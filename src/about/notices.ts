import { MAPLIBRE_NATIVE_TEXT } from "./maplibreNativeTexts";
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
  /**
   * The credits of the map's data and design (docs/SPEC.md 3.9, PBI-2.8), as
   * `THIRD-PARTY-NOTICES.md` records them under "Map data": the map shows them through its "(i)"
   * button, and About lists them too.
   */
  readonly mapData: readonly MapDataCredit[];
  /**
   * Credits a licence asks to reach the user in the documentation (PBI-2.8), such as FreeType's,
   * which MapLibre Native builds in; `THIRD-PARTY-NOTICES.md` records them under "Credits".
   */
  readonly credits: readonly Credit[];
};

export type Credit = {
  readonly name: string;
  readonly text: string;
};

export type MapDataCredit = {
  readonly name: string;
  /** The credit as its source asks for it, for example "© OpenStreetMap contributors". */
  readonly credit: string;
  readonly licence: string;
  /** The page the credit links to, for example OpenStreetMap's copyright page. */
  readonly url: string;
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

function mapDataOf(value: unknown): MapDataCredit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NoticesError("mapData is not a non-empty list");
  }
  const credits = value.map((entry: unknown, index) => {
    const where = `mapData[${index}]`;
    const credit = fields(entry, where, ["name", "credit", "licence", "url"]);
    return {
      name: text(credit.name, `${where}.name`),
      credit: text(credit.credit, `${where}.credit`),
      licence: text(credit.licence, `${where}.licence`),
      url: address(credit.url, `${where}.url`),
    };
  });
  const names = new Set<string>();
  for (const credit of credits) {
    if (names.has(credit.name)) {
      throw new NoticesError(`two map data credits are named ${credit.name}`);
    }
    names.add(credit.name);
  }
  return credits;
}

function creditsOf(value: unknown): Credit[] {
  if (!Array.isArray(value)) {
    throw new NoticesError("credits is not a list");
  }
  const credits = value.map((entry: unknown, index) => {
    const where = `credits[${index}]`;
    const credit = fields(entry, where, ["name", "text"]);
    return { name: text(credit.name, `${where}.name`), text: text(credit.text, `${where}.text`) };
  });
  const names = new Set<string>();
  for (const credit of credits) {
    if (names.has(credit.name)) {
      throw new NoticesError(`two credits are named ${credit.name}`);
    }
    names.add(credit.name);
  }
  return credits;
}

/** Checks the data file's content and gives it typed; anything else throws `NoticesError`. */
export function parseNotices(value: unknown): Notices {
  const top = fields(value, "the file", ["app", "libraries", "texts", "mapData", "credits"]);
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
  return {
    app,
    libraries,
    texts,
    mapData: mapDataOf(top.mapData),
    credits: creditsOf(top.credits),
  };
}

/**
 * The licence texts too long to keep in `notices.json`, by ID: MapLibre Native's, with the
 * licences of the libraries it builds in (PBI-2.8). They join the file's texts.
 */
export const LONG_TEXTS: { readonly [id: string]: string } = Object.freeze({
  "maplibre-native": MAPLIBRE_NATIVE_TEXT,
});

/** The app's notices, checked when the module loads. */
export const NOTICES: Notices = parseNotices({
  ...data,
  texts: { ...data.texts, ...LONG_TEXTS },
});
