package app.kooyu.android

import android.graphics.Matrix
import android.graphics.PathMeasure
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser
import kotlinx.coroutines.delay

private const val KOOYU_LOGO_PATH_DATA =
    "M804.63,796.12 C767.56,799.78 733.03,788.56 700.97,772.58 C673.26,758.76 647.40,741.39 622.93,721.18 " +
    "C576.45,682.78 534.98,634.13 499.70,586.13 C490.60,573.74 481.91,561.40 472.15,551.32 C470.95,550.09 " +
    "469.74,548.89 468.56,548.98 C467.37,549.06 466.20,550.44 465.02,552.00 C462.66,555.11 460.23,558.93 " +
    "457.79,562.35 C453.02,569.03 448.18,574.20 443.20,579.60 C433.21,590.45 422.61,602.28 411.58,613.12 " +
    "C400.57,623.93 389.12,633.75 377.43,642.91 C351.95,662.85 325.33,679.62 296.06,690.62 C279.38,696.89 " +
    "261.84,701.30 243.33,702.77 C224.11,704.30 203.85,702.67 186.21,695.95 C156.60,684.66 134.41,659.01 " +
    "124.63,628.58 C118.71,610.15 117.33,589.98 118.65,570.64 C119.89,552.45 123.51,535.01 129.27,518.21 " +
    "C139.44,488.52 156.30,460.83 177.55,436.45 C197.76,413.26 221.93,393.06 248.82,379.15 C280.87,362.56 " +
    "316.78,354.91 353.00,358.88 C370.48,360.80 388.04,365.42 402.47,375.40 C415.05,384.09 425.26,396.83 " +
    "430.93,410.60 C434.19,418.53 435.95,426.79 439.87,434.48 C441.64,437.94 443.84,441.29 446.10,444.77 " +
    "C448.24,448.08 450.44,451.52 452.91,451.29 C455.32,451.07 457.99,447.36 460.40,444.09 C462.86,440.75 " +
    "465.05,437.86 467.32,434.93 C471.86,429.07 476.74,423.02 481.50,416.97 C500.78,392.45 517.91,368.01 " +
    "536.99,343.68 C574.23,296.22 618.90,249.20 667.99,216.41 C695.29,198.17 723.95,184.33 755.45,175.05 " +
    "C791.46,164.44 831.19,159.79 868.23,168.39 C877.09,170.44 885.80,173.25 894.34,176.80 C901.63,179.81 " +
    "908.79,183.36 912.64,189.42 C917.22,196.65 917.07,207.45 915.65,216.77 C914.29,225.61 911.78,233.11 " +
    "908.59,240.67 C897.26,267.50 877.36,295.07 854.35,316.65 C805.72,362.26 743.19,381.11 683.51,403.52 " +
    "C652.82,415.05 622.89,427.51 593.15,441.52 C578.51,448.42 563.92,455.70 549.24,462.72 C535.01,469.54 " +
    "520.70,476.11 511.76,488.97 C507.30,495.39 504.18,503.38 498.97,509.80 C496.52,512.81 493.62,515.48 " +
    "491.52,518.44 C489.26,521.63 487.93,525.16 489.64,527.28 C491.48,529.55 496.79,530.22 501.41,531.16 " +
    "C506.13,532.12 510.11,533.36 514.19,534.49 C522.60,536.82 531.40,538.64 540.25,540.40 C576.33,547.54 " +
    "613.27,553.49 649.41,560.47 C684.28,567.22 718.40,574.92 751.23,587.43 C780.15,598.45 808.06,613.19 " +
    "830.22,636.57 C841.21,648.18 850.79,661.91 857.00,676.01 C864.22,692.42 866.88,709.33 866.11,728.04 " +
    "C865.37,746.11 861.44,765.86 849.99,778.08 C839.16,789.62 821.63,794.43 804.63,796.12 Z " +
    "M237.75,612.21 C266.35,608.59 290.37,596.15 313.90,581.45 C334.92,568.33 355.54,553.41 374.64,536.36 " +
    "C383.97,528.02 392.93,519.18 402.52,510.01 C407.31,505.43 412.26,500.76 416.37,496.05 C418.31,493.81 " +
    "420.07,491.57 420.45,489.28 C420.87,486.77 419.64,484.21 418.12,481.67 C412.38,472.08 402.57,462.80 " +
    "392.61,455.04 C381.73,446.57 370.66,439.92 358.68,435.48 C330.96,425.21 298.32,426.76 270.46,438.96 " +
    "C247.47,449.03 227.75,466.37 212.51,486.42 C195.33,509.02 183.84,535.08 182.03,563.53 C181.52,571.56 " +
    "181.79,579.79 184.49,587.53 C186.65,593.71 190.37,599.58 195.08,603.77 C206.10,613.57 222.57,614.13 " +
    "237.75,612.21 Z"

/**
 * Animated opening sequence that draws and forms the Kooyu ribbon brand logo.
 * The ribbon sweeps across following the contours, illuminates into the solid mark,
 * and dissolves smoothly into the application without any static splash screen.
 */
@Composable
fun MobiusSplashScreen(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val strokeProgress = remember { Animatable(0f) }
    val fillAlpha = remember { Animatable(0f) }
    val scale = remember { Animatable(0.92f) }
    val overlayAlpha = remember { Animatable(1f) }

    LaunchedEffect(Unit) {
        // Phase 1: Ribbon flows and traces the logo contour
        strokeProgress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 600, easing = FastOutSlowInEasing)
        )
        // Phase 2: Logo illuminates and settles into solid emblem
        fillAlpha.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 260, easing = LinearEasing)
        )
        scale.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 180, easing = FastOutSlowInEasing)
        )
        delay(120)
        // Phase 3: Dissolve into app
        overlayAlpha.animateTo(
            targetValue = 0f,
            animationSpec = tween(durationMillis = 200, easing = LinearEasing)
        )
        onDismiss()
    }

    val dark = Kooyu.colors.dark
    val bg = if (dark) Color(0xFF0C0E14) else Color(0xFFFFFFFF)
    val coral = Color(0xFFF17561)

    val rawPath = remember {
        PathParser.createPathFromPathData(KOOYU_LOGO_PATH_DATA)
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(bg.copy(alpha = overlayAlpha.value))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss
            ),
        contentAlignment = Alignment.Center
    ) {
        Canvas(
            modifier = Modifier.size(190.dp)
        ) {
            val canvasW = size.width
            val canvasH = size.height

            // Scale and center the 848x704 vector path into the canvas
            val scaleFactor = minOf(canvasW / 848f, canvasH / 704f) * 0.95f * scale.value
            val matrix = Matrix().apply {
                postTranslate(-96f, -128f)
                postScale(scaleFactor, scaleFactor)
                val transformedW = (848f - 96f) * scaleFactor
                val transformedH = (704f - 128f) * scaleFactor
                val offsetX = (canvasW - transformedW) / 2f
                val offsetY = (canvasH - transformedH) / 2f
                postTranslate(offsetX, offsetY)
            }

            val transformedAndroidPath = android.graphics.Path()
            rawPath.transform(matrix, transformedAndroidPath)
            transformedAndroidPath.fillType = android.graphics.Path.FillType.EVEN_ODD
            val transformedComposePath = transformedAndroidPath.asComposePath()

            val p = strokeProgress.value
            val currentFill = fillAlpha.value
            val curAlpha = overlayAlpha.value

            // 1. Draw solid filled logo when illuminated
            if (currentFill > 0.01f) {
                drawPath(
                    path = transformedComposePath,
                    color = coral.copy(alpha = currentFill * curAlpha),
                    style = Fill
                )
            }

            // 2. Draw animated sweeping ribbon outline
            if (p < 0.99f || currentFill < 0.95f) {
                val measure = PathMeasure(transformedAndroidPath, false)
                val totalLength = measure.length
                val animatedAndroidPath = android.graphics.Path()
                measure.getSegment(0f, totalLength * p, animatedAndroidPath, true)

                drawPath(
                    path = animatedAndroidPath.asComposePath(),
                    color = Color(0xFFFF9A76).copy(alpha = (1f - currentFill * 0.5f) * curAlpha),
                    style = Stroke(
                        width = 3.5.dp.toPx(),
                        cap = androidx.compose.ui.graphics.StrokeCap.Round
                    )
                )

                // Glowing particle at the active drawing tip
                if (p in 0.02f..0.98f) {
                    val pos = floatArrayOf(0f, 0f)
                    val tan = floatArrayOf(0f, 0f)
                    measure.getPosTan(totalLength * p, pos, tan)
                    drawCircle(
                        color = Color.White.copy(alpha = 0.9f * curAlpha),
                        radius = 4.5.dp.toPx(),
                        center = Offset(pos[0], pos[1])
                    )
                    drawCircle(
                        color = coral.copy(alpha = 0.5f * curAlpha),
                        radius = 8.5.dp.toPx(),
                        center = Offset(pos[0], pos[1])
                    )
                }
            }
        }
    }
}
