/**
 * @jest-environment node
 *
 * The Android build on EAS (docs/SPEC.md 3.8, PBI-1.10): the build profile in eas.json for the
 * test on Adam's phone, the Android application ID, and the permission app.json blocks. The
 * config runs only when the app is built, so the manifest is read as
 * `npx expo config --type introspect` gives it, by running the real config over this project's
 * app.json, as backupRules.test.ts does.
 */
import ts from "typescript";

import { APPLICATION_ID } from "../../testing/appIdentity";
import { appSourceFiles, fs, PROJECT_ROOT, path } from "../../testing/projectFiles";

const { readFileSync } = fs;
const { join } = path;

/**
 * The Expo project the builds belong to, `factoincognito/what-mushroom-is-this` (docs/SPEC.md
 * Known unknown 5): its owner since #39, and its project ID since #42, of the project Adam
 * recreated on 2026-11-09 (PBI-1.10). `eas build` takes the project from these two.
 */
const EXPO_OWNER = "factoincognito";
const EXPO_PROJECT_ID = "3b682970-bc59-4ead-8128-9055c1112e2c";

const WIFI_STATE = "android.permission.ACCESS_WIFI_STATE";
/** "Display over other apps": the app draws over no other app (Clead's decision on #40). */
const ALERT_WINDOW = "android.permission.SYSTEM_ALERT_WINDOW";
/**
 * Reading shared storage, which expo-image-picker's and expo-file-system's own manifests declare
 * up to Android 12 (`maxSdkVersion` 32). None of the app's picker calls asks for it or reads the
 * phone's storage by path; they read what the system picker hands back through its content
 * address. Only the image picker's media-library permission functions ask for it, and the app
 * calls neither (PBI-1.29; the source lines are in the PR).
 */
const READ_STORAGE = "android.permission.READ_EXTERNAL_STORAGE";
/** Writing shared storage: the image picker asks for it with the camera below Android 10. */
const WRITE_STORAGE = "android.permission.WRITE_EXTERNAL_STORAGE";

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

  it("gives each preview build a new versionCode (autoIncrement, kept on Expo's servers with the remote source), so the phone can tell builds apart", () => {
    expect(easJson()).toMatchObject({ build: { preview: { autoIncrement: true } } });
  });

  it("holds nothing else: no other profile, no environment variables and no credentials", () => {
    expect(easJson()).toEqual({
      cli: { appVersionSource: "remote" },
      build: {
        preview: { distribution: "internal", autoIncrement: true, android: { buildType: "apk" } },
      },
    });
  });
});

describe("app.json: the Expo project the builds belong to (PBI-1.29, note 3 on #42)", () => {
  it("is owned by factoincognito", () => {
    expect(appJson.expo.owner).toBe(EXPO_OWNER);
  });

  it("is linked by the project ID of factoincognito/what-mushroom-is-this, and nothing else is in extra", () => {
    expect(appJson.expo.extra).toEqual({ eas: { projectId: EXPO_PROJECT_ID } });
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

  it("blocks ACCESS_WIFI_STATE (#23), SYSTEM_ALERT_WINDOW (#40) and READ_EXTERNAL_STORAGE (PBI-1.29), which the app does not use, and no other permission", () => {
    expect(appJson.expo.android?.blockedPermissions).toEqual([
      WIFI_STATE,
      ALERT_WINDOW,
      READ_STORAGE,
    ]);
  });

  it("removes READ_EXTERNAL_STORAGE in the manifest, which the image picker's and the file system's own manifests add at the merge (PBI-1.29)", () => {
    expect(libraryPermissions("expo-image-picker")).toContain(READ_STORAGE);
    expect(libraryPermissions("expo-file-system")).toContain(READ_STORAGE);
    expect(removed()).toContain(READ_STORAGE);
    expect(declared()).not.toContain(READ_STORAGE);
  });

  it("keeps WRITE_EXTERNAL_STORAGE, which the image picker asks for with the camera below Android 10", () => {
    expect(libraryPermissions("expo-image-picker")).toContain(WRITE_STORAGE);
    expect(removed()).not.toContain(WRITE_STORAGE);
  });

  it("is built from source files that call neither of the image picker's media-library permission functions, the only ones that ask for READ_EXTERNAL_STORAGE (PBI-1.29)", () => {
    const files = appSourceFiles();
    expect(files).toContain(join(PROJECT_ROOT, "src", "newFind", "devicePicker.ts"));
    const calling = files.filter((file) =>
      /MediaLibraryPermissions/.test(readFileSync(file, "utf8")),
    );
    expect(calling).toEqual([]);
  });

  /**
   * Every node of a source file's code, as the TypeScript parser reads the whole file: a comment
   * is no node, and a text that looks like a comment's start (`"image/*"`) is one text, so no
   * code is left out, as it was when comments were cut from the file's text (the review of #94).
   */
  function nodesOf(file: string): ts.Node[] {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const nodes: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      nodes.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return nodes;
  }

  /**
   * The texts in the code that name the image picker's package or a path below it
   * (`expo-image-picker/src/ImagePicker`), wherever they stand: an import, a `require`, an
   * `import()`, or the start of a text with parts filled in.
   */
  function pickerModuleNames(nodes: ts.Node[]): string[] {
    return nodes
      .filter(
        (node): node is ts.StringLiteralLike | ts.TemplateHead =>
          ts.isStringLiteralLike(node) || ts.isTemplateHead(node),
      )
      .map((node) => node.text)
      .filter((text) => /^expo-image-picker(\/|$)/.test(text));
  }

  it("reaches the image picker in one file only, and there only by naming one of four functions after its import's name, so that no computed property or other name for it can call a media-library permission function unseen by the test above (PBI-2.16, the notes on #79)", () => {
    const devicePicker = join(PROJECT_ROOT, "src", "newFind", "devicePicker.ts");
    const reaching = appSourceFiles().filter((file) => pickerModuleNames(nodesOf(file)).length > 0);
    expect(reaching).toEqual([devicePicker]);
    const nodes = nodesOf(devicePicker);
    // Named once, by the package's own name, in an import of the whole module under one name.
    expect(pickerModuleNames(nodes)).toEqual(["expo-image-picker"]);
    const imported = nodes
      .filter(ts.isImportDeclaration)
      .filter(
        ({ moduleSpecifier }) =>
          ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text === "expo-image-picker",
      )
      .map(({ importClause }) =>
        importClause !== undefined &&
        importClause.name === undefined &&
        importClause.namedBindings !== undefined &&
        ts.isNamespaceImport(importClause.namedBindings)
          ? importClause.namedBindings.name
          : null,
      );
    expect(imported).toHaveLength(1);
    const [binding] = imported;
    if (binding === undefined || binding === null) {
      throw new Error("the image picker is not imported as `import * as <name>`");
    }
    // Every other use of that name, by what it is used for: the function named after it and a
    // dot, or null for anything else, such as `ImagePicker[...]`, `ImagePicker?.`, a
    // destructuring or another name given to it.
    const uses = nodes
      .filter(
        (node): node is ts.Identifier =>
          ts.isIdentifier(node) && node.text === binding.text && node !== binding,
      )
      .map((use) => {
        const { parent } = use;
        return ts.isPropertyAccessExpression(parent) &&
          parent.expression === use &&
          parent.questionDotToken === undefined &&
          ts.isIdentifier(parent.name)
          ? parent.name.text
          : null;
      });
    expect(uses.filter((name) => name === null)).toEqual([]);
    expect([...new Set(uses)].sort()).toEqual([
      "getCameraPermissionsAsync",
      "launchCameraAsync",
      "launchImageLibraryAsync",
      "requestCameraPermissionsAsync",
    ]);
  });

  it("removes ACCESS_WIFI_STATE in the manifest, which expo-network's own manifest adds at the merge", () => {
    expect(libraryPermissions("expo-network")).toContain(WIFI_STATE);
    expect(removed()).toContain(WIFI_STATE);
    expect(declared()).not.toContain(WIFI_STATE);
  });

  it("still removes ACCESS_WIFI_STATE with MapLibre React Native's plugin registered, since MapLibre Android declares it (PBI-2.8)", () => {
    const plugins = (appJson.expo.plugins ?? []) as (string | [string, unknown])[];
    expect(
      plugins.some(
        (plugin) =>
          plugin === "@maplibre/maplibre-react-native" ||
          (Array.isArray(plugin) && plugin[0] === "@maplibre/maplibre-react-native"),
      ),
    ).toBe(true);
    expect(appJson.expo.android?.blockedPermissions).toContain(WIFI_STATE);
    expect(removed()).toContain(WIFI_STATE);
    expect(declared()).not.toContain(WIFI_STATE);
  });

  it("keeps the location permissions MapLibre React Native's own manifest declares, which the map's position uses (PBI-2.8)", () => {
    const maplibre = libraryPermissions("@maplibre/maplibre-react-native");
    expect(maplibre.sort()).toEqual([
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.INTERNET",
    ]);
    for (const permission of maplibre) {
      expect(removed()).not.toContain(permission);
    }
  });

  it("removes SYSTEM_ALERT_WINDOW in the manifest, which the prebuild template's own manifest declares", () => {
    expect(removed()).toContain(ALERT_WINDOW);
    expect(declared()).not.toContain(ALERT_WINDOW);
  });

  it("removes only ACCESS_WIFI_STATE, SYSTEM_ALERT_WINDOW, READ_EXTERNAL_STORAGE and the microphone the image picker's options turn off", () => {
    expect(removed().sort()).toEqual(
      ["android.permission.RECORD_AUDIO", WIFI_STATE, ALERT_WINDOW, READ_STORAGE].sort(),
    );
  });

  it("keeps VIBRATE, a normal permission React Native may use", () => {
    expect(declared()).toContain("android.permission.VIBRATE");
    expect(removed()).not.toContain("android.permission.VIBRATE");
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
