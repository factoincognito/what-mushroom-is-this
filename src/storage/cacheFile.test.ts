import { Directory, Paths } from "expo-file-system";

import { isCacheFileAddress } from "./cacheFile";

/*
 * The one rule for removing a copy the app made in its cache directory (`removePickedCopy`,
 * `removePictureCopy`; PBI-2.16). The cache directory is that of jest-expo's in-memory file
 * system, "file:///mock/cache/".
 */
const cache = Paths.cache.uri;

/** A parent step, plain and with one or both of its dots percent-encoded, in either case. */
const PARENT_STEPS = ["..", "%2e%2e", "%2E%2E", ".%2e", ".%2E", "%2e.", "%2E.", "%2e%2E"];
/** What ends a step: a slash or a backslash, plain or percent-encoded, in either case. */
const SEPARATORS = ["/", "%2f", "%2F", "\\", "%5c", "%5C"];
/**
 * The characters a URL's reader drops from an address before it reads the path (Node's does, which
 * the removals' tests show): a step with one of them in it is read as the step without it.
 */
const DROPPED: [string, string][] = [
  ["a tab", "\t"],
  ["a line feed", "\n"],
  ["a carriage return", "\r"],
];

describe("isCacheFileAddress: a file under the app's cache directory", () => {
  it("has, in these tests, a cache directory whose address ends with a slash", () => {
    expect(cache).toBe("file:///mock/cache/");
  });

  it.each([
    ["directly in the cache", `${cache}picture-abc.jpg`],
    ["in a picker's folder", `${cache}ImagePicker/1.jpg`],
    ["further down", `${cache}DocumentPicker/a/b/1.jpg`],
    ["whose name holds two dots", `${cache}ImagePicker/a..b.jpg`],
    ["whose name starts with two dots", `${cache}ImagePicker/..a.jpg`],
    ["whose name ends with two dots", `${cache}ImagePicker/a..`],
    ["in a folder named by three dots", `${cache}.../a.jpg`],
    ["whose name holds an encoded space", `${cache}ImagePicker/IMG%200042.jpg`],
    ["whose name holds an encoded dot", `${cache}ImagePicker/a%2eb.jpg`],
    ["whose name holds two encoded dots among other letters", `${cache}ImagePicker/a%2e%2e.jpg`],
    ["whose name holds a percent sign that encodes nothing", `${cache}ImagePicker/100%.jpg`],
    ["whose name holds an encoded percent sign before 2e", `${cache}%252e%252e/a.jpg`],
  ])("takes a file %s", (_name, uri) => {
    expect(isCacheFileAddress(uri)).toBe(true);
  });

  it.each([
    ["the find log's photo", `${Paths.document.uri}photos/p1.jpg`],
    ["a file in a folder whose name only starts as the cache's does", "file:///mock/cache-2/a.jpg"],
    ["the cache directory's address without its slash", "file:///mock/cache"],
    ["an address that holds the cache's further in", `file:///mock/document/${cache}a.jpg`],
    ["an address that is not a file's", "content://media/picker/0/media/1000000033"],
    ["a path without a scheme", "/mock/cache/a.jpg"],
    ["an empty address", ""],
  ])("refuses %s", (_name, uri) => {
    expect(isCacheFileAddress(uri)).toBe(false);
  });

  describe.each(PARENT_STEPS)("with the parent step %s", (step) => {
    it.each(SEPARATORS)(
      "refuses it between two %s, though the file is in the cache",
      (separator) => {
        const uri = `${cache}ImagePicker${separator}${step}${separator}ImagePicker/a.jpg`;
        expect(isCacheFileAddress(uri)).toBe(false);
      },
    );

    it.each(SEPARATORS)("refuses it right after the cache's address, before %s", (separator) => {
      expect(isCacheFileAddress(`${cache}${step}${separator}document/photos/p1.jpg`)).toBe(false);
    });

    it.each(SEPARATORS)("refuses it at the address's end, after %s", (separator) => {
      expect(isCacheFileAddress(`${cache}ImagePicker${separator}${step}`)).toBe(false);
    });
  });

  it.each([
    ["a plain slash before and an encoded one after", `${cache}ImagePicker/..%2fa.jpg`],
    ["an encoded slash before and a plain one after", `${cache}ImagePicker%2f../a.jpg`],
    ["a backslash before and a slash after", `${cache}ImagePicker\\../a.jpg`],
    [
      "an encoded backslash before and an encoded slash after",
      `${cache}ImagePicker%5c%2e%2e%2fa.jpg`,
    ],
    ["two steps in a row", `${cache}a/b/%2e%2e/%2e%2e/%2e%2e/document/photos/p1.jpg`],
  ])("refuses a parent step with %s", (_name, uri) => {
    expect(isCacheFileAddress(uri)).toBe(false);
  });

  describe.each(DROPPED)("with %s, which a URL's reader drops", (_name, dropped) => {
    it.each([
      ["between the dots of a parent step", `${cache}.${dropped}./document/photos/p1.jpg`],
      ["before a parent step", `${cache}${dropped}../document/photos/p1.jpg`],
      ["after a parent step", `${cache}..${dropped}/document/photos/p1.jpg`],
      ["twice in a parent step", `${cache}${dropped}.${dropped}./document/photos/p1.jpg`],
      ["in a parent step at the address's end", `${cache}ImagePicker/.${dropped}.`],
      ["in a parent step that stays in the cache", `${cache}ImagePicker/.${dropped}./a.jpg`],
      ["inside the first encoded dot", `${cache}%${dropped}2e%2e/document/photos/p1.jpg`],
      ["inside the second encoded dot", `${cache}.%2${dropped}e/document/photos/p1.jpg`],
      ["inside an encoded slash", `${cache}ImagePicker%${dropped}2f..%2${dropped}fa.jpg`],
      ["inside an encoded backslash", `${cache}ImagePicker%5${dropped}c..%${dropped}5ca.jpg`],
      ["between backslashes", `${cache}ImagePicker\\.${dropped}.\\a.jpg`],
    ])("refuses an address with it %s", (_place, uri) => {
      expect(isCacheFileAddress(uri)).toBe(false);
    });

    it.each([
      ["in a file's name", `${cache}ImagePicker/a${dropped}b.jpg`],
      ["between a dot and a letter", `${cache}ImagePicker/.${dropped}a.jpg`],
      ["between three dots", `${cache}ImagePicker/.${dropped}.${dropped}./a.jpg`],
    ])("takes a file under the cache with it %s, where it makes no parent step", (_place, uri) => {
      expect(isCacheFileAddress(uri)).toBe(true);
    });

    it.each([
      ["at its start", `${dropped}${cache}a.jpg`],
      ["in its scheme", `fi${dropped}le:///mock/cache/a.jpg`],
      ["in the cache's name", `file:///mock/ca${dropped}che/a.jpg`],
    ])("refuses an address with it %s, in the cache directory's own part", (_place, uri) => {
      expect(isCacheFileAddress(uri)).toBe(false);
    });
  });

  it("refuses a parent step with all three dropped characters in it", () => {
    expect(isCacheFileAddress(`${cache}.\t\r\n./document/photos/p1.jpg`)).toBe(false);
  });

  it.each(["%09", "%0a", "%0A", "%0d", "%0D"])(
    "takes a file under a folder named .%s., which a URL's reader does not read as a parent step",
    (encoded) => {
      expect(isCacheFileAddress(`${cache}.${encoded}./a.jpg`)).toBe(true);
      expect(isCacheFileAddress(`${cache}ImagePicker/a${encoded}b.jpg`)).toBe(true);
    },
  );

  describe("when the cache directory's address has no slash at its end", () => {
    beforeEach(() => {
      jest.spyOn(Paths, "cache", "get").mockReturnValue(new Directory("file:///mock/cache"));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("takes a file in the cache, and refuses one with a parent step", () => {
      expect(Paths.cache.uri).toBe("file:///mock/cache");
      expect(isCacheFileAddress("file:///mock/cache/ImagePicker/1.jpg")).toBe(true);
      expect(isCacheFileAddress("file:///mock/cache/%2e%2e/document/photos/p1.jpg")).toBe(false);
    });

    it("refuses a file in a folder whose name only starts as the cache's does", () => {
      expect(isCacheFileAddress("file:///mock/cache-2/a.jpg")).toBe(false);
      expect(isCacheFileAddress("file:///mock/cache")).toBe(false);
    });
  });
});
