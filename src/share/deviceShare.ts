import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { removePickedCopy } from "../newFind/devicePicker";
import { isCacheFileAddress } from "../storage/cacheFile";
import type { ShareFiles, ShareSource } from "./shareSession";

/**
 * The share on the phone, through expo-sharing (docs/SPEC.md 3.9, Shared photos; Known unknown
 * 16; PBI-2.21). The library's version is pinned at 57.0.26, whose source was read for this, not
 * run on a phone (`node_modules/expo-sharing/src/`, and for Android
 * `android/src/main/java/expo/modules/sharing/`):
 *
 * - `getSharedPayloads` reads the share's intent and makes no request;
 * - `getResolvedSharedPayloadsAsync` copies each shared file through the content resolver into a
 *   folder of its own under `expo-sharing/` in the app's cache, and gives the copy's address as
 *   Java writes a file's (`file:/…`, one slash). For a share of the type `text/plain` that is a
 *   web address it makes a request to that address. The session asks for it only for a share
 *   whose every item is a file on the phone (`mayResolve`);
 * - `clearSharedPayloads` drops the share and removes the whole `expo-sharing/` folder;
 * - the library's own hook, which resolves every share it sees, is not used anywhere in the app.
 *
 * This is the one module that imports the library (`shareConfig.test.ts` checks it).
 */
export const deviceShareSource: ShareSource = {
  read: () => Sharing.getSharedPayloads(),
  resolve: () => Sharing.getResolvedSharedPayloadsAsync(),
  clear: () => Sharing.clearSharedPayloads(),
};

/** The folder under the cache where the library keeps its copies of shared files. */
const LIBRARY_FOLDER = "expo-sharing";
/** The folder under the cache where the app keeps its own copies of the photos of a choice. */
const APP_FOLDER = "SharedPhotos";

const EXTENSION = /^\.[A-Za-z0-9]{1,8}$/;

/** The cache directory's address, ending in a slash. */
function cacheUri(): string {
  return Paths.cache.uri.endsWith("/") ? Paths.cache.uri : `${Paths.cache.uri}/`;
}

/** A file address with three slashes after the scheme, as the app's file code writes it. */
function threeSlashes(address: string): string {
  return address.replace(/^file:\/(?=[^/])/, "file:///");
}

/**
 * The address of a copy the library made of a shared file, when it names a file that is there,
 * in the library's folder in the app's cache, with no parent step on the way
 * (`isCacheFileAddress`); else null. So nothing but the library's own copies is ever taken as a
 * shared photo, moved or removed: not a web address, not the sharing app's file, not the find
 * log's photos.
 */
export function libraryCopy(contentUri: string): string | null {
  if (typeof contentUri !== "string") {
    return null;
  }
  const address = threeSlashes(contentUri);
  if (!isCacheFileAddress(address) || !address.startsWith(`${cacheUri()}${LIBRARY_FOLDER}/`)) {
    return null;
  }
  try {
    return new File(address).exists ? address : null;
  } catch {
    return null;
  }
}

let kept = 0;

/**
 * Moves the library's copy of a shared photo into the app's own folder in the cache, under a
 * plain name of the app's making with the copy's extension when that is letters and digits, and
 * gives the new address; null when the address is not a library copy or the move fails, and the
 * copy is then left where it is. The app's copy outlives the library's clearing of the share, and
 * is removed like any picked copy (`removePickedCopy`) when its photo is not saved to a find.
 */
export function keepSharedCopy(uri: string): string | null {
  const address = libraryCopy(uri);
  if (address === null) {
    return null;
  }
  try {
    const source = new File(address);
    const { extension } = source;
    kept += 1;
    const name = `shared-${Date.now().toString(36)}-${kept}${EXTENSION.test(extension) ? extension : ""}`;
    const folder = new Directory(Paths.cache, APP_FOLDER);
    folder.create({ intermediates: true, idempotent: true });
    const destination = new File(folder, name);
    source.moveSync(destination);
    return destination.uri;
  } catch {
    return null;
  }
}

/** Removes a copy in the cache, the library's or the app's own, at either form of its address. */
function removeCopy(uri: string): void {
  removePickedCopy(typeof uri === "string" ? threeSlashes(uri) : uri);
}

export const deviceShareFiles: ShareFiles = {
  libraryCopy,
  keep: keepSharedCopy,
  remove: removeCopy,
};
