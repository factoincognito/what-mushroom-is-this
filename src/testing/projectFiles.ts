/**
 * Node's file functions, typed, for the tests that check the project's own files against each
 * other (the backup rules, the About view's notices). The project has no Node types, and the
 * app does not import this module.
 */

type Fs = {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  /** Every file and folder below the path, each by its path relative to it. */
  readdirSync(path: string, options: { recursive: true }): string[];
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};

type Path = {
  join(...parts: string[]): string;
};

type Os = {
  tmpdir(): string;
};

export const fs: Fs = jest.requireActual("node:fs");
export const path: Path = jest.requireActual("node:path");
export const os: Os = jest.requireActual("node:os");

/** The project's root folder: the folder Jest runs in, which holds this project's app.json. */
export const PROJECT_ROOT: string = process.cwd();
if (!fs.existsSync(path.join(PROJECT_ROOT, "app.json"))) {
  throw new Error(`run the tests from the project's root folder, not ${PROJECT_ROOT}`);
}
