import { fs, PROJECT_ROOT, path } from "../testing/projectFiles";
import { NOTICES, NoticesError, parseNotices } from "./notices";

const { existsSync, readdirSync, readFileSync } = fs;
const { join } = path;

const ROOT = PROJECT_ROOT;
const MODULES = join(ROOT, "node_modules");

const raw: unknown = jest.requireActual("./notices.json");

/** A valid notices object, small, to be broken by the error-path tests. */
function valid(): Record<string, unknown> {
  return {
    app: {
      licence: "PolyForm Noncommercial License 1.0.0",
      url: "https://polyformproject.org/licenses/noncommercial/1.0.0",
      requiredNotice: "Required Notice: Copyright Someone",
      textId: "app",
    },
    libraries: [
      { name: "a", version: "1.0.0", licence: "MIT", source: "https://example.org/a", textId: "a" },
      { name: "b", version: null, licence: "MIT", source: "https://example.org/b", textId: null },
    ],
    texts: { app: "the terms", a: "MIT text" },
  };
}

/** `valid()` with one change made by `change`. */
function broken(change: (notices: Record<string, unknown>) => void): unknown {
  const notices = valid();
  change(notices);
  return notices;
}

function libraries(notices: Record<string, unknown>): Record<string, unknown>[] {
  return notices.libraries as Record<string, unknown>[];
}

function firstLibrary(notices: Record<string, unknown>): Record<string, unknown> {
  const first = libraries(notices)[0];
  if (first === undefined) {
    throw new Error("the fixture has no library");
  }
  return first;
}

describe("parseNotices", () => {
  it("reads a valid notices object as it is", () => {
    expect(parseNotices(valid())).toEqual(valid());
  });

  it("reads the app's data file", () => {
    expect(() => parseNotices(raw)).not.toThrow();
    expect(NOTICES).toEqual(raw);
  });

  it.each<[string, unknown]>([
    ["not an object", "notices"],
    ["null", null],
    ["an array", []],
    ["no app", broken((n) => delete n.app)],
    ["an unknown top-level key", broken((n) => (n.extra = 1))],
    ["an app that is not an object", broken((n) => (n.app = "PolyForm"))],
    [
      "an app without its required notice",
      broken((n) => delete (n.app as Record<string, unknown>).requiredNotice),
    ],
    ["an app with an unknown key", broken((n) => ((n.app as Record<string, unknown>).name = "x"))],
    [
      "an app whose text is not given",
      broken((n) => ((n.app as Record<string, unknown>).textId = "none")),
    ],
    [
      "an app whose text is null",
      broken((n) => ((n.app as Record<string, unknown>).textId = null)),
    ],
    ["libraries that are not an array", broken((n) => (n.libraries = {}))],
    ["no libraries", broken((n) => (n.libraries = []))],
    ["a library that is not an object", broken((n) => (n.libraries = ["a"]))],
    ["a library without a name", broken((n) => delete firstLibrary(n).name)],
    ["a library with an empty name", broken((n) => (firstLibrary(n).name = ""))],
    ["a version that is a number", broken((n) => (firstLibrary(n).version = 1))],
    ["a version that is empty", broken((n) => (firstLibrary(n).version = ""))],
    ["a version that is missing", broken((n) => delete firstLibrary(n).version)],
    ["a licence that is not a string", broken((n) => (firstLibrary(n).licence = ["MIT"]))],
    ["a source that is not an address", broken((n) => (firstLibrary(n).source = "github"))],
    ["a text ID that is a number", broken((n) => (firstLibrary(n).textId = 1))],
    ["a text ID that names no text", broken((n) => (firstLibrary(n).textId = "c"))],
    [
      "a text ID that names a property of every object",
      broken((n) => (firstLibrary(n).textId = "toString")),
    ],
    [
      "an app text ID that names a property of every object",
      broken((n) => ((n.app as Record<string, unknown>).textId = "constructor")),
    ],
    ["a library with an unknown key", broken((n) => (firstLibrary(n).mode = "depend"))],
    ["two libraries of one name", broken((n) => (libraries(n)[1] = { ...firstLibrary(n) }))],
    ["texts that are not an object", broken((n) => (n.texts = "MIT"))],
    ["a text that is not a string", broken((n) => ((n.texts as Record<string, unknown>).a = 1))],
    ["a text that is empty", broken((n) => ((n.texts as Record<string, unknown>).a = ""))],
    [
      "a text that nothing uses",
      broken((n) => ((n.texts as Record<string, unknown>).z = "unused")),
    ],
  ])("refuses %s", (_name, input) => {
    expect(() => parseNotices(input)).toThrow(NoticesError);
  });

  it("refuses an http:// address as not https, for a library's source and for the app's licence (PBI-1.22)", () => {
    const source = broken((n) => (firstLibrary(n).source = "http://example.org/a"));
    expect(() => parseNotices(source)).toThrow(
      "notices.json: libraries[0].source is not an https address",
    );
    const url = broken((n) => ((n.app as Record<string, unknown>).url = "http://example.org/l"));
    expect(() => parseNotices(url)).toThrow("notices.json: app.url is not an https address");
  });
});

/** The rows of the tables under a heading of THIRD-PARTY-NOTICES.md, up to the next `## `. */
function tableRows(heading: string): string[][] {
  const text = readFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8");
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) {
    throw new Error(`THIRD-PARTY-NOTICES.md has no heading "${heading}"`);
  }
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end))
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

/** What THIRD-PARTY-NOTICES.md records of a library the app ships. */
type Recorded = { name: string; version: string | null; licence: string; source: string };

function recordedInTheApp(): Recorded[] {
  return tableRows("## In the app").map(
    ([name = "", version = "", licence = "", , source = ""]) => ({
      name: /^`([^`]+)`/.exec(name)?.[1] ?? name,
      version: /^\d[\w.-]*$/.test(version) ? version : null,
      licence: licence.replace(/\s*\([^)]*\)/g, "").trim(),
      source: /https:\/\/\S+?(?=,|$|\s)/.exec(source)?.[0] ?? source,
    }),
  );
}

/** The licence file a package ships, or undefined when it ships none. */
function licenceFile(packageDir: string): string | undefined {
  const name = readdirSync(packageDir).find((file) => /^licen[cs]e(\.md|\.txt)?$/i.test(file));
  return name === undefined ? undefined : readFileSync(join(packageDir, name), "utf8");
}

function npmPackage(
  name: string,
): { dir: string; json: { version: string; license: string } } | undefined {
  const dir = join(MODULES, ...name.split("/"));
  const file = join(dir, "package.json");
  return existsSync(file) ? { dir, json: JSON.parse(readFileSync(file, "utf8")) } : undefined;
}

describe("the data file against THIRD-PARTY-NOTICES.md", () => {
  it("lists exactly the libraries recorded as in the app, in the same order", () => {
    expect(NOTICES.libraries.map((entry) => entry.name)).toEqual(
      recordedInTheApp().map((entry) => entry.name),
    );
  });

  it("gives each library the version, licence and source recorded there", () => {
    expect(
      NOTICES.libraries.map(({ name, version, licence, source }) => ({
        name,
        version,
        licence,
        source,
      })),
    ).toEqual(recordedInTheApp());
  });

  it("lists none of the development tools, which are not shipped", () => {
    const tools = tableRows("## Development tools").map(([name = ""]) => name.replace(/`/g, ""));
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(NOTICES.libraries.map((entry) => entry.name)).not.toContain(tool);
    }
  });
});

describe("the licence texts", () => {
  const fromNpm = NOTICES.libraries.filter((entry) => npmPackage(entry.name) !== undefined);

  it("cover the npm packages", () => {
    expect(fromNpm.length).toBeGreaterThan(0);
  });

  it.each(fromNpm.map((entry) => [entry.name, entry] as const))(
    "of %s are those of the installed package",
    (_name, entry) => {
      const installed = npmPackage(entry.name);
      expect(entry.version).toBe(installed?.json.version);
      expect(entry.licence).toBe(installed?.json.license);
      const file = installed === undefined ? undefined : licenceFile(installed.dir);
      if (file === undefined) {
        expect(entry.textId).toBeNull();
      } else {
        expect(NOTICES.texts[entry.textId ?? ""]).toBe(file);
      }
    },
  );

  it("give the Apache-2.0 libraries from Maven the Apache License 2.0, as TypeScript ships it", () => {
    const apache = NOTICES.libraries.filter(
      (entry) => npmPackage(entry.name) === undefined && entry.licence === "Apache-2.0",
    );
    expect(apache.length).toBeGreaterThan(0);
    const text = readFileSync(join(MODULES, "typescript", "LICENSE.txt"), "utf8");
    for (const entry of apache) {
      expect(NOTICES.texts[entry.textId ?? ""]).toBe(text);
    }
  });

  it("are missing for exactly these libraries, which the release gate still needs", () => {
    expect(NOTICES.libraries.filter((entry) => entry.textId === null).map((e) => e.name)).toEqual([
      "expo-router",
      "com.github.bumptech.glide:glide",
      "SDWebImageWebPCoder",
      "com.google.android.gms:play-services-location",
      "com.google.android.gms:play-services-base",
      "com.google.android.gms:play-services-basement",
      "com.google.android.gms:play-services-tasks",
    ]);
  });

  /** play-services-location, and the Play services libraries its POM and theirs name. */
  const PLAY_SERVICES: readonly [string, string][] = [
    ["play-services-location", "21.0.1"],
    ["play-services-base", "18.1.0"],
    ["play-services-basement", "18.1.0"],
    ["play-services-tasks", "18.0.2"],
  ];

  it.each(PLAY_SERVICES)(
    "name Google's terms for %s %s by the address its POM gives, as no text of them ships in a package (PBI-1.19)",
    (artifact, version) => {
      const name = `com.google.android.gms:${artifact}`;
      expect(NOTICES.libraries.find((entry) => entry.name === name)).toEqual({
        name,
        version,
        licence:
          "Android Software Development Kit License, https://developer.android.com/studio/terms.html",
        source: "https://dl.google.com/dl/android/maven2/",
        textId: null,
      });
    },
  );

  /** The AndroidX libraries the POMs of play-services-base and play-services-basement name. */
  const ANDROIDX_FOR_PLAY_SERVICES: readonly [string, string, string][] = [
    ["androidx.collection", "collection", "1.0.0"],
    ["androidx.core", "core", "1.2.0"],
    ["androidx.fragment", "fragment", "1.0.0"],
  ];

  it.each(ANDROIDX_FOR_PLAY_SERVICES)(
    "give %s:%s %s, which Play services names, the Apache License 2.0 its POM names (PBI-1.19)",
    (group, artifact, version) => {
      const name = `${group}:${artifact}`;
      expect(NOTICES.libraries.find((entry) => entry.name === name)).toEqual({
        name,
        version,
        licence: "Apache-2.0",
        source: "https://dl.google.com/dl/android/maven2/",
        textId: "Apache-2.0",
      });
    },
  );

  it.each(ANDROIDX_FOR_PLAY_SERVICES)(
    "record that the licence of %s:%s %s was read from its own POM on Google's Maven (PBI-1.19)",
    (group, artifact, version) => {
      const row = tableRows("## In the app").find(([name = ""]) =>
        name.startsWith(`\`${group}:${artifact}\``),
      );
      const pom = `https://dl.google.com/dl/android/maven2/${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.pom`;
      expect(row?.[1]).toBe(version);
      expect(row?.[5]).toContain(pom);
    },
  );

  it.each(PLAY_SERVICES)(
    "record that the licence of %s %s was read from its own POM on Google's Maven (PBI-1.19)",
    (artifact, version) => {
      const row = tableRows("## In the app").find(([name = ""]) =>
        name.startsWith(`\`com.google.android.gms:${artifact}\``),
      );
      const pom = `https://dl.google.com/dl/android/maven2/com/google/android/gms/${artifact}/${version}/${artifact}-${version}.pom`;
      expect(row?.[5]).toContain(pom);
    },
  );

  it("name for expo-location the Play services version its Android build files ask for (PBI-1.19)", () => {
    const wanted = "com.google.android.gms:play-services-location:21.0.1";
    const gradle = readFileSync(join(MODULES, "expo-location", "android", "build.gradle"), "utf8");
    expect(gradle).toContain(`'${wanted}'`);
    const [name, version] = [wanted.slice(0, wanted.lastIndexOf(":")), wanted.split(":")[2]];
    expect(NOTICES.libraries.find((entry) => entry.name === name)?.version).toBe(version);
  });
});

describe("the app's own licence", () => {
  it("is the text of LICENSE", () => {
    expect(NOTICES.texts[NOTICES.app.textId]).toBe(readFileSync(join(ROOT, "LICENSE"), "utf8"));
  });

  it("is named and linked as LICENSE names and links it", () => {
    const [title = "", , link = ""] = readFileSync(join(ROOT, "LICENSE"), "utf8").split("\n");
    expect(`# ${NOTICES.app.licence}`).toBe(title);
    expect(`<${NOTICES.app.url}>`).toBe(link);
  });

  it("carries the required notice of NOTICE", () => {
    const notices = readFileSync(join(ROOT, "NOTICE"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("Required Notice:"));
    expect([NOTICES.app.requiredNotice]).toEqual(notices);
  });
});
