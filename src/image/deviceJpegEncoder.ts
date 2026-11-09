import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import type { JpegEncoder } from "./prepareForAnalysis";

/**
 * The phone's JPEG encoder, through expo-image-manipulator (its SDK 57 reference,
 * "ImageManipulator - Expo documentation", https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/,
 * read 2026-11-09): `manipulate` loads the photo, `renderAsync` gives an image with its width and
 * height, `saveAsync` saves it to the cache directory, JPEG by default. The page says nothing of
 * what the saved JPEG keeps of the photo's metadata (Known unknown 2): the segment check decides,
 * and what the encoder writes is seen only on a phone.
 */
export const deviceJpegEncoder: JpegEncoder = {
  async load(photoUri) {
    const context = ImageManipulator.manipulate(photoUri);
    let image: Awaited<ReturnType<typeof context.renderAsync>>;
    try {
      image = await context.renderAsync();
    } catch (error) {
      context.release();
      throw error;
    }
    return {
      width: image.width,
      height: image.height,

      async encodeJpeg(width, height, quality) {
        const resizing = ImageManipulator.manipulate(image).resize({ width, height });
        try {
          const resized = await resizing.renderAsync();
          try {
            const saved = await resized.saveAsync({ format: SaveFormat.JPEG, compress: quality });
            const file = new File(saved.uri);
            try {
              return await file.bytes();
            } finally {
              removeQuietly(file);
            }
          } finally {
            resized.release();
          }
        } finally {
          resizing.release();
        }
      },

      release() {
        image.release();
        context.release();
      },
    };
  },
};

/** The encoded file is a copy in the cache; one that cannot be removed is left to the system. */
function removeQuietly(file: File): void {
  try {
    file.delete();
  } catch {
    // The cache directory is the system's to clear.
  }
}
