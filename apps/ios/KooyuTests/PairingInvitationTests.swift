import XCTest
@testable import Kooyu

final class PairingInvitationTests: XCTestCase {
    private let address = "https://relay.example.com/h/" + String(repeating: "a", count: 64)
    private let code = "0123456789abcdef0123456789abcdef"

    func testPreservesRelayIdentityAndNormalizesInvitation() throws {
        XCTAssertEqual(try PairingInvitation.parse("  " + address + "/#pair=" + code + "  "),
                       PairingInvitation(address: address, code: code.uppercased()))
        XCTAssertEqual(try PairingInvitation.parse("https://desktop.example:8443/#pair=" + code),
                       PairingInvitation(address: "https://desktop.example:8443", code: code.uppercased()))
    }

    func testRejectsOtherQRCodesAndAmbiguousDestinations() {
        let invalid = [
            "", "not a URL", "javascript:alert(1)", "http://desktop.example/#pair=" + code,
            address, address + "?pair=" + code, address + "#pair=1234", address + "#pair=" + String(repeating: "g", count: 32),
            address + "?extra=1#pair=" + code, address + "#pair=" + code + "&pair=" + code,
            address + "#pair=" + code + "#more", address + "#pair=%30" + String(code.dropFirst()),
            "https://user:password@relay.example.com/#pair=" + code,
            "https://relay.example.com/h/not-a-host/#pair=" + code,
            address + "/../#pair=" + code, address + "/%2e%2e/#pair=" + code,
            "https://relay.example.com/api/#pair=" + code,
            "https://relay.example.com/#pair=" + code + String(repeating: "x", count: 2048)
        ]
        for value in invalid { XCTAssertThrowsError(try PairingInvitation.parse(value)) }
    }
}
