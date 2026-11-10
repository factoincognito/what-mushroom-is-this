/**
 * The fetch of a text answer's representative picture (docs/SPEC.md 3.9, "A representative picture
 * for text lookups"; PBI-2.9). Only the Latin name is sent to Wikimedia: the search names it, and
 * the later calls only what Wikimedia gave back. The requests go one at a time, each with the
 * app's User-Agent and `Accept-Encoding: gzip`, each within the time limit, never retried here
 * (Clead's decision 5):
 *
 * 1. Wikidata's search for the items whose taxon name, P225, is the name;
 * 2. the items' claims and sitelinks, and the image of the one chosen (`chooseImageFile`);
 * 3. the Commons file's size, addresses, author and licence templates (`readFileInfo`);
 * 4. its thumbnail's address, at the smallest standard width at or above what the model's resize
 *    needs (3840 when the need is above that); not asked for when the original is narrower than
 *    that width, as Wikimedia then serves the original itself;
 * 5. the picture, its type read from its bytes: JPEG, PNG, WebP or GIF, anything else none.
 *
 * The picture is then resized and checked on the phone as a photo is for analysis (3.3); the copy
 * kept is the resized JPEG, which passed the metadata check. The copy downloaded is removed.
 *
 * What comes of it, by 3.9's "Fetching it": no network, the time limit, a 429 or a 5xx make the
 * picture wait (a 429 or 503 until its `Retry-After`, or at least 5 seconds); no item, no image, a
 * licence not on the list, no machine-readable author, any other answer, a picture of another type,
 * one too large, or one that cannot be loaded or fails the metadata check after its resize give no
 * picture for that answer. An error that is not Wikimedia's nor the picture's (a copy that cannot
 * be written, a configuration error of the resize) is passed on.
 */

import { parseRetryAfter } from "../analysis/retryAfter";
import { type WikimediaConfig, wikimediaConfig } from "../config/wikimedia";
import { type ImageLimits, resizedSize } from "../image/resize";
import { EXTENSION_OF, imageTypeOf } from "./imageType";
import {
  chooseImageFile,
  entitiesUrl,
  fileInfoUrl,
  isMediaUrl,
  readFileInfo,
  readSearch,
  readThumbnail,
  searchUrl,
  sendableName,
  standardWidthFor,
  thumbnailUrl,
} from "./wikimedia";

/** Why there is no picture for an answer; for the tests and the reader, not shown as such. */
export type NoPictureReason =
  | "name"
  | "user-agent"
  | "no-item"
  | "no-image"
  | "licence"
  | "no-author"
  | "answer"
  | "format"
  | "too-large"
  | "load"
  | "segment-check";

/** Why a picture waits: no network, or Wikimedia (a 429, a 5xx, or its time limit passed). */
export type PictureWaitCause = "network" | "picture-source";

/** A picture fetched: the app's copy, resized, and the credit its licence requires. */
export interface FetchedPicture {
  readonly uri: string;
  readonly author: string;
  /** The code of the licence it is credited under (`licences.ts`). */
  readonly licence: string;
  /** Its page on Wikimedia Commons. */
  readonly page: string;
}

export type PictureFetch =
  | { readonly kind: "picture"; readonly picture: FetchedPicture }
  | { readonly kind: "none"; readonly reason: NoPictureReason }
  /** `retryAtMs`: not before then (a 429 or 503), or null for the next run. */
  | { readonly kind: "waits"; readonly cause: PictureWaitCause; readonly retryAtMs: number | null };

/** The part of a fetch Response the fetch reads. */
export interface PictureResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PictureFetcher = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<PictureResponse>;

/** The picture resized and checked as a photo is (`prepareJpegForAnalysis`), or why not. */
export type PreparedPicture =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "load" | "segment-check" };

export interface PictureDeps {
  fetch: PictureFetcher;
  /** The current time in ms since the epoch. */
  now: () => number;
  /** The User-Agent (`pictureUserAgent`), or null when the app's config gives none. */
  userAgent: string | null;
  /** The image limits of a model (`imageLimitsFor`). */
  imageLimits: (modelId: string) => ImageLimits;
  /** Saves bytes as a copy of the app's own, with the extension given; gives its address. */
  saveCopy: (bytes: Uint8Array, extension: string) => Promise<string>;
  /** Removes a copy; one that is not there is no error. */
  removeCopy: (uri: string) => void;
  /** Resizes and checks a copy for the model, as a photo is for analysis. */
  prepare: (uri: string, modelId: string) => Promise<PreparedPicture>;
}

/** What one request came to: its answer, or the outcome that ends the fetch. */
type Got<T> = { ok: true; value: T } | { ok: false; outcome: PictureFetch };

const none = (reason: NoPictureReason): Got<never> => ({
  ok: false,
  outcome: { kind: "none", reason },
});

/** The longest delay a timer holds. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Finds, fetches, resizes and checks the representative picture of the species named `latinName`,
 * for the model `modelId`; gives the app's copy with its credit, no picture, or a wait.
 */
export async function fetchPicture(
  latinName: string,
  modelId: string,
  deps: PictureDeps,
  appConfig: WikimediaConfig = wikimediaConfig,
): Promise<PictureFetch> {
  const timeLimit = appConfig.requestTimeoutMs;
  if (!Number.isInteger(timeLimit) || timeLimit < 1 || timeLimit > MAX_TIMER_MS) {
    throw new RangeError(`requestTimeoutMs must be an integer from 1 to ${MAX_TIMER_MS}`);
  }
  const name = sendableName(latinName);
  if (name === null) {
    return { kind: "none", reason: "name" };
  }
  const { userAgent } = deps;
  if (userAgent === null) {
    return { kind: "none", reason: "user-agent" };
  }
  const headers = { "User-Agent": userAgent, "Accept-Encoding": "gzip" };

  /** One GET within the time limit, its body read as JSON or as bytes, its failure classed. */
  async function get<T>(
    url: string,
    read: (response: PictureResponse, signal: AbortSignal) => Promise<Got<T>>,
  ): Promise<Got<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("time limit passed")));
    });
    aborted.catch(() => undefined);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeLimit);
    try {
      const response = await Promise.race([
        deps.fetch(url, { method: "GET", headers, signal: controller.signal }),
        aborted,
      ]);
      const failed = classify(response.status, response.headers.get("retry-after"));
      if (failed !== null) {
        return { ok: false, outcome: failed };
      }
      return await Promise.race([read(response, controller.signal), aborted]);
    } catch {
      return {
        ok: false,
        outcome: {
          kind: "waits",
          cause: timedOut ? "picture-source" : "network",
          retryAtMs: null,
        },
      };
    } finally {
      clearTimeout(timer);
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  /** The outcome of a status that is not 200, or null for 200. */
  function classify(status: number, retryAfter: string | null): PictureFetch | null {
    if (status === 200) {
      return null;
    }
    if (status === 429 || status === 503) {
      return throttled(retryAfter);
    }
    if (status >= 500 && status <= 599) {
      return { kind: "waits", cause: "picture-source", retryAtMs: null };
    }
    return { kind: "none", reason: "answer" };
  }

  /** A wait until `Retry-After`, or at least the configured least wait (a 429 or 503). */
  function throttled(retryAfter: string | null): PictureFetch {
    const now = deps.now();
    const at = parseRetryAfter(retryAfter, now, appConfig.retryAfterMaxMs);
    const least = now + appConfig.retryWaitMinMs;
    return {
      kind: "waits",
      cause: "picture-source",
      retryAtMs: at === null || at < least ? least : at,
    };
  }

  /**
   * An Action API answer as JSON. One that reports an error (`{"error": {"code": …}}`, which the
   * API gives with status 200) makes the picture wait when its code is one the configuration
   * lists as temporary, as a 429 does (Clead's decision on #71); any other error is an answer the
   * app does not know, and gives no picture.
   */
  const json = (url: string) =>
    get<unknown>(url, async (response) => {
      const text = await response.text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return none("answer");
      }
      const error =
        typeof value === "object" && value !== null
          ? (value as { error?: unknown }).error
          : undefined;
      if (error === undefined) {
        return { ok: true, value };
      }
      const code =
        typeof error === "object" && error !== null
          ? (error as { code?: unknown }).code
          : undefined;
      if (typeof code === "string" && appConfig.temporaryApiErrors.includes(code)) {
        return { ok: false, outcome: throttled(response.headers.get("retry-after")) };
      }
      return none("answer");
    });

  const bytes = (url: string) =>
    get<Uint8Array>(url, async (response) => {
      const stated = Number(response.headers.get("content-length"));
      if (Number.isFinite(stated) && stated > appConfig.pictureMaxBytes) {
        return none("too-large");
      }
      const body = new Uint8Array(await response.arrayBuffer());
      return body.length > appConfig.pictureMaxBytes
        ? none("too-large")
        : { ok: true, value: body };
    });

  const search = await json(searchUrl(name, appConfig));
  if (!search.ok) {
    return search.outcome;
  }
  const ids = readSearch(search.value);
  if (ids === null) {
    return { kind: "none", reason: "answer" };
  }
  if (ids.length === 0) {
    return { kind: "none", reason: "no-item" };
  }
  const entities = await json(entitiesUrl(ids, appConfig));
  if (!entities.ok) {
    return entities.outcome;
  }
  const chosen = chooseImageFile(entities.value, ids, name, appConfig);
  if (!chosen.ok) {
    return { kind: "none", reason: chosen.reason };
  }
  const fileInfo = await json(fileInfoUrl(chosen.file, appConfig));
  if (!fileInfo.ok) {
    return fileInfo.outcome;
  }
  const info = readFileInfo(fileInfo.value, appConfig);
  if (!info.ok) {
    return { kind: "none", reason: info.reason };
  }

  const size = resizedSize(info.width, info.height, deps.imageLimits(modelId));
  if (!size.ok) {
    return { kind: "none", reason: "answer" };
  }
  const width = standardWidthFor(size.width, appConfig);
  let downloadUrl = info.url;
  if (info.width >= width) {
    const thumb = await json(thumbnailUrl(chosen.file, width, appConfig));
    if (!thumb.ok) {
      return thumb.outcome;
    }
    const thumbUrl = readThumbnail(thumb.value, appConfig);
    if (thumbUrl === null) {
      return { kind: "none", reason: "answer" };
    }
    downloadUrl = thumbUrl;
  }
  if (!isMediaUrl(downloadUrl, appConfig)) {
    return { kind: "none", reason: "answer" };
  }
  const downloaded = await bytes(downloadUrl);
  if (!downloaded.ok) {
    return downloaded.outcome;
  }
  const type = imageTypeOf(downloaded.value);
  if (type === null) {
    return { kind: "none", reason: "format" };
  }

  const copy = await deps.saveCopy(downloaded.value, EXTENSION_OF[type]);
  let prepared: PreparedPicture;
  try {
    prepared = await deps.prepare(copy, modelId);
    if (!prepared.ok) {
      return { kind: "none", reason: prepared.reason };
    }
    const kept = await deps.saveCopy(prepared.bytes, EXTENSION_OF.jpeg);
    return {
      kind: "picture",
      picture: { uri: kept, author: info.author, licence: info.licence, page: info.page },
    };
  } finally {
    deps.removeCopy(copy);
  }
}
