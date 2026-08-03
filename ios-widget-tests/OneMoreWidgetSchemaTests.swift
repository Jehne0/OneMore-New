import XCTest
@testable import OneMoreWidget

final class OneMoreWidgetSchemaTests: XCTestCase {
  func testSharedFixtureDecodesWithSchemaV2AndUidScope() throws {
    let fixture = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("tests/fixtures/ios-widget-schema-v2.json")
    let snapshot = try JSONDecoder().decode(OneMoreWidgetSnapshot.self, from: Data(contentsOf: fixture))
    XCTAssertEqual(snapshot.version, OneMoreWidgetConstants.schemaVersion)
    XCTAssertTrue(snapshot.hasValidAccountScope())
    XCTAssertEqual(snapshot.challenges.map(\.challengeType), ["personal", "shared"])
    XCTAssertEqual(snapshot.challenges[1].timelineDays[0].done, 1)
  }

  func testExpirationIsEvaluatedAgainstCurrentTime() throws {
    let fixture = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("tests/fixtures/ios-widget-schema-v2.json")
    let snapshot = try JSONDecoder().decode(OneMoreWidgetSnapshot.self, from: Data(contentsOf: fixture))
    XCTAssertTrue(snapshot.isPremiumActive(at: ISO8601DateFormatter.oneMore.date(from: "2026-07-20T09:59:59.000Z")!))
    XCTAssertFalse(snapshot.isPremiumActive(at: ISO8601DateFormatter.oneMore.date(from: "2026-07-20T10:00:00.000Z")!))
  }
}
