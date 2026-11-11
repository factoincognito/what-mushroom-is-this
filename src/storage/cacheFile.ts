import { Paths } from "expo-file-system";

/**
 * Whether an address names a file under the app's cache directory, with no parent step on the way:
 * the rule by which the app removes a copy it made there (`removePickedCopy`, `removePictureCopy`;
 * PBI-2.16), so that nothing outside the cache is removed, the find log's own photos never.
 *
 * A parent step is "..", also with one or both dots percent-encoded ("%2e"), between slashes or
 * backslashes, plain or percent-encoded ("%2f", "%5c"), or at the address's end. What reads the
 * address later decodes it: `new File(address)` reads it as a URL, whose path takes "%2e%2e" for
 * ".." and a backslash for a slash (`Paths.join`; the tests show it with Node's URL), and Android's
 * file system code builds a `java.io.File` from a `java.net.URI` (`JavaFile`; expo-file-system
 * 57.0.7, read, not run on a phone), which is taken to decode the whole path, "%2f" too (Java's
 * own behaviour, not checked for this change; iOS not read). One decoding is undone here, as
 * there: "%252e" stays a name.
 *
 * A URL's reader also drops a tab, a line feed and a carriage return from an address before it
 * reads the path (the tests show it with Node's URL), so ".<tab>." is "..", and "%<tab>2e" is
 * "%2e": the steps are looked for with those three dropped, first. Their percent-encoded forms
 * ("%09", "%0a", "%0d") that reader keeps, so they stay part of a name. The cache directory's own
 * part is compared as given: an address with one of the three there is refused.
 */
export function isCacheFileAddress(uri: string): boolean {
  const cache = Paths.cache.uri.endsWith("/") ? Paths.cache.uri : `${Paths.cache.uri}/`;
  return uri.startsWith(cache) && !hasParentStep(uri);
}

function hasParentStep(uri: string): boolean {
  return uri
    .replace(/[\t\n\r]/g, "")
    .replace(/%2e/gi, ".")
    .replace(/%2f/gi, "/")
    .replace(/%5c/gi, "\\")
    .split(/[/\\]/)
    .includes("..");
}
