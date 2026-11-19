import XCTest
@testable import Kooyu

final class StatusBadgeTests: XCTestCase {
    private func session(_ extra: String) throws -> HostSession {
        let raw = #"{"id":"s","title":"t","harnessId":"codex","archived":false,"# + extra + "}"
        return try JSONDecoder().decode(HostSession.self, from: Data(raw.utf8))
    }

    func testEveryStateHasWords() throws {
        XCTAssertEqual(sessionStatus(try session(#""runState":"running""#)), SessionStatus(label: "运行中", tone: .running))
        XCTAssertEqual(sessionStatus(try session(#""runState":"waiting-input""#)), SessionStatus(label: "需确认", tone: .attention))
        XCTAssertEqual(sessionStatus(try session(#""runState":"idle""#)), SessionStatus(label: "就绪", tone: .ready))
        XCTAssertEqual(sessionStatus(try session(#""runState":"failed""#)), SessionStatus(label: "异常", tone: .error))
        XCTAssertEqual(sessionStatus(try session(#""runState":"unknown""#)).label, "待核对")
    }

    func testIdleRefinesDraftAndNativeConnection() throws {
        XCTAssertEqual(sessionStatus(try session(#""runState":"idle","phase":"draft""#)).label, "未启动")
        XCTAssertEqual(sessionStatus(try session(#""runState":"idle","connectionState":"offline""#)).label, "未连接")
        XCTAssertTrue(sessionStatus(try session(#""runState":"idle","connectionState":"reconnecting""#)).pulses)
        XCTAssertFalse(sessionStatus(try session(#""runState":"idle""#)).pulses)
    }
}
