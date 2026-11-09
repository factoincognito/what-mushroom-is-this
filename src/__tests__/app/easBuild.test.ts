/**
 * @jest-environment node
 *
 * The Android build on EAS (docs/SPEC.md 3.8, PBI-1.10): the build profile in eas.json for the
 * test on Adam's phone, the Android application ID, and the permission app.json blocks. The
 * config runs only when the app is built, so the manifest is read as
 * `npx expo config --type introspect` gives it, by running the real config over this project's
 * app.json, as backupRules.test.ts does.
 */
import { fs, PROJECT_ROOT, path } from "../../testing/projectFiles";

const { readFileSync } = fs;
const { join } = path;

/** The Android application ID of this app (SPEC 3.8). */
const APPLICATION_ID = "com.factoincognito.whatmushroomisthis";

const WIFI_STATE = "android.permission.ACCESS_WIFI_STATE";

type Permission = { $: Record<string, string> };
type Manifest = {
  manifest: { $: Record<string, string>; "uses-permission"?: Permission[] };
};
type ExpoConfig = Record<string, unknown> & {
  android?: { package?: unknown; blockedPermissions?: unknown };
  _internal?: { modResults?: { android?: { manifest?: Manifest } } };
};

const appJson: { expo: ExpoConfig } = jest.requireActual("../../../app.json");

/** eas.json, parsed from its text, so a file that is not JSON fails here. */
function easJson(): unknown {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "eas.json"), "utf8"));
}

/** The permissions a library's own Android manifest declares, merged into the app at the build. */
function libraryPermissions(library: string): string[] {
  const xml = readFileSync(
    join(PROJECT_ROOT, "node_modules", library, "android", "src", "main", "AndroidManifest.xml"),
    "utf8",
  );
  return [...xml.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("eas.json: the build profile for the test on Adam's phone (PBI-1.10)", () => {
  it("is JSON with a build section and a cli section only", () => {
    const eas = easJson();
    expect(typeof eas === "object" && eas !== null && !Array.isArray(eas)).toBe(true);
    expect(Object.keys(eas as object).sort()).toEqual(["build", "cli"]);
  });

  it("has a preview profile that builds an APK the phone installs, shared by URL (internal distribution)", () => {
    expect(easJson()).toMatchObject({
      build: { preview: { distribution: "internal", android: { buildType: "apk" } } },
    });
  });

  it("sets the app version source EAS recommends (remote), so EAS CLI does not warn that it is missing", () => {
    expect(easJson()).toMatchObject({ cli: { appVersionSource: "remote" } });
  });

  it("holds nothing else: no other profile, no environment variables and no credentials", () => {
    expect(easJson()).toEqual({
      cli: { appVersionSource: "remote" },
      build: { preview: { distribution: "internal", android: { buildType: "apk" } } },
    });
  });
});

/** Runs the real config over app.json, as `npx expo config --type introspect` does. */
async function introspectedManifest(): Promise<Manifest> {
  const { getPrebuildConfigAsync } = jest.requireActual("@expo/prebuild-config");
  const { compileModsAsync } = jest.requireActual("expo/config-plugins");
  const prebuild: { exp: ExpoConfig } = await getPrebuildConfigAsync(PROJECT_ROOT, {
    platforms: ["android"],
  });
  await compileModsAsync(prebuild.exp, {
    projectRoot: PROJECT_ROOT,
    introspect: true,
    platforms: ["android"],
    assertMissingModProviders: false,
  });
  const manifest = prebuild.exp._internal?.modResults?.android?.manifest;
  if (manifest === undefined) {
    throw new Error("introspection gave no Android manifest");
  }
  return manifest;
}

describe("app.json: the Android build (PBI-1.10)", () => {
  let manifest: Manifest;

  beforeAll(async () => {
    manifest = await introspectedManifest();
  }, 120_000);

  const permissions = () => manifest.manifest["uses-permission"] ?? [];
  const removed = () =>
    permissions()
      .filter((permission) => permission.$["tools:node"] === "remove")
      .map((permission) => permission.$["android:name"]);
  const declared = () =>
    permissions()
      .filter((permission) => permission.$["tools:node"] !== "remove")
      .map((permission) => permission.$["android:name"]);

  it("names the Android application ID, so the first build does not ask for one and write it into app.json", () => {
    expect(appJson.expo.android?.package).toBe(APPLICATION_ID);
    expect(APPLICATION_ID).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    expect(manifest.manifest.$.package).toBe(APPLICATION_ID);
  });

  it("blocks ACCESS_WIFI_STATE, which the app does not use (#23), and no other permission", () => {
    expect(appJson.expo.android?.blockedPermissions).toEqual([WIFI_STATE]);
  });

  it("removes ACCESS_WIFI_STATE in the manifest, which expo-network's own manifest adds at the merge", () => {
    expect(libraryPermissions("expo-network")).toContain(WIFI_STATE);
    expect(removed()).toContain(WIFI_STATE);
    expect(declared()).not.toContain(WIFI_STATE);
  });

  it("removes only ACCESS_WIFI_STATE and the microphone the image picker's options turn off", () => {
    expect(removed().sort()).toEqual(["android.permission.RECORD_AUDIO", WIFI_STATE].sort());
  });

  it("keeps the location, the camera and the network state", () => {
    expect(declared()).toEqual(
      expect.arrayContaining([
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
      ]),
    );
    expect(libraryPermissions("expo-image-picker")).toContain("android.permission.CAMERA");
    expect(libraryPermissions("expo-network")).toContain("android.permission.ACCESS_NETWORK_STATE");
    for (const kept of [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.CAMERA",
      "android.permission.ACCESS_NETWORK_STATE",
    ]) {
      expect(removed()).not.toContain(kept);
    }
  });
});
