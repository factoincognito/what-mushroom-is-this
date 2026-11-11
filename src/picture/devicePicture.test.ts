import { Directory, File, Paths } from "expo-file-system";

import { prepareJpegForAnalysis } from "../image/prepareForAnalysis";
import searchNone from "./__tests__/fixtures/search-none.json";
import { devicePictureDeps, fetchDevicePicture, removePictureCopy } from "./devicePicture";

/*
 * expo-file-system is jest-expo's in-memory file system; the encoder runs only on a phone, so the
 * image module's preparation is replaced, and the app's config is that of app.json.
 */
jest.mock("../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../image/prepareForAnalysis"),
  prepareJpegForAnalysis: jest.fn(),
}));
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  const appJson = jest.requireActual("../../app.json");
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: appJson.expo } };
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 0xff, 0xd9]);
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  jest.mocked(prepareJpegForAnalysis).mockReset();
});

describe("devicePictureDeps (PBI-2.9)", () => {
  it("names the app as app.json does, in the User-Agent", () => {
    expect(devicePictureDeps().userAgent).toBe(
      "Wushroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this) expo-fetch",
    );
    expect(devicePictureDeps({ name: "Wushroom" }).userAgent).toBeNull();
  });

  it("saves a copy in the cache, with the extension given, and removes it again", async () => {
    const deps = devicePictureDeps();
    const uri = await deps.saveCopy(JPEG, "png");
    expect(uri.startsWith(Paths.cache.uri)).toBe(true);
    expect(uri.endsWith(".png")).toBe(true);
    const file = new File(uri);
    expect(file.exists).toBe(true);
    await expect(file.bytes()).resolves.toEqual(JPEG);
    const other = await deps.saveCopy(JPEG, "jpg");
    expect(other).not.toBe(uri);
    deps.removeCopy(uri);
    expect(new File(uri).exists).toBe(false);
    expect(new File(other).exists).toBe(true);
    removePictureCopy(other);
    expect(new File(other).exists).toBe(false);
  });

  it("removes a copy that is not there, or an address that is not a file, without an error", () => {
    expect(() => removePictureCopy(`${Paths.cache.uri}picture-not-there.jpg`)).not.toThrow();
    expect(() => removePictureCopy("not an address")).not.toThrow();
  });

  it("prepares the copy as a photo is prepared, and gives a failure of the picture as no picture", async () => {
    const deps = devicePictureDeps();
    jest
      .mocked(prepareJpegForAnalysis)
      .mockResolvedValueOnce({ ok: true, bytes: JPEG, width: 1, height: 1 })
      .mockResolvedValueOnce({
        ok: false,
        loaded: false,
        failure: { cause: "photo", detail: "load-failed" },
      })
      .mockResolvedValueOnce({
        ok: false,
        loaded: true,
        failure: { cause: "photo", detail: "invalid-size: x" },
      })
      .mockResolvedValueOnce({
        ok: false,
        loaded: true,
        failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
      });
    await expect(deps.prepare("file:///cache/a.png", "claude-opus-5-5")).resolves.toEqual({
      ok: true,
      bytes: JPEG,
    });
    await expect(deps.prepare("file:///cache/a.png", "m")).resolves.toEqual({
      ok: false,
      reason: "load",
    });
    await expect(deps.prepare("file:///cache/a.png", "m")).resolves.toEqual({
      ok: false,
      reason: "load",
    });
    await expect(deps.prepare("file:///cache/a.png", "m")).resolves.toEqual({
      ok: false,
      reason: "segment-check",
    });
    expect(jest.mocked(prepareJpegForAnalysis).mock.calls[0]?.slice(0, 2)).toEqual([
      "file:///cache/a.png",
      "claude-opus-5-5",
    ]);
  });

  it("fetches through the platform fetch, as the app's queue does", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(searchNone),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(fetchDevicePicture("Cantharellus cibarius", "claude-opus-5-5")).resolves.toEqual({
      kind: "none",
      reason: "no-item",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        "User-Agent":
          "Wushroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this) expo-fetch",
      },
    });
  });
});

/*
 * The fetch writes its copies into the cache directory (`saveCopy`); only a file there is removed,
 * named without a parent step (PBI-2.16; the notes on #71). `new File(address)` first reads the
 * address as a URL (`Paths.join`, the library's own JavaScript). The URL class here is
 * `whatwg-url-minimum`'s, which expo installs as the global `URL` on a phone too (expo 57.0.32,
 * `src/winter`, loaded by jest-expo's setup; read, and the class compared in a run; not run on a
 * phone). Its path takes "..", "%2e%2e", ".%2e" and "%2e." for a parent step and a backslash for a
 * slash, so an address that starts as the cache's can name a file outside it, which these tests
 * show. An
 * encoded slash ("%2f") is not decoded there; Android's file system code is taken to decode it
 * (expo-file-system 57.0.7's `JavaFile` builds a `java.io.File` from a `java.net.URI`; read, not
 * run), so for those the tests check that the file system is not asked at all.
 */
describe("removePictureCopy: only a file in the cache, named without a parent step (PBI-2.16)", () => {
  function fileIn(directory: Directory, name: string): File {
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, name);
    file.write(JPEG);
    return file;
  }

  /** A photo of the find log's, outside the cache, and its path from the folder above the cache. */
  function findLogPhoto(): { photo: File; fromAboveTheCache: string } {
    const photo = fileIn(new Directory(Paths.document, "photos-picture-test"), "p1.jpg");
    return { photo, fromAboveTheCache: "document/photos-picture-test/p1.jpg" };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("removes nothing outside the cache, such as the find log's own photos", () => {
    const { photo } = findLogPhoto();
    removePictureCopy(photo.uri);
    expect(photo.exists).toBe(true);
    devicePictureDeps().removeCopy(photo.uri);
    expect(photo.exists).toBe(true);
  });

  it.each(["..", "%2e%2e", "%2E%2E", ".%2e", ".%2E", "%2e.", "%2E."])(
    "leaves the find log's photo, named through the cache by the parent step %s",
    (step) => {
      const { photo, fromAboveTheCache } = findLogPhoto();
      const viaCache = `${Paths.cache.uri}${step}/${fromAboveTheCache}`;
      expect(viaCache.startsWith(Paths.cache.uri)).toBe(true);
      expect(new File(viaCache).uri).toBe(photo.uri);
      removePictureCopy(viaCache);
      expect(photo.exists).toBe(true);
    },
  );

  it("leaves the find log's photo, named through the cache with backslashes around the step", () => {
    const { photo, fromAboveTheCache } = findLogPhoto();
    const viaCache = `${Paths.cache.uri}pictures\\..\\..\\${fromAboveTheCache}`;
    expect(new File(viaCache).uri).toBe(photo.uri);
    removePictureCopy(viaCache);
    expect(photo.exists).toBe(true);
  });

  it.each(["..", "%2e%2e"])(
    "leaves the fetch's own copy when its address holds the parent step %s",
    async (step) => {
      const uri = await devicePictureDeps().saveCopy(JPEG, "jpg");
      const viaParent = uri.replace(Paths.cache.uri, `${Paths.cache.uri}pictures/${step}/`);
      expect(viaParent).not.toBe(uri);
      expect(new File(viaParent).uri).toBe(uri);
      removePictureCopy(viaParent);
      expect(new File(uri).exists).toBe(true);
      removePictureCopy(uri);
      expect(new File(uri).exists).toBe(false);
    },
  );

  it.each([
    ["encoded slashes", "pictures%2f..%2f..%2fdocument%2fphotos-picture-test%2fp1.jpg"],
    ["encoded slashes in capitals", "pictures%2F..%2F..%2Fdocument/photos-picture-test/p1.jpg"],
    [
      "encoded slashes and dots",
      "pictures%2f%2e%2e%2f%2e%2e%2fdocument/photos-picture-test/p1.jpg",
    ],
    ["an encoded slash after it only", "pictures/..%2f..%2fdocument/photos-picture-test/p1.jpg"],
    ["encoded backslashes", "pictures%5c..%5c..%5cdocument/photos-picture-test/p1.jpg"],
  ])(
    "does not ask the file system about an address whose parent step has %s around it",
    (_name, path) => {
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePictureCopy(`${Paths.cache.uri}picture-gone.jpg`);
      expect(asked).toHaveBeenCalledTimes(1);
      asked.mockClear();
      removePictureCopy(`${Paths.cache.uri}${path}`);
      expect(asked).not.toHaveBeenCalled();
    },
  );

  it.each([
    "picture-a..b.jpg",
    "..picture-a.jpg",
    "picture a.jpg",
    "picture-%2e%2e.jpg",
    "picture-100%.jpg",
  ])("still removes a copy in the cache whose name, %s, only looks like one", (name) => {
    const copy = fileIn(Paths.cache, name);
    removePictureCopy(copy.uri);
    expect(copy.exists).toBe(false);
  });

  it.each([
    ["a percent sign that encodes nothing", "%zz/picture-gone.jpg"],
    ["a percent sign at its end", "picture-gone.jpg%"],
    ["half an encoded dot", "%2/picture-gone.jpg"],
    ["an encoded parent step that leads nowhere", "%2e%2e/%2e%2e/%2e%2e/%2e%2e/gone.jpg"],
  ])("does nothing, and does not throw, for an address with %s", (_name, path) => {
    expect(() => removePictureCopy(`${Paths.cache.uri}${path}`)).not.toThrow();
  });

  it("takes a removal that fails as no error, and removes the copy at a later try", async () => {
    const uri = await devicePictureDeps().saveCopy(JPEG, "jpg");
    const failing = jest.spyOn(File.prototype, "delete").mockImplementation(() => {
      throw new Error("the file is in use");
    });
    expect(() => removePictureCopy(uri)).not.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(new File(uri).exists).toBe(true);
    failing.mockRestore();
    removePictureCopy(uri);
    expect(new File(uri).exists).toBe(false);
  });

  /*
   * A URL's reader drops a tab, a line feed and a carriage return from an address before it reads
   * the path (the first tests here show it by the address `new File` gets), so a parent step with
   * one of them in it is a parent step. Their percent-encoded forms it keeps.
   */
  describe.each([
    ["a tab", "\t"],
    ["a line feed", "\n"],
    ["a carriage return", "\r"],
  ])("with %s, which a URL's reader drops", (_name, dropped) => {
    it.each([
      ["between the dots", `.${dropped}.`],
      ["before the dots", `${dropped}..`],
      ["after the dots", `..${dropped}`],
      ["inside an encoded dot", `%${dropped}2e%2e`],
    ])(
      "leaves the find log's photo, named through the cache by a parent step with it %s",
      (_place, step) => {
        const { photo, fromAboveTheCache } = findLogPhoto();
        const viaCache = `${Paths.cache.uri}${step}/${fromAboveTheCache}`;
        expect(viaCache.startsWith(Paths.cache.uri)).toBe(true);
        expect(new File(viaCache).uri).toBe(photo.uri);
        removePictureCopy(viaCache);
        expect(photo.exists).toBe(true);
      },
    );

    it("does not ask the file system about an address with it inside the encoded slashes around a parent step", () => {
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePictureCopy(`${Paths.cache.uri}picture-gone.jpg`);
      expect(asked).toHaveBeenCalledTimes(1);
      asked.mockClear();
      removePictureCopy(
        `${Paths.cache.uri}pictures%${dropped}2f..%2${dropped}f..%2fdocument/photos-picture-test/p1.jpg`,
      );
      expect(asked).not.toHaveBeenCalled();
    });

    it("still removes a copy in the cache whose name holds it", () => {
      const copy = fileIn(Paths.cache, `picture-a${dropped}b.jpg`);
      expect(copy.uri).toMatch(/picture-a%0[9AD]b\.jpg$/);
      removePictureCopy(copy.uri);
      expect(copy.exists).toBe(false);
    });
  });

  it.each(["%09", "%0a", "%0A", "%0d", "%0D"])(
    "takes .%s. for a folder's name, as the address's reader does, and reaches nothing outside the cache",
    (encoded) => {
      const { photo, fromAboveTheCache } = findLogPhoto();
      const address = `${Paths.cache.uri}.${encoded}./${fromAboveTheCache}`;
      expect(new File(address).uri).toBe(address);
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePictureCopy(address);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(photo.exists).toBe(true);
    },
  );

  /*
   * A URL's reader ends the path at "?" or "#" and trims the characters U+0000 to U+0020 from the
   * address's end, so a parent step before one of those is the path's last step: the address then
   * names the folder above the cache, which each test here shows first. Nothing was removed for
   * these before the guard refused them, since that folder is no file; the tests check that the
   * file system is not asked at all.
   */
  it.each([
    ["a fragment", "..#x"],
    ["a query", "..?x"],
    ["an empty fragment, its dots encoded", "%2e%2e#"],
    ["a space", ".. "],
    ["the character U+0000", "..\u0000"],
    ["a fragment, with a tab between its dots", ".\t.#x"],
  ])(
    "does not ask the file system about an address whose parent step, at the path's end, is followed by %s",
    (_name, end) => {
      const address = `${Paths.cache.uri}${end}`;
      expect(address.startsWith(Paths.cache.uri)).toBe(true);
      expect(new File(address).uri.startsWith(Paths.cache.uri)).toBe(false);
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePictureCopy(`${Paths.cache.uri}picture-gone.jpg`);
      expect(asked).toHaveBeenCalledTimes(1);
      asked.mockClear();
      removePictureCopy(address);
      expect(asked).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a hash sign", "picture-a#b.jpg", "%23"],
    ["a question mark", "picture-a?b.jpg", "%3F"],
    ["a space", "picture-a b9.jpg", "%20"],
    ["a space at its end", "picture-ab.jpg ", "%20"],
  ])(
    "still removes a copy in the cache whose name holds %s, written as an escape in its address",
    (_name, name, written) => {
      const copy = fileIn(Paths.cache, name);
      expect(copy.uri).toContain(written);
      expect(copy.uri).not.toMatch(/[?# ]/);
      removePictureCopy(copy.uri);
      expect(copy.exists).toBe(false);
    },
  );
});
