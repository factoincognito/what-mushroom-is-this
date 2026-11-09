/**
 * The config plugins app.json registers for the libraries of the key module. The plugins run
 * only when the app is built, so these tests check the entries they are given.
 */

type PluginEntry = string | [string, Record<string, unknown>?];

const appJson: { expo: { plugins?: PluginEntry[] } } = jest.requireActual("../../../app.json");

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

describe("the expo-secure-store config plugin in app.json", () => {
  it("is registered", () => {
    expect(pluginEntry("expo-secure-store")).toBeDefined();
  });

  it("writes no Face ID usage text, as the app uses no biometric authentication", () => {
    expect(pluginEntry("expo-secure-store")?.[1].faceIDPermission).toBe(false);
  });

  it("leaves the Android backup rules to the app's own, which keep the secure store's (backupRules.test.ts)", () => {
    const options = pluginEntry("expo-secure-store")?.[1];
    expect(options).toBeDefined();
    expect(options?.configureAndroidBackup).toBe(false);
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
