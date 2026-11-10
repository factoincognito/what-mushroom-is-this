/**
 * A Commons file's licence (docs/SPEC.md 3.9; Clead's decision 3 for PBI-2.9): read from the
 * licence templates on its file page, which the API lists, and mapped by the table in the config
 * module (`wikimediaConfig`) to CC0, public domain without a country limit, CC BY or CC BY-SA, the
 * latter two with their version and any jurisdiction port. A template the table does not map is no
 * licence on the list. The licence a picture is credited under is stored as a code (`cc0`, `pd`,
 * `cc-by-4.0`, `cc-by-sa-3.0-nl`), which `licenceDisplay` names and links to its deed.
 */

import { type WikimediaConfig, wikimediaConfig } from "../config/wikimedia";

export type LicenceFamily = "cc0" | "pd" | "cc-by" | "cc-by-sa";

export interface FileLicence {
  readonly family: LicenceFamily;
  /** The Creative Commons version, such as "3.0"; null for CC0 and public domain. */
  readonly version: string | null;
  /** The jurisdiction port, such as "nl" or "igo"; null for an unported licence. */
  readonly port: string | null;
}

/** The order SPEC 3.9 credits a file under: the first of its licences on the list. */
const FAMILY_ORDER: readonly LicenceFamily[] = ["cc0", "pd", "cc-by", "cc-by-sa"];

const TEMPLATE_PREFIX = "template:";
/** A Creative Commons template: `cc-by-<version>` or `cc-by-sa-<version>`, and a port. */
const CREATIVE_COMMONS = /^cc-by(-sa)?-(\d\.\d)(?:-([a-z]{2}|igo))?$/;
/** A stored code, as `licenceCode` writes it. */
const CODE = /^cc-(by|by-sa)-(\d\.\d)(?:-([a-z]{2}|igo))?$/;

/** A title's name, compared as MediaWiki would after its first letter, here without case. */
function normal(name: string): string {
  return name.replace(/_/g, " ").trim().toLowerCase();
}

/**
 * The licence a template of the file page stands for, by its title ("Template:Cc-by-sa-3.0"), or
 * null when the table does not map it. Titles are compared without regard to case.
 */
export function licenceOfTemplate(
  title: string,
  appConfig: WikimediaConfig = wikimediaConfig,
): FileLicence | null {
  const lower = normal(title);
  if (!lower.startsWith(TEMPLATE_PREFIX)) {
    return null;
  }
  const name = lower.slice(TEMPLATE_PREFIX.length);
  if (appConfig.cc0Templates.some((template) => normal(template) === name)) {
    return { family: "cc0", version: null, port: null };
  }
  if (appConfig.publicDomainTemplates.some((template) => normal(template) === name)) {
    return { family: "pd", version: null, port: null };
  }
  const match = CREATIVE_COMMONS.exec(name);
  const version = match?.[2];
  if (match === null || version === undefined || !appConfig.ccVersions.includes(version)) {
    return null;
  }
  return { family: match[1] === undefined ? "cc-by" : "cc-by-sa", version, port: match[3] ?? null };
}

/** The code a licence is stored under. */
export function licenceCode(licence: FileLicence): string {
  if (licence.version === null) {
    return licence.family;
  }
  const port = licence.port === null ? "" : `-${licence.port}`;
  return `${licence.family}-${licence.version}${port}`;
}

/**
 * Orders two licences for the credit: by SPEC 3.9's order of families; within a family, the newer
 * version first, and an unported licence before a port, the ports by name (Crog's choice).
 */
function compare(a: FileLicence, b: FileLicence): number {
  const family = FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family);
  if (family !== 0) {
    return family;
  }
  const version = Number(b.version ?? 0) - Number(a.version ?? 0);
  if (version !== 0) {
    return version;
  }
  if (a.port === b.port) {
    return 0;
  }
  if (a.port === null || b.port === null) {
    return a.port === null ? -1 : 1;
  }
  return a.port < b.port ? -1 : 1;
}

/**
 * The code of the licence a file is credited under (docs/SPEC.md 3.9): of the licences its
 * templates map to, the first in the order CC0, public domain, CC BY, CC BY-SA. Null when none of
 * its templates maps to a licence on the list, and the file gives no picture.
 */
export function creditedLicence(
  templateTitles: readonly string[],
  appConfig: WikimediaConfig = wikimediaConfig,
): string | null {
  const licences = templateTitles
    .map((title) => licenceOfTemplate(title, appConfig))
    .filter((licence): licence is FileLicence => licence !== null)
    .sort(compare);
  const first = licences[0];
  return first === undefined ? null : licenceCode(first);
}

/** A licence as the credit shows it: public domain, or a name with a link to its deed. */
export type LicenceDisplay =
  | { readonly kind: "public-domain" }
  | { readonly kind: "named"; readonly name: string; readonly deed: string | null };

/**
 * The name of a stored licence, with the address of its deed on creativecommons.org; public
 * domain, which has no deed, as such. A code the app does not write, which only a damaged file
 * holds, is shown as it is, without a link.
 */
export function licenceDisplay(code: string): LicenceDisplay {
  if (code === "pd") {
    return { kind: "public-domain" };
  }
  if (code === "cc0") {
    return {
      kind: "named",
      name: "CC0 1.0",
      deed: "https://creativecommons.org/publicdomain/zero/1.0/",
    };
  }
  const match = CODE.exec(code);
  const [, kind, version, port] = match ?? [];
  if (
    match === null ||
    kind === undefined ||
    version === undefined ||
    !wikimediaConfig.ccVersions.includes(version)
  ) {
    return { kind: "named", name: code, deed: null };
  }
  const name = `CC ${kind.toUpperCase()} ${version}${port === undefined ? "" : ` ${port.toUpperCase()}`}`;
  const path = `${kind}/${version}/${port === undefined ? "" : `${port}/`}`;
  return { kind: "named", name, deed: `https://creativecommons.org/licenses/${path}` };
}
