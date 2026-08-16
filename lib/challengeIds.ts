function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  globalThis.crypto?.getRandomValues?.(bytes);
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0 && !globalThis.crypto?.getRandomValues) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").slice(0, length);
}

/** Generates the stable ID before a new challenge is first persisted or edited. */
export function createChallengeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${randomHex(3)}-${randomHex(12)}`;
}

export function isStableChallengeId(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

/** Builds the exact stable object persisted by the home-screen quick-create modal. */
export function createQuickChallenge(text: string, createdDate: string, id = createChallengeId()) {
  return { id, text: text.trim(), enabled: true, createdDate };
}
