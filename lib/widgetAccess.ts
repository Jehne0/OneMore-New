export function authorizeWidgetCompletion(
  activeUid: string | null,
  authenticatedUid: string | null
): string | null {
  if (!activeUid || activeUid !== authenticatedUid) return null;
  return activeUid;
}

export type WidgetPremiumCache = { uid: string; isPremium: boolean; expiresDate: string | null };

export function isWidgetPremiumCacheActiveAt(
  cache: WidgetPremiumCache,
  uid: string,
  now = Date.now()
): boolean {
  return cache.uid === uid && cache.isPremium === true && typeof cache.expiresDate === "string" &&
    Number.isFinite(Date.parse(cache.expiresDate)) && Date.parse(cache.expiresDate) > now;
}

export function premiumWidgetDeepLink(now = Date.now()): string {
  return `onemore://profile?open=paywall&t=${now}&source=widget`;
}

export function premiumWidgetDestination(authenticatedUid: string | null, now = Date.now()): string {
  return authenticatedUid ? premiumWidgetDeepLink(now) : "onemore://login";
}

export function challengeWidgetDeepLink(challengeId: string): string {
  return `onemore://challenges?challengeId=${encodeURIComponent(challengeId)}`;
}
