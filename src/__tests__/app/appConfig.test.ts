/**
 * @jest-environment node
 *
 * The config plugins app.json registers for the libraries of the app. The plugins run only when
 * the app is built. The secure store's is run here for real over this project's app.json, as the
 * sitemap test runs expo-router's, and its mods as `npx expo config --type introspect` runs them
 * (PBI-1.17); for the others, these tests check the entries they are given.
 */
import { PROJECT_ROOT } from "../../testing/projectFiles";

type PluginEntry = string | [string, Record<string, unknown>?];
type ExpoConfig = {
  plugins?: PluginEntry[];
  /** What introspection leaves of the files the mods would write. */
  _internal?: {
    modResults?: {
      ios?: { infoPlist?: Record<string, unknown> };
      android?: { manifest?: { manifest: { application?: { $?: Record<string, string> }[] } } };
    };
  };
};

const appJson: { expo: ExpoConfig } = jest.requireActual("../../../app.json");

/** The plugin entry of a library in app.json, as [name, options], or undefined without one. */
function pluginEntry(name: string): [string, Record<string, unknown>] | undefined {
  const entry = appJson.expo.plugins?.find(
    (plugin) => plugin === name || (Array.isArray(plugin) && plugin[0] === name),
  );
  if (entry === undefined) {
    return undefined;
  }
  return typeof entry === "string" ? [entry, {}] : [entry[0], entry[1] ?? {}];
}

/**
 * The iOS Info.plist and the Android manifest after the real expo-secure-store plugin has run over
 * app.json with the options app.json gives it, and its mods have been run without writing files.
 */
async function afterSecureStorePlugin(): Promise<{
  infoPlist: Record<string, unknown>;
  application: Record<string, string>;
}> {
  const entry = pluginEntry("expo-secure-store");
  if (entry === undefined) {
    throw new Error("app.json registers no expo-secure-store plugin");
  }
  const withSecureStore: { default: (config: ExpoConfig, props: unknown) => ExpoConfig } =
    jest.requireActual("expo-secure-store/app.plugin");
  const { compileModsAsync } = jest.requireActual(
    "@expo/config-plugins/build/plugins/mod-compiler.js",
  );
  const config = withSecureStore.default(structuredClone(appJson.expo), entry[1]);
  await compileModsAsync(config, {
    projectRoot: PROJECT_ROOT,
    introspect: true,
    platforms: ["ios", "android"],
    assertMissingModProviders: false,
  });
  const results = config._internal?.modResults;
  const manifest = results?.android?.manifest;
  const infoPlist = results?.ios?.infoPlist;
  if (manifest === undefined || infoPlist === undefined) {
    throw new Error("introspection gave no Android manifest or no iOS Info.plist");
  }
  return { infoPlist, application: manifest.manifest.application?.[0]?.$ ?? {} };
}

describe("the expo-secure-store config plugin in app.json", () => {
  let after: Awaited<ReturnType<typeof afterSecureStorePlugin>>;

  beforeAll(async () => {
    after = await afterSecureStorePlugin();
  }, 120_000);

  it("is registered", () => {
    expect(pluginEntry("expo-secure-store")).toBeDefined();
  });

  it("writes no Face ID usage text, as the app uses no biometric authentication (the real plugin, PBI-1.17)", () => {
    expect(after.infoPlist).not.toHaveProperty("NSFaceIDUsageDescription");
  });

  it("points the Android manifest to none of its own backup rules, leaving them to the app's, which keep the secure store's (the real plugin, PBI-1.17; backupRules.test.ts)", () => {
    expect(after.application["android:fullBackupContent"]).not.toBe(
      "@xml/secure_store_backup_rules",
    );
    expect(after.application["android:dataExtractionRules"]).not.toBe(
      "@xml/secure_store_data_extraction_rules",
    );
  });

  it("keeps the other libraries' plugins", () => {
    expect(pluginEntry("expo-router")?.[1]).toEqual({ sitemap: false });
    expect(pluginEntry("expo-localization")).toBeDefined();
    expect(pluginEntry("expo-sqlite")).toBeDefined();
  });
});

/** Whether a permission message says what the app uses the permission for. */
function isPurposeText(value: unknown): boolean {
  return typeof value === "string" && value.length > 20 && !value.includes("$(PRODUCT_NAME)");
}

describe("the expo-image-picker config plugin in app.json (PBI-1.6)", () => {
  it("is registered", () => {
    expect(pluginEntry("expo-image-picker")).toBeDefined();
  });

  it("gives the camera and photo library messages iOS shows when it asks", () => {
    const options = pluginEntry("expo-image-picker")?.[1];
    expect(isPurposeText(options?.cameraPermission)).toBe(true);
    expect(isPurposeText(options?.photosPermission)).toBe(true);
  });

  it("asks for no microphone, as the app takes no video: RECORD_AUDIO is blocked on Android", () => {
    expect(pluginEntry("expo-image-picker")?.[1].microphonePermission).toBe(false);
  });
});

describe("the phone's location (PBI-1.6)", () => {
  it("is not configured: expo-location waits for its escalation (the parked PR on feat/pbi-1.6-position)", () => {
    expect(pluginEntry("expo-location")).toBeUndefined();
  });
});
