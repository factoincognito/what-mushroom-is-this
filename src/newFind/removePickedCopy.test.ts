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
 * the address as a URL (`Paths.join`, the library's own JavaScript; the URL here is Node's), and a
 * URL's path takes "%2e%2e", ".%2e" and "%2e." for a parent step and a backslash for a slash: an
 * address that starts as the cache's can so name a file outside it, which the first tests show.
 * An encoded slash ("%2f") is not decoded there; Android's file system code decodes it
 * (expo-file-system 57.0.7's `JavaFile`, read, not run), so for those the tests check that the
 * file system is not asked at all.
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
