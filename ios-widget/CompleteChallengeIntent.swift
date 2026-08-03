import AppIntents
import Foundation
import WidgetKit

@available(iOS 17.0, *)
struct CompleteChallengeIntent: AppIntent {
  static var title: LocalizedStringResource = "Complete challenge"
  static var description = IntentDescription("Records one completion in OneMore.")
  static var openAppWhenRun = false
  static var isDiscoverable = false

  @Parameter(title: "Challenge") var challengeId: String
  @Parameter(title: "Type") var challengeType: String
  @Parameter(title: "Date") var date: String
  @Parameter(title: "Expected progress") var expectedDoneBefore: Int
  @Parameter(title: "Widget configuration") var configurationKey: String

  init() {}

  init(challengeId: String, challengeType: String, date: String, expectedDoneBefore: Int, configurationKey: String) {
    self.challengeId = challengeId
    self.challengeType = challengeType
    self.date = date
    self.expectedDoneBefore = expectedDoneBefore
    self.configurationKey = configurationKey
  }

  func perform() async throws -> some IntentResult {
    // Refresh first so a renewed subscription can authorize a tap even when
    // the previously rendered snapshot reached its old expiration meanwhile.
    await WidgetNetworkClient.refreshPremiumIfNeeded(force: true)
    // The UID is deliberately not accepted from the intent. The atomically
    // coordinated store derives it from the active, UID-scoped snapshot and
    // validates Premium, type, date, selection and expected progress again.
    let mutation = try OneMoreWidgetStateStore.enqueueCompletion(
      challengeId: challengeId,
      challengeType: challengeType,
      date: date,
      expectedDoneBefore: expectedDoneBefore,
      configurationKey: configurationKey
    )
    WidgetCenter.shared.reloadAllTimelines()
    guard let mutation else { return .result() }
    do {
      _ = try await WidgetNetworkClient.complete(mutation)
      try? OneMoreWidgetStateStore.acknowledge([mutation.mutationId])
    } catch WidgetNetworkError.rejected(let permanent) where permanent {
      // Permission/Premium/schedule rejections are authoritative. Transient
      // network failures deliberately leave the optimistic mutation in outbox.
      try? OneMoreWidgetStateStore.rejectCompletion(mutation.mutationId)
    } catch {
      // Offline outbox is replayed either by the extension or the main app.
    }
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}
