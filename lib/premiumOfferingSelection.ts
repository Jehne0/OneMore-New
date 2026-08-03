export type RevenueCatPackageLike = {
  identifier?: string | null;
  packageType?: string | null;
  product?: {
    identifier?: string | null;
    priceString?: string | null;
    subscriptionPeriod?: string | null;
    title?: string | null;
  } | null;
};

export type PremiumPackageDiagnostic = {
  identifier: string | null;
  packageType: string | null;
  productIdentifier: string | null;
  hasPriceString: boolean;
  subscriptionPeriod: string | null;
};

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function isUsableRevenueCatPackage(pkg: RevenueCatPackageLike): boolean {
  return !!(
    pkg.product?.identifier?.trim() &&
    pkg.product?.priceString?.trim()
  );
}

export function isMonthlyRevenueCatPackage(pkg: RevenueCatPackageLike): boolean {
  return (
    normalized(pkg.packageType) === "MONTHLY" ||
    normalized(pkg.product?.subscriptionPeriod) === "P1M"
  );
}

export function selectMonthlyRevenueCatPackage<T extends RevenueCatPackageLike>(
  packages: T[]
): T | null {
  const usable = packages.filter(isUsableRevenueCatPackage);
  return (
    usable.find((pkg) => normalized(pkg.packageType) === "MONTHLY") ??
    usable.find((pkg) => pkg.identifier?.trim() === "$rc_monthly") ??
    (usable.length === 1 && isMonthlyRevenueCatPackage(usable[0]) ? usable[0] : null)
  );
}

export function describeRevenueCatPackages(
  packages: RevenueCatPackageLike[]
): PremiumPackageDiagnostic[] {
  return packages.map((pkg) => ({
    identifier: pkg.identifier?.trim() || null,
    packageType: pkg.packageType?.trim() || null,
    productIdentifier: pkg.product?.identifier?.trim() || null,
    hasPriceString: !!pkg.product?.priceString?.trim(),
    subscriptionPeriod: pkg.product?.subscriptionPeriod?.trim() || null,
  }));
}

export type PremiumPaywallPhase =
  | "idle"
  | "waitingForAuth"
  | "loadingOffering"
  | "ready"
  | "unavailable"
  | "purchasing"
  | "purchaseCancelled"
  | "purchaseFailed";

export function canUpgradePremium<T>(
  phase: PremiumPaywallPhase,
  pkg: T | null
): pkg is T {
  return (
    (phase === "ready" ||
      phase === "purchaseCancelled" ||
      phase === "purchaseFailed") &&
    pkg !== null
  );
}
