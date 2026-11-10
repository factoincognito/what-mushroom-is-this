/**
 * An image's type, read from its first bytes (docs/SPEC.md 3.9: "its type read from its bytes, not
 * from what Wikimedia says it is"). Only the four types the Claude API accepts are known; any
 * other, an SVG or a TIFF among them, has none.
 */

export type ImageType = "jpeg" | "png" | "webp" | "gif";

/** The extension a copy of each type is saved with. */
export const EXTENSION_OF: { readonly [T in ImageType]: string } = Object.freeze({
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, expected: readonly number[], at = 0): boolean {
  return (
    bytes.length >= at + expected.length && expected.every((byte, i) => bytes[at + i] === byte)
  );
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/**
 * The type of the image whose bytes these are, by its signature: JPEG's start of image and the
 * next marker (FF D8 FF), PNG's eight-byte signature, GIF87a or GIF89a, and a RIFF file of form
 * WEBP. Null for anything else.
 */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (startsWith(bytes, PNG)) {
    return "png";
  }
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    return "gif";
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "webp";
  }
  return null;
}
