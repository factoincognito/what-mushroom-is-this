/**
 * @jest-environment node
 *
 * One copy of `expo-font` (PBI-1.30). The first EAS build's `expo doctor` failed its check that no
 * duplicate dependencies are installed: `expo` brought `expo-font` 57.0.4, and npm filled the
 * `expo-font: "*"` peer of `expo-symbols` (a dependency of `expo-router`) with 58.0.11, of the
 * next SDK. CI cannot run `expo doctor` (it asks Expo's servers), so the lockfile is checked here.
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
