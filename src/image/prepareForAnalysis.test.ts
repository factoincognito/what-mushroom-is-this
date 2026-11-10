import { type AppConfig, config, STANDARD_TIER } from "../config/config";
import { bytesToBase64 } from "./base64";
import {
  type JpegEncoder,
  type LoadedImage,
  PhotoPreparationError,
  prepareJpegForAnalysis,
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
      loaded: true,
      failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
    });
    expect(encoder.released).toBe(1);
  });

  it("fails the find on the segment check, naming the reason, when the encoder's output is cut short", async () => {
    encoder.bytes = CLEAN.slice(0, CLEAN.length - 2);
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      loaded: true,
      failure: { cause: "segment-check", detail: "truncated" },
    });
  });

  it("fails the find on the segment check when bytes follow the end of the image", async () => {
    encoder.bytes = Uint8Array.from([...CLEAN, ...CLEAN]);
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      loaded: true,
      failure: { cause: "segment-check", detail: "trailing-data" },
    });
  });

  it.each<[string, number, number]>([
    ["no width", 0, 3024],
    ["no height", 4032, 0],
    ["a width that is not whole", 4032.5, 3024],
  ])(
    "fails the find (photo) for a decoded photo with %s, naming the size, and says the photo loaded (PBI-1.25), and releases it",
    async (_, width, height) => {
      encoder.width = width;
      encoder.height = height;
      await expect(
        preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
      ).resolves.toEqual({
        ok: false,
        loaded: true,
        failure: {
          cause: "photo",
          detail: `invalid-size: the photo of ${width} x ${height} px cannot be sized for claude-opus-5-5`,
        },
      });
      expect(encoder.encoded).toEqual([]);
      expect(encoder.released).toBe(1);
    },
  );

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

  it("fails the find (photo) for a photo that cannot be loaded or decoded, with the reason, and says the photo did not load (PBI-1.21, PBI-1.25)", async () => {
    encoder.loadError = new Error("unsupported image format");
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      loaded: false,
      failure: { cause: "photo", detail: "load-failed: unsupported image format" },
    });
    expect(encoder.encoded).toEqual([]);
  });

  it.each([
    ["an Error with no message", new Error("")],
    ["something that is not an Error", "busy"],
  ])("still gives a load failure with %s a reason", async (_name, thrown) => {
    encoder.load = async () => {
      throw thrown;
    };
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      loaded: false,
      failure: { cause: "photo", detail: "load-failed" },
    });
  });

  it.each([
    [
      "full storage, when the encoded copy is written",
      new Error("ENOSPC: no space left on device"),
    ],
    ["a failed read of the encoded bytes", new Error("File could not be read")],
    ["a programming error", new TypeError("Cannot read properties of undefined")],
    ["out of memory", new Error("out of memory")],
  ])(
    "passes on an error that is not the photo's (%s), and releases the decoded photo (PBI-1.21)",
    async (_name, thrown) => {
      encoder.encodeError = thrown;
      await expect(
        preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder),
      ).rejects.toBe(thrown);
      expect(encoder.released).toBe(1);
    },
  );

  it("passes on a configuration error as a PhotoPreparationError", async () => {
    const custom: AppConfig = { ...config, analysisJpegQuality: 2 };
    await expect(
      preparePhotoForAnalysis("file:///doc/photos/p1.jpg", "claude-opus-5-5", encoder, custom),
    ).rejects.toBeInstanceOf(PhotoPreparationError);
  });
});

describe("prepareJpegForAnalysis (the representative picture's resize, docs/SPEC.md 3.9; PBI-2.9)", () => {
  it("gives the checked JPEG's bytes, sized as a photo's, for a copy to be kept", async () => {
    const prepared = await prepareJpegForAnalysis(
      "file:///cache/picture-1.png",
      "claude-opus-5-5",
      encoder,
    );
    expect(encoder.encoded).toEqual([[2212, 1659, config.analysisJpegQuality]]);
    expect(prepared).toEqual({ ok: true, bytes: CLEAN, width: 2212, height: 1659 });
    expect(encoder.released).toBe(1);
  });

  it("fails as a photo fails: what the segment check refuses, and what cannot be loaded", async () => {
    encoder.bytes = WITH_EXIF;
    await expect(
      prepareJpegForAnalysis("file:///cache/picture-1.png", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      loaded: true,
      failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
    });
    encoder.loadError = new Error("");
    await expect(
      prepareJpegForAnalysis("file:///cache/picture-1.png", "claude-opus-5-5", encoder),
    ).resolves.toEqual({
      ok: false,
      loaded: false,
      failure: { cause: "photo", detail: "load-failed" },
    });
  });
});
