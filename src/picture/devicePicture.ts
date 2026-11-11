import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";

import { imageLimitsFor } from "../config/modelSetting";
import { deviceJpegEncoder } from "../image/deviceJpegEncoder";
import { prepareJpegForAnalysis } from "../image/prepareForAnalysis";
import { isCacheFileAddress } from "../storage/cacheFile";
import { fetchPicture, type PictureDeps, type PictureFetch } from "./fetchPicture";
import { pictureUserAgent } from "./wikimedia";

/**
 * The representative picture's parts on the phone (docs/SPEC.md 3.9; PBI-2.9): the platform fetch,
 * which in Expo SDK 57 is `expo/fetch` (phase-2-checks.md section 5: it passes the User-Agent to
 * OkHttp unchanged; its `TransparentCompressionInterceptor`, expo 57.0.32, still decompresses a
 * gzip answer when the app sets `Accept-Encoding` itself; both read from the sources, not run on a
 * phone); the User-Agent from the app's config; the copies in the cache directory; and the phone's
 * encoder, as for a photo.
 */
export function devicePictureDeps(expoConfig: unknown = Constants.expoConfig): PictureDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    userAgent: pictureUserAgent(expoConfig),
    imageLimits: (modelId) => imageLimitsFor(modelId),
    async saveCopy(bytes, extension) {
      const file = new File(Paths.cache, `picture-${copyName()}.${extension}`);
      file.create({ overwrite: true });
      file.write(bytes);
      return file.uri;
    },
    removeCopy: removePictureCopy,
    async prepare(uri, modelId) {
      const prepared = await prepareJpegForAnalysis(uri, modelId, deviceJpegEncoder);
      if (prepared.ok) {
        return { ok: true, bytes: prepared.bytes };
      }
      return {
        ok: false,
        reason: prepared.failure.cause === "segment-check" ? "segment-check" : "load",
      };
    },
  };
}

/** Fetches a species' representative picture on the phone, for the model given. */
export function fetchDevicePicture(latinName: string, modelId: string): Promise<PictureFetch> {
  return fetchPicture(latinName, modelId, devicePictureDeps());
}

/**
 * Removes a copy of a picture the fetch made, once the store has its own or the screen that showed
 * it is left. The fetch writes its copies into the cache directory (`saveCopy`); only a file there
 * is removed, named without a parent step, percent-encoded or not (`isCacheFileAddress`), so that
 * nothing else is, the find log's own photos never. One that is not there, an address that is not
 * a file's, or one that cannot be removed, is left to the system's clearing of the cache, and is
 * not an error.
 */
export function removePictureCopy(uri: string): void {
  try {
    if (!isCacheFileAddress(uri)) {
      return;
    }
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // The cache directory is the system's to clear.
  }
}

/** A name for a copy: the time in base 36, a hyphen and eight random base-36 digits. */
function copyName(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${Date.now().toString(36)}-${random}`;
}
