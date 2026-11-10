import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { deviceJpegEncoder } from "../image/deviceJpegEncoder";
import type { JpegEncoder } from "../image/prepareForAnalysis";
import type { PermissionAsker } from "./permissions";

/**
 * The camera and the gallery, through expo-image-picker (its SDK 57 reference, "ImagePicker -
 * Expo documentation", https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/, read 2026-11-09).
 * A photo is taken unchanged (`quality: 1`). The gallery photo comes with its EXIF, for its own
 * time and position; the camera's is not asked for, as the find's time and position are the
 * phone's at saving. The page: "No permissions request is necessary for launching the image
 * library"; the camera needs its permission.
 */

export type PickResult =
  | { kind: "photo"; uri: string; exif: unknown }
  | { kind: "canceled" }
  /** A file from the phone's files that the app cannot load as an image (SPEC 3.9, Lookups). */
  | { kind: "notImage" };

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
 * A photo from the phone's files (docs/SPEC.md 3.9, Lookups; Known unknown 13; PBI-2.6), through
 * expo-document-picker (its SDK 57 types, `node_modules/expo-document-picker/build/types.d.ts`):
 * images only (`type: "image/*"`), one file, copied to the app's cache (`copyToCacheDirectory`, in
 * its `DocumentPicker` folder on both platforms), so that the image loader reads a local file and
 * the store then copies it into its photos. The file has no time or position of its own, as a
 * gallery photo without metadata: no metadata is given, and the picker's `lastModified` is never
 * used.
 *
 * The file is loaded with the loader the analysis uses (`encoder`); a file that does not load, or
 * loads to a size that is not whole pixels of one or more, is not an image the app can use. It is
 * refused, and the app's copy of it removed.
 */
export async function pickFromFiles(encoder: JpegEncoder = deviceJpegEncoder): Promise<PickResult> {
  const result = readResult(
    await DocumentPicker.getDocumentAsync({
      type: "image/*",
      copyToCacheDirectory: true,
      multiple: false,
    }),
    false,
  );
  if (result.kind !== "photo") {
    return result;
  }
  if (!(await loadsAsImage(result.uri, encoder))) {
    removePickedCopy(result.uri);
    return { kind: "notImage" };
  }
  return { kind: "photo", uri: result.uri, exif: null };
}

/** Whether the loader loads the file as an image of whole pixels; the image is released. */
async function loadsAsImage(uri: string, encoder: JpegEncoder): Promise<boolean> {
  let image: Awaited<ReturnType<JpegEncoder["load"]>>;
  try {
    image = await encoder.load(uri);
  } catch {
    return false;
  }
  const sized = isWholePixels(image.width) && isWholePixels(image.height);
  try {
    image.release();
  } catch {
    // The check is done; a release that fails leaves the image to the loader.
  }
  return sized;
}

function isWholePixels(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/**
 * Removes the app's own copy of a photo the camera, the gallery or the phone's files gave, for an
 * unsaved lookup whose screen is left (docs/SPEC.md 3.9, Lookups; PBI-2.13), or for a file refused
 * as not an image (PBI-2.6). The pickers leave their copies in the app's cache directory; only a
 * file there is removed, named without a parent step, so that nothing else is, the original in the
 * gallery or the files, or the find log's own photos, never. A copy that is gone, an address that
 * is not a file's, or a failed removal is left to the system, which clears the cache, and is not
 * an error.
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

/**
 * The picker's answer, checked: canceled, or one photo with an address. The image picker's and the
 * document picker's answers have this same shape.
 */
function readResult(
  raw: unknown,
  withExif: boolean,
): { kind: "photo"; uri: string; exif: unknown } | { kind: "canceled" } {
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
