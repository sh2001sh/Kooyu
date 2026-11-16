package app.kooyu.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.CameraPreview
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

/** Private in-app camera screen; no external barcode app or cloud recognition. */
class QrScannerActivity : ComponentActivity() {
    companion object { const val EXTRA_INVITATION = "app.kooyu.android.PAIRING_QR" }
    private var delivered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_SECURE)
        setContent { MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFFF947D), onPrimary = Color(0xFF571A10))) { Scanner() } }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable private fun Scanner() {
        var error by remember { mutableStateOf("") }
        var torch by remember { mutableStateOf(false) }
        val preview = remember {
            DecoratedBarcodeView(this).apply {
                setStatusText("")
                barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
                barcodeView.addStateListener(object : CameraPreview.StateListener {
                    override fun previewSized() {}
                    override fun previewStarted() {}
                    override fun previewStopped() {}
                    override fun cameraClosed() {}
                    override fun cameraError(exception: Exception) { error = "无法使用相机，请关闭其他相机应用后重试，或手动输入。" }
                })
                decodeSingle(object : BarcodeCallback {
                    override fun barcodeResult(result: BarcodeResult) {
                        if (delivered || isFinishing) return
                        delivered = true
                        pause()
                        setResult(RESULT_OK, Intent().putExtra(EXTRA_INVITATION, result.text))
                        finish()
                    }
                })
            }
        }
        DisposableEffect(preview, lifecycle) {
            var running = false
            fun resumeCamera() {
                if (running || delivered) return
                if (ContextCompat.checkSelfPermission(this@QrScannerActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    error = "相机权限已关闭，请返回连接页重新允许。"
                    return
                }
                running = true
                preview.resume()
            }
            fun pauseCamera() { if (running) { preview.pause(); running = false } }
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_RESUME -> resumeCamera()
                    Lifecycle.Event.ON_PAUSE -> pauseCamera()
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) resumeCamera()
            onDispose { lifecycle.removeObserver(observer); pauseCamera() }
        }
        Scaffold(topBar = {
            TopAppBar(title = { Text("扫描桌面二维码") }, navigationIcon = { TextButton(onClick = { finish() }) { Text("取消") } }, actions = {
                if (packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)) TextButton(onClick = {
                    torch = !torch
                    if (torch) preview.setTorchOn() else preview.setTorchOff()
                }) { Text(if (torch) "关闭补光" else "开启补光") }
            })
        }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (error.isEmpty()) AndroidView(factory = { preview }, modifier = Modifier.weight(1f).fillMaxWidth())
                else Box(Modifier.weight(1f).fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { Text(error) }
            }
        }
    }
}
