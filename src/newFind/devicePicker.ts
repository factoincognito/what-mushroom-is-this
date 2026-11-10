import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { PermissionAsker } from "./permissions";

/**
 * The camera and the gallery, through expo-image-picker (its SDK 57 reference, "ImagePicker -
 * Expo documentation", https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/, read 2026-11-09).
 * A photo is taken unchanged (`quality: 1`). The gallery photo comes with its EXIF, for its own
 * time and position; the camera's is not asked for, as the find's time and position are the
 * phone's at saving. The page: "No permissions request is necessary for launching the image
 * library"; the camera needs its permission.
 */

export type PickResult = { kind: "photo"; uri: string; exif: unknown } | { kind: "canceled" };

export async function takePhoto(): Promise<PickResult> {
  return readResult(
    await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false }),
    false,
  );
}

export async function pickFromGallery(): Promise<PickResult> {
  return readResult(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      exif: true,
      allowsMultipleSelection: false,
    }),
    true,
  );
}

/**
 * Removes the app's own copy of a photo the camera or the gallery gave, for an unsaved lookup
 * whose screen is left (docs/SPEC.md 3.9, Lookups; PBI-2.13). The picker leaves its copies in the
 * app's cache directory; only a file there is removed, named without a parent step, so that
 * nothing else is, the original in the gallery or the find log's own photos never. A copy that is
 * gone, an address that is not a file's, or a failed removal is left to the system, which clears
 * the cache, and is not an error.
 */
export function removePickedCopy(uri: string): void {
  try {
    const cache = Paths.cache.uri.endsWith("/") ? Paths.cache.uri : `${Paths.cache.uri}/`;
    if (!uri.startsWith(cache) || uri.split("/").includes("..")) {
      return;
    }
    const copy = new File(uri);
    if (copy.exists) {
      copy.delete();
    }
  } catch {
    // The cache directory is the system's to clear.
  }
}

export const cameraPermission: PermissionAsker = {
  get: () => ImagePicker.getCameraPermissionsAsync(),
  request: () => ImagePicker.requestCameraPermissionsAsync(),
};

/** The picker's answer, checked: canceled, or one photo with an address. */
function readResult(raw: unknown, withExif: boolean): PickResult {
  if (typeof raw === "object" && raw !== null && "canceled" in raw) {
    if (raw.canceled === true) {
      return { kind: "canceled" };
    }
    const assets = raw.canceled === false && "assets" in raw ? raw.assets : null;
    const asset: unknown = Array.isArray(assets) ? assets[0] : undefined;
    if (typeof asset === "object" && asset !== null && "uri" in asset) {
      const { uri } = asset;
      if (typeof uri === "string" && uri.length > 0) {
        const exif = withExif && "exif" in asset ? (asset.exif ?? null) : null;
        return { kind: "photo", uri, exif };
      }
    }
  }
  throw new Error("the picker gave no photo");
}
