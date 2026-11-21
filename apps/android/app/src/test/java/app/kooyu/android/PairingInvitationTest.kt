package app.kooyu.android

import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.*
import org.junit.Test

class PairingInvitationTest {
    private val address = "https://relay.example.com/h/" + "a".repeat(64)
    private val code = "0123456789abcdef0123456789abcdef"

    @Test fun preservesRelayIdentityAndNormalizesInvitation() {
        assertEquals(PairingInvitation(address, code.uppercase()), PairingInvitation.parse("  " + address + "/#pair=" + code + "  "))
        assertEquals(PairingInvitation("https://desktop.example:8443", code.uppercase()), PairingInvitation.parse("https://desktop.example:8443/#pair=" + code))
    }

    @Test fun readsARealDesktopFormatQrImage() {
        val matrix = QRCodeWriter().encode(address + "/#pair=" + code, BarcodeFormat.QR_CODE, 512, 512)
        val pixels = IntArray(matrix.width * matrix.height) { index -> if (matrix[index % matrix.width, index / matrix.width]) -16777216 else -1 }
        val bitmap = BinaryBitmap(HybridBinarizer(RGBLuminanceSource(matrix.width, matrix.height, pixels)))
        val decoded = QRCodeReader().decode(bitmap)
        assertEquals(PairingInvitation(address, code.uppercase()), PairingInvitation.parse(decoded.text))
    }

    @Test fun rejectsOtherQrCodesAndAmbiguousDestinations() {
        val invalid = listOf(
            "", "not a URL", "javascript:alert(1)", "http://desktop.example/#pair=" + code,
            address, address + "?pair=" + code, address + "#pair=1234", address + "#pair=" + "g".repeat(32),
            address + "?extra=1#pair=" + code, address + "#pair=" + code + "&pair=" + code,
            address + "#pair=" + code + "#more", address + "#pair=%30" + code.drop(1),
            "https://user:password@relay.example.com/#pair=" + code,
            "https://relay.example.com/h/not-a-host/#pair=" + code,
            address + "/../#pair=" + code, address + "/%2e%2e/#pair=" + code,
            "https://relay.example.com/api/#pair=" + code,
            "https://relay.example.com/#pair=" + code + "x".repeat(2048)
        )
        invalid.forEach { value -> assertThrows(IllegalArgumentException::class.java) { PairingInvitation.parse(value) } }
    }
}
