import AppIntents
import Foundation

@available(iOS 17.0, *)
struct OneMoreChallengeEntity: AppEntity, Hashable {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Challenge")
  static var defaultQuery = OneMoreChallengeQuery()

  let id: String
  let name: String
  let shared: Bool

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: LocalizedStringResource(stringLiteral: name),
      subtitle: shared ? "Shared" : "Personal"
    )
  }
}

@available(iOS 17.0, *)
struct OneMoreChallengeQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [OneMoreChallengeEntity] {
    let wanted = Set(identifiers)
    return available().filter { wanted.contains($0.id) }
  }

  func suggestedEntities() async throws -> [OneMoreChallengeEntity] { available() }

  private func available() -> [OneMoreChallengeEntity] {
    guard let envelope = OneMoreWidgetStateStore.read(),
          let snapshot = envelope.snapshot, snapshot.hasValidAccountScope() else { return [] }
    return snapshot.challenges.map {
      OneMoreChallengeEntity(id: $0.challengeId, name: $0.challengeName, shared: $0.challengeType == "shared")
    }
  }
}

@available(iOS 17.0, *)
struct OneMoreWidgetConfigurationIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Widget challenges"
  static var description = IntentDescription("Choose challenges shown by this widget.")

  @Parameter(title: "Challenge 1") var challenge1: OneMoreChallengeEntity?
  @Parameter(title: "Challenge 2") var challenge2: OneMoreChallengeEntity?
  @Parameter(title: "Challenge 3") var challenge3: OneMoreChallengeEntity?
  @Parameter(title: "Challenge 4") var challenge4: OneMoreChallengeEntity?
  @Parameter(title: "Challenge 5") var challenge5: OneMoreChallengeEntity?

  init() {}

  var selectedChallengeIds: [String] {
    var seen = Set<String>()
    return [challenge1, challenge2, challenge3, challenge4, challenge5]
      .compactMap { $0?.id }
      .filter { seen.insert($0).inserted }
  }

  var stableKey: String { stableConfigurationKey(selectedChallengeIds) }
}
