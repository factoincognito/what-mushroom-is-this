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
import notices from "../../about/notices.json";
import { LANGUAGES } from "../../i18n/languages";
import { STRINGS } from "../../i18n/strings";
import { APPLICATION_ID } from "../../testing/appIdentity";
import { PROJECT_ROOT } from "../../testing/projectFiles";

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

describe("the texts the app shows to the user", () => {
  let texts: string[];

  beforeAll(async () => {
    const ios = await resolvedLocales("ios");
    texts = [
      ...LANGUAGES.flatMap((language) => leaves(STRINGS[language])),
      ...LANGUAGES.flatMap((language) => leaves(ios[language])),
      ...pluginTexts(),
      ...leaves(notices.app),
    ];
  });

  it("are read: the strings of all three languages, the iOS permission texts and the About view's own entry", () => {
    expect(texts.length).toBeGreaterThan(100);
    expect(texts).toContain(STRINGS.it.disclaimer);
    expect(texts).toContain(notices.app.requiredNotice);
  });

  it("name the app, wherever they do, only as Washroom, in every language: never by its old name and never in another case", () => {
    const names = texts.flatMap(namesOfTheApp);
    expect(names.filter((name) => name !== APP_NAME)).toEqual([]);
  });
});
