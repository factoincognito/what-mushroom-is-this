/**
 * @jest-environment node
 *
 * The app's public name, "Washroom" ("as in What Mushroom"): Adam's decision, recorded in the
 * product office's DECISIONS.md on 2026-11-09. It is the same in Swedish, English and Italian, as
 * it is a name. The repository, the Expo slug and scheme, and the Android application ID stay.
 * The name reaches the phone through app.json's `name`, so the Android label and the iOS display
 * name are read as `npx expo config --type introspect` gives them, by running the real config over
 * this project's app.json, as easBuild.test.ts does.
 */
import type * as TypeScript from "typescript";

import notices from "../../about/notices.json";
import { LANGUAGES } from "../../i18n/languages";
import { STRINGS } from "../../i18n/strings";
import { APPLICATION_ID } from "../../testing/appIdentity";
import { appSourceFiles, fs, PROJECT_ROOT } from "../../testing/projectFiles";

const { readFileSync } = fs;
/** TypeScript's own parser, the project's development dependency. */
const ts: typeof TypeScript = jest.requireActual("typescript");

/** The app's public name, in every language. */
const APP_NAME = "Washroom";

/** The app's name before the decision, which no text shown to the user may give any more. */
const OLD_NAME = /what mushroom is this/gi;

type PluginEntry = string | [string, Record<string, unknown>?];
type Application = { $: Record<string, string> };
type ExpoConfig = Record<string, unknown> & {
  name?: unknown;
  slug?: unknown;
  scheme?: unknown;
  android?: { package?: unknown };
  plugins?: PluginEntry[];
  locales?: Record<string, string>;
  _internal?: {
    modResults?: {
      android?: {
        manifest?: { manifest: { application?: Application[] } };
        strings?: { resources: { string?: { $: { name: string }; _: string }[] } };
      };
      ios?: { infoPlist?: Record<string, unknown> };
    };
  };
};

const appJson: { expo: ExpoConfig } = jest.requireActual("../../../app.json");

/**
 * What a text says the app is called: each time it gives the old name, then each time it gives
 * "Washroom", in any case, as written in the text.
 */
function namesOfTheApp(text: string): string[] {
  return [...text.matchAll(OLD_NAME), ...text.matchAll(/washroom/gi)].map((match) => match[0]);
}

/**
 * The texts written straight into a source file, as TypeScript's own parser reads it (PBI-1.29,
 * note 1 on #41): its string literals (a JSX attribute's among them), the fixed parts of its
 * template literals, and its JSX text, with each run of white space as one space, as a screen
 * shows it. Names and comments are not texts. A text built by joining parts at run time is not
 * seen whole: the scan reads each part.
 */
function literalTexts(source: string): string[] {
  const file = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const texts: string[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    } else if (ts.isJsxText(node)) {
      texts.push(node.text.replace(/\s+/g, " "));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return texts;
}

/** Every leaf string of a nested object of texts. */
function leaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.values(value).flatMap(leaves);
}

/** The app's locale files as the real reader of `@expo/config-plugins` resolves them. */
async function resolvedLocales(
  platform: "ios" | "android",
): Promise<Record<string, Record<string, unknown>>> {
  const { getResolvedLocalesAsync } = jest.requireActual(
    "@expo/config-plugins/build/utils/locales.js",
  );
  const resolved: { localesMap: Record<string, Record<string, unknown>> } =
    await getResolvedLocalesAsync(PROJECT_ROOT, appJson.expo.locales ?? {}, platform);
  return resolved.localesMap;
}

/** The texts app.json gives the config plugins to show to the user (the permission texts). */
function pluginTexts(): string[] {
  return (appJson.expo.plugins ?? []).flatMap((plugin) =>
    typeof plugin === "string" ? [] : leaves(plugin[1]),
  );
}

describe("namesOfTheApp, the check the tests below use", () => {
  it("finds the old name in any case", () => {
    expect(namesOfTheApp("Om What mushroom is this?")).toEqual(["What mushroom is this"]);
    expect(namesOfTheApp("WHAT MUSHROOM IS THIS, what mushroom is this")).toEqual([
      "WHAT MUSHROOM IS THIS",
      "what mushroom is this",
    ]);
  });

  it("finds every spelling of Washroom, so a wrong case fails the tests that use it", () => {
    expect(namesOfTheApp("Washroom, washroom and WASHROOM")).toEqual([
      "Washroom",
      "washroom",
      "WASHROOM",
    ]);
  });

  it("finds nothing in a text that does not name the app", () => {
    expect(namesOfTheApp("The app may not use the camera.")).toEqual([]);
  });
});

describe("app.json: the app's public name", () => {
  it("is Washroom", () => {
    expect(appJson.expo.name).toBe(APP_NAME);
  });

  it("leaves the slug and the scheme, tied to the EAS project and to links, and the Android application ID as they were", () => {
    expect(appJson.expo.slug).toBe("what-mushroom-is-this");
    expect(appJson.expo.scheme).toBe("what-mushroom-is-this");
    expect(appJson.expo.android?.package).toBe(APPLICATION_ID);
  });
});

/** Runs the real config over app.json, as `npx expo config --type introspect` does. */
async function introspected(): Promise<ExpoConfig> {
  const { getPrebuildConfigAsync } = jest.requireActual("@expo/prebuild-config");
  const { compileModsAsync } = jest.requireActual("expo/config-plugins");
  const prebuild: { exp: ExpoConfig } = await getPrebuildConfigAsync(PROJECT_ROOT, {
    platforms: ["ios", "android"],
  });
  await compileModsAsync(prebuild.exp, {
    projectRoot: PROJECT_ROOT,
    introspect: true,
    platforms: ["ios", "android"],
    assertMissingModProviders: false,
  });
  return prebuild.exp;
}

describe("the name the phone shows under the app's icon", () => {
  let config: ExpoConfig;

  beforeAll(async () => {
    config = await introspected();
  }, 120_000);

  it("is Washroom on Android: the application's label is the app_name string, which is Washroom", () => {
    const android = config._internal?.modResults?.android;
    expect(android?.manifest?.manifest.application?.[0]?.$["android:label"]).toBe(
      "@string/app_name",
    );
    const appName = android?.strings?.resources.string?.filter((s) => s.$.name === "app_name");
    expect(appName?.map((s) => s._)).toEqual([APP_NAME]);
  });

  it("is Washroom on iOS (CFBundleDisplayName)", () => {
    expect(config._internal?.modResults?.ios?.infoPlist?.CFBundleDisplayName).toBe(APP_NAME);
  });

  it("is the same in Swedish, English and Italian: no locale file gives a name of its own, so iOS and Android show the one above", async () => {
    const ios = await resolvedLocales("ios");
    const android = await resolvedLocales("android");
    for (const language of LANGUAGES) {
      expect(ios[language]).not.toHaveProperty("CFBundleDisplayName");
      expect(ios[language]).not.toHaveProperty("CFBundleName");
      expect(android[language]).not.toHaveProperty("app_name");
    }
  });
});

describe("literalTexts, the scan of the app's source files the tests below use (PBI-1.29)", () => {
  it("finds a text written straight into a component, as JSX text, with its line breaks as spaces", () => {
    const source = `export function About() {
      return <Text>About What mushroom
        is this?</Text>;
    }`;
    expect(literalTexts(source).flatMap(namesOfTheApp)).toEqual(["What mushroom is this"]);
  });

  it("finds a text in a JSX attribute, a string literal and the fixed parts of a template literal", () => {
    const source = `const title = "washroom";
      export const Header = () => <Stack.Screen options={{ title: 'WASHROOM' }} />;
      export const credit = (year: number) => \`What mushroom is this \${year}, Washroom\`;
      export const plain = \`Washroom\`;`;
    expect(literalTexts(source).flatMap(namesOfTheApp)).toEqual([
      "washroom",
      "WASHROOM",
      "What mushroom is this",
      "Washroom",
      "Washroom",
    ]);
  });

  it("finds nothing in names, comments and code that are not texts", () => {
    const source = `// What mushroom is this, washroom
      /** WASHROOM */
      const washroom = 1;
      export function WhatMushroomIsThis() { return washroom; }`;
    expect(literalTexts(source).flatMap(namesOfTheApp)).toEqual([]);
  });
});

describe("the texts the app shows to the user", () => {
  let texts: string[];

  beforeAll(async () => {
    const ios = await resolvedLocales("ios");
    texts = [
      ...LANGUAGES.flatMap((language) => leaves(STRINGS[language])),
      ...LANGUAGES.flatMap((language) => leaves(ios[language])),
      ...pluginTexts(),
      ...leaves(notices.app),
      ...appSourceFiles().flatMap((file) => literalTexts(readFileSync(file, "utf8"))),
    ];
  });

  it("are read: the strings of all three languages, the iOS permission texts and the About view's own entry", () => {
    expect(texts.length).toBeGreaterThan(100);
    expect(texts).toContain(STRINGS.it.disclaimer);
    expect(texts).toContain(notices.app.requiredNotice);
  });

  it("are read: the texts written straight into the app's source files, its components among them (PBI-1.29, note 1 on #41)", () => {
    // A screen's route name in src/app/_layout.tsx, and the gallery's error in devicePicker.ts.
    expect(texts).toContain("text-lookup");
    expect(texts).toContain("the picker gave no photo");
  });

  it("name the app, wherever they do, only as Washroom, in every language: never by its old name and never in another case", () => {
    const names = texts.flatMap(namesOfTheApp);
    expect(names.filter((name) => name !== APP_NAME)).toEqual([]);
  });
});
