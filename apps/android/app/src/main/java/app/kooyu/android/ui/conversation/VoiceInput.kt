package app.kooyu.android.ui.conversation

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.kooyu.android.ui.theme.*
import kotlin.math.max
import kotlin.math.min

/** Smoothly merges voice dictation text into an existing draft with ASCII-aware spacing. */
fun appendVoiceTranscript(current: String, addition: String): String {
    val clean = addition.trim()
    if (clean.isEmpty()) return current
    if (current.isBlank()) return clean
    if (current.last().isWhitespace()) return current + clean
    val last = current.last()
    val first = clean.first()
    return if (last.isLetterOrDigit() && last.code < 128 && first.isLetterOrDigit() && first.code < 128) {
        "$current $clean"
    } else {
        current + clean
    }
}

class VoiceInputController(
    val listening: Boolean,
    val interim: String,
    val level: Float,
    val error: String,
    val toggle: () -> Unit,
    val stop: () -> Unit,
    val cancel: () -> Unit,
    val clearError: () -> Unit,
)

private fun speechTagForLocale(locale: String): String = when (locale) {
    "en" -> "en-US"
    "ja" -> "ja-JP"
    else -> "zh-CN"
}

@Composable
fun rememberVoiceInputController(
    onTranscript: (String) -> Unit,
): VoiceInputController {
    val context = LocalContext.current
    val locale = LocalKooyuLocale.current
    val permDeniedMsg = kooyuT("voice.err.permission")
    val unavailableMsg = kooyuT("voice.err.unavailable")
    val latestOnTranscript by rememberUpdatedState(onTranscript)

    var listening by remember { mutableStateOf(false) }
    var interim by remember { mutableStateOf("") }
    var level by remember { mutableFloatStateOf(0.18f) }
    var error by remember { mutableStateOf("") }
    var recognizer by remember { mutableStateOf<SpeechRecognizer?>(null) }
    var cancelled by remember { mutableStateOf(false) }
    val disposed = remember { java.util.concurrent.atomic.AtomicBoolean(false) }

    fun releaseRecognizer() {
        try {
            recognizer?.destroy()
        } catch (_: Throwable) {}
        recognizer = null
        listening = false
        level = 0.18f
    }

    val intentFallbackLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        listening = false
        if (result.resultCode == Activity.RESULT_OK) {
            val matches = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val best = matches?.firstOrNull()?.trim().orEmpty()
            if (best.isNotEmpty()) latestOnTranscript(best)
        }
    }

    fun startRecognition() {
        error = ""
        interim = ""
        cancelled = false
        val speechLang = speechTagForLocale(locale)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            try {
                listening = true
                intentFallbackLauncher.launch(intent)
            } catch (_: Throwable) {
                listening = false
                error = unavailableMsg
            }
            return
        }

        releaseRecognizer()
        val sr = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = sr
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                listening = true
            }
            override fun onBeginningOfSpeech() {
                listening = true
            }
            override fun onRmsChanged(rmsdB: Float) {
                level = min(1f, max(0.16f, (rmsdB + 2f) / 12f))
            }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(errCode: Int) {
                if (recognizer !== sr || disposed.get()) return
                val partial = interim.trim()
                interim = ""
                releaseRecognizer()
                if (!cancelled && partial.isNotEmpty()) {
                    latestOnTranscript(partial)
                    return
                }
                if (!cancelled && errCode != SpeechRecognizer.ERROR_NO_MATCH && errCode != SpeechRecognizer.ERROR_CLIENT) {
                    error = if (errCode == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) permDeniedMsg else unavailableMsg
                }
            }
            override fun onResults(results: Bundle?) {
                if (recognizer !== sr || disposed.get()) return
                val best = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                val finalText = best.ifEmpty { interim.trim() }
                interim = ""
                releaseRecognizer()
                if (!cancelled && finalText.isNotEmpty()) {
                    latestOnTranscript(finalText)
                }
            }
            override fun onPartialResults(partialResults: Bundle?) {
                if (recognizer !== sr || disposed.get()) return
                val part = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                if (part.isNotEmpty()) interim = part
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        try {
            listening = true
            sr.startListening(intent)
        } catch (_: Throwable) {
            releaseRecognizer()
            error = unavailableMsg
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!disposed.get() && !cancelled) {
            if (granted) startRecognition() else error = permDeniedMsg
        }
    }

    DisposableEffect(Unit) {
        onDispose { disposed.set(true); cancelled = true; releaseRecognizer() }
    }

    return VoiceInputController(
        listening = listening,
        interim = interim,
        level = level,
        error = error,
        toggle = {
            if (listening) {
                try {
                    recognizer?.stopListening()
                } catch (_: Throwable) {
                    val partial = interim.trim()
                    interim = ""
                    releaseRecognizer()
                    if (partial.isNotEmpty()) latestOnTranscript(partial)
                }
            } else {
                cancelled = false
                val hasPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                if (hasPerm) startRecognition() else permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        },
        stop = {
            if (listening) {
                try {
                    recognizer?.stopListening()
                } catch (_: Throwable) {
                    val partial = interim.trim()
                    interim = ""
                    releaseRecognizer()
                    if (partial.isNotEmpty()) latestOnTranscript(partial)
                }
            }
        },
        cancel = {
            cancelled = true
            interim = ""
            error = ""
            try {
                recognizer?.cancel()
            } catch (_: Throwable) {}
            releaseRecognizer()
        },
        clearError = { error = "" },
    )
}

@Composable
fun VoiceMicButton(
    controller: VoiceInputController,
    enabled: Boolean,
) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val label = if (controller.listening) kooyuT("voice.stop") else kooyuT("voice.start")
    val bg by animateColorAsState(
        if (controller.listening) c.brandCoral else c.sunken,
        KooyuMotion.snap(),
        label = "voiceBg"
    )
    val fg by animateColorAsState(
        if (controller.listening) Color.White else if (enabled) c.textSecondary else c.textTertiary,
        KooyuMotion.snap(),
        label = "voiceFg"
    )

    Box(
        Modifier
            .size(44.dp)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                controller.toggle()
            }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(bg)
                .border(0.5.dp, if (controller.listening) Color.Transparent else c.borderSubtle, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                if (controller.listening) Icons.Filled.Stop else Icons.Outlined.Mic,
                null,
                modifier = Modifier.size(if (controller.listening) 15.dp else 18.dp),
                tint = fg
            )
        }
    }
}

@Composable
fun VoiceListeningStrip(controller: VoiceInputController) {
    val c = Kooyu.colors
    if (!controller.listening && controller.error.isBlank()) return

    if (controller.error.isNotBlank() && !controller.listening) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = c.destructiveTint,
            border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.28f)),
            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp, end = 6.dp)
        ) {
            Row(
                Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    controller.error,
                    fontSize = 12.sp,
                    color = c.destructive,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = controller.clearError, modifier = Modifier.size(26.dp)) {
                    Icon(Icons.Outlined.Close, null, Modifier.size(14.dp), tint = c.destructive)
                }
            }
        }
        return
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = c.brandCoralTint,
        border = BorderStroke(0.5.dp, c.brandCoral.copy(alpha = 0.28f)),
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp, end = 6.dp)
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val scales = listOf(0.55f, 0.85f, 1f, 0.75f, 0.5f)
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.height(16.dp)
            ) {
                scales.forEachIndexed { idx, factor ->
                    val h by animateFloatAsState(
                        min(1f, max(0.2f, controller.level * factor)),
                        label = "bar$idx"
                    )
                    Box(
                        Modifier
                            .width(2.5.dp)
                            .height(14.dp)
                            .graphicsLayer { scaleY = h }
                            .clip(CircleShape)
                            .background(c.brandCoral)
                    )
                }
            }
            Text(
                controller.interim.ifBlank { kooyuT("voice.listening") },
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Medium,
                color = c.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = controller.cancel, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Outlined.Close, kooyuT("voice.cancel"), Modifier.size(15.dp), tint = c.textSecondary)
            }
            Box(
                Modifier
                    .size(26.dp)
                    .clip(CircleShape)
                    .background(c.accent)
                    .clickable(onClick = controller.stop),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Outlined.Check, kooyuT("voice.stop"), Modifier.size(14.dp), tint = c.onAccent)
            }
        }
    }
}
