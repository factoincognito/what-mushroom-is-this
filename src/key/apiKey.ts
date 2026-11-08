import { isSendableKey } from "../analysis/request";
import type { KeyValueStore } from "../storage/keyValueStore";

/**
 * The API key (docs/SPEC.md 3.2). It is kept only in the secure store, never in the plain
 * key-value store, a file or a log, and no result here carries it except `readKey`'s.
 */

/** The part of `expo-secure-store` the key module uses. */
export type SecretStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

/** The secure-store key of the API key (letters, digits, ".", "-" and "_" only). */
export const API_KEY_STORE_KEY = "anthropic_api_key";

/**
 * The plain-store key of the install marker. The plain store is deleted with the app, while on
 * iOS the secure store can outlive it, so a missing marker means the first start after an install.
 */
export const INSTALL_MARKER_KEY = "install.marker";

const INSTALLED = "installed";

export type SaveKeyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "empty" | "not-sendable" | "store-failed" };

export type ReadKeyResult =
  | { readonly ok: true; readonly key: string | null }
  | { readonly ok: false };

/**
 * Saves a key, trimmed of spaces and line breaks. An empty key is not saved. Nor is one the
 * analysis module would refuse to send (anything but printable ASCII), since it could never be
 * used; input that is not a string counts as such. A failed write is reported, not thrown.
 */
export async function saveKey(secrets: SecretStore, raw: unknown): Promise<SaveKeyResult> {
  if (typeof raw !== "string") {
    return { ok: false, reason: "not-sendable" };
  }
  const key = raw.trim();
  if (key === "") {
    return { ok: false, reason: "empty" };
  }
  if (!isSendableKey(key)) {
    return { ok: false, reason: "not-sendable" };
  }
  try {
    await secrets.setItemAsync(API_KEY_STORE_KEY, key);
    return { ok: true };
  } catch {
    return { ok: false, reason: "store-failed" };
  }
}

/** The saved key, or null when there is none. A failed read is reported, not thrown. */
export async function readKey(secrets: SecretStore): Promise<ReadKeyResult> {
  try {
    const stored: unknown = await secrets.getItemAsync(API_KEY_STORE_KEY);
    return { ok: true, key: typeof stored === "string" && stored !== "" ? stored : null };
  } catch {
    return { ok: false };
  }
}

/** Removes the saved key. A failed delete is reported, not thrown. */
export async function removeKey(secrets: SecretStore): Promise<{ readonly ok: boolean }> {
  try {
    await secrets.deleteItemAsync(API_KEY_STORE_KEY);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Clears the key store at the first start after an install (docs/SPEC.md 3.2), which it tells
 * from the install marker in the plain store: anything but the exact marker counts as a first
 * start. The marker is set only once the key is cleared, so a failed clear is tried again at the
 * next start. When the marker cannot be read, nothing is cleared: a passing storage fault does
 * not cost the user their key.
 */
export async function clearKeyOnFirstStartAfterInstall(
  secrets: SecretStore,
  store: KeyValueStore,
): Promise<"cleared" | "kept" | "failed"> {
  let marker: unknown;
  try {
    marker = await store.getItem(INSTALL_MARKER_KEY);
  } catch {
    return "failed";
  }
  if (marker === INSTALLED) {
    return "kept";
  }
  if (!(await removeKey(secrets)).ok) {
    return "failed";
  }
  try {
    await store.setItem(INSTALL_MARKER_KEY, INSTALLED);
  } catch {
    return "failed";
  }
  return "cleared";
}
