import type { KeyValueStore } from "../storage/keyValueStore";
import { parseVersion, type Version } from "./version";

/**
 * The store key under which the version this phone saw last is kept, as the version's text
 * (docs/SPEC.md 3.10, item 6). It is no secret, and is kept in the plain store. Once a build with
 * the key is on a phone, its name and the form of its value are not changed.
 */
export const HISTORY_SEEN_VERSION_KEY = "history.seen-version";

/** What the store holds under the key, as the decision of item 7 tells the cases apart. */
export type SeenVersion =
  /** Nothing is stored. */
  | { readonly kind: "missing" }
  /** Reading the store failed. */
  | { readonly kind: "unreadable" }
  /** Something is stored that is not a version. */
  | { readonly kind: "notVersion" }
  | { readonly kind: "version"; readonly version: Version };

/** Reads the version last seen. A failed read is reported, not thrown. */
export async function readSeenVersion(store: KeyValueStore): Promise<SeenVersion> {
  let value: unknown;
  try {
    value = await store.getItem(HISTORY_SEEN_VERSION_KEY);
  } catch {
    return { kind: "unreadable" };
  }
  if (value === null) {
    return { kind: "missing" };
  }
  const version = parseVersion(value);
  return version === null ? { kind: "notVersion" } : { kind: "version", version };
}

/**
 * Stores a version as the one last seen. A failed write is reported, not thrown, and what is not a
 * version is not written.
 */
export async function writeSeenVersion(
  store: KeyValueStore,
  version: string,
): Promise<{ readonly ok: boolean }> {
  if (parseVersion(version) === null) {
    return { ok: false };
  }
  try {
    await store.setItem(HISTORY_SEEN_VERSION_KEY, version);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
