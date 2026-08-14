import SwiftUI
import WidgetKit

enum WidgetAvailability: Equatable {
  case available
  case updating
  case confirmedSignedOut
}

struct OneMoreWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: OneMoreWidgetSnapshot?
  let selection: ResolvedWidgetSelection?
  let availability: WidgetAvailability
}

private func maximumRows(for family: WidgetFamily) -> Int {
  switch family {
  case .systemSmall: return 1
  case .systemMedium: return 2
  default: return 5
  }
}

private func makeEntry(
  at date: Date,
  family: WidgetFamily,
  requestedIds: [String],
  configurationKey: String
) -> OneMoreWidgetEntry {
  guard let envelope = OneMoreWidgetStateStore.read() else {
    return OneMoreWidgetEntry(date: date, snapshot: nil, selection: nil, availability: .updating)
  }
  if envelope.sessionState == "confirmedSignedOut" {
    return OneMoreWidgetEntry(date: date, snapshot: nil, selection: nil, availability: .confirmedSignedOut)
  }
  guard let snapshot = envelope.snapshot, snapshot.hasValidAccountScope(),
        envelope.activeUid == snapshot.accountUid else {
    return OneMoreWidgetEntry(date: date, snapshot: nil, selection: nil, availability: .updating)
  }
  let day = localDay(date)
  let supportsDay = snapshot.generatedForDate == day
    || snapshot.challenges.contains(where: { challenge in challenge.timelineDays.contains(where: { $0.date == day }) })
  guard supportsDay,
        let (_, selection) = OneMoreWidgetStateStore.resolveSelection(
          requestedIds: requestedIds,
          configurationKey: configurationKey,
          maximumRows: maximumRows(for: family),
          date: date
        ) else {
    return OneMoreWidgetEntry(date: date, snapshot: snapshot, selection: nil, availability: .updating)
  }
  return OneMoreWidgetEntry(date: date, snapshot: snapshot, selection: selection, availability: .available)
}

private func nextRefresh(after now: Date, snapshot: OneMoreWidgetSnapshot?) -> Date {
  let calendar = Calendar.autoupdatingCurrent
  let midnight = calendar.nextDate(
    after: now,
    matching: DateComponents(hour: 0, minute: 0, second: 1),
    matchingPolicy: .nextTime,
    repeatedTimePolicy: .first,
    direction: .forward
  ) ?? now.addingTimeInterval(30 * 60)
  if snapshot?.premiumState == "checking" { return min(midnight, now.addingTimeInterval(15 * 60)) }
  if snapshot?.premiumState == "free", snapshot?.premiumExpirationDate != nil {
    return min(midnight, now.addingTimeInterval(6 * 60 * 60))
  }
  guard snapshot?.premiumLifetime != true,
        snapshot?.premiumState == "premium",
        let value = snapshot?.premiumExpirationDate,
        let expiration = parseISODate(value),
        expiration > now else { return midnight }
  return min(midnight, expiration)
}

struct LegacyProvider: TimelineProvider {
  func placeholder(in context: Context) -> OneMoreWidgetEntry {
    OneMoreWidgetEntry(date: Date(), snapshot: nil, selection: nil, availability: .updating)
  }

  func getSnapshot(in context: Context, completion: @escaping (OneMoreWidgetEntry) -> Void) {
    Task {
      await WidgetNetworkClient.synchronizeBeforeTimeline()
      let requested = OneMoreWidgetStateStore.read()?.snapshot?.defaultConfiguration.orderedChallengeIds ?? []
      completion(makeEntry(at: Date(), family: context.family, requestedIds: requested, configurationKey: "legacy-default"))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<OneMoreWidgetEntry>) -> Void) {
    Task {
      await WidgetNetworkClient.synchronizeBeforeTimeline()
      let now = Date()
      let requested = OneMoreWidgetStateStore.read()?.snapshot?.defaultConfiguration.orderedChallengeIds ?? []
      let entry = makeEntry(at: now, family: context.family, requestedIds: requested, configurationKey: "legacy-default")
      completion(Timeline(entries: [entry], policy: .after(nextRefresh(after: now, snapshot: entry.snapshot))))
    }
  }
}

@available(iOS 17.0, *)
struct InteractiveProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> OneMoreWidgetEntry {
    OneMoreWidgetEntry(date: Date(), snapshot: nil, selection: nil, availability: .updating)
  }

  func snapshot(for configuration: OneMoreWidgetConfigurationIntent, in context: Context) async -> OneMoreWidgetEntry {
    await WidgetNetworkClient.synchronizeBeforeTimeline()
    return makeEntry(at: Date(), family: context.family, requestedIds: configuration.selectedChallengeIds, configurationKey: configuration.stableKey)
  }

  func timeline(for configuration: OneMoreWidgetConfigurationIntent, in context: Context) async -> Timeline<OneMoreWidgetEntry> {
    await WidgetNetworkClient.synchronizeBeforeTimeline()
    let now = Date()
    let entry = makeEntry(at: now, family: context.family, requestedIds: configuration.selectedChallengeIds, configurationKey: configuration.stableKey)
    return Timeline(entries: [entry], policy: .after(nextRefresh(after: now, snapshot: entry.snapshot)))
  }
}

struct OneMoreWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let entry: OneMoreWidgetEntry

  private var locale: String { entry.snapshot?.locale ?? "en" }
  private var rows: [WidgetChallengeSnapshot] { entry.selection?.rows ?? [] }
  private var completed: Int {
    rows.filter { !$0.lockedByPremiumExpiration && $0.isActiveToday && $0.todayCompleted }.count
  }
  private var total: Int { rows.filter { !$0.lockedByPremiumExpiration && $0.isActiveToday }.count }
  private var compact: Bool { family == .systemSmall || dynamicTypeSize >= .accessibility1 }
  private var surface: Color { colorScheme == .dark ? Color(red: 0.035, green: 0.065, blue: 0.11) : Color(red: 0.94, green: 0.97, blue: 0.99) }
  private var primary: Color { colorScheme == .dark ? .white : Color(red: 0.04, green: 0.08, blue: 0.14) }
  private let accent = Color(red: 0.08, green: 0.65, blue: 0.59)

  private func text(_ cs: String, _ en: String, _ de: String, _ pl: String) -> String {
    switch locale {
    case "cs": return cs
    case "de": return de
    case "pl": return pl
    default: return en
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 5 : 8) {
      HStack(spacing: 5) {
        Text("OneMore").font(.headline).foregroundStyle(primary).lineLimit(1)
        Spacer(minLength: 2)
        if entry.availability == .available && !rows.isEmpty {
          Text("\(text("Dnes", "Today", "Heute", "Dziś")) \(completed)/\(total)")
            .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
        }
      }

      switch entry.availability {
      case .confirmedSignedOut:
        status(text("Přihlas se v OneMore", "Sign in to OneMore", "Bei OneMore anmelden", "Zaloguj się w OneMore"))
      case .updating:
        status(text("Aktualizuji data…", "Updating data…", "Daten werden aktualisiert…", "Aktualizowanie danych…"))
      case .available:
        if rows.isEmpty {
          status(text("Vyber výzvu v konfiguraci widgetu", "Choose a challenge in widget settings", "Wähle eine Challenge in den Widget-Einstellungen", "Wybierz wyzwanie w ustawieniach widżetu"))
        } else {
          ForEach(rows) { challenge in challengeRow(challenge) }
          if entry.selection?.premiumChecking == true {
            Text(text("Ověřuji Premium…", "Checking Premium…", "Premium wird geprüft…", "Sprawdzanie Premium…"))
              .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
    }
    .padding(compact ? 10 : 12)
    .widgetSurface(surface)
    .accessibilityElement(children: .contain)
  }

  private func status(_ value: String) -> some View {
    Text(value).font(.caption).foregroundStyle(.secondary).lineLimit(3).minimumScaleFactor(0.8)
  }

  @ViewBuilder
  private func challengeRow(_ challenge: WidgetChallengeSnapshot) -> some View {
    VStack(alignment: .leading, spacing: compact ? 2 : 4) {
      HStack(alignment: .center, spacing: 6) {
        VStack(alignment: .leading, spacing: 1) {
          HStack(spacing: 4) {
            if challenge.challengeType == "shared" {
              Image(systemName: "person.2.fill").font(.caption2).foregroundStyle(.secondary)
            }
            Text(challenge.challengeName)
              .font(.subheadline.weight(.semibold)).foregroundStyle(primary)
              .lineLimit(1).truncationMode(.tail).minimumScaleFactor(0.72)
          }
          HStack(spacing: 6) {
            Label("\(challenge.currentStreak)", systemImage: "flame.fill")
            if !compact { Text("\(text("nejl.", "best", "Bestw.", "najl.")) \(challenge.bestStreak)") }
            if challenge.todayTarget > 1 { Text("\(challenge.todayDone)/\(challenge.todayTarget)") }
          }
          .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 2)
        action(for: challenge)
      }
      if family != .systemSmall && !challenge.week.isEmpty {
        weekStrip(challenge.week)
      }
    }
    .padding(.vertical, family == .systemLarge ? 2 : 0)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder
  private func action(for challenge: WidgetChallengeSnapshot) -> some View {
    if challenge.lockedByPremiumExpiration {
      Label(text("Zamčeno", "Locked", "Gesperrt", "Zablokowane"), systemImage: "lock.fill")
        .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).labelStyle(.titleAndIcon)
    } else if challenge.dayState == "restDay" {
      Text(text("Volný den", "Rest day", "Ruhetag", "Dzień wolny"))
        .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
    } else if challenge.dayState == "activeCompleted" {
      Label(text("Splněno", "Done", "Erledigt", "Gotowe"), systemImage: "checkmark.circle.fill")
        .font(.caption2.weight(.semibold)).foregroundStyle(accent).labelStyle(.titleAndIcon)
    } else if challenge.allowsMultipleCompletionsToday == false && challenge.completedOnCurrentDate == true {
      Text("\(challenge.todayDone)/\(challenge.todayTarget)")
        .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
    } else if #available(iOS 17.0, *), entry.selection?.premiumActive == true {
      Button(intent: CompleteChallengeIntent(
        challengeId: challenge.challengeId,
        challengeType: challenge.challengeType,
        date: localDay(entry.date),
        expectedDoneBefore: challenge.todayDone,
        configurationKey: entry.selection?.key ?? ""
      )) {
        Text(text("Splnit", "Complete", "Erledigen", "Wykonaj")).font(.caption2.weight(.bold)).lineLimit(1)
      }
      .buttonStyle(.borderedProminent).tint(accent)
      .accessibilityLabel(text("Splnit výzvu", "Complete challenge", "Challenge erledigen", "Wykonaj wyzwanie"))
    } else {
      Text(challenge.todayTarget > 1 ? "\(challenge.todayDone)/\(challenge.todayTarget)" : text("Splnit", "Complete", "Erledigen", "Wykonaj"))
        .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
    }
  }

  private func weekStrip(_ days: [WidgetWeekDay]) -> some View {
    HStack(spacing: 4) {
      ForEach(Array(days.prefix(7).enumerated()), id: \.offset) { _, day in
        Circle()
          .fill(dayColor(day.kind))
          .frame(width: 6, height: 6)
          .accessibilityLabel("\(day.date): \(day.kind), \(day.done)/\(day.target)")
      }
    }
  }

  private func dayColor(_ kind: String) -> Color {
    switch kind {
    case "completed": return accent
    case "partial": return .orange
    case "missed": return .red.opacity(0.75)
    case "future": return .secondary.opacity(0.2)
    default: return .secondary.opacity(0.35)
    }
  }
}

extension View {
  @ViewBuilder func widgetSurface(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(for: .widget) { color }
    } else {
      background(color)
    }
  }
}

struct OneMoreWidget: Widget {
  let kind = "OneMoreWidget"

  func makeWidgetConfiguration() -> some WidgetConfiguration {
    if #available(iOS 17.0, *) {
      return AppIntentConfiguration(kind: kind, intent: OneMoreWidgetConfigurationIntent.self, provider: InteractiveProvider()) {
        OneMoreWidgetView(entry: $0)
      }
    } else {
      return StaticConfiguration(kind: kind, provider: LegacyProvider()) {
        OneMoreWidgetView(entry: $0)
      }
    }
  }

  var body: some WidgetConfiguration {
    makeWidgetConfiguration()
      .configurationDisplayName("OneMore")
      .description("Challenges, progress and streaks")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct OneMoreWidgetBundle: WidgetBundle {
  @WidgetBundleBuilder
  var body: some Widget {
    OneMoreWidget()
  }
}
