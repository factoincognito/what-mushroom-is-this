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
    mapData: [
      {
        name: "OpenStreetMap",
        credit: "© OpenStreetMap contributors",
        licence: "ODbL 1.0",
        url: "https://www.openstreetmap.org/copyright",
      },
    ],
  };
}

function firstMapData(notices: Record<string, unknown>): Record<string, unknown> {
  const first = (notices.mapData as Record<string, unknown>[])[0];
  if (first === undefined) {
    throw new Error("the fixture has no map data");
  }
  return first;
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
    ["no map data (PBI-2.8)", broken((n) => delete n.mapData)],
    ["map data that is not a list", broken((n) => (n.mapData = {}))],
    ["no map data credits", broken((n) => (n.mapData = []))],
    ["a map data credit that is not an object", broken((n) => (n.mapData = ["OSM"]))],
    ["a map data credit without its credit", broken((n) => delete firstMapData(n).credit)],
    ["a map data credit with an empty licence", broken((n) => (firstMapData(n).licence = ""))],
    ["a map data credit with an unknown key", broken((n) => (firstMapData(n).logo = "x"))],
    [
      "a map data credit whose link is not https",
      broken((n) => (firstMapData(n).url = "http://www.openstreetmap.org/copyright")),
    ],
    [
      "two map data credits of one name",
      broken((n) => (n.mapData = [firstMapData(n), { ...firstMapData(n) }])),
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

/** What THIRD-PARTY-NOTICES.md records of a development tool (PBI-1.27). */
function recordedDevelopmentTools(): { name: string; version: string; licence: string }[] {
  return tableRows("## Development tools").map(([name = "", version = "", licence = ""]) => ({
    name: /^`([^`]+)`$/.exec(name)?.[1] ?? name,
    version,
    licence,
  }));
}

/** The project's `devDependencies`, as `package.json` pins them. */
function devDependencies(): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).devDependencies;
}

describe("the development tools in THIRD-PARTY-NOTICES.md against what is installed (PBI-1.27)", () => {
  const recorded = recordedDevelopmentTools();

  it("are exactly the project's devDependencies", () => {
    expect(recorded.map((tool) => tool.name).sort()).toEqual(Object.keys(devDependencies()).sort());
  });

  it.each(recorded.map((tool) => [tool.name, tool] as const))(
    "record for %s the version installed, which package.json pins",
    (name, tool) => {
      expect(tool.version).toBe(npmPackage(name)?.json.version);
      expect(tool.version).toBe(devDependencies()[name]);
    },
  );

  it.each(recorded.map((tool) => [tool.name, tool] as const))(
    "record for %s the licence its installed package.json states, and say so when it ships no licence file",
    (name, tool) => {
      const installed = npmPackage(name);
      const note = " (`package.json`; the package ships no licence file)";
      const shipsLicence =
        installed !== undefined &&
        readdirSync(installed.dir).some((file) => /^licen[cs]e/i.test(file));
      expect(tool.licence).toBe(`${installed?.json.license}${shipsLicence ? "" : note}`);
    },
  );
});

/** The notices' entry of the library named `name`. */
function library(name: string) {
  const found = NOTICES.libraries.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no library ${name} in the notices`);
  }
  return found;
}

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
      "org.maplibre.gl:android-sdk-opengl",
      "org.maplibre.gl:android-plugin-annotation-v9",
      "org.maplibre.gl:android-plugin-scalebar-v9",
      "org.maplibre.gl:android-sdk-turf",
      "com.squareup.okhttp3:okhttp",
      "com.squareup.okhttp3:okhttp-urlconnection",
      "maplibre-gl-native-distribution",
    ]);
  });

  /**
   * The Maven libraries MapLibre React Native's `android/build.gradle` asks for, its versions
   * filled in from its `android/gradle.properties`, as app.json's plugin options leave them (only
   * `locationEngine`, at its default; appConfig.test.ts), without Google's location engine, which
   * that option leaves out, and without React Native and Kotlin, which come with the app.
   */
  function mapLibreMavenLibraries(): { name: string; version: string }[] {
    const dir = join(MODULES, "@maplibre", "maplibre-react-native", "android");
    const properties = new Map(
      [
        ...readFileSync(join(dir, "gradle.properties"), "utf8").matchAll(
          /^org\.maplibre\.reactnative\.(\w+)=(.*)$/gm,
        ),
      ].map(([, key = "", value = ""]) => [key, value.trim()]),
    );
    const gradle = readFileSync(join(dir, "build.gradle"), "utf8");
    // The module's own dependencies block, at the start of a line, not the buildscript's, up to
    // the libraries of Google's location engine in it.
    const start = gradle.indexOf("\ndependencies {");
    const google = gradle.indexOf(
      'if (getConfigurableExtOrDefault("locationEngine") == "google")',
      start,
    );
    expect(start).toBeGreaterThan(0);
    expect(google).toBeGreaterThan(start);
    const asked = gradle
      .slice(start, google)
      .matchAll(/^\s*implementation\s*\(?\s*"([^":]+):([^":]+)(?::([^"]+))?"/gm);
    return [...asked]
      .map(([, group = "", artifact = "", version = ""]) => ({
        name: `${group}:${artifact}`.replace(
          /\$\{getConfigurableExtOrDefault\('(\w+)'\)\}/g,
          (_whole, key: string) => properties.get(key) ?? `?${key}`,
        ),
        version: version.replace(
          /\$\{getConfigurableExtOrDefault\('(\w+)'\)\}/g,
          (_whole, key: string) => properties.get(key) ?? `?${key}`,
        ),
      }))
      .filter(
        ({ name }) =>
          name !== "com.facebook.react:react-android" &&
          name !== "org.jetbrains.kotlin:kotlin-stdlib",
      );
  }

  it("list @maplibre/maplibre-react-native with the licence text its package ships (PBI-2.8)", () => {
    expect(library("@maplibre/maplibre-react-native")).toMatchObject({
      version: "11.5.1",
      licence: "MIT",
      textId: "@maplibre/maplibre-react-native",
    });
  });

  it("name every Maven library MapLibre React Native's Android build file asks for, at its version (PBI-2.8)", () => {
    const wanted = mapLibreMavenLibraries();
    expect(wanted).toEqual([
      { name: "org.maplibre.gl:android-sdk-opengl", version: "13.6.1" },
      { name: "org.maplibre.gl:android-plugin-annotation-v9", version: "3.0.2" },
      { name: "org.maplibre.gl:android-plugin-scalebar-v9", version: "3.0.2" },
      { name: "org.maplibre.gl:android-sdk-turf", version: "6.0.1" },
      { name: "com.squareup.okhttp3:okhttp", version: "4.12.0" },
      { name: "com.squareup.okhttp3:okhttp-urlconnection", version: "4.12.0" },
      { name: "androidx.vectordrawable:vectordrawable", version: "1.2.0" },
      { name: "androidx.annotation:annotation", version: "1.9.1" },
      { name: "androidx.appcompat:appcompat", version: "1.7.1" },
    ]);
    const record = readFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8");
    for (const { name, version } of wanted) {
      const entry = NOTICES.libraries.find((candidate) => candidate.name === name);
      expect(entry).toBeDefined();
      // A library another one already asks for at another version keeps its row; the record
      // names the version MapLibre asks for beside it (Gradle builds in one version of each).
      if (entry?.version !== version) {
        expect(record).toContain(`\`${name}\` ${version}`);
      }
    }
  });

  it("name the iOS MapLibre Native that MapLibre React Native's podspec asks for, at its version (PBI-2.8)", () => {
    const podspec = readFileSync(
      join(MODULES, "@maplibre", "maplibre-react-native", "MapLibreReactNative.podspec"),
      "utf8",
    );
    const version = /\$MLRN_NATIVE_VERSION \|\|= "([^"]+)"/.exec(podspec)?.[1];
    expect(version).toBe("6.31.0");
    expect(podspec).toContain('url: "https://github.com/maplibre/maplibre-gl-native-distribution"');
    expect(library("maplibre-gl-native-distribution")).toMatchObject({
      version,
      source: "https://github.com/maplibre/maplibre-gl-native-distribution",
    });
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

  it("list expo-document-picker, and the Android libraries its build file asks for with the Apache License 2.0 (PBI-2.6)", () => {
    expect(NOTICES.libraries.map((entry) => entry.name)).toContain("expo-document-picker");
    const gradle = readFileSync(
      join(MODULES, "expo-document-picker", "android", "build.gradle"),
      "utf8",
    );
    const wanted = [...gradle.matchAll(/^\s*api\s+["']([^"':]+):([^"':]+):([^"']+)["']/gm)].map(
      ([, group = "", artifact = "", version = ""]) => ({ name: `${group}:${artifact}`, version }),
    );
    expect(wanted).toEqual([
      { name: "androidx.annotation:annotation", version: "1.0.0" },
      { name: "commons-io:commons-io", version: "2.6" },
    ]);
    for (const { name, version } of wanted) {
      expect(NOTICES.libraries.find((entry) => entry.name === name)).toMatchObject({
        name,
        version,
        licence: "Apache-2.0",
        textId: "Apache-2.0",
      });
    }
  });

  it("name for expo-location the Play services version its Android build files ask for (PBI-1.19)", () => {
    const wanted = "com.google.android.gms:play-services-location:21.0.1";
    const gradle = readFileSync(join(MODULES, "expo-location", "android", "build.gradle"), "utf8");
    expect(gradle).toContain(`'${wanted}'`);
    const [name, version] = [wanted.slice(0, wanted.lastIndexOf(":")), wanted.split(":")[2]];
    expect(NOTICES.libraries.find((entry) => entry.name === name)?.version).toBe(version);
  });
});

describe("the map data credits (SPEC 3.9, PBI-2.8)", () => {
  const credit = (name: string) => NOTICES.mapData.find((entry) => entry.name === name);

  it("credit OpenStreetMap, with a link to its copyright page", () => {
    expect(credit("OpenStreetMap")).toMatchObject({
      credit: "© OpenStreetMap contributors",
      url: "https://www.openstreetmap.org/copyright",
    });
    expect(credit("OpenStreetMap")?.licence).toContain("ODbL");
  });

  it("credit OpenMapTiles, as it asks, and the CC BY 4.0 of its design", () => {
    expect(credit("OpenMapTiles")?.credit).toBe("© OpenMapTiles");
    expect(credit("OpenMapTiles")?.licence).toContain("CC BY 4.0");
  });

  it("credit OpenFreeMap's style, whose design is CC BY 4.0", () => {
    const style = NOTICES.mapData.find((entry) => entry.name.startsWith("OpenFreeMap"));
    expect(style?.licence).toContain("CC BY 4.0");
    expect(style?.credit).toContain("OpenFreeMap");
  });

  it("are exactly those THIRD-PARTY-NOTICES.md records under Map data, in the same order", () => {
    const recorded = tableRows("## Map data").map(
      ([name = "", credit = "", licence = "", url = ""]) => ({
        name: /^`([^`]+)`$/.exec(name)?.[1] ?? name,
        credit,
        licence,
        url,
      }),
    );
    expect(recorded.length).toBeGreaterThan(0);
    expect(NOTICES.mapData).toEqual(recorded);
  });

  it("are not libraries: none of them is listed as one", () => {
    const names = NOTICES.libraries.map((entry) => entry.name);
    for (const entry of NOTICES.mapData) {
      expect(names).not.toContain(entry.name);
    }
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
