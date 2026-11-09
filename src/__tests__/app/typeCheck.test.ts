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
