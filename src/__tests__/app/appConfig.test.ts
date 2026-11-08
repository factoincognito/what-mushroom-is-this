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

  it("keeps the plugin's Android backup rules for the secure store's own data", () => {
    const options = pluginEntry("expo-secure-store")?.[1];
    expect(options).toBeDefined();
    expect(options?.configureAndroidBackup ?? true).toBe(true);
  });

  it("keeps the other libraries' plugins", () => {
    expect(pluginEntry("expo-router")?.[1]).toEqual({ sitemap: false });
    expect(pluginEntry("expo-localization")).toBeDefined();
    expect(pluginEntry("expo-sqlite")).toBeDefined();
  });
});
