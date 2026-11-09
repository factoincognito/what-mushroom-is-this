/** Base64 (RFC 4648, the standard alphabet, with padding) of bytes, for the image block. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("bytesToBase64 needs a Uint8Array");
  }
  const chunks: string[] = [];
  let chunk = "";
  const letter = (index: number) => ALPHABET.charAt(index & 0x3f);
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const left = bytes.length - i;
    chunk += letter(a >> 2) + letter((a << 4) | (b >> 4));
    chunk += left > 1 ? letter((b << 2) | (c >> 6)) : "=";
    chunk += left > 2 ? letter(c) : "=";
    // Strings are joined in chunks, so a photo of some megabytes is not built one character
    // at a time into one ever-longer string.
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = "";
    }
  }
  chunks.push(chunk);
  return chunks.join("");
}
