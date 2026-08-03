import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

type LocaleTree = { [key: string]: string | LocaleTree | string[] };
type DictionarySpec = { file: string; variable: string };

const dictionaries: DictionarySpec[] = [
  { file: "lib/i18n.tsx", variable: "STRINGS" },
  { file: "app/history.tsx", variable: "HISTORY_STRINGS" },
  { file: "app/(tabs)/profile.tsx", variable: "PROFILE_STRINGS" },
  { file: "lib/widgetCopy.ts", variable: "widgetCopy" },
  { file: "widgets/WidgetConfigurationScreen.tsx", variable: "copy" },
  { file: "app/(tabs)/challenges.tsx", variable: "CHALLENGES_STRINGS" },
  { file: "app/(tabs)/profile.tsx", variable: "PROFILE_RUNTIME_STRINGS" },
  { file: "app/(tabs)/profile.tsx", variable: "PROFILE_ACCOUNT_STRINGS" },
  { file: "app/(tabs)/profile.tsx", variable: "PROFILE_ACCESS_STRINGS" },
  { file: "app/forgot.tsx", variable: "FORGOT_STRINGS" },
  { file: "app/friend-invite/[inviteId].tsx", variable: "FRIEND_INVITE_STRINGS" },
  { file: "app/statistics.tsx", variable: "ROOT_PROFILE_STRINGS" },
  { file: "app/modal.tsx", variable: "MODAL_STRINGS" },
];

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrap(expression.expression);
  }
  return expression;
}

function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error(`Unsupported localization property name: ${node.getText()}`);
}

function readTree(expression: ts.Expression): string | LocaleTree | string[] {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((item) => {
      const value = readTree(item as ts.Expression);
      assert.equal(typeof value, "string", "Localization arrays may only contain strings");
      return value as string;
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: LocaleTree = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      result[propertyName(property.name)] = readTree(property.initializer);
    }
    return result;
  }
  throw new Error(`Unsupported localization value: ${node.getText()}`);
}

async function readDictionary(spec: DictionarySpec): Promise<Record<string, LocaleTree>> {
  const sourceText = await readFile(spec.file, "utf8");
  const source = ts.createSourceFile(spec.file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === spec.variable) initializer = declaration.initializer;
    }
  });
  assert.ok(initializer, `${spec.file} must declare ${spec.variable}`);
  return readTree(initializer!) as Record<string, LocaleTree>;
}

function placeholders(value: string): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(/\{\{?\s*([A-Za-z_$][\w$]*)\s*\}?\}/g)) found.add(match[1]);
  return [...found].sort();
}

function compareTrees(reference: LocaleTree, candidate: LocaleTree, path: string): void {
  assert.deepEqual(Object.keys(candidate).sort(), Object.keys(reference).sort(), `${path}: translation keys differ`);
  for (const key of Object.keys(reference)) {
    const expected = reference[key];
    const actual = candidate[key];
    const itemPath = `${path}.${key}`;
    if (typeof expected === "string") {
      assert.equal(typeof actual, "string", `${itemPath}: value type differs`);
      assert.ok((actual as string).trim().length > 0, `${itemPath}: translation is empty`);
      assert.deepEqual(placeholders(actual as string), placeholders(expected), `${itemPath}: interpolation parameters differ`);
    } else if (Array.isArray(expected)) {
      assert.ok(Array.isArray(actual), `${itemPath}: value must be an array`);
      assert.equal((actual as string[]).length, expected.length, `${itemPath}: array length differs`);
      for (const value of actual as string[]) assert.ok(value.trim().length > 0, `${itemPath}: array contains an empty value`);
    } else {
      assert.equal(typeof actual, "object", `${itemPath}: value type differs`);
      compareTrees(expected, actual as LocaleTree, itemPath);
    }
  }
}

for (const spec of dictionaries) {
  test(`${spec.variable} has complete CS/EN/PL/DE translations`, async () => {
    const dictionary = await readDictionary(spec);
    assert.deepEqual(Object.keys(dictionary).sort(), ["cs", "de", "en", "pl"]);
    for (const language of ["en", "pl", "de"] as const) {
      compareTrees(dictionary.cs, dictionary[language], `${spec.variable}.${language}`);
    }
  });
}

test("Free/Premium comparison contains Android widget copy in every language", async () => {
  const dictionary = await readDictionary({ file: "app/(tabs)/profile.tsx", variable: "PROFILE_STRINGS" });
  const expected = {
    cs: ["Widget na ploše", "1 výzva", "Neomezeně výzev"],
    en: ["Home screen widget", "1 challenge", "Unlimited challenges"],
    pl: ["Widżet na ekranie", "1 wyzwanie", "Nieograniczone wyzwania"],
    de: ["Startbildschirm-Widget", "1 Challenge", "Unbegrenzte Challenges"],
  } as const;
  for (const language of ["cs", "en", "pl", "de"] as const) {
    assert.deepEqual([
      dictionary[language].homeScreenWidget,
      dictionary[language].homeScreenWidgetFree,
      dictionary[language].homeScreenWidgetPremium,
    ], expected[language]);
  }
});

test("Android widget comparison row is platform-gated", async () => {
  const source = await readFile("app/(tabs)/profile.tsx", "utf8");
  assert.match(source, /Platform\.OS === "android"[\s\S]*p\.homeScreenWidgetFree/);
  assert.match(source, /Platform\.OS === "android"[\s\S]*p\.homeScreenWidgetPremium/);
});
