import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { isCacheFileAddress } from "../storage/cacheFile";
import { deviceShareFiles, deviceShareSource, keepSharedCopy, libraryCopy } from "./deviceShare";

jest.mock("expo-sharing", () => ({
  getSharedPayloads: jest.fn(),
  getResolvedSharedPayloadsAsync: jest.fn(),
  clearSharedPayloads: jest.fn(),
  // The library's hook resolves every share it sees, a shared web address too, with a request
  // (57.0.26, `src/useIncomingShare.ts`, read): the app must never call it.
  useIncomingShare: jest.fn(() => {
    throw new Error("the app does not use the library's hook");
  }),
}));
// The image picker and the document picker are loaded with the device picker, whose removal of a
// cache copy is used here.
jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

/*
 * jest-expo backs expo-file-system with an in-memory file system, whose cache directory is
 * `file:///mock/cache/`. The library keeps its copies of shared files under `expo-sharing/` in
 * the app's cache directory, each in a folder of its own (57.0.26, `ShareIntoFileStore.kt`, read).
 */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function fileIn(directory: Directory, name: string, bytes: Uint8Array = JPEG): File {
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, name);
  file.write(bytes);
  return file;
}

let folders = 0;
/** A copy as the library makes it: in a folder of its own under `expo-sharing/`. */
function libraryFile(name: string, bytes: Uint8Array = JPEG): File {
  folders += 1;
  return fileIn(new Directory(Paths.cache, "expo-sharing", `folder-${folders}`), name, bytes);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deviceShareSource: the share the library holds", () => {
  it("reads the raw payloads, which the library gives without a request", () => {
    const payloads = [{ value: "content://a/1", shareType: "image", mimeType: "image/jpeg" }];
    jest.mocked(Sharing.getSharedPayloads).mockReturnValue(payloads as never);
    expect(deviceShareSource.read()).toBe(payloads);
    expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
  });

  it("resolves through the library only when asked", async () => {
    const resolved = [{ value: "content://a/1", contentUri: "file:/cache/expo-sharing/u/a.jpg" }];
    jest.mocked(Sharing.getResolvedSharedPayloadsAsync).mockResolvedValue(resolved as never);
    await expect(deviceShareSource.resolve()).resolves.toBe(resolved);
    expect(Sharing.getResolvedSharedPayloadsAsync).toHaveBeenCalledTimes(1);
  });

  it("drops the share through the library", () => {
    deviceShareSource.clear();
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
  });

  it("never uses the library's hook", () => {
    deviceShareSource.read();
    deviceShareSource.clear();
    expect(Sharing.useIncomingShare).not.toHaveBeenCalled();
  });
});

describe("libraryCopy: the library's copy of a shared file", () => {
  it("is taken at its address when it is a file in the library's folder in the cache", () => {
    const copy = libraryFile("IMG_1.jpg");
    expect(libraryCopy(copy.uri)).toBe(copy.uri);
  });

  it("is taken at the address Java writes for it, with one slash after the scheme", () => {
    const copy = libraryFile("IMG_2.jpg");
    const asJava = copy.uri.replace("file:///", "file:/");
    expect(asJava.startsWith("file:/mock/")).toBe(true);
    expect(libraryCopy(asJava)).toBe(copy.uri);
  });

  it("is not taken when the file is not there: the library could not copy it", () => {
    const gone = `${Paths.cache.uri}expo-sharing/folder-x/gone.jpg`;
    expect(libraryCopy(gone)).toBeNull();
  });

  it("is not taken when the address names a folder", () => {
    const copy = libraryFile("IMG_3.jpg");
    expect(libraryCopy(copy.uri.slice(0, copy.uri.lastIndexOf("/")))).toBeNull();
  });

  it.each([
    [
      "another folder of the cache",
      () => fileIn(new Directory(Paths.cache, "ImagePicker"), "a.jpg").uri,
    ],
    ["the find log's photos", () => fileIn(new Directory(Paths.document, "photos"), "p1.jpg").uri],
    [
      "the find log's photos, named through the library's folder by a parent step",
      () => {
        fileIn(new Directory(Paths.document, "photos"), "p2.jpg");
        return `${Paths.cache.uri}expo-sharing/../../document/photos/p2.jpg`;
      },
    ],
    [
      "the find log's photos, named through the library's folder by an encoded parent step",
      () => {
        fileIn(new Directory(Paths.document, "photos"), "p3.jpg");
        return `${Paths.cache.uri}expo-sharing/%2e%2e/%2e%2e/document/photos/p3.jpg`;
      },
    ],
    [
      "a folder whose name only starts as the library's",
      () => fileIn(new Directory(Paths.cache, "expo-sharing-other"), "a.jpg").uri,
    ],
  ])("is not taken from %s", (_, address) => {
    const uri = address();
    expect(libraryCopy(uri)).toBeNull();
  });

  it.each([
    "https://example.org/a.jpg",
    "http://example.org/a.jpg",
    "content://media/external/images/media/1",
    "",
    "expo-sharing/a.jpg",
  ])("is not taken at the address %p, which is no file in the cache", (address) => {
    expect(libraryCopy(address)).toBeNull();
  });

  it("is not taken at an address with a query or a fragment", () => {
    const copy = libraryFile("IMG_4.jpg");
    expect(libraryCopy(`${copy.uri}?x=1`)).toBeNull();
    expect(libraryCopy(`${copy.uri}#x`)).toBeNull();
  });

  it.each([null, undefined, 7, { uri: "file:///mock/cache/expo-sharing/a.jpg" }])(
    "is not taken at %p, which is no address",
    (value) => {
      expect(libraryCopy(value as never)).toBeNull();
    },
  );

  it("is not taken when the file system cannot say whether the file is there", () => {
    const copy = libraryFile("IMG_11.jpg");
    const exists = jest.spyOn(File.prototype, "exists", "get").mockImplementation(() => {
      throw new Error("file system unavailable");
    });
    try {
      expect(libraryCopy(copy.uri)).toBeNull();
    } finally {
      exists.mockRestore();
    }
  });
});

describe("keepSharedCopy: the app's own copy of a shared photo", () => {
  it("moves the library's copy to the app's own folder in the cache, with its bytes and its extension", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const copy = libraryFile("IMG_5.JPG", bytes);
    const from = copy.uri;
    const kept = keepSharedCopy(from);
    expect(kept).not.toBeNull();
    expect(kept?.startsWith(`${Paths.cache.uri}SharedPhotos/`)).toBe(true);
    expect(kept?.endsWith(".JPG")).toBe(true);
    expect(new File(kept ?? "").bytesSync()).toEqual(bytes);
    expect(new File(from).exists).toBe(false);
  });

  it("gives an address the app's removal of a cache copy takes", () => {
    const kept = keepSharedCopy(libraryFile("IMG_6.jpg").uri) ?? "";
    expect(isCacheFileAddress(kept)).toBe(true);
    deviceShareFiles.remove(kept);
    expect(new File(kept).exists).toBe(false);
  });

  it("names two photos apart, also when the library gave them the same name", () => {
    const first = keepSharedCopy(libraryFile("image.jpg").uri);
    const second = keepSharedCopy(libraryFile("image.jpg").uri);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(new File(first ?? "").exists).toBe(true);
    expect(new File(second ?? "").exists).toBe(true);
  });

  it.each([
    ["no extension", "photo", /\/[A-Za-z0-9-]+$/],
    ["an extension that is not letters and digits", "photo.j pg", /\/[A-Za-z0-9-]+$/],
    [
      "a name with characters an address cannot hold as they are",
      "my photo #1?.png",
      /\/[A-Za-z0-9-]+\.png$/,
    ],
  ])("gives a plain name to a copy with %s", (_, name, pattern) => {
    const kept = keepSharedCopy(libraryFile(name).uri) ?? "";
    expect(kept).toMatch(pattern);
    expect(isCacheFileAddress(kept)).toBe(true);
    expect(new File(kept).exists).toBe(true);
  });

  it("moves nothing that is not the library's copy", () => {
    const picked = fileIn(new Directory(Paths.cache, "ImagePicker"), "a.jpg");
    const photo = fileIn(new Directory(Paths.document, "photos"), "p9.jpg");
    expect(keepSharedCopy(picked.uri)).toBeNull();
    expect(keepSharedCopy(photo.uri)).toBeNull();
    expect(
      keepSharedCopy(`${Paths.cache.uri}expo-sharing/../../document/photos/p9.jpg`),
    ).toBeNull();
    expect(picked.exists).toBe(true);
    expect(photo.exists).toBe(true);
  });

  it("gives nothing for a copy that is gone", () => {
    expect(keepSharedCopy(`${Paths.cache.uri}expo-sharing/folder-y/gone.jpg`)).toBeNull();
  });

  it("gives nothing, and leaves the copy, when the move fails", () => {
    const copy = libraryFile("IMG_7.jpg");
    const move = jest.spyOn(File.prototype, "moveSync").mockImplementation(() => {
      throw new Error("no space left on device");
    });
    try {
      expect(keepSharedCopy(copy.uri)).toBeNull();
    } finally {
      move.mockRestore();
    }
    expect(new File(copy.uri).exists).toBe(true);
  });
});

describe("deviceShareFiles: the files of a share on the phone", () => {
  it("removes the library's copy of a file, and the app's own", () => {
    const library = libraryFile("IMG_8.jpg");
    const kept = keepSharedCopy(libraryFile("IMG_9.jpg").uri) ?? "";
    deviceShareFiles.remove(library.uri);
    deviceShareFiles.remove(kept);
    expect(library.exists).toBe(false);
    expect(new File(kept).exists).toBe(false);
  });

  it("removes the library's copy at the address Java writes for it", () => {
    const library = libraryFile("IMG_10.jpg");
    deviceShareFiles.remove(library.uri.replace("file:///", "file:/"));
    expect(library.exists).toBe(false);
  });

  it("never removes a file outside the cache: the find log's photos, or a shared original", () => {
    const photo = fileIn(new Directory(Paths.document, "photos"), "p10.jpg");
    deviceShareFiles.remove(photo.uri);
    deviceShareFiles.remove(`${Paths.cache.uri}expo-sharing/../../document/photos/p10.jpg`);
    deviceShareFiles.remove("content://media/external/images/media/1");
    deviceShareFiles.remove("https://example.org/a.jpg");
    expect(photo.exists).toBe(true);
  });

  it("is the three functions the session uses", () => {
    expect(deviceShareFiles.libraryCopy).toBe(libraryCopy);
    expect(deviceShareFiles.keep).toBe(keepSharedCopy);
  });
});
