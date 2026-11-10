/**
 * The Wikidata and Commons calls of a text answer's representative picture, and the reading of
 * their answers (docs/SPEC.md 3.9, Known unknown 15; the product office's phase-2-checks.md,
 * section 5, gives the calls and their fields). It sends nothing itself: `fetchPicture.ts` does,
 * one request at a time. Every answer is read as untrusted input: anything not of the shape the
 * section gives is an answer the app does not know, and gives no picture.
 *
 * The item and the image follow docs/SPEC.md Known unknown 15, as settled for PBI-2.9: among the
 * items whose taxon name, P225, is the name, ignoring case, those whose rank, P105, is species; of
 * them, those with a P18 that is not deprecated; of them, the one with the most sitelinks, and no
 * picture on a tie for the most. Its image is the first P18 of preferred rank, else the first of
 * normal rank, never a deprecated one. A deprecated P225 or P105 does not count, and a P18 without
 * a file name ("somevalue") is no image.
 */

import { type WikimediaConfig, wikimediaConfig } from "../config/wikimedia";
import { creditedLicence } from "./licences";

/** Letters, blanks between words, and the marks of a Latin name: a hyphen, a full stop, ×, '. */
const LATIN_NAME = /^[\p{L}][\p{L} .'×-]*$/u;
const LATIN_NAME_MAX = 200;
const ITEM_ID = /^Q[1-9][0-9]*$/;

/**
 * The Latin name as it is sent (docs/SPEC.md 3.9: "Only the Latin name is sent to Wikimedia"): its
 * blanks trimmed and single. Null for a name that is not letters and the marks above, such as one
 * with a quote that would end the search's phrase, or one past 200 characters: nothing is sent.
 */
export function sendableName(latinName: string): string | null {
  const name = latinName.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > LATIN_NAME_MAX || /[\n\r\t]/.test(latinName)) {
    return null;
  }
  return LATIN_NAME.test(name) ? name : null;
}

/** An address of an Action API with its parameters, in their order. */
function apiUrl(base: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}?${query}`;
}

/** Section 5, call 1: the items whose taxon name is the name, case ignored. */
export function searchUrl(name: string, appConfig: WikimediaConfig = wikimediaConfig): string {
  return apiUrl(appConfig.wikidataApiUrl, {
    action: "query",
    list: "search",
    srsearch: `haswbstatement:"P225=${name}"`,
    srlimit: String(appConfig.searchLimit),
    format: "json",
    formatversion: "2",
  });
}

/** Section 5, call 2: the items' claims, and their sitelinks for the choice among homonyms. */
export function entitiesUrl(
  ids: readonly string[],
  appConfig: WikimediaConfig = wikimediaConfig,
): string {
  return apiUrl(appConfig.wikidataApiUrl, {
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "claims|sitelinks",
    format: "json",
    formatversion: "2",
  });
}

/**
 * Section 5, call 3, without a width: the original's size and address, the file page's address,
 * its author (`extmetadata` Artist only) and its templates, for the licence (SPEC Known unknown 15).
 */
export function fileInfoUrl(file: string, appConfig: WikimediaConfig = wikimediaConfig): string {
  return apiUrl(appConfig.commonsApiUrl, {
    action: "query",
    titles: `File:${file}`,
    prop: "imageinfo|templates",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "Artist",
    iiextmetadatalanguage: "en",
    tlnamespace: "10",
    tllimit: "max",
    format: "json",
    formatversion: "2",
  });
}

/** Section 5, call 3, with the width: the thumbnail's address. */
export function thumbnailUrl(
  file: string,
  width: number,
  appConfig: WikimediaConfig = wikimediaConfig,
): string {
  return apiUrl(appConfig.commonsApiUrl, {
    action: "query",
    titles: `File:${file}`,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width),
    format: "json",
    formatversion: "2",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const child = value[key];
  return isRecord(child) ? child : null;
}

function listAt(value: unknown, key: string): unknown[] | null {
  if (!isRecord(value)) {
    return null;
  }
  const child = value[key];
  return Array.isArray(child) ? child : null;
}

/** The items the search found, in its order; null when the answer is not a search's. */
export function readSearch(answer: unknown): string[] | null {
  const results = listAt(recordAt(answer, "query"), "search");
  if (results === null) {
    return null;
  }
  return results.flatMap((result) => {
    const title = isRecord(result) ? result.title : undefined;
    return typeof title === "string" && ITEM_ID.test(title) ? [title] : [];
  });
}

type Rank = "preferred" | "normal" | "deprecated";

/** A claim's rank and value, when it has a value; claims without one ("somevalue") have none. */
function claimValues(claims: unknown, property: string): { rank: Rank; value: unknown }[] {
  const list = listAt(claims, property) ?? [];
  return list.flatMap((claim) => {
    if (!isRecord(claim)) {
      return [];
    }
    const { rank } = claim;
    const snak = recordAt(claim, "mainsnak");
    const datavalue = recordAt(snak, "datavalue");
    if (
      snak?.snaktype !== "value" ||
      datavalue === null ||
      (rank !== "preferred" && rank !== "normal" && rank !== "deprecated")
    ) {
      return [];
    }
    return [{ rank, value: datavalue.value }];
  });
}

function counted(claims: unknown, property: string): unknown[] {
  return claimValues(claims, property)
    .filter((claim) => claim.rank !== "deprecated")
    .map((claim) => claim.value);
}

/** The item's image (SPEC Known unknown 15: the first preferred, else the first normal), or null. */
function imageOf(claims: unknown): string | null {
  const images = claimValues(claims, "P18").filter(
    (claim): claim is { rank: Rank; value: string } =>
      typeof claim.value === "string" && claim.value.trim().length > 0,
  );
  const chosen =
    images.find((claim) => claim.rank === "preferred") ??
    images.find((claim) => claim.rank === "normal");
  return chosen?.value ?? null;
}

export type ChosenFile =
  | { readonly ok: true; readonly file: string }
  | { readonly ok: false; readonly reason: "no-item" | "no-image" | "tie" | "answer" };

/**
 * The Commons file of the image of the species' item (docs/SPEC.md Known unknown 15, settled for
 * PBI-2.9), from the answer of `entitiesUrl(ids)`.
 */
export function chooseImageFile(
  answer: unknown,
  ids: readonly string[],
  name: string,
  appConfig: WikimediaConfig = wikimediaConfig,
): ChosenFile {
  const entities = recordAt(answer, "entities");
  if (entities === null) {
    return { ok: false, reason: "answer" };
  }
  const wanted = name.toLowerCase();
  const species = ids.flatMap((id) => {
    const entity = recordAt(entities, id);
    if (entity === null || "missing" in entity) {
      return [];
    }
    const claims = recordAt(entity, "claims");
    const named = counted(claims, "P225").some(
      (value) => typeof value === "string" && value.trim().toLowerCase() === wanted,
    );
    const ofSpeciesRank = counted(claims, "P105").some(
      (value) => isRecord(value) && value.id === appConfig.speciesRank,
    );
    if (!named || !ofSpeciesRank) {
      return [];
    }
    const sitelinks = recordAt(entity, "sitelinks");
    return [{ image: imageOf(claims), sitelinks: Object.keys(sitelinks ?? {}).length }];
  });
  if (species.length === 0) {
    return { ok: false, reason: "no-item" };
  }
  // The image first, then the sitelinks: an item without an image never takes the place, nor
  // ties with, one that has one.
  const withImage = species.filter(
    (item): item is { image: string; sitelinks: number } => item.image !== null,
  );
  if (withImage.length === 0) {
    return { ok: false, reason: "no-image" };
  }
  const most = Math.max(...withImage.map((item) => item.sitelinks));
  const [first, ...others] = withImage.filter((item) => item.sitelinks === most);
  if (first === undefined) {
    return { ok: false, reason: "no-image" };
  }
  // A tie for the most gives no picture (SPEC Known unknown 15): the self-check would not catch a
  // homonym of the same genus.
  return others.length > 0 ? { ok: false, reason: "tie" } : { ok: true, file: first.image };
}

export type FileInfo =
  | {
      readonly ok: true;
      /** The original's size, in pixels. */
      readonly width: number;
      readonly height: number;
      /** The original's address. */
      readonly url: string;
      /** The file page on Commons. */
      readonly page: string;
      /** Artist, as text. */
      readonly author: string;
      /** The code of the licence it is credited under (`creditedLicence`). */
      readonly licence: string;
    }
  | { readonly ok: false; readonly reason: "no-image" | "licence" | "no-author" | "answer" };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** The first page of an imageinfo query's answer, or null when there is none. */
function firstPage(answer: unknown): Record<string, unknown> | null {
  const [page] = listAt(recordAt(answer, "query"), "pages") ?? [];
  return isRecord(page) ? page : null;
}

/** A page's first imageinfo entry, or null. */
function firstInfo(page: Record<string, unknown> | null): Record<string, unknown> | null {
  const [info] = listAt(page, "imageinfo") ?? [];
  return isRecord(info) ? info : null;
}

/** The file's size, address, page, author and licence, from the answer of `fileInfoUrl`. */
export function readFileInfo(
  answer: unknown,
  appConfig: WikimediaConfig = wikimediaConfig,
): FileInfo {
  const page = firstPage(answer);
  if (page === null) {
    return { ok: false, reason: "answer" };
  }
  if ("missing" in page || "invalid" in page) {
    return { ok: false, reason: "no-image" };
  }
  const info = firstInfo(page);
  const templates = listAt(page, "templates");
  if (info === null || templates === null) {
    return { ok: false, reason: "answer" };
  }
  const { width, height, url, descriptionurl } = info;
  if (
    !isPositiveInteger(width) ||
    !isPositiveInteger(height) ||
    typeof url !== "string" ||
    !isMediaUrl(url, appConfig) ||
    typeof descriptionurl !== "string" ||
    !descriptionurl.startsWith(`https://${appConfig.pageHost}/`)
  ) {
    return { ok: false, reason: "answer" };
  }
  const titles = templates.flatMap((template) =>
    isRecord(template) && typeof template.title === "string" ? [template.title] : [],
  );
  const licence = creditedLicence(titles, appConfig);
  if (licence === null) {
    return { ok: false, reason: "licence" };
  }
  const artist = recordAt(recordAt(info, "extmetadata"), "Artist")?.value;
  const author = typeof artist === "string" ? plainText(artist) : "";
  if (author.length === 0) {
    return { ok: false, reason: "no-author" };
  }
  return { ok: true, width, height, url, page: descriptionurl, author, licence };
}

/** The thumbnail's address, from the answer of `thumbnailUrl`; null without one on a media host. */
export function readThumbnail(
  answer: unknown,
  appConfig: WikimediaConfig = wikimediaConfig,
): string | null {
  const thumb = firstInfo(firstPage(answer))?.thumburl;
  return typeof thumb === "string" && isMediaUrl(thumb, appConfig) ? thumb : null;
}

/**
 * The smallest standard width at or above the width the resize needs, or the largest when the
 * need is above it (docs/SPEC.md 3.9).
 */
export function standardWidthFor(
  need: number,
  appConfig: WikimediaConfig = wikimediaConfig,
): number {
  const widths = appConfig.thumbnailWidths;
  return widths.find((width) => width >= need) ?? widths[widths.length - 1] ?? need;
}

/** An https address on one of Wikimedia's media hosts, with no user or port in it. */
export function isMediaUrl(url: string, appConfig: WikimediaConfig = wikimediaConfig): boolean {
  const host = /^https:\/\/([A-Za-z0-9.-]+)(?:[/?#]|$)/.exec(url)?.[1] ?? "";
  return host.toLowerCase().endsWith(appConfig.mediaHostSuffix);
}

const NAMED_ENTITIES: { readonly [name: string]: string } = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Artist's HTML as text, for the author SPEC 3.9 shows: line breaks as blanks, every tag dropped, the
 * entities decoded, the blanks single and trimmed. An entity the app does not know stays as it is.
 */
export function plainText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity.startsWith("#")) {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    });
  return text.replace(/\s+/g, " ").trim();
}

/** A product token of HTTP (RFC 9110, 5.6.2): printable ASCII without blanks or delimiters. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function tokenOf(fields: object, key: "name" | "version"): string | null {
  const value: unknown = key in fields ? (fields as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

/**
 * The User-Agent of the picture's requests (SPEC Known unknown 15), from the app's config, app.json's
 * `expo`: `<name>/<version> (<repository>) expo-fetch`. Null when the name or the version is
 * missing or not a product token, ASCII only, as OkHttp refuses other header values; then nothing
 * is sent, since Wikimedia blocks generic agents.
 */
export function pictureUserAgent(
  expoConfig: unknown,
  appConfig: WikimediaConfig = wikimediaConfig,
): string | null {
  if (typeof expoConfig !== "object" || expoConfig === null) {
    return null;
  }
  const name = tokenOf(expoConfig, "name");
  const version = tokenOf(expoConfig, "version");
  if (name === null || version === null) {
    return null;
  }
  return `${name}/${version} (${appConfig.userAgentContact}) ${appConfig.userAgentLibrary}`;
}
