import { File, Paths } from "expo-file-system";
import { ImageManipulator } from "expo-image-manipulator";

import { deviceJpegEncoder } from "./deviceJpegEncoder";

/*
 * expo-image-manipulator runs only on a phone, so it is replaced here by a stand-in that keeps
 * what was asked of it. expo-file-system is jest-expo's in-memory file system.
 */
jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

type Call = string;

const ENCODED = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);

let calls: Call[];
let saved: File;

/** A stand-in ImageRef: its size, and its save to the cache directory. */
function imageRef(name: string, width: number, height: number) {
  return {
    width,
    height,
    saveAsync: jest.fn(async (options: unknown) => {
      calls.push(`${name}.saveAsync ${JSON.stringify(options)}`);
      saved.write(ENCODED);
      return { uri: saved.uri, width, height };
    }),
    release: jest.fn(() => calls.push(`${name}.release`)),
  };
}

interface FakeContext {
  resize: jest.Mock<FakeContext, [unknown]>;
  renderAsync: jest.Mock<Promise<ReturnType<typeof imageRef>>, []>;
  release: jest.Mock<number, []>;
}

/** A stand-in ImageManipulatorContext whose render gives `image`. */
function context(name: string, image: ReturnType<typeof imageRef>): FakeContext {
  const ctx: FakeContext = {
    resize: jest.fn((size: unknown) => {
      calls.push(`${name}.resize ${JSON.stringify(size)}`);
      return ctx;
    }),
    renderAsync: jest.fn(async () => {
      calls.push(`${name}.renderAsync`);
      return image;
    }),
    release: jest.fn(() => calls.push(`${name}.release`)),
  };
  return ctx;
}

let original: ReturnType<typeof imageRef>;
let resized: ReturnType<typeof imageRef>;

beforeEach(() => {
  calls = [];
  saved = new File(Paths.cache, `manipulated-${Math.random().toString(36).slice(2)}.jpg`);
  original = imageRef("original", 4032, 3024);
  resized = imageRef("resized", 2212, 1659);
  const contexts = [context("load", original), context("resizing", resized)];
  jest.mocked(ImageManipulator.manipulate).mockImplementation((source: unknown) => {
    calls.push(`manipulate ${source === original ? "original" : String(source)}`);
    const next = contexts.shift();
    if (next === undefined) {
      throw new Error("manipulate called too often");
    }
    return next as never;
  });
});

describe("deviceJpegEncoder", () => {
  it("decodes the photo and gives its size", async () => {
    const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
    expect([image.width, image.height]).toEqual([4032, 3024]);
    expect(calls).toEqual(["manipulate file:///doc/photos/p1.jpg", "load.renderAsync"]);
  });

  it("resizes the decoded photo, saves it as JPEG at the quality given, and gives the file's bytes", async () => {
    const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
    calls.length = 0;
    await expect(image.encodeJpeg(2212, 1659, 0.9)).resolves.toEqual(ENCODED);
    expect(calls).toEqual([
      "manipulate original",
      'resizing.resize {"width":2212,"height":1659}',
      "resizing.renderAsync",
      'resized.saveAsync {"format":"jpeg","compress":0.9}',
      "resized.release",
      "resizing.release",
    ]);
  });

  it("removes the encoded file from the cache once it has its bytes", async () => {
    const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
    await image.encodeJpeg(2212, 1659, 0.9);
    expect(saved.exists).toBe(false);
  });

  it("removes the encoded copy from the cache, and passes the error on, when its bytes cannot be read", async () => {
    const spy = jest.spyOn(File.prototype, "bytes").mockRejectedValue(new Error("read failed"));
    try {
      const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
      await expect(image.encodeJpeg(2212, 1659, 0.9)).rejects.toThrow("read failed");
      expect(saved.exists).toBe(false);
      expect(calls).toEqual(expect.arrayContaining(["resized.release", "resizing.release"]));
    } finally {
      spy.mockRestore();
    }
  });

  it("gives the bytes even when the encoded file cannot be removed", async () => {
    resized.saveAsync.mockImplementation(async () => {
      saved.write(ENCODED);
      return { uri: saved.uri, width: 2212, height: 1659 };
    });
    const spy = jest.spyOn(File.prototype, "delete").mockImplementation(() => {
      throw new Error("busy");
    });
    try {
      const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
      await expect(image.encodeJpeg(2212, 1659, 0.9)).resolves.toEqual(ENCODED);
    } finally {
      spy.mockRestore();
    }
  });

  it("releases what it made when the save fails, and passes the error on", async () => {
    resized.saveAsync.mockRejectedValue(new Error("disk full"));
    const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
    calls.length = 0;
    await expect(image.encodeJpeg(2212, 1659, 0.9)).rejects.toThrow("disk full");
    expect(calls).toEqual(expect.arrayContaining(["resized.release", "resizing.release"]));
  });

  it("releases the decoded photo and its context when released", async () => {
    const image = await deviceJpegEncoder.load("file:///doc/photos/p1.jpg");
    calls.length = 0;
    image.release();
    expect(calls).toEqual(["original.release", "load.release"]);
  });

  it("releases the context and passes the error on when the photo cannot be decoded", async () => {
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      const failing = context("load", original);
      failing.renderAsync.mockRejectedValue(new Error("unsupported image format"));
      return failing as never;
    });
    await expect(deviceJpegEncoder.load("file:///doc/photos/p1.jpg")).rejects.toThrow(
      "unsupported image format",
    );
    expect(calls).toContain("load.release");
  });
});
