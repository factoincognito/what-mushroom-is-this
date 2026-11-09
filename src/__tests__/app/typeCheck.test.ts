import ts from "typescript";

import { fs, PROJECT_ROOT, path } from "../../testing/projectFiles";

/** The files `npm run typecheck` (`tsc --noEmit`) checks, as `tsconfig.json` gives them. */
function checkedFiles(): string[] {
  const configPath = path.join(PROJECT_ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PROJECT_ROOT);
  return parsed.fileNames;
}

describe("the type check (PBI-1.22)", () => {
  it("covers the root mocks Jest uses in place of a library, such as expo-network's", () => {
    const dir = path.join(PROJECT_ROOT, "__mocks__");
    const mocks = fs
      .readdirSync(dir)
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => path.join(dir, name));
    expect(mocks).toContain(path.join(dir, "expo-network.ts"));
    expect(checkedFiles()).toEqual(expect.arrayContaining(mocks));
  });

  it("still covers the app's code", () => {
    expect(checkedFiles()).toContain(path.join(PROJECT_ROOT, "src", "queue", "queue.ts"));
  });
});

/** The project's compiler options, as `tsconfig.json` gives them. */
function compilerOptions(): ts.CompilerOptions {
  const configPath = path.join(PROJECT_ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(read.config, ts.sys, PROJECT_ROOT).options;
}

/**
 * The type errors in the expo-network mock, with `change` applied to its text first: the mock is
 * checked as `npm run typecheck` checks it, against expo-network's own declarations.
 */
function mockErrors(change: (text: string) => string): string[] {
  const file = path.join(PROJECT_ROOT, "__mocks__", "expo-network.ts");
  const text = change(fs.readFileSync(file, "utf8"));
  const host = ts.createCompilerHost(compilerOptions());
  const readFile = host.readFile;
  host.readFile = (name) => (path.join(name) === file ? text : readFile(name));
  const program = ts.createProgram([file], compilerOptions(), host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

describe("the expo-network mock's network type (PBI-1.26)", () => {
  it("type-checks as it is", () => {
    expect(mockErrors((text) => text)).toEqual([]);
  }, 120_000);

  it("fails the type check when its network type is not one of the enum's values", () => {
    const errors = mockErrors((text) => text.replace('"WIFI"', '"WIRELESS"'));
    expect(errors.join("\n")).toMatch(/"WIRELESS"/);
  }, 120_000);
});
