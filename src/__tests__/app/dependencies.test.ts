/**
 * @jest-environment node
 *
 * One copy of `expo-font` (PBI-1.30). The first EAS build's `expo doctor` failed its check that no
 * duplicate dependencies are installed: `expo` brought `expo-font` 57.0.4, and npm filled the
 * `expo-font: "*"` peer of `expo-symbols` (a dependency of `expo-router`) with 58.0.11, of the
 * next SDK. CI cannot run `expo doctor` (it asks Expo's servers), so the lockfile is checked here.
 * Since PBI-1.29 (note 2 on #45) the same holds for every native module Expo's autolinking finds.
 */
import { fs, PROJECT_ROOT, path } from "../../testing/projectFiles";

const { readFileSync } = fs;
const { join } = path;

type LockEntry = { version?: unknown };
type Lockfile = { packages?: Record<string, LockEntry> };

/** package-lock.json, parsed from its text. */
function lockfile(): Lockfile {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package-lock.json"), "utf8"));
}

/** Every installed copy of a package the lockfile records: its path and its version. */
function installedCopies(name: string): { at: string; version: unknown }[] {
  const packages = lockfile().packages ?? {};
  return Object.entries(packages)
    .filter(([at]) => at === `node_modules/${name}` || at.endsWith(`/node_modules/${name}`))
    .map(([at, entry]) => ({ at, version: entry.version }));
}

/** The package a lockfile entry installs, by its path: the name after its last `node_modules/`. */
function packageAt(at: string): string | undefined {
  const marker = "node_modules/";
  const index = at.lastIndexOf(marker);
  return index === -1 ? undefined : at.slice(index + marker.length);
}

/**
 * The packages among `names` that the lockfile records at more than one version, each with its
 * versions, sorted; a copy without a version counts as a version of its own (PBI-1.29).
 */
function atSeveralVersions(
  lock: Lockfile,
  names: string[],
): { name: string; versions: string[] }[] {
  const wanted = new Set(names);
  const versions = new Map<string, Set<string>>();
  for (const [at, entry] of Object.entries(lock.packages ?? {})) {
    const name = packageAt(at);
    if (name !== undefined && wanted.has(name)) {
      const version = typeof entry.version === "string" ? entry.version : "(no version)";
      versions.set(name, (versions.get(name) ?? new Set()).add(version));
    }
  }
  return [...versions]
    .filter(([, found]) => found.size > 1)
    .map(([name, found]) => ({ name, versions: [...found].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type AutolinkingDependencies = {
  makeCachedDependenciesLinker(params: { projectRoot: string }): unknown;
  scanDependencyResolutionsForPlatform(
    linker: unknown,
    platform: "android" | "ios",
    extraInclude?: string[],
  ): Promise<Record<string, unknown>>;
  mergeResolutionResults(results: Record<string, unknown>[]): Record<string, unknown>;
};

/**
 * The native modules of the app, by name: those Expo's autolinking finds for Android and iOS in
 * the installed dependencies, as `npx expo-modules-autolinking verify -p native` scans them, with
 * React Native, which that command adds (its source, `build/commands/verifyCommand.js`).
 */
async function nativeModuleNames(): Promise<string[]> {
  const autolinking: AutolinkingDependencies = jest.requireActual(
    "expo-modules-autolinking/build/dependencies/index",
  );
  const linker = autolinking.makeCachedDependenciesLinker({ projectRoot: PROJECT_ROOT });
  const platforms = ["android", "ios"] as const;
  const results = await Promise.all(
    platforms.map((platform) =>
      autolinking.scanDependencyResolutionsForPlatform(linker, platform, ["react-native"]),
    ),
  );
  return Object.keys(autolinking.mergeResolutionResults(results)).sort();
}

/** A version as `major.minor.patch`, or undefined for any other form (a pre-release included). */
function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Whether `version` satisfies `range`, for the one range form this test meets, a tilde range
 * `~major.minor.patch`: the same major and minor, and a patch at least that one. Any other form
 * of range throws, so a change in what `expo` asks for is seen, not passed.
 */
function satisfiesTilde(version: string, range: string): boolean {
  const wanted = range.startsWith("~") ? parseVersion(range.slice(1)) : undefined;
  if (wanted === undefined) {
    throw new Error(`not a ~major.minor.patch range: ${range}`);
  }
  const have = parseVersion(version);
  return (
    have !== undefined && have[0] === wanted[0] && have[1] === wanted[1] && have[2] >= wanted[2]
  );
}

/** The range of `expo-font` that the installed `expo` asks for in its own package.json. */
function expoAsksFor(): string {
  const expo: { dependencies?: Record<string, unknown> } = JSON.parse(
    readFileSync(join(PROJECT_ROOT, "node_modules", "expo", "package.json"), "utf8"),
  );
  const range = expo.dependencies?.["expo-font"];
  if (typeof range !== "string") {
    throw new Error("the installed expo names no expo-font range in its dependencies");
  }
  return range;
}

describe("satisfiesTilde, the range check of these tests", () => {
  it.each<[string, string]>([
    ["57.0.4", "~57.0.4"],
    ["57.0.9", "~57.0.4"],
  ])("takes %s as within %s", (version, range) => {
    expect(satisfiesTilde(version, range)).toBe(true);
  });

  it.each<[string, string]>([
    ["58.0.11", "~57.0.4"],
    ["57.1.0", "~57.0.4"],
    ["57.0.3", "~57.0.4"],
    ["57.0.5-beta.1", "~57.0.4"],
    ["v57.0.4", "~57.0.4"],
  ])("takes %s as outside %s", (version, range) => {
    expect(satisfiesTilde(version, range)).toBe(false);
  });

  it.each(["^57.0.4", "57.0.4", "~57.0", "*", ""])("throws on the range %p", (range) => {
    expect(() => satisfiesTilde("57.0.4", range)).toThrow(
      `not a ~major.minor.patch range: ${range}`,
    );
  });
});

describe("atSeveralVersions, the check of the native modules below (PBI-1.29)", () => {
  it("finds a module the lockfile records at two versions, as expo-font was before #45", () => {
    const lock: Lockfile = {
      packages: {
        "": {},
        "node_modules/expo": { version: "57.0.32" },
        "node_modules/expo/node_modules/expo-font": { version: "57.0.4" },
        "node_modules/expo-font": { version: "58.0.11" },
      },
    };
    expect(atSeveralVersions(lock, ["expo", "expo-font"])).toEqual([
      { name: "expo-font", versions: ["57.0.4", "58.0.11"] },
    ]);
  });

  it("finds a scoped module at two versions, nested at any depth", () => {
    const lock: Lockfile = {
      packages: {
        "node_modules/@maplibre/maplibre-react-native": { version: "11.5.1" },
        "node_modules/a/node_modules/b/node_modules/@maplibre/maplibre-react-native": {
          version: "11.4.0",
        },
      },
    };
    expect(atSeveralVersions(lock, ["@maplibre/maplibre-react-native"])).toEqual([
      { name: "@maplibre/maplibre-react-native", versions: ["11.4.0", "11.5.1"] },
    ]);
  });

  it("counts a copy without a version as a version of its own", () => {
    const lock: Lockfile = {
      packages: {
        "node_modules/expo-font": { version: "57.0.4" },
        "node_modules/x/node_modules/expo-font": {},
      },
    };
    expect(atSeveralVersions(lock, ["expo-font"])).toEqual([
      { name: "expo-font", versions: ["(no version)", "57.0.4"] },
    ]);
  });

  it("passes a module at one version in several copies, and one that is not named", () => {
    const lock: Lockfile = {
      packages: {
        "node_modules/expo-font": { version: "57.0.4" },
        "node_modules/x/node_modules/expo-font": { version: "57.0.4" },
        "node_modules/semver": { version: "7.7.2" },
        "node_modules/x/node_modules/semver": { version: "6.3.1" },
      },
    };
    expect(atSeveralVersions(lock, ["expo-font"])).toEqual([]);
  });

  it("does not take a package whose name only ends like a named one", () => {
    const lock: Lockfile = {
      packages: {
        "node_modules/expo-font": { version: "57.0.4" },
        "node_modules/my-expo-font": { version: "1.0.0" },
        "node_modules/@x/expo-font": { version: "2.0.0" },
      },
    };
    expect(atSeveralVersions(lock, ["expo-font"])).toEqual([]);
  });
});

describe("the installed native modules (PBI-1.29, note 2 on #45)", () => {
  let names: string[];

  beforeAll(async () => {
    names = await nativeModuleNames();
  }, 120_000);

  it("are found by Expo's autolinking: the Expo modules, React Native and the other libraries with native code", () => {
    expect(names).toEqual(
      expect.arrayContaining([
        "expo",
        "expo-font",
        "expo-sqlite",
        "react-native",
        "react-native-screens",
        "@maplibre/maplibre-react-native",
      ]),
    );
  });

  it("are each at one version in every copy the lockfile records", () => {
    expect(atSeveralVersions(lockfile(), names)).toEqual([]);
  });
});

describe("the installed expo-font (PBI-1.30)", () => {
  const copies = installedCopies("expo-font");

  it("is installed", () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  it("is one version in every copy the lockfile records", () => {
    const first = copies[0]?.version;
    expect(copies).toEqual(copies.map(({ at }) => ({ at, version: first })));
  });

  it("is in every copy a version that the installed expo's own package.json asks for", () => {
    const range = expoAsksFor();
    const outside = copies.filter(
      (copy) => typeof copy.version !== "string" || !satisfiesTilde(copy.version, range),
    );
    expect({ range, outside }).toEqual({ range, outside: [] });
  });
});
