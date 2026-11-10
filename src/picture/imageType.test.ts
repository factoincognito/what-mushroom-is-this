import { EXTENSION_OF, imageTypeOf } from "./imageType";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string, ...rest: number[]) =>
  new Uint8Array([...[...text].map((c) => c.charCodeAt(0)), ...rest]);

describe("imageTypeOf (docs/SPEC.md 3.9: the type read from the bytes, not from Wikimedia)", () => {
  it.each([
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), "jpeg"],
    ["PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "png"],
    ["GIF87a", ascii("GIF87a", 1, 0), "gif"],
    ["GIF89a", ascii("GIF89a", 1, 0), "gif"],
    ["WebP", ascii("RIFF", 0x24, 0, 0, 0, ...[..."WEBPVP8 "].map((c) => c.charCodeAt(0))), "webp"],
  ] as const)("reads %s", (_name, input, type) => {
    expect(imageTypeOf(input)).toBe(type);
  });

  it.each([
    ["an SVG", ascii('<?xml version="1.0"?><svg')],
    ["an SVG without its XML line", ascii("<svg xmlns=")],
    ["a little-endian TIFF", bytes(0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0)],
    ["a big-endian TIFF", bytes(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8)],
    [
      "a RIFF that is not WebP",
      ascii("RIFF", 0x24, 0, 0, 0, ...[..."WAVE"].map((c) => c.charCodeAt(0))),
    ],
    ["an HTML page", ascii("<!DOCTYPE html>")],
    ["a JPEG cut after two bytes", bytes(0xff, 0xd8)],
    ["a PNG signature cut short", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)],
    ["a GIF of another version", ascii("GIF88a")],
    ["no bytes", bytes()],
  ])("gives no type for %s", (_name, input) => {
    expect(imageTypeOf(input)).toBeNull();
  });

  it("gives each type the extension its copy is saved with", () => {
    expect(EXTENSION_OF).toEqual({ jpeg: "jpg", png: "png", webp: "webp", gif: "gif" });
  });
});
