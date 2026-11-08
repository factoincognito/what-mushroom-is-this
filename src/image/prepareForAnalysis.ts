/**
 * The photo for analysis (docs/SPEC.md 3.3): resized to the largest size that fits both image
 * limits of the model in use, re-encoded as JPEG, then put through the segment check. Only bytes
 * that pass the check are given out to be sent.
 *
 * It runs at analysis time, not at saving: SPEC 3.3 sizes the photo for "the model in use", which
 * the user can change while a find waits, and has a photo that fails the check marked failed,
 * which is an analysis outcome. The find keeps its photo as it was taken (SPEC 3.6).
 */

import { type AppConfig, config } from "../config/config";
import { imageLimitsFor } from "../config/modelSetting";
import type { FindFailure } from "../store/find";
import { bytesToBase64 } from "./base64";
import { checkJpegSegments } from "./jpegSegments";
import { resizedSize } from "./resize";

/** A photo decoded by the encoder, ready to be encoded again; to be released once done with. */
export interface LoadedImage {
  readonly width: number;
  readonly height: number;
  /** The photo at the size given, encoded as JPEG at a quality from 0 to 1: the file's bytes. */
  encodeJpeg(width: number, height: number, quality: number): Promise<Uint8Array>;
  release(): void;
}

/** The phone's image encoder, as the module uses it. */
export interface JpegEncoder {
  load(photoUri: string): Promise<LoadedImage>;
}

export type PreparedPhoto =
  | { ok: true; imageBase64: string; width: number; height: number }
  /** The encoder wrote something the segment check refuses: the find is marked failed. */
  | { ok: false; failure: FindFailure };

export type PhotoPreparationErrorCode =
  /** The decoder gave a size that is not whole pixels of one or more. */
  | "invalid-size"
  /** The model's image limits in the config are not whole numbers the rule can use. */
  | "invalid-limits"
  /** The JPEG quality in the config is not a number above 0 and at most 1. */
  | "invalid-quality";

/** A programming or configuration error, or a decoder that gave no usable size. */
export class PhotoPreparationError extends Error {
  readonly code: PhotoPreparationErrorCode;

  constructor(code: PhotoPreparationErrorCode, message: string) {
    super(message);
    this.name = "PhotoPreparationError";
    this.code = code;
  }
}

/**
 * Prepares a find's photo for the model `modelId`. A photo the encoder cannot read, and an
 * encoder that fails, pass their error on.
 */
export async function preparePhotoForAnalysis(
  photoUri: string,
  modelId: string,
  encoder: JpegEncoder,
  appConfig: AppConfig = config,
): Promise<PreparedPhoto> {
  const quality = appConfig.analysisJpegQuality;
  if (!(typeof quality === "number" && quality > 0 && quality <= 1)) {
    throw new PhotoPreparationError(
      "invalid-quality",
      `the JPEG quality ${quality} is not in (0, 1]`,
    );
  }
  const limits = imageLimitsFor(modelId, appConfig);
  const image = await encoder.load(photoUri);
  try {
    const size = resizedSize(image.width, image.height, limits);
    if (!size.ok) {
      throw new PhotoPreparationError(
        size.reason,
        `the photo of ${image.width} x ${image.height} px cannot be sized for ${modelId}`,
      );
    }
    const bytes = await image.encodeJpeg(size.width, size.height, quality);
    const check = checkJpegSegments(bytes);
    if (!check.ok) {
      const marker = check.marker === null ? "" : ` ${markerName(check.marker)}`;
      return { ok: false, failure: { cause: "segment-check", detail: `${check.reason}${marker}` } };
    }
    return { ok: true, imageBase64: bytesToBase64(bytes), width: size.width, height: size.height };
  } finally {
    image.release();
  }
}

/** A two-byte marker as the segment check's tests write it: 0xFFE1. */
function markerName(marker: number): string {
  return `0x${marker.toString(16).toUpperCase().padStart(4, "0")}`;
}
