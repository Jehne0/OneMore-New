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
