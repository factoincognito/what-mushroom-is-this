import { type AppConfig, config, STANDARD_TIER } from "../config/config";
import { bytesToBase64 } from "./base64";
import {
  type JpegEncoder,
  type LoadedImage,
  PhotoPreparationError,
  preparePhotoForAnalysis,
} from "./prepareForAnalysis";

/** One marker segment: 0xFF, the marker byte, a length that counts itself, the payload. */
function segment(marker: number, payload: number[] = []): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const JFIF = segment(
  0xe0,
  [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01],
);
const DQT = segment(0xdb, [0x00, 0x01, 0x02, 0x03]);
const SOF0 = segment(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
const SCAN = [...segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), 0x12, 0x34, 0xff, 0x00, 0x56];
const EXIF = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);

const CLEAN = Uint8Array.from([SOI, JFIF, DQT, SOF0, SCAN, EOI].flat());
const WITH_EXIF = Uint8Array.from([SOI, JFIF, EXIF, DQT, SOF0, SCAN, EOI].flat());

/** Stands in for expo-image-manipulator: the decoded size, and the bytes it encodes. */
class FakeEncoder implements JpegEncoder {
  loaded: string[] = [];
  encoded: [number, number, number][] = [];
  released = 0;
  width = 4032;
  height = 3024;
  bytes: Uint8Array = CLEAN;
  loadError: Error | null = null;
  encodeError: Error | null = null;

  async load(photoUri: string): Promise<LoadedImage> {
    this.loaded.push(photoUri);
    if (this.loadError !== null) {
      throw this.loadError;
    }
    return {
      width: this.width,
      height: this.height,
      encodeJpeg: async (width, height, quality) => {
        this.encoded.push([width, height, quality]);
        if (this.encodeError !== null) {
          throw this.encodeError;
        }
        return this.bytes;
      },
      release: () => {
        this.released += 1;
      },
    };
  }
}

let encoder: FakeEncoder;

beforeEach(() => {
  encoder = new FakeEncoder();
});

describe("preparePhotoForAnalysis", () => {
  it("resizes a 4:3 photo to the high-resolution tier of a listed model and re-encodes it as JPEG", async () => {
    const prepared = await preparePhotoForAnalysis(
      "file:///doc/photos/p1.jpg",
      "claude-opus-5-5",
      encoder,
    );
    expect(encoder.loaded).toEqual(["file:///doc/photos/p1.jpg"]);
    expect(encoder.encoded).toEqual([[2212, 1659, config.analysisJpegQuality]]);
    expect(prepared).toEqual({
      ok: true,
      imageBase64: bytesToBase64(CLEAN),
      width: 2212,
      height: 1659,
    });
    expect(encoder.released).toBe(1);
  });

  it("resizes to the standard tier for a model ID that is not listed", async () => {
    await preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-some-future-model", encoder);
    expect(encoder.encoded).toEqual([[1270, 952, config.analysisJpegQuality]]);
  });

  it("takes the tier from the model's entry in the config", async () => {
    const custom: AppConfig = {
      ...config,
      models: [{ id: "claude-small", imageLimits: STANDARD_TIER }],
      analysisJpegQuality: 0.5,
    };
    await preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-small", encoder, custom);
    expect(encoder.encoded).toEqual([[1270, 952, 0.5]]);
  });

  it("re-encodes a photo that already fits at its own size, so no original bytes are sent", async () => {
    encoder.width = 800;
    encoder.height = 600;
    const prepared = await preparePhotoForAnalysis(
      "file:///doc/photos/p1",
      "claude-opus-5-5",
      encoder,
    );
    expect(encoder.encoded).toEqual([[800, 600, config.analysisJpegQuality]]);
    expect(prepared).toMatchObject({ ok: true, width: 800, height: 600 });
  });

  it("fails the find on the segment check, naming the refused marker, when the encoder writes EXIF", async () => {
    encoder.bytes = WITH_EXIF;
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
    });
    expect(encoder.released).toBe(1);
  });

  it("fails the find on the segment check, naming the reason, when the encoder's output is cut short", async () => {
    encoder.bytes = CLEAN.slice(0, CLEAN.length - 2);
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({ ok: false, failure: { cause: "segment-check", detail: "truncated" } });
  });

  it("fails the find on the segment check when bytes follow the end of the image", async () => {
    encoder.bytes = Uint8Array.from([...CLEAN, ...CLEAN]);
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      failure: { cause: "segment-check", detail: "trailing-data" },
    });
  });

  it.each<[string, number, number]>([
    ["no width", 0, 3024],
    ["no height", 4032, 0],
    ["a width that is not whole", 4032.5, 3024],
  ])("refuses a decoded photo with %s, and releases it", async (_, width, height) => {
    encoder.width = width;
    encoder.height = height;
    const preparing = preparePhotoForAnalysis(
      "file:///doc/photos/p1.jpg",
      "claude-opus-5-5",
      encoder,
    );
    await expect(preparing).rejects.toBeInstanceOf(PhotoPreparationError);
    await expect(preparing).rejects.toMatchObject({ code: "invalid-size" });
    expect(encoder.encoded).toEqual([]);
    expect(encoder.released).toBe(1);
  });

  it("refuses limits in the config that are not whole numbers", async () => {
    const custom: AppConfig = {
      ...config,
      models: [{ id: "claude-broken", imageLimits: { maxEdge: 0, maxTokens: 1, patchSize: 28 } }],
    };
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-broken", encoder, custom),
    ).rejects.toMatchObject({ code: "invalid-limits" });
  });

  it.each([0, 1.5, Number.NaN])("refuses a JPEG quality of %s in the config", async (quality) => {
    const custom: AppConfig = { ...config, analysisJpegQuality: quality };
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder, custom),
    ).rejects.toMatchObject({ code: "invalid-quality" });
    expect(encoder.loaded).toEqual([]);
  });

  it("passes on a photo that cannot be decoded", async () => {
    encoder.loadError = new Error("unsupported image format");
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).rejects.toThrow("unsupported image format");
  });

  it("passes on an encoder that fails, and releases the decoded photo", async () => {
    encoder.encodeError = new Error("out of memory");
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).rejects.toThrow("out of memory");
    expect(encoder.released).toBe(1);
  });
});
