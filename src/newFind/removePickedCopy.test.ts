import { Directory, File, Paths } from "expo-file-system";

import { removePickedCopy } from "./devicePicker";

jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

/*
 * The cache-path guard of `removePickedCopy` and a parent step that is not written as "..": one
 * percent-encoded, or one whose separators are (PBI-2.16; note 2 on #61). Its other tests are in
 * devicePicker.test.ts.
 *
 * jest-expo backs expo-file-system with an in-memory file system. `new File(address)` first reads
 * the address as a URL (`Paths.join`, the library's own JavaScript). The URL class here is
 * `whatwg-url-minimum`'s, which expo installs as the global `URL` on a phone too (expo 57.0.32,
 * `src/winter`, loaded by jest-expo's setup; read, and the class compared in a run; not run on a
 * phone). Its path takes "%2e%2e", ".%2e" and "%2e." for a parent step and a backslash for a slash:
 * an address that starts as the cache's can so name a file outside it, which the first tests show.
 * An encoded slash ("%2f") is not decoded there; Android's file system code is taken to decode it
 * (expo-file-system 57.0.7's `JavaFile` builds a `java.io.File` from a `java.net.URI`; read, not
 * run), so for those the tests check that the file system is not asked at all.
 */
function fileIn(directory: Directory, name: string): File {
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, name);
  file.write(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return file;
}

/** A photo of the find log's, outside the cache, and its path from the folder above the cache. */
function findLogPhoto(): { photo: File; fromAboveTheCache: string } {
  const photo = fileIn(new Directory(Paths.document, "photos-guard-test"), "p1.jpg");
  return { photo, fromAboveTheCache: "document/photos-guard-test/p1.jpg" };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("removePickedCopy and a parent step that is not written as two dots (PBI-2.16)", () => {
  it.each(["%2e%2e", "%2E%2E", ".%2e", ".%2E", "%2e.", "%2E."])(
    "leaves the find log's photo, named through the cache by the parent step %s",
    (step) => {
      const { photo, fromAboveTheCache } = findLogPhoto();
      const viaCache = `${Paths.cache.uri}${step}/${fromAboveTheCache}`;
      expect(viaCache.startsWith(Paths.cache.uri)).toBe(true);
      expect(new File(viaCache).uri).toBe(photo.uri);
      removePickedCopy(viaCache);
      expect(photo.exists).toBe(true);
    },
  );

  it("leaves the find log's photo, named through the cache with backslashes around the step", () => {
    const { photo, fromAboveTheCache } = findLogPhoto();
    const viaCache = `${Paths.cache.uri}ImagePicker\\..\\..\\${fromAboveTheCache}`;
    expect(new File(viaCache).uri).toBe(photo.uri);
    removePickedCopy(viaCache);
    expect(photo.exists).toBe(true);
  });

  it("leaves a copy in the cache named through an encoded parent step, as through a plain one", () => {
    const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), "held-5.jpg");
    const viaParent = copy.uri.replace("/ImagePicker/", "/ImagePicker/%2e%2e/ImagePicker/");
    expect(new File(viaParent).uri).toBe(copy.uri);
    removePickedCopy(viaParent);
    expect(copy.exists).toBe(true);
  });

  it.each([
    ["encoded slashes", "ImagePicker%2f..%2f..%2fdocument%2fphotos-guard-test%2fp1.jpg"],
    ["encoded slashes in capitals", "ImagePicker%2F..%2F..%2Fdocument/photos-guard-test/p1.jpg"],
    [
      "encoded slashes and dots",
      "ImagePicker%2f%2e%2e%2f%2e%2e%2fdocument/photos-guard-test/p1.jpg",
    ],
    ["an encoded slash after it only", "ImagePicker/..%2f..%2fdocument/photos-guard-test/p1.jpg"],
    ["encoded backslashes", "ImagePicker%5c..%5c..%5cdocument/photos-guard-test/p1.jpg"],
  ])(
    "does not ask the file system about an address whose parent step has %s around it",
    (_name, path) => {
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePickedCopy(`${Paths.cache.uri}ImagePicker/gone.jpg`);
      expect(asked).toHaveBeenCalledTimes(1);
      asked.mockClear();
      removePickedCopy(`${Paths.cache.uri}${path}`);
      expect(asked).not.toHaveBeenCalled();
    },
  );

  it.each(["held..6.jpg", "..held-6.jpg", "held 6.jpg", "held%2e%2e6.jpg", "100%.jpg"])(
    "still removes a copy in the cache whose name, %s, only looks like one",
    (name) => {
      const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), name);
      removePickedCopy(copy.uri);
      expect(copy.exists).toBe(false);
    },
  );

  it.each([
    ["a percent sign that encodes nothing", "ImagePicker/%zz/gone.jpg"],
    ["a percent sign at its end", "ImagePicker/gone.jpg%"],
    ["half an encoded dot", "ImagePicker/%2/gone.jpg"],
    ["an encoded parent step that leads nowhere", "%2e%2e/%2e%2e/%2e%2e/%2e%2e/gone.jpg"],
  ])("does nothing, and does not throw, for an address with %s", (_name, path) => {
    expect(() => removePickedCopy(`${Paths.cache.uri}${path}`)).not.toThrow();
  });

  it("takes a removal that fails as no error, and removes the copy at a later try", () => {
    const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), "held-7.jpg");
    const failing = jest.spyOn(File.prototype, "delete").mockImplementation(() => {
      throw new Error("the file is in use");
    });
    expect(() => removePickedCopy(copy.uri)).not.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(copy.exists).toBe(true);
    failing.mockRestore();
    removePickedCopy(copy.uri);
    expect(copy.exists).toBe(false);
  });
});

/*
 * A URL's reader drops a tab, a line feed and a carriage return from an address before it reads
 * the path (the first tests here show it by the address `new File` gets), so a parent step with
 * one of them in it is a parent step. Their percent-encoded forms it keeps.
 */
describe("removePickedCopy and a parent step with a character a URL's reader drops (PBI-2.16)", () => {
  describe.each([
    ["a tab", "\t"],
    ["a line feed", "\n"],
    ["a carriage return", "\r"],
  ])("%s", (_name, dropped) => {
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
        removePickedCopy(viaCache);
        expect(photo.exists).toBe(true);
      },
    );

    it("does not ask the file system about an address with it inside the encoded slashes around a parent step", () => {
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePickedCopy(`${Paths.cache.uri}ImagePicker/gone.jpg`);
      expect(asked).toHaveBeenCalledTimes(1);
      asked.mockClear();
      removePickedCopy(
        `${Paths.cache.uri}ImagePicker%${dropped}2f..%2${dropped}f..%2fdocument/photos-guard-test/p1.jpg`,
      );
      expect(asked).not.toHaveBeenCalled();
    });

    it("still removes a copy in the cache whose name holds it", () => {
      const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), `held${dropped}8.jpg`);
      expect(copy.uri).toMatch(/held%0[9AD]8\.jpg$/);
      removePickedCopy(copy.uri);
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
      removePickedCopy(address);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(photo.exists).toBe(true);
    },
  );
});

/*
 * A URL's reader ends the path at "?" or "#" and trims the characters U+0000 to U+0020 from the
 * address's end, so a parent step before one of those is the path's last step: the address then
 * names the folder above the cache, which each test here shows first. Nothing was removed for
 * these before the guard refused them, since that folder is no file; the tests check that the
 * file system is not asked at all.
 */
describe("removePickedCopy and a parent step at the path's end (PBI-2.16)", () => {
  it.each([
    ["a fragment", "..#x"],
    ["a query", "..?x"],
    ["an empty fragment, its dots encoded", "%2e%2e#"],
    ["a space", ".. "],
    ["the character U+0000", "..\u0000"],
    ["a fragment, with a tab between its dots", ".\t.#x"],
  ])(
    "does not ask the file system about an address whose parent step is followed by %s",
    (_name, end) => {
      const address = `${Paths.cache.uri}${end}`;
      expect(address.startsWith(Paths.cache.uri)).toBe(true);
      expect(new File(address).uri.startsWith(Paths.cache.uri)).toBe(false);
      const asked = jest.spyOn(File.prototype, "exists", "get");
      removePickedCopy(`${Paths.cache.uri}ImagePicker/gone.jpg`);
      expect(asked).toHaveBeenCalledTimes(1);
      asked.mockClear();
      removePickedCopy(address);
      expect(asked).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a hash sign", "held#9.jpg", "%23"],
    ["a question mark", "held?9.jpg", "%3F"],
    ["a space", "held 9.jpg", "%20"],
    ["a space at its end", "held9.jpg ", "%20"],
  ])("still removes a copy in the cache whose name holds %s", (_name, name, written) => {
    const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), name);
    expect(copy.uri).toContain(written);
    expect(copy.uri).not.toMatch(/[?# ]/);
    removePickedCopy(copy.uri);
    expect(copy.exists).toBe(false);
  });
});
