/**
 * The configuration of a text answer's representative picture (docs/SPEC.md 3.9, Known unknown
 * 15; PBI-2.9): the Wikimedia APIs, the standard thumbnail widths, the limits of the requests, the
 * User-Agent's parts, and the table the file page's licence templates are mapped by. Configuration
 * under Process P-11 § 5 (2), kept in the config module beside `config.ts`. Nothing secret
 * belongs here.
 *
 * Sources: the product office's `library/designs/what-mushroom-is-this/phase-2-checks.md`, sections
 * 4 and 5, and Clead's decisions 1 to 7 for PBI-2.9 (the brief of PBI-2.9's Crog agent).
 */

export type WikimediaConfig = {
  /** Wikidata's Action API: the search by taxon name and the items' claims. */
  readonly wikidataApiUrl: string;
  /** Commons' Action API: the file's size, address, page, author, licence templates and thumbnail. */
  readonly commonsApiUrl: string;
  /** The host of a file's page, the only one a credit links to. */
  readonly pageHost: string;
  /** The end of the host of every image the app downloads: Wikimedia's own media hosts. */
  readonly mediaHostSuffix: string;
  /** Wikimedia's standard thumbnail widths, smallest first; no other width is asked for. */
  readonly thumbnailWidths: readonly number[];
  /** The most items the search gives, and so the most `wbgetentities` reads in one request. */
  readonly searchLimit: number;
  /** The Wikidata item of the taxon rank "species", which an item's P105 must name. */
  readonly speciesRank: string;
  /** The time limit of each request, its body included, in milliseconds. */
  readonly requestTimeoutMs: number;
  /** The least wait after a 429 or 503 without a usable `Retry-After`, in milliseconds. */
  readonly retryWaitMinMs: number;
  /** How far ahead a `Retry-After` may lie, in milliseconds; beyond it, it is treated as missing. */
  readonly retryAfterMaxMs: number;
  /** The largest picture the app downloads, in bytes; a larger one gives no picture. */
  readonly pictureMaxBytes: number;
  /** The contact the User-Agent names: the repository's address. */
  readonly userAgentContact: string;
  /** The library the User-Agent names. */
  readonly userAgentLibrary: string;
  /** The licence templates that are CC0, by name. */
  readonly cc0Templates: readonly string[];
  /** The public-domain templates whose own text says they apply worldwide, by name. */
  readonly publicDomainTemplates: readonly string[];
  /** The Creative Commons versions accepted under CC BY and CC BY-SA, their ports included. */
  readonly ccVersions: readonly string[];
};

export const wikimediaConfig: WikimediaConfig = Object.freeze({
  // phase-2-checks.md section 5, "Calls and fields".
  wikidataApiUrl: "https://www.wikidata.org/w/api.php",
  commonsApiUrl: "https://commons.wikimedia.org/w/api.php",
  pageHost: "commons.wikimedia.org",
  // Section 5: thumbnails come from thumb.wikimedia.org, originals from upload.wikimedia.org.
  mediaHostSuffix: ".wikimedia.org",
  // Section 5, "Widths" (Common thumbnail sizes, edited 2026-10-20); Clead's decision 6.
  thumbnailWidths: Object.freeze([20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840]),
  // Section 4: the Action API takes up to 50 entities a request.
  searchLimit: 50,
  // Section 5: "`Q7432` is species".
  speciesRank: "Q7432",
  // Proposed by Crog in PBI-2.9: half the analysis request's 60 s; the documents give no value.
  requestTimeoutMs: 30_000,
  // Section 5, Rate limits: "respect `Retry-After` on 429 or 503, else wait at least 5 s".
  retryWaitMinMs: 5_000,
  // As the analysis's bound (`config/analysis.ts`): a wait of more than a day is treated as missing.
  retryAfterMaxMs: 24 * 60 * 60 * 1_000,
  // Proposed by Crog in PBI-2.9: a 3840 px JPEG thumbnail is a few MB; 25 MB leaves room.
  pictureMaxBytes: 25 * 1024 * 1024,
  // Clead's decision 5: `Washroom/<app version> (<repository>) expo-fetch`.
  userAgentContact: "https://github.com/factoincognito/what-mushroom-is-this",
  userAgentLibrary: "expo-fetch",
  // Commons' own CC0 template, {{Cc-zero}}, as Commons:Donate to the public domain recommends it
  // (read on a copy at c.enwp.org, 2026-11-10). A redirect to it is listed with it by the API
  // (from memory, not checked).
  cc0Templates: Object.freeze(["Cc-zero"]),
  // Clead's decision 3: only templates whose text says "This applies worldwide", each read on
  // 2026-11-10 by Crog on a copy of its Commons page (WebFetch cannot reach commons.wikimedia.org):
  // PD-self (c.enwp.org, Commons:Donate to the public domain), PD-author, PD-user-w and
  // PD-user-at-project (c.enwp.org), PD-user (species-id.net/openmedia, a copy that does not say
  // it is Commons'). To be read again on Commons itself.
  publicDomainTemplates: Object.freeze([
    "PD-self",
    "PD-user",
    "PD-author",
    "PD-user-w",
    "PD-user-at-project",
  ]),
  // Clead's decision 3: 2.0, 2.5, 3.0 and 4.0, ports such as cc-by-sa-3.0-nl under their family.
  ccVersions: Object.freeze(["2.0", "2.5", "3.0", "4.0"]),
});
