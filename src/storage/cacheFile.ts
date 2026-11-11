import { Paths } from "expo-file-system";

/**
 * Whether an address is one under the app's cache directory, with no parent step on the way: the
 * rule by which the app removes a copy it made there (`removePickedCopy`, `removePictureCopy`;
 * PBI-2.16), so that nothing outside the cache is removed, the find log's own photos never. A
 * folder's address under the cache is taken too; that only a file is removed is the removals' own
 * check (`File.exists`).
 *
 * The address is read here as its later readers read it. The first is the URL class behind
 * `new File(address)` (`Paths.join`): `whatwg-url-minimum`'s in the tests, which expo installs as
 * the global `URL` on a phone too (expo 57.0.32, `src/winter`; read, and run by the tests, not on
 * a phone). The second is the phone's file system code: on Android a `java.io.File` built from a
 * `java.net.URI` (`JavaFile`; expo-file-system 57.0.7, read, not run), which is taken to decode
 * the whole path (Java's own behaviour, not checked for this change; iOS not read).
 *
 * - The cache directory's own part is compared as given, by exact case.
 * - A parent step is "..", also with one or both dots percent-encoded ("%2e"), between slashes or
 *   backslashes, plain or percent-encoded ("%2f", "%5c"), or at the address's end: the URL class
 *   takes "%2e%2e" for ".." and a backslash for a slash, and the file system code is taken to
 *   decode "%2f" too. One decoding is undone, as there: "%252e" stays a name.
 * - The URL class drops a tab, a line feed and a carriage return before it reads the path, so
 *   ".<tab>." is ".." and "%<tab>2e" is "%2e": the steps are looked for with those three dropped,
 *   first. Their percent-encoded forms ("%09", "%0a", "%0d") it keeps, as part of a name.
 * - The URL class ends the path at the first "?" or "#", and trims the characters U+0000 to U+0020
 *   from the address's end, so "..#x" and ".. " end in a parent step for it. An address that holds
 *   a "?" or a "#", or ends in one of those characters, is refused whole. The address `File` makes
 *   from a folder and a name holds none of them: in a name they are written "%3F", "%23", "%20".
 */
export function isCacheFileAddress(uri: string): boolean {
  const cache = Paths.cache.uri.endsWith("/") ? Paths.cache.uri : `${Paths.cache.uri}/`;
  return uri.startsWith(cache) && !endsItsPathEarly(uri) && !hasParentStep(uri);
}

/** Whether a URL's reader would end the address's path before the address's own last character. */
function endsItsPathEarly(uri: string): boolean {
  return uri.includes("?") || uri.includes("#") || uri.charCodeAt(uri.length - 1) <= 0x20;
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
