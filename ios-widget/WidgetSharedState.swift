import Foundation

enum OneMoreWidgetConstants {
  static let appGroup = "group.eu.desigame.onemore"
  static let schemaVersion = 2
  static let stateFile = "onemore-widget-state-v2.json"
  static let backupFile = "onemore-widget-state-v2.backup.json"
}

struct WidgetWeekDay: Codable, Hashable {
  var date: String
  var kind: String
  var done: Int
  var target: Int
}

struct WidgetDailyState: Codable, Hashable {
  var date: String
  var done: Int
  var target: Int
  var completed: Bool
  var active: Bool
  var dayState: String
  var week: [WidgetWeekDay]
}

struct WidgetChallengeSnapshot: Codable, Identifiable, Hashable {
  var id: String { challengeId }
  var challengeId: String
  var challengeName: String
  var challengeType: String
  var currentStreak: Int
  var bestStreak: Int
  var todayDone: Int
  var todayTarget: Int
  var todayCompleted: Bool
  var isActiveToday: Bool
  var dayState: String
  var lockedByPremiumExpiration: Bool
  var week: [WidgetWeekDay]
  var timelineDays: [WidgetDailyState]

  func projected(to date: String) -> WidgetChallengeSnapshot {
    guard date != timelineDays.first?.date,
          let day = timelineDays.first(where: { $0.date == date }) else { return self }
    var copy = self
    copy.todayDone = day.done
    copy.todayTarget = day.target
    copy.todayCompleted = day.completed
    copy.isActiveToday = day.active
    copy.dayState = day.dayState
    copy.week = day.week
    return copy
  }
}

struct WidgetConfigurationSnapshot: Codable, Hashable {
  var version: Int
  var configurationKey: String
  var orderedChallengeIds: [String]
  var premiumSelectedChallengeIds: [String]
  var premiumSelectionRecorded: Bool
  var lastPremiumActive: Bool?
  var updatedAtISO: String
}

struct OneMoreWidgetSnapshot: Codable, Hashable {
  var version: Int
  var snapshotRevision: Int
  var sessionState: String
  var activeUid: String?
  var accountUid: String?
  var locale: String
  var premium: Bool
  var premiumState: String
  var premiumExpirationDate: String?
  var premiumLifetime: Bool
  var defaultConfiguration: WidgetConfigurationSnapshot
  var selectedChallengeIds: [String]
  var challenges: [WidgetChallengeSnapshot]
  var completedToday: Int
  var countableToday: Int
  var generatedAtISO: String
  var generatedForDate: String
  var timeZoneIdentifier: String

  func hasValidAccountScope() -> Bool {
    version == OneMoreWidgetConstants.schemaVersion && sessionState == "authenticated"
      && activeUid != nil && activeUid == accountUid
  }

  func isPremiumActive(at date: Date) -> Bool {
    guard hasValidAccountScope(), premiumState == "premium" else { return false }
    if premiumLifetime { return true }
    guard let value = premiumExpirationDate,
          let expiration = parseISODate(value) else { return false }
    return expiration > date
  }
}

struct WidgetMutation: Codable, Hashable {
  var mutationId: String
  var uid: String
  var challengeId: String
  var challengeType: String
  var date: String
  var expectedDoneBefore: Int
  var createdAtISO: String
}

struct StoredWidgetConfiguration: Codable, Hashable {
  var version: Int
  var configurationKey: String
  var orderedChallengeIds: [String]
  var premiumSelectedChallengeIds: [String]
  var premiumSelectionRecorded: Bool
  var lastPremiumActive: Bool?
  var updatedAtISO: String
}

struct WidgetStateEnvelope: Codable {
  var schemaVersion: Int
  var revision: Int
  var activeUid: String?
  var sessionState: String
  var snapshot: OneMoreWidgetSnapshot?
  var configurations: [String: StoredWidgetConfiguration]
  var outbox: [WidgetMutation]
  var updatedAtISO: String

  static func empty(sessionState: String = "restoring") -> WidgetStateEnvelope {
    WidgetStateEnvelope(
      schemaVersion: OneMoreWidgetConstants.schemaVersion,
      revision: 0,
      activeUid: nil,
      sessionState: sessionState,
      snapshot: nil,
      configurations: [:],
      outbox: [],
      updatedAtISO: ISO8601DateFormatter.oneMore.string(from: Date())
    )
  }
}

struct ResolvedWidgetSelection {
  var key: String
  var rows: [WidgetChallengeSnapshot]
  var activeIds: Set<String>
  var frozenIds: Set<String>
  var premiumActive: Bool
  var premiumChecking: Bool
}

enum WidgetStateError: Error {
  case appGroupUnavailable
  case invalidSnapshot
  case invalidAction
}

extension ISO8601DateFormatter {
  static let oneMore: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  static let oneMoreWithoutFractions: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()
}

func parseISODate(_ value: String) -> Date? {
  ISO8601DateFormatter.oneMore.date(from: value)
    ?? ISO8601DateFormatter.oneMoreWithoutFractions.date(from: value)
}

enum OneMoreWidgetStateStore {
  private static let queue = DispatchQueue(label: "eu.desigame.onemore.widget-state")
  private static let encoder: JSONEncoder = {
    let value = JSONEncoder()
    value.outputFormatting = [.sortedKeys]
    return value
  }()
  private static let decoder = JSONDecoder()

  static func containerURL() throws -> URL {
    guard let value = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: OneMoreWidgetConstants.appGroup) else {
      throw WidgetStateError.appGroupUnavailable
    }
    return value
  }

  static func stateURL() throws -> URL { try containerURL().appendingPathComponent(OneMoreWidgetConstants.stateFile) }
  static func backupURL() throws -> URL { try containerURL().appendingPathComponent(OneMoreWidgetConstants.backupFile) }

  private static func decodedEnvelope(at url: URL) -> WidgetStateEnvelope? {
    guard let data = try? Data(contentsOf: url),
          let value = try? decoder.decode(WidgetStateEnvelope.self, from: data),
          value.schemaVersion == OneMoreWidgetConstants.schemaVersion else { return nil }
    return value
  }

  private static func loadUncoordinated() throws -> WidgetStateEnvelope {
    let primary = try stateURL()
    if let value = decodedEnvelope(at: primary) { return value }
    if let value = decodedEnvelope(at: try backupURL()) { return value }
    return .empty()
  }

  static func read() -> WidgetStateEnvelope? {
    queue.sync {
      do {
        let target = try stateURL()
        var result: WidgetStateEnvelope?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordinationError) { _ in
          result = try? loadUncoordinated()
        }
        return coordinationError == nil ? result : nil
      } catch {
        return nil
      }
    }
  }

  @discardableResult
  static func transaction<T>(_ operation: (inout WidgetStateEnvelope) throws -> T) throws -> T {
    try queue.sync {
      let target = try stateURL()
      var operationResult: Result<T, Error>?
      var coordinationError: NSError?
      NSFileCoordinator().coordinate(writingItemAt: target, options: .forMerging, error: &coordinationError) { _ in
        do {
          var envelope = try loadUncoordinated()
          let value = try operation(&envelope)
          envelope.schemaVersion = OneMoreWidgetConstants.schemaVersion
          envelope.revision += 1
          envelope.updatedAtISO = ISO8601DateFormatter.oneMore.string(from: Date())
          let data = try encoder.encode(envelope)
          let backup = try backupURL()
          if FileManager.default.fileExists(atPath: target.path) {
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: target, to: backup)
          }
          try data.write(to: target, options: .atomic)
          operationResult = .success(value)
        } catch {
          operationResult = .failure(error)
        }
      }
      if let coordinationError { throw coordinationError }
      guard let operationResult else { throw WidgetStateError.invalidSnapshot }
      return try operationResult.get()
    }
  }

  static func updateSnapshot(data: Data) throws {
    let incoming = try decoder.decode(OneMoreWidgetSnapshot.self, from: data)
    guard incoming.version == OneMoreWidgetConstants.schemaVersion,
          incoming.hasValidAccountScope() else { throw WidgetStateError.invalidSnapshot }
    let switchedAccount = try transaction { envelope -> Bool in
      let switched = envelope.activeUid != nil && envelope.activeUid != incoming.activeUid
      if envelope.activeUid != incoming.activeUid {
        envelope.configurations.removeAll()
        envelope.outbox.removeAll()
      }
      envelope.activeUid = incoming.activeUid
      envelope.sessionState = incoming.sessionState
      envelope.snapshot = incoming
      let available = Set(incoming.challenges.map(\.challengeId))
      envelope.outbox = envelope.outbox.filter { $0.uid == incoming.activeUid && available.contains($0.challengeId) }
      envelope.configurations = envelope.configurations.mapValues { configuration in
        var copy = configuration
        copy.orderedChallengeIds = unique(copy.orderedChallengeIds).filter(available.contains)
        copy.premiumSelectedChallengeIds = unique(copy.premiumSelectedChallengeIds).filter(available.contains)
        return copy
      }
      let legacy = incoming.defaultConfiguration
      envelope.configurations[legacy.configurationKey] = StoredWidgetConfiguration(
        version: 2,
        configurationKey: legacy.configurationKey,
        orderedChallengeIds: legacy.orderedChallengeIds.filter(available.contains),
        premiumSelectedChallengeIds: legacy.premiumSelectedChallengeIds.filter(available.contains),
        premiumSelectionRecorded: legacy.premiumSelectionRecorded,
        lastPremiumActive: legacy.lastPremiumActive,
        updatedAtISO: legacy.updatedAtISO
      )
      return switched
    }
    // A fallback must never resurrect the previous account after a switch.
    if switchedAccount { try? FileManager.default.removeItem(at: backupURL()) }
  }

  static func markConfirmedSignedOut() throws {
    try transaction { envelope in
      envelope.activeUid = nil
      envelope.sessionState = "confirmedSignedOut"
      envelope.snapshot = nil
      envelope.configurations.removeAll()
      envelope.outbox.removeAll()
    }
    // Logout removes the UID-scoped fallback as well as the active snapshot.
    try? FileManager.default.removeItem(at: backupURL())
  }

  static func outboxJSON() throws -> String {
    let items = read()?.outbox ?? []
    return String(data: try encoder.encode(items), encoding: .utf8) ?? "[]"
  }

  static func pendingMutations() -> [WidgetMutation] { read()?.outbox ?? [] }

  static func acknowledge(_ mutationIds: Set<String>) throws {
    try transaction { envelope in
      envelope.outbox.removeAll { mutationIds.contains($0.mutationId) }
    }
  }

  static func applyRemotePremium(
    state: String,
    expirationDate: String?,
    lifetime: Bool
  ) throws {
    try transaction { envelope in
      guard var snapshot = envelope.snapshot, snapshot.hasValidAccountScope() else {
        throw WidgetStateError.invalidSnapshot
      }
      snapshot.premiumState = state
      snapshot.premium = state == "premium"
      snapshot.premiumExpirationDate = expirationDate
      snapshot.premiumLifetime = lifetime
      snapshot.snapshotRevision += 1
      envelope.snapshot = snapshot
    }
  }

  static func markPremiumCheckingIfExpired(at date: Date = Date()) throws {
    try transaction { envelope in
      guard var snapshot = envelope.snapshot, snapshot.hasValidAccountScope(),
            snapshot.premiumState == "premium", !snapshot.premiumLifetime,
            let value = snapshot.premiumExpirationDate,
            let expiration = parseISODate(value), expiration <= date else { return }
      // Expiration is not proof of Free: an automatic renewal may already have
      // produced a later RevenueCat expiration that the extension has not read.
      snapshot.premiumState = "checking"
      snapshot.premium = false
      snapshot.snapshotRevision += 1
      envelope.snapshot = snapshot
    }
  }

  static func rejectCompletion(_ mutationId: String) throws {
    try transaction { envelope in
      guard let mutation = envelope.outbox.first(where: { $0.mutationId == mutationId }) else { return }
      envelope.outbox.removeAll { $0.mutationId == mutationId }
      guard var snapshot = envelope.snapshot,
            let index = snapshot.challenges.firstIndex(where: { $0.challengeId == mutation.challengeId }) else { return }
      var challenge = snapshot.challenges[index].projected(to: mutation.date)
      guard challenge.todayDone == mutation.expectedDoneBefore + 1 else { return }
      let wasCompletedByMutation = challenge.todayCompleted && mutation.expectedDoneBefore < challenge.todayTarget
      challenge.todayDone = mutation.expectedDoneBefore
      challenge.todayCompleted = mutation.expectedDoneBefore >= challenge.todayTarget
      challenge.dayState = challenge.todayCompleted ? "activeCompleted" : "activePending"
      if wasCompletedByMutation { challenge.currentStreak = max(0, challenge.currentStreak - 1) }
      if let dayIndex = challenge.timelineDays.firstIndex(where: { $0.date == mutation.date }) {
        challenge.timelineDays[dayIndex].done = challenge.todayDone
        challenge.timelineDays[dayIndex].completed = challenge.todayCompleted
        challenge.timelineDays[dayIndex].dayState = challenge.dayState
      }
      if let weekIndex = challenge.week.firstIndex(where: { $0.date == mutation.date }) {
        challenge.week[weekIndex].done = challenge.todayDone
        challenge.week[weekIndex].kind = challenge.todayCompleted ? "completed" : challenge.todayDone > 0 ? "partial" : "pending"
      }
      snapshot.challenges[index] = challenge
      snapshot.snapshotRevision += 1
      envelope.snapshot = snapshot
    }
  }

  static func resolveSelection(
    requestedIds: [String],
    configurationKey: String,
    maximumRows: Int,
    date: Date = Date()
  ) -> (WidgetStateEnvelope, ResolvedWidgetSelection)? {
    try? transaction { envelope in
      guard let snapshot = envelope.snapshot, snapshot.hasValidAccountScope(),
            envelope.activeUid == snapshot.accountUid else { throw WidgetStateError.invalidSnapshot }
      let availableOrder = snapshot.challenges.map(\.challengeId)
      let available = Set(availableOrder)
      let fallback = snapshot.defaultConfiguration.orderedChallengeIds
      let requested = unique(requestedIds.isEmpty ? fallback : requestedIds).filter(available.contains)
      let existing = envelope.configurations[configurationKey]
      let premiumActive = snapshot.isPremiumActive(at: date)
      let premiumChecking = snapshot.premiumState == "checking"
      var ordered: [String]
      var frozen: [String] = []
      var next = existing ?? StoredWidgetConfiguration(
        version: 2,
        configurationKey: configurationKey,
        orderedChallengeIds: requested,
        premiumSelectedChallengeIds: [],
        premiumSelectionRecorded: false,
        lastPremiumActive: nil,
        updatedAtISO: ISO8601DateFormatter.oneMore.string(from: date)
      )

      if premiumChecking {
        ordered = unique(existing?.orderedChallengeIds ?? requested)
        frozen = existing?.lastPremiumActive == false && existing?.premiumSelectionRecorded == true
          ? unique(existing?.premiumSelectedChallengeIds ?? []).filter { $0 != ordered.first }
          : []
      } else if premiumActive {
        if existing?.lastPremiumActive == false {
          ordered = existing?.premiumSelectionRecorded == true
            ? unique(existing?.premiumSelectedChallengeIds ?? []).filter(available.contains)
            : Array(requested.prefix(1))
        } else {
          ordered = requested
        }
        next.orderedChallengeIds = ordered
        next.premiumSelectedChallengeIds = ordered
        next.premiumSelectionRecorded = true
        next.lastPremiumActive = true
      } else {
        let active = requested.first ?? existing?.orderedChallengeIds.first ?? availableOrder.first
        let proven = existing?.premiumSelectionRecorded == true
          ? unique(existing?.premiumSelectedChallengeIds ?? []).filter(available.contains)
          : []
        frozen = proven.filter { $0 != active && requested.contains($0) }
        ordered = unique([active].compactMap { $0 } + frozen)
        next.orderedChallengeIds = ordered
        next.premiumSelectedChallengeIds = proven
        next.lastPremiumActive = false
      }

      ordered = unique(ordered).filter(available.contains)
      let activeIds = Set(premiumActive || premiumChecking ? ordered : Array(ordered.prefix(1)))
      let frozenIds = Set(frozen)
      next.orderedChallengeIds = ordered
      next.updatedAtISO = ISO8601DateFormatter.oneMore.string(from: date)
      envelope.configurations[configurationKey] = next
      let projected = ordered.prefix(max(1, maximumRows)).compactMap { challengeId -> WidgetChallengeSnapshot? in
        guard var challenge = snapshot.challenges.first(where: { $0.challengeId == challengeId })?.projected(to: localDay(date)) else { return nil }
        challenge.lockedByPremiumExpiration = frozenIds.contains(challengeId)
        return challenge
      }
      return (envelope, ResolvedWidgetSelection(
        key: configurationKey,
        rows: projected,
        activeIds: activeIds,
        frozenIds: frozenIds,
        premiumActive: premiumActive,
        premiumChecking: premiumChecking
      ))
    }
  }

  static func enqueueCompletion(
    challengeId: String,
    challengeType: String,
    date: String,
    expectedDoneBefore: Int,
    configurationKey: String
  ) throws -> WidgetMutation? {
    try transaction { envelope -> WidgetMutation? in
      guard date == localDay(), challengeType == "personal" || challengeType == "shared",
            let snapshot = envelope.snapshot, snapshot.hasValidAccountScope(),
            envelope.activeUid == snapshot.accountUid, snapshot.isPremiumActive(at: Date()),
            let uid = snapshot.accountUid,
            let config = envelope.configurations[configurationKey],
            config.orderedChallengeIds.contains(challengeId) else { throw WidgetStateError.invalidAction }
      let frozen = config.lastPremiumActive == false && config.premiumSelectionRecorded
        ? Set(config.premiumSelectedChallengeIds.dropFirst()) : Set<String>()
      guard !frozen.contains(challengeId),
            let challengeIndex = snapshot.challenges.firstIndex(where: {
              $0.challengeId == challengeId && $0.challengeType == challengeType
            }) else { throw WidgetStateError.invalidAction }
      var updated = snapshot
      var challenge = updated.challenges[challengeIndex].projected(to: date)
      guard challenge.dayState == "activePending", challenge.isActiveToday,
            challenge.todayDone == expectedDoneBefore, challenge.todayDone < challenge.todayTarget else { return nil }
      let mutationId = "ios:\(uid):\(challengeType):\(challengeId):\(date):\(expectedDoneBefore)"
      if let existing = envelope.outbox.first(where: { $0.mutationId == mutationId }) { return existing }
      let nextDone = min(challenge.todayTarget, challenge.todayDone + 1)
      let completedDayNow = nextDone >= challenge.todayTarget && !challenge.todayCompleted
      challenge.todayDone = nextDone
      challenge.todayCompleted = completedDayNow || challenge.todayCompleted
      challenge.dayState = challenge.todayCompleted ? "activeCompleted" : "activePending"
      if completedDayNow {
        challenge.currentStreak += 1
        challenge.bestStreak = max(challenge.bestStreak, challenge.currentStreak)
      }
      if let dayIndex = challenge.timelineDays.firstIndex(where: { $0.date == date }) {
        challenge.timelineDays[dayIndex].done = nextDone
        challenge.timelineDays[dayIndex].completed = challenge.todayCompleted
        challenge.timelineDays[dayIndex].dayState = challenge.dayState
      }
      if let weekIndex = challenge.week.firstIndex(where: { $0.date == date }) {
        challenge.week[weekIndex].done = nextDone
        challenge.week[weekIndex].kind = challenge.todayCompleted ? "completed" : "partial"
      }
      updated.challenges[challengeIndex] = challenge
      updated.snapshotRevision += 1
      let selectedIds = Set(config.orderedChallengeIds)
      let countable = updated.challenges.filter {
        selectedIds.contains($0.challengeId) && !frozen.contains($0.challengeId) && $0.isActiveToday
      }
      updated.completedToday = countable.filter(\.todayCompleted).count
      updated.countableToday = countable.count
      envelope.snapshot = updated
      let mutation = WidgetMutation(
        mutationId: mutationId,
        uid: uid,
        challengeId: challengeId,
        challengeType: challengeType,
        date: date,
        expectedDoneBefore: expectedDoneBefore,
        createdAtISO: ISO8601DateFormatter.oneMore.string(from: Date())
      )
      envelope.outbox.append(mutation)
      return mutation
    }
  }

  private static func unique(_ ids: [String]) -> [String] {
    var seen = Set<String>()
    return ids.filter { !$0.isEmpty && seen.insert($0).inserted }
  }
}

func localDay(_ date: Date = Date(), calendar: Calendar = .autoupdatingCurrent) -> String {
  let formatter = DateFormatter()
  formatter.calendar = calendar
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = calendar.timeZone
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter.string(from: date)
}

func stableConfigurationKey(_ ids: [String]) -> String {
  // FNV-1a is used only as a stable local key, never as a security primitive.
  let source = ids.joined(separator: "\u{1F}")
  var hash: UInt64 = 14_695_981_039_346_656_037
  for byte in source.utf8 {
    hash ^= UInt64(byte)
    hash &*= 1_099_511_628_211
  }
  return "intent-\(String(hash, radix: 16))"
}
