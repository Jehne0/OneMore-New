import { readFile } from "node:fs/promises";
import { readAccountSnapshot, resolveAccountPremiumBootstrapState } from "../../lib/accountSnapshot";
import { readWidgetActiveUid } from "../../lib/widgetSession";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Missing cold-process store path");

  const values = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
  const store = {
    getItem: async (key: string) => values[key] ?? null,
    setItem: async (key: string, value: string) => { values[key] = value; },
    removeItem: async (key: string) => { delete values[key]; },
  };
  const uid = await readWidgetActiveUid(store);
  const account = uid ? await readAccountSnapshot(uid, store) : null;

  process.stdout.write(JSON.stringify({
    uid,
    accountUid: account?.activeUid ?? null,
    displayNameFallback: account?.displayNameFallback ?? null,
    premiumState: resolveAccountPremiumBootstrapState(account, Date.parse("2026-07-20T00:00:00.000Z")),
    managementURL: account?.managementURL ?? null,
  }));
}

void main();
