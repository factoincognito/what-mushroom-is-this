import data from "./notices.json";

/**
 * What the About view shows of the licences (docs/SPEC.md 3.1, PBI-1.9): the app's own licence,
 * and the libraries the app ships as `THIRD-PARTY-NOTICES.md` records them under "In the app".
 * The data is kept in `notices.json`; an entry is added there, and its tests check it against
 * `THIRD-PARTY-NOTICES.md` and the installed package.
 */
export type Notices = {
  readonly app: {
    /** The licence's name, as the first line of `LICENSE` gives it. */
    readonly licence: string;
    readonly url: string;
    /** The "Required Notice:" line of `NOTICE`, which the licence says must reach the user. */
    readonly requiredNotice: string;
    readonly textId: string;
  };
  readonly libraries: readonly Library[];
  /** The licence texts, by ID; libraries whose texts are the same share one. */
  readonly texts: { readonly [id: string]: string };
};

export type Library = {
  readonly name: string;
  /** The exact version, or null when the build chooses it (the release gate fixes it). */
  readonly version: string | null;
  readonly licence: string;
  readonly source: string;
  /** The ID of its licence text, or null when the text is not in the app yet. */
  readonly textId: string | null;
};

/** The data file does not have the shape of `Notices`. */
export class NoticesError extends Error {
  constructor(message: string) {
    super(`notices.json: ${message}`);
    this.name = "NoticesError";
  }
}

type Fields = { readonly [key: string]: unknown };

function fields(value: unknown, where: string, keys: readonly string[]): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NoticesError(`${where} is not an object`);
  }
  const found = Object.keys(value).sort();
  const wanted = [...keys].sort();
  if (found.length !== wanted.length || found.some((key, index) => key !== wanted[index])) {
    throw new NoticesError(`${where} must have exactly the keys ${wanted.join(", ")}`);
  }
  return value as Fields;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") {
    throw new NoticesError(`${where} is not a non-empty string`);
  }
  return value;
}

function address(value: unknown, where: string): string {
  const url = text(value, where);
  if (!/^https:\/\/\S+$/.test(url)) {
    throw new NoticesError(`${where} is not an https address`);
  }
  return url;
}

function textsOf(value: unknown): { [id: string]: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NoticesError("texts is not an object");
  }
  const texts: { [id: string]: string } = {};
  for (const [id, entry] of Object.entries(value)) {
    texts[id] = text(entry, `texts.${id}`);
  }
  return texts;
}

/** Whether `texts` has its own text `id` (not one of `Object.prototype`'s, such as "toString"). */
function hasText(texts: Fields, id: string): boolean {
  return Object.hasOwn(texts, id);
}

function libraryOf(value: unknown, index: number, texts: Fields): Library {
  const where = `libraries[${index}]`;
  const entry = fields(value, where, ["name", "version", "licence", "source", "textId"]);
  const textId = entry.textId === null ? null : text(entry.textId, `${where}.textId`);
  if (textId !== null && !hasText(texts, textId)) {
    throw new NoticesError(`${where}.textId names no text: ${textId}`);
  }
  return {
    name: text(entry.name, `${where}.name`),
    version: entry.version === null ? null : text(entry.version, `${where}.version`),
    licence: text(entry.licence, `${where}.licence`),
    source: address(entry.source, `${where}.source`),
    textId,
  };
}

/** Checks the data file's content and gives it typed; anything else throws `NoticesError`. */
export function parseNotices(value: unknown): Notices {
  const top = fields(value, "the file", ["app", "libraries", "texts"]);
  const texts = textsOf(top.texts);

  const appFields = fields(top.app, "app", ["licence", "url", "requiredNotice", "textId"]);
  const app = {
    licence: text(appFields.licence, "app.licence"),
    url: address(appFields.url, "app.url"),
    requiredNotice: text(appFields.requiredNotice, "app.requiredNotice"),
    textId: text(appFields.textId, "app.textId"),
  };
  if (!hasText(texts, app.textId)) {
    throw new NoticesError(`app.textId names no text: ${app.textId}`);
  }

  if (!Array.isArray(top.libraries) || top.libraries.length === 0) {
    throw new NoticesError("libraries is not a non-empty list");
  }
  const libraries = top.libraries.map((entry: unknown, index) => libraryOf(entry, index, texts));
  const names = new Set<string>();
  for (const library of libraries) {
    if (names.has(library.name)) {
      throw new NoticesError(`two libraries are named ${library.name}`);
    }
    names.add(library.name);
  }

  const used = new Set([app.textId, ...libraries.map((library) => library.textId)]);
  for (const id of Object.keys(texts)) {
    if (!used.has(id)) {
      throw new NoticesError(`texts.${id} is not used`);
    }
  }
  return { app, libraries, texts };
}

/** The app's notices, checked when the module loads. */
export const NOTICES: Notices = parseNotices(data);
