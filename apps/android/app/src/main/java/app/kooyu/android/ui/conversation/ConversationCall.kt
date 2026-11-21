package app.kooyu.android.ui.conversation

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import app.kooyu.android.Workbench
import app.kooyu.android.WorkbenchState
import app.kooyu.android.ui.theme.Kooyu
import app.kooyu.android.ui.theme.KooyuType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ConversationCall(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    val c = Kooyu.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ready by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    val active = remember { java.util.concurrent.atomic.AtomicBoolean(true) }
    val seen = remember { state.events.maxOfOrNull { it.optInt("sequence") } ?: 0 }
    var cursor by remember { mutableIntStateOf(seen) }
    var synth by remember { mutableStateOf<TextToSpeech?>(null) }
    val handler = remember { Handler(Looper.getMainLooper()) }
    val voice = rememberVoiceInputController {
        if (active.get() && !speaking && !sending) {
            sending = true
            scope.launch {
                try { if (!model.send(it)) failure = "设备未确认语音消息。" }
                finally { sending = false }
            }
        }
    }
    val stopListening by rememberUpdatedState(voice.cancel)
    DisposableEffect(Unit) {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val previous = audio.mode
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        val engine = TextToSpeech(context) { status ->
            handler.post {
                if (active.get()) {
                    ready = status == TextToSpeech.SUCCESS && SpeechRecognizer.isRecognitionAvailable(context)
                    if (!ready) failure = "设备语音识别或播报服务不可用。"
                }
            }
        }
        synth = engine
        var lastUtterance = ""
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) { handler.post { lastUtterance = id } }
            override fun onDone(id: String) { handler.post { if (active.get() && lastUtterance == id && !engine.isSpeaking) speaking = false } }
            override fun onError(id: String) { handler.post { if (active.get()) failure = "语音播报中断。" } }
        })
        onDispose {
            active.set(false)
            stopListening()
            engine.stop()
            engine.shutdown()
            if (audio.mode == AudioManager.MODE_IN_COMMUNICATION) audio.mode = previous
        }
    }
    LaunchedEffect(state.events, ready) {
        if (!ready) return@LaunchedEffect
        for (event in state.events) {
            val sequence = event.optInt("sequence")
            if (sequence <= cursor) continue
            cursor = sequence
            val payload = event.optJSONObject("payload") ?: continue
            if (event.optString("type") != "message" || payload.optString("role", "assistant") != "assistant") continue
            val row = state.transcript.rows.lastOrNull { event.optString("id") in it.eventIds && it.role == "assistant" } ?: continue
            if (row.text.isBlank()) continue
            speaking = true
            voice.cancel()
            for ((n, part) in row.text.chunked(TextToSpeech.getMaxSpeechInputLength()).withIndex())
                if (synth?.speak(part, TextToSpeech.QUEUE_ADD, null, "$sequence-$n") != TextToSpeech.SUCCESS) failure = "语音播报失败。"
        }
    }
    LaunchedEffect(ready, speaking, sending, voice.listening, voice.error, failure, state.canWrite) {
        if (ready && state.canWrite && !speaking && !sending && !voice.listening && voice.error.isBlank() && failure.isBlank()) {
            delay(320)
            voice.toggle()
        }
    }

    val statusText = failure.ifEmpty {
        voice.error.ifEmpty {
            when {
                speaking -> "正在播报回复…"
                sending -> "正在发送…"
                !state.online -> "设备离线"
                else -> voice.interim.ifEmpty { if (ready) "正在聆听…" else "正在打开语音服务…" }
            }
        }
    }
    val hasError = failure.isNotEmpty() || voice.error.isNotEmpty()

    Dialog(onDismissRequest = close) {
        Surface(
            shape = RoundedCornerShape(22.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.border),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Box(
                    Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(if (hasError) c.destructiveTint else c.brandCoral.copy(alpha = 0.14f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Outlined.GraphicEq,
                        contentDescription = null,
                        tint = if (hasError) c.destructive else c.brandCoral,
                        modifier = Modifier.size(28.dp)
                    )
                }
                Text("语音通话", style = KooyuType.pageTitle, color = c.text)
                Text(
                    statusText,
                    style = KooyuType.body,
                    color = if (hasError) c.destructive else c.textSecondary,
                    textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(4.dp))
                Button(
                    onClick = close,
                    shape = RoundedCornerShape(999.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.destructive, contentColor = Color.White),
                    contentPadding = PaddingValues(horizontal = 24.dp, vertical = 10.dp)
                ) {
                    Icon(Icons.Outlined.CallEnd, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("结束通话", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
    }
}
