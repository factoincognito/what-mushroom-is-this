/**
 * @jest-environment node
 *
 * The share target's configuration (docs/SPEC.md 3.9, Shared photos; Known unknown 16; PBI-2.21):
 * the library and its pinned version, its config plugin's settings in app.json, what the real
 * plugin writes into the Android manifest, what the library's own manifest adds, and where the
 * app's own code reaches the library. The plugin runs only when the app is built; it is run here
 * over this project's app.json, its mods as `npx expo config --type introspect` runs them.
 */
import { appSourceFiles, fs, PROJECT_ROOT, path } from "../../testing/projectFiles";

const { readFileSync } = fs;
const { join } = path;

const VERSION = "57.0.26";
const LIBRARY = join(PROJECT_ROOT, "node_modules", "expo-sharing");

type PluginEntry = string | [string, Record<string, unknown>?];
type IntentFilter = {
  $?: Record<string, string>;
  action?: { $: Record<string, string> }[];
  category?: { $: Record<string, string> }[];
  data?: { $: Record<string, string> }[];
};
type Activity = { $: Record<string, string>; "intent-filter"?: IntentFilter[] };
type ExpoConfig = {
  scheme?: string;
  plugins?: PluginEntry[];
  android?: { package?: string; blockedPermissions?: string[] };
  ios?: Record<string, unknown>;
  extra?: { eas?: Record<string, unknown> };
  _internal?: {
    modResults?: {
      android?: {
        manifest?: {
          manifest: {
            "uses-permission"?: { $: Record<string, string> }[];
            application?: { activity?: Activity[] }[];
          };
        };
        strings?: { resources: { string?: { $: Record<string, string>; _: string }[] } };
      };
    };
  };
};

const appJson: { expo: ExpoConfig } = jest.requireActual("../../../app.json");
const packageJson: { dependencies: Record<string, string> } =
  jest.requireActual("../../../package.json");

function sharingEntry(): [string, Record<string, unknown>] | undefined {
  const entry = appJson.expo.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-sharing",
  );
  return Array.isArray(entry) ? [entry[0], entry[1] ?? {}] : undefined;
}

describe("the expo-sharing library (Known unknown 16)", () => {
  it("is a dependency pinned at the version whose source was read for this build", () => {
    expect(packageJson.dependencies["expo-sharing"]).toBe(VERSION);
    const installed: { version: string; license: string } = JSON.parse(
      readFileSync(join(LIBRARY, "package.json"), "utf8"),
    );
    expect(installed.version).toBe(VERSION);
    expect(installed.license).toBe("MIT");
  });

  it("is a version the installed Expo SDK asks for", () => {
    const bundled: Record<string, string> = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "node_modules", "expo", "bundledNativeModules.json"), "utf8"),
    );
    const range = bundled["expo-sharing"] ?? "";
    const wanted = /^~(\d+)\.(\d+)\.(\d+)$/.exec(range);
    const have = /^(\d+)\.(\d+)\.(\d+)$/.exec(VERSION);
    expect(wanted).not.toBeNull();
    expect([have?.[1], have?.[2]]).toEqual([wanted?.[1], wanted?.[2]]);
    expect(Number(have?.[3])).toBeGreaterThanOrEqual(Number(wanted?.[3]));
  });

  it("is in the lockfile once, at that version", () => {
    const lock: { packages: Record<string, { version?: string }> } = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "package-lock.json"), "utf8"),
    );
    const copies = Object.entries(lock.packages)
      .filter(
        ([at]) => at === "node_modules/expo-sharing" || at.endsWith("/node_modules/expo-sharing"),
      )
      .map(([at, entry]) => [at, entry.version]);
    expect(copies).toEqual([["node_modules/expo-sharing", VERSION]]);
  });
});

describe("the expo-sharing config plugin in app.json (SPEC 3.9: images only, Android only)", () => {
  it("is registered with images as the only type, for one file and for several, on Android only", () => {
    expect(sharingEntry()?.[1]).toEqual({
      ios: { enabled: false },
      android: {
        enabled: true,
        singleShareMimeTypes: ["image/*"],
        multipleShareMimeTypes: ["image/*"],
      },
    });
  });

  describe("run for real over app.json", () => {
    let config: ExpoConfig;
    let filters: IntentFilter[];

    beforeAll(async () => {
      const entry = sharingEntry();
      if (entry === undefined) {
        throw new Error("app.json registers no expo-sharing plugin");
      }
      const plugin: { default: (config: ExpoConfig, props: unknown) => ExpoConfig } =
        jest.requireActual("expo-sharing/app.plugin");
      const { compileModsAsync } = jest.requireActual("expo/config-plugins");
      config = plugin.default(structuredClone(appJson.expo), entry[1]);
      await compileModsAsync(config, {
        projectRoot: PROJECT_ROOT,
        introspect: true,
        platforms: ["android"],
        assertMissingModProviders: false,
      });
      const activities =
        config._internal?.modResults?.android?.manifest?.manifest.application?.[0]?.activity ?? [];
      const main = activities.find((activity) => activity.$["android:name"] === ".MainActivity");
      if (main === undefined) {
        throw new Error("introspection gave no main activity");
      }
      filters = main["intent-filter"] ?? [];
    }, 120_000);

    /** The filters of the main activity that take a share: those with a SEND action. */
    const shareFilters = () =>
      filters.filter((filter) =>
        (filter.action ?? []).some((action) =>
          action.$["android:name"]?.startsWith("android.intent.action.SEND"),
        ),
      );

    it("puts the app in Share with for one image and for several, and for nothing else", () => {
      const summary = shareFilters().map((filter) => ({
        actions: (filter.action ?? []).map((action) => action.$["android:name"]),
        categories: (filter.category ?? []).map((category) => category.$["android:name"]),
        types: (filter.data ?? []).map((data) => data.$),
      }));
      expect(summary).toEqual([
        {
          actions: ["android.intent.action.SEND"],
          categories: ["android.intent.category.DEFAULT"],
          types: [{ "android:mimeType": "image/*" }],
        },
        {
          actions: ["android.intent.action.SEND_MULTIPLE"],
          categories: ["android.intent.category.DEFAULT"],
          types: [{ "android:mimeType": "image/*" }],
        },
      ]);
    });

    it("takes no text and no file of another type: no filter names text/plain or every type", () => {
      const types = filters.flatMap((filter) =>
        (filter.data ?? []).map((data) => data.$["android:mimeType"]),
      );
      expect(types.filter((type) => type !== undefined)).toEqual(["image/*", "image/*"]);
    });

    it("writes the app's own scheme as the scheme of the share's address", () => {
      const strings = config._internal?.modResults?.android?.strings?.resources.string ?? [];
      const scheme = strings.find((item) => item.$.name === "share_into_scheme");
      expect(scheme?._).toBe(appJson.expo.scheme);
      expect(appJson.expo.scheme).toBe("what-mushroom-is-this");
    });

    it("asks for no permission", () => {
      const manifest = config._internal?.modResults?.android?.manifest?.manifest;
      const withoutPlugin = (appJson.expo.android?.blockedPermissions ?? []).length;
      // Introspection writes the blocked permissions as removals; the plugin adds none of its own.
      expect((manifest?.["uses-permission"] ?? []).length).toBeLessThanOrEqual(withoutPlugin);
    });

    it("sets up nothing for iOS: no share extension, no app group", () => {
      expect(config.extra?.eas).toEqual(appJson.expo.extra?.eas);
      expect(config.ios).toEqual(appJson.expo.ios);
    });
  });
});

describe("what the library's own Android manifest adds to the app's", () => {
  const manifest = readFileSync(
    join(LIBRARY, "android", "src", "main", "AndroidManifest.xml"),
    "utf8",
  );

  it("asks for no permission, so the app's blocked permissions stay as they are", () => {
    expect(manifest).not.toMatch(/<uses-permission/);
    expect(appJson.expo.android?.blockedPermissions).toEqual([
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
    ]);
  });

  it("adds one file provider, for sharing out, which is not exported", () => {
    const providers = manifest.match(/<provider[\s\S]*?>/g) ?? [];
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatch(/android:name="\.SharingFileProvider"/);
    expect(providers[0]).toMatch(/android:exported="false"/);
  });

  it("adds no activity, service or receiver", () => {
    expect(manifest).not.toMatch(/<(activity|service|receiver)\b/);
  });
});

describe("the library's resolver, as read for this build (57.0.26)", () => {
  const resolver = readFileSync(
    join(
      LIBRARY,
      "android",
      "src",
      "main",
      "java",
      "expo",
      "modules",
      "sharing",
      "dataParsers",
      "ResolvingShareIntentDataParser.kt",
    ),
    "utf8",
  );

  it("makes a request in one function only, the one that resolves a shared web address", () => {
    expect(resolver.match(/HttpURLConnection/g)).toHaveLength(2);
    const start = resolver.indexOf("private fun resolveUrlContext(");
    expect(start).toBeGreaterThan(0);
    expect(resolver.indexOf("openConnection()")).toBeGreaterThan(start);
    expect(resolver.slice(0, start)).not.toMatch(/openConnection|\.connect\(\)/);
  });

  it("resolves a web address only for a share of one item whose type is text/plain", () => {
    expect(resolver.match(/resolveUrlContext\(/g)).toHaveLength(2);
    expect(resolver.match(/extractTextPayload\(/g)).toHaveLength(2);
    expect(resolver).toMatch(
      /return if \(type == "text\/plain"\) \{\s*extractTextPayload\(intent\)\s*\} else \{/,
    );
    const multiple = resolver.slice(
      resolver.indexOf("private fun handleSendMultipleAction("),
      resolver.indexOf("private fun extractTextPayload("),
    );
    expect(multiple).toMatch(/resolveUri\(context, it, type\)/);
    expect(multiple).not.toMatch(/extractTextPayload|resolveUrlContext/);
  });

  it("copies a shared file into a folder under the cache, through the content resolver", () => {
    const resolveUri = resolver.slice(
      resolver.indexOf("private fun resolveUri("),
      resolver.indexOf("private fun getFileName("),
    );
    expect(resolveUri).toMatch(/ShareIntoFileStore\(context\.cacheDir\)\.newDestination\(/);
    expect(resolveUri).toMatch(/contentResolver\.openInputStream\(uri\)/);
    expect(resolveUri).not.toMatch(/URL\(|HttpURLConnection|openConnection/);
  });
});

describe("where the app's own code reaches the library", () => {
  const sources = appSourceFiles().map((file) => ({
    file: file.slice(PROJECT_ROOT.length + 1).replace(/\\/g, "/"),
    text: readFileSync(file, "utf8"),
  }));

  it("imports it in one module only", () => {
    const importing = sources
      .filter(({ text }) => /from "expo-sharing"|require\("expo-sharing"\)/.test(text))
      .map(({ file }) => file);
    expect(importing).toEqual(["src/share/deviceShare.ts"]);
  });

  it("never uses the library's hook, which resolves every share it sees, a web address too", () => {
    const using = sources
      .filter(({ text }) =>
        /\buseIncomingShare\b/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
      )
      .map(({ file }) => file);
    expect(using).toEqual([]);
  });

  it("calls the resolver in that one module, behind the session's check of the share", () => {
    const calling = sources
      .filter(({ text }) => /getResolvedSharedPayloadsAsync\s*\(/.test(text))
      .map(({ file }) => file);
    expect(calling).toEqual(["src/share/deviceShare.ts"]);
  });

  it("has a native-intent file for the router, which is no route of its own", () => {
    expect(sources.map(({ file }) => file)).toContain("src/app/+native-intent.ts");
    expect(sources.map(({ file }) => file)).toContain("src/app/share.tsx");
  });
});
