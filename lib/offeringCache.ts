export class OfferingCache<T> {
  private value: T[] | null = null;
  private uid: string | null = null;
  private inFlight: Promise<T[]> | null = null;

  clear() {
    this.value = null;
    this.uid = null;
    this.inFlight = null;
  }

  async get(uid: string, loader: () => Promise<T[]>, force = false): Promise<T[]> {
    if (!force && this.uid === uid && this.value?.length) return this.value;
    if (this.inFlight) return this.inFlight;
    const previous = this.uid === uid ? this.value : null;
    this.inFlight = loader().then((items) => {
      if (items.length) {
        this.uid = uid;
        this.value = items;
      }
      return items.length ? items : (previous ?? []);
    }).catch((error) => {
      if (previous?.length) return previous;
      throw error;
    }).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}
