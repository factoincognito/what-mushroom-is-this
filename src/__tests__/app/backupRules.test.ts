/**
 * @jest-environment node
 *
 * The find log, its photos and the plain key-value store are kept out of the phone's backups
 * (docs/SPEC.md 3.6, PBI-1.9). The config plugins run only when the app is built, so these
 * tests run the real ones over this project's app.json, as `npx expo config --type introspect`
 * does, and read what they make of the Android manifest and the iOS Info.plist. The rules files
 * themselves are written by a dangerous mod, which introspection skips, so it is run here on a
 * folder of its own.
 */
import { PHOTO_DIRECTORY } from "../../store/locations";
import { fs, os, PROJECT_ROOT, path } from "../../testing/projectFiles";

const { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = fs;
const { tmpdir } = os;
const { join } = path;

const ROOT = PROJECT_ROOT;
const MODULES = join(ROOT, "node_modules");

type Rule = {
  readonly kind: "include" | "exclude";
  readonly domain: string;
  readonly path: string;
};
type ExpoConfig = Record<string, unknown> & {
  plugins?: unknown[];
  mods?: { android?: { dangerous?: (config: unknown) => Promise<unknown> } };
  _internal?: { modResults?: Record<string, Record<string, unknown>> };
};
type BackupRulesPlugin = {
  default: (config: ExpoConfig, options: unknown) => ExpoConfig;
  BACKUP_RULES_RESOURCE: string;
  DATA_EXTRACTION_RULES_RESOURCE: string;
};

const plugin: BackupRulesPlugin = jest.requireActual("../../../plugins/withBackupRules");

const appJson: { expo: ExpoConfig & { android?: Record<string, unknown> } } =
  jest.requireActual("../../../app.json");

/** The options app.json gives a plugin, or undefined when it is not registered. */
function pluginOptions(name: string): unknown {
  const entry = appJson.expo.plugins?.find(
    (p) => p === name || (Array.isArray(p) && p[0] === name),
  );
  if (entry === undefined) {
    return undefined;
  }
  return Array.isArray(entry) ? (entry[1] ?? {}) : {};
}

/** The include and exclude elements of a piece of XML, in order. */
function rulesIn(xml: string): Rule[] {
  const rules: Rule[] = [];
  for (const match of xml.matchAll(/<(include|exclude)\s+([^>]*?)\/>/g)) {
    const attributes = match[2] ?? "";
    const domain = /domain="([^"]*)"/.exec(attributes)?.[1];
    const path = /path="([^"]*)"/.exec(attributes)?.[1];
    if (domain === undefined || path === undefined) {
      throw new Error(`a rule without a domain or a path: ${match[0]}`);
    }
    rules.push({ kind: match[1] === "include" ? "include" : "exclude", domain, path });
  }
  return rules;
}

/** The XML inside the one element `name` of `xml`. */
function section(xml: string, name: string): string {
  const matches = [
    ...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g")),
  ];
  if (matches.length !== 1) {
    throw new Error(`expected one <${name}>, found ${matches.length}`);
  }
  return matches[0]?.[1] ?? "";
}

/** expo-secure-store's own rules files, as its package ships them. */
function secureStoreRules(file: string): string {
  return readFileSync(
    join(MODULES, "expo-secure-store", "android", "src", "main", "res", "xml", file),
    "utf8",
  );
}

/** The exclusions this item adds (SPEC 3.6): the database, the photos, the key-value store. */
const OWN_EXCLUSIONS: readonly Rule[] = [
  { kind: "exclude", domain: "file", path: "SQLite" },
  { kind: "exclude", domain: "file", path: PHOTO_DIRECTORY },
  { kind: "exclude", domain: "database", path: "." },
];

/** Runs the real config plugins over app.json, as `npx expo config --type introspect` does. */
async function introspect(): Promise<{ config: ExpoConfig; warnings: string[] }> {
  const { getPrebuildConfigAsync } = jest.requireActual("@expo/prebuild-config");
  const { compileModsAsync } = jest.requireActual(
    "@expo/config-plugins/build/plugins/mod-compiler.js",
  );
  const warnings: string[] = [];
  const warn = jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  try {
    const prebuild = await getPrebuildConfigAsync(ROOT, { platforms: ["ios", "android"] });
    await compileModsAsync(prebuild.exp, {
      projectRoot: ROOT,
      introspect: true,
      platforms: ["ios", "android"],
      assertMissingModProviders: false,
    });
    return { config: prebuild.exp, warnings };
  } finally {
    warn.mockRestore();
  }
}

let introspected: { config: ExpoConfig; warnings: string[] };

beforeAll(async () => {
  introspected = await introspect();
}, 120_000);

function applicationAttributes(): Record<string, string> {
  const manifest = introspected.config._internal?.modResults?.android?.manifest as
    | { manifest: { application: { $: Record<string, string> }[] } }
    | undefined;
  const attributes = manifest?.manifest.application[0]?.$;
  if (attributes === undefined) {
    throw new Error("introspection gave no <application> of the Android manifest");
  }
  return attributes;
}

describe("Android: the manifest after the real config plugins", () => {
  it("turns Auto Backup off (android.allowBackup)", () => {
    expect(appJson.expo.android?.allowBackup).toBe(false);
    expect(applicationAttributes()["android:allowBackup"]).toBe("false");
  });

  it("points to the app's own rules, for Android 11 and lower and for Android 12 and higher", () => {
    const attributes = applicationAttributes();
    expect(attributes["android:fullBackupContent"]).toBe(`@xml/${plugin.BACKUP_RULES_RESOURCE}`);
    expect(attributes["android:dataExtractionRules"]).toBe(
      `@xml/${plugin.DATA_EXTRACTION_RULES_RESOURCE}`,
    );
  });

  it("gets no warning from expo-secure-store that it skipped its rules", () => {
    expect(introspected.warnings.filter((w) => /backup/i.test(w))).toEqual([]);
  });

  it("turns off expo-secure-store's own rules, as its docs say for an app with its own", () => {
    expect(pluginOptions("expo-secure-store")).toMatchObject({ configureAndroidBackup: false });
  });
});

describe("Android: the rules files the plugin writes", () => {
  let projectRoot: string;
  let written: Record<string, string>;

  beforeAll(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "backup-rules-"));
    written = await runDangerousMod(projectRoot);
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Runs the plugin's dangerous mod with `projectRoot` as the Android project's folder. */
  async function runDangerousMod(androidRoot: string): Promise<Record<string, string>> {
    const config = plugin.default({ name: "test", slug: "test" }, pluginOptions(PLUGIN_NAME));
    const dangerous = config.mods?.android?.dangerous;
    if (dangerous === undefined) {
      throw new Error("the plugin registers no dangerous Android mod");
    }
    await dangerous({
      ...config,
      modRequest: { platformProjectRoot: androidRoot, projectRoot: ROOT, platform: "android" },
      modResults: {},
    });
    const folder = join(androidRoot, "app", "src", "main", "res", "xml");
    return Object.fromEntries(
      readdirSync(folder).map((name) => [name, readFileSync(join(folder, name), "utf8")]),
    );
  }

  const backupFile = () => written[`${plugin.BACKUP_RULES_RESOURCE}.xml`] ?? "";
  const extractionFile = () => written[`${plugin.DATA_EXTRACTION_RULES_RESOURCE}.xml`] ?? "";

  it("writes the two files and nothing else", () => {
    expect(Object.keys(written).sort()).toEqual(
      [
        `${plugin.BACKUP_RULES_RESOURCE}.xml`,
        `${plugin.DATA_EXTRACTION_RULES_RESOURCE}.xml`,
      ].sort(),
    );
  });

  it("keeps expo-secure-store's own rules for Android 11 and lower", () => {
    const own = rulesIn(
      section(secureStoreRules("secure_store_backup_rules.xml"), "full-backup-content"),
    );
    expect(own.length).toBeGreaterThan(0);
    const ours = rulesIn(section(backupFile(), "full-backup-content"));
    expect(ours).toEqual(expect.arrayContaining(own));
  });

  it.each(["cloud-backup", "device-transfer"])(
    "keeps expo-secure-store's own rules for Android 12 and higher: %s",
    (name) => {
      const own = rulesIn(
        section(secureStoreRules("secure_store_data_extraction_rules.xml"), name),
      );
      expect(own.length).toBeGreaterThan(0);
      const ours = rulesIn(section(section(extractionFile(), "data-extraction-rules"), name));
      expect(ours).toEqual(expect.arrayContaining(own));
    },
  );

  it("excludes the database, the photos and the key-value store for Android 11 and lower", () => {
    expect(rulesIn(section(backupFile(), "full-backup-content"))).toEqual(
      expect.arrayContaining([...OWN_EXCLUSIONS]),
    );
  });

  it.each(["cloud-backup", "device-transfer"])(
    "excludes the database, the photos and the key-value store from %s",
    (name) => {
      const ours = rulesIn(section(section(extractionFile(), "data-extraction-rules"), name));
      expect(ours).toEqual(expect.arrayContaining([...OWN_EXCLUSIONS]));
    },
  );

  it("includes nothing but the shared preferences, as expo-secure-store's rules do", () => {
    const all = [...rulesIn(backupFile()), ...rulesIn(extractionFile())].filter(
      (rule) => rule.kind === "include",
    );
    expect(all.length).toBeGreaterThan(0);
    for (const rule of all) {
      expect(rule).toEqual({ kind: "include", domain: "sharedpref", path: "." });
    }
  });

  /** The start tag of each <include> or <exclude> element of a file, in order. */
  const ruleTags = (xml: string, kind: "include" | "exclude") =>
    [...xml.matchAll(new RegExp(`<${kind}\\s[^>]*/>`, "g"))].map((match) => match[0]);

  it("declares the tools namespace on each file's root element, for tools:ignore (PBI-1.10)", () => {
    const tools = 'xmlns:tools="http://schemas.android.com/tools"';
    expect(/<full-backup-content\s[^>]*>/.exec(backupFile())?.[0]).toContain(tools);
    expect(/<data-extraction-rules\s[^>]*>/.exec(extractionFile())?.[0]).toContain(tools);
  });

  it("marks every exclude tools:ignore FullBackupContent, the Android lint check that stops a release build over an exclude outside every include (PBI-1.10)", () => {
    for (const file of [backupFile(), extractionFile()]) {
      const excludes = ruleTags(file, "exclude");
      expect(excludes.length).toBe(rulesIn(file).filter((r) => r.kind === "exclude").length);
      expect(excludes.length).toBeGreaterThan(0);
      for (const tag of excludes) {
        expect(tag).toContain('tools:ignore="FullBackupContent"');
      }
    }
  });

  it("marks no include, so the check still runs on them (PBI-1.10)", () => {
    for (const file of [backupFile(), extractionFile()]) {
      for (const tag of ruleTags(file, "include")) {
        expect(tag).not.toContain("tools:");
      }
    }
  });

  it("starts each file with an XML declaration", () => {
    expect(backupFile().startsWith('<?xml version="1.0" encoding="utf-8"?>\n')).toBe(true);
    expect(extractionFile().startsWith('<?xml version="1.0" encoding="utf-8"?>\n')).toBe(true);
  });

  it("writes the same files when it runs again over its own output", async () => {
    const again = await runDangerousMod(projectRoot);
    expect(again).toEqual(written);
  });

  it("replaces a file of the same name that holds other rules", async () => {
    const folder = join(projectRoot, "app", "src", "main", "res", "xml");
    writeFileSync(join(folder, `${plugin.BACKUP_RULES_RESOURCE}.xml`), "<full-backup-content/>");
    const again = await runDangerousMod(projectRoot);
    expect(again).toEqual(written);
  });
});

const PLUGIN_NAME = "./plugins/withBackupRules";

describe("the plugin's options", () => {
  const apply = (options: unknown) => () => plugin.default({ name: "test", slug: "test" }, options);

  it("are given in app.json", () => {
    expect(pluginOptions(PLUGIN_NAME)).toEqual({
      exclude: OWN_EXCLUSIONS.map(({ domain, path }) => ({ domain, path })),
    });
  });

  it("accept the options in app.json", () => {
    expect(apply(pluginOptions(PLUGIN_NAME))).not.toThrow();
  });

  it.each([
    ["no options", undefined],
    ["no list", {}],
    ["a list that is not an array", { exclude: "photos" }],
    ["an empty list", { exclude: [] }],
    ["an entry that is not an object", { exclude: ["photos"] }],
    ["an unknown domain", { exclude: [{ domain: "files", path: "photos" }] }],
    ["a domain that is not a string", { exclude: [{ domain: 1, path: "photos" }] }],
    ["a path that is not a string", { exclude: [{ domain: "file", path: 1 }] }],
    ["an empty path", { exclude: [{ domain: "file", path: "" }] }],
    ["a path to the parent folder", { exclude: [{ domain: "file", path: "../shared_prefs" }] }],
    ["a path with a wildcard", { exclude: [{ domain: "file", path: "*.db" }] }],
    ["a path with a quote", { exclude: [{ domain: "file", path: 'a"b' }] }],
    ["an absolute path", { exclude: [{ domain: "file", path: "/data/photos" }] }],
    ["an unknown key", { exclude: [{ domain: "file", path: "photos", include: true }] }],
  ])("refuse %s", (_name, options) => {
    expect(apply(options)).toThrow(/withBackupRules/);
  });
});

describe("Android: where the libraries keep the data the rules exclude", () => {
  const source = (...parts: string[]) => readFileSync(join(MODULES, ...parts), "utf8");

  it("expo-sqlite's default database folder is SQLite in the app's files folder (domain file)", () => {
    expect(
      source(
        "expo-sqlite",
        "android",
        "src",
        "main",
        "java",
        "expo",
        "modules",
        "sqlite",
        "SQLiteModule.kt",
      ),
    ).toContain('context.filesDir.canonicalPath + File.separator + "SQLite"');
  });

  it("expo-file-system's document folder, which holds the photos, is the files folder (domain file)", () => {
    expect(
      source(
        "expo-modules-core",
        "android",
        "src",
        "main",
        "java",
        "expo",
        "modules",
        "kotlin",
        "services",
        "AppDirectoriesService.kt",
      ),
    ).toMatch(/persistentFilesDirectory: File\s+get\(\) = context\.filesDir/);
  });

  it("AsyncStorage keeps its database with SQLiteOpenHelper, in the databases folder (domain database)", () => {
    const supplier = source(
      "@react-native-async-storage",
      "async-storage",
      "android",
      "src",
      "main",
      "java",
      "com",
      "reactnativecommunity",
      "asyncstorage",
      "ReactDatabaseSupplier.java",
    );
    expect(supplier).toContain("extends SQLiteOpenHelper");
    expect(supplier).toContain('DATABASE_NAME = "RKStorage"');
  });
});

describe("iOS: the plain key-value store", () => {
  it("is excluded from backup by AsyncStorage's own Info.plist key, set in app.json", () => {
    const infoPlist = introspected.config._internal?.modResults?.ios?.infoPlist as
      | Record<string, unknown>
      | undefined;
    expect(infoPlist?.RCTAsyncStorageExcludeFromBackup).toBe(true);
  });
});
