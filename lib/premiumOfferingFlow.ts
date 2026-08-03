export type PremiumOfferingOutcome<T> =
  | { status: "ready" | "cached"; packages: T[]; showError: false; requestId: number }
  | { status: "unavailable"; packages: []; showError: boolean; requestId: number }
  | { status: "stale"; packages: T[]; showError: false; requestId: number };

export class PremiumOfferingFlow<T> {
  private requestGeneration = 0;
  private openGeneration = 0;
  private errorShownForOpen = -1;
  private packages: T[] = [];

  beginOpen(existing: T[] = []) {
    this.openGeneration += 1;
    this.requestGeneration += 1;
    this.errorShownForOpen = -1;
    if (existing.length) this.packages = existing;
    return this.openGeneration;
  }

  close() {
    this.requestGeneration += 1;
  }

  currentPackages() {
    return this.packages;
  }

  async load(loader: (attempt: number) => Promise<T[]>, retries = 2): Promise<PremiumOfferingOutcome<T>> {
    const requestId = ++this.requestGeneration;
    const openId = this.openGeneration;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const packages = await loader(attempt);
        if (requestId !== this.requestGeneration || openId !== this.openGeneration) {
          return { status: "stale", packages: this.packages, showError: false, requestId };
        }
        if (packages.length) {
          this.packages = packages;
          return { status: "ready", packages, showError: false, requestId };
        }
        lastError = new Error("PREMIUM_PACKAGE_MISSING");
      } catch (error) {
        lastError = error;
        if (requestId !== this.requestGeneration || openId !== this.openGeneration) {
          return { status: "stale", packages: this.packages, showError: false, requestId };
        }
      }

      if (this.packages.length) {
        return { status: "cached", packages: this.packages, showError: false, requestId };
      }
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }

    void lastError;
    const showError = this.errorShownForOpen !== openId;
    if (showError) this.errorShownForOpen = openId;
    return { status: "unavailable", packages: [], showError, requestId };
  }
}

