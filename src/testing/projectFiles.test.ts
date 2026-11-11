/**
 * @jest-environment node
 *
 * The list of the app's own source files (`appSourceFiles`), which the tests that read the app's
 * source rely on (`easBuild.test.ts`, `appName.test.ts`): a file left out of it is a file those
 * tests do not read. Node lists the files below `src/` with the system's own separator, "/" or,
 * on Windows, "\", so the choice is made by either (PBI-2.16, the notes on #79).
 */
import { appSourceFiles, isAppSourceFile, PROJECT_ROOT, path } from "./projectFiles";

describe("isAppSourceFile: a file under src/, by its path from there", () => {
  it.each([
    "app/index.tsx",
    "newFind/devicePicker.ts",
    "store/findStore.ts",
    "testingGround/tool.ts",
    "attesting/x.ts",
    "app\\index.tsx",
    "newFind\\devicePicker.ts",
    "testingGround\\tool.ts",
  ])("takes the app's own source file %s", (file) => {
    expect(isAppSourceFile(file)).toBe(true);
  });

  it.each([
    ["a test beside its code", "store/findStore.test.ts"],
    ["a component's test", "key/KeyContext.test.tsx"],
    ["a spec", "store/findStore.spec.ts"],
    ["a file in a tests folder", "__tests__/app/log.tsx"],
    ["a file in a tests folder further down", "picture/__tests__/helper.ts"],
    ["a test helper", "testing/projectFiles.ts"],
    ["a file that is not TypeScript", "about/notices.json"],
    ["a fixture", "picture/__tests__/fixtures/search-none.json"],
    ["a folder", "store"],
  ])("leaves out %s, with either separator", (_name, file) => {
    expect(isAppSourceFile(file)).toBe(false);
    expect(isAppSourceFile(file.replaceAll("/", "\\"))).toBe(false);
  });
});

describe("appSourceFiles: the files the source-reading tests read", () => {
  const files = appSourceFiles();
  const inSrc = (...parts: string[]) => path.join(PROJECT_ROOT, "src", ...parts);

  it("holds the app's routes and modules, by their full paths", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        inSrc("app", "index.tsx"),
        inSrc("app", "find", "[id].tsx"),
        inSrc("newFind", "devicePicker.ts"),
        inSrc("store", "findStore.ts"),
      ]),
    );
  });

  it("holds no test, no file of a tests folder and no test helper, wherever the project is checked out", () => {
    // Judged by each file's path below `src/`, not by its full path: the folders the project is
    // checked out in, one of which may be named `testing`, say nothing of the file.
    const src = inSrc();
    expect(files.filter((file) => !file.startsWith(src))).toEqual([]);
    const belowSrc = files.map((file) => file.slice(src.length + 1));
    expect(belowSrc.filter((file) => /__tests__|\.test\.|^testing[\\/]/.test(file))).toEqual([]);
    expect(files).not.toContain(inSrc("store", "findStore.test.ts"));
    expect(files).not.toContain(inSrc("__tests__", "app", "easBuild.test.ts"));
    expect(files).not.toContain(inSrc("testing", "projectFiles.ts"));
  });
});
