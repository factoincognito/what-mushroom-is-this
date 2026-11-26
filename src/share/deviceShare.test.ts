import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import * as cacheFile from "../storage/cacheFile";
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

  it("removes a copy with the file system's removal, once, and nothing else", () => {
    const library = libraryFile("IMG_12.jpg");
    const other = libraryFile("IMG_13.jpg");
    const removal = jest.spyOn(File.prototype, "delete");
    try {
      deviceShareFiles.remove(library.uri);
      expect(removal).toHaveBeenCalledTimes(1);
    } finally {
      removal.mockRestore();
    }
    expect(library.exists).toBe(false);
    expect(other.exists).toBe(true);
  });

  it("is the three functions the session uses", () => {
    expect(deviceShareFiles.libraryCopy).toBe(libraryCopy);
    expect(deviceShareFiles.keep).toBe(keepSharedCopy);
  });
});

/*
 * `deviceShareFiles.remove` is given addresses that come from the library (`contentUri` of the
 * resolved payloads, whose file names the sharing app chooses and whose address of a shared web
 * address is the one the web server's redirects end at) and the app's own copies. It removes only
 * a file in the library's folder or the app's own folder of the cache, at an address that passes
 * the one guard of the app's removals (`isCacheFileAddress`); anything else is left alone, and the
 * file system's removal is not called for it.
 */
describe("deviceShareFiles.remove: only the share's own copies, at a plain address", () => {
  const cache = Paths.cache.uri;

  /** A file the removal must leave, and the address at which it is named. */
  type Refused = [string, () => { file: File; address: string }];

  function pickerFile(): File {
    return fileIn(new Directory(Paths.cache, "ImagePicker"), "pick.jpg");
  }
  function photoFile(): File {
    return fileIn(new Directory(Paths.document, "photos"), "p20.jpg");
  }

  const refused: Refused[] = [
    [
      "a file of the find log's photos",
      () => {
        const file = photoFile();
        return { file, address: file.uri };
      },
    ],
    [
      "a file of another folder of the cache, which is no copy of the share",
      () => {
        const file = pickerFile();
        return { file, address: file.uri };
      },
    ],
    [
      "a file of another folder of the cache, at the address Java writes",
      () => {
        const file = pickerFile();
        return { file, address: file.uri.replace("file:///", "file:/") };
      },
    ],
    [
      "a file of a folder whose name only starts as the library's",
      () => {
        const file = fileIn(new Directory(Paths.cache, "expo-sharing-other"), "a.jpg");
        return { file, address: file.uri };
      },
    ],
    [
      "a file of a folder whose name only starts as the app's own",
      () => {
        const file = fileIn(new Directory(Paths.cache, "SharedPhotos-other"), "a.jpg");
        return { file, address: file.uri };
      },
    ],
    [
      "a file of the cache's own top",
      () => {
        const file = fileIn(Paths.cache, "top.jpg");
        return { file, address: file.uri };
      },
    ],
  ];

  it.each(refused)("leaves %s", (_, make) => {
    const { file, address } = make();
    const removal = jest.spyOn(File.prototype, "delete");
    try {
      deviceShareFiles.remove(address);
      expect(removal).not.toHaveBeenCalled();
    } finally {
      removal.mockRestore();
    }
    expect(file.exists).toBe(true);
  });

  /** Addresses that start in the library's folder and are not a plain file in the cache. */
  const notPlain: [string, (copy: string, own: string) => string][] = [
    ["a parent step", () => `${cache}expo-sharing/../../document/photos/p21.jpg`],
    ["a parent step, one slash after the scheme", () => `file:/mock/cache/expo-sharing/../x.jpg`],
    ["an encoded parent step", () => `${cache}expo-sharing/%2e%2e/%2e%2e/document/photos/p21.jpg`],
    ["an upper-case encoded parent step", () => `${cache}expo-sharing/%2E%2E/%2E%2E/a.jpg`],
    ["a half-encoded parent step", () => `${cache}expo-sharing/.%2e/.%2e/a.jpg`],
    ["an encoded separator", () => `${cache}expo-sharing/..%2f..%2fdocument/photos/p21.jpg`],
    ["backslashes", () => `${cache}expo-sharing\\..\\..\\document\\photos\\p21.jpg`],
    ["an encoded backslash", () => `${cache}expo-sharing/..%5c..%5cdocument/photos/p21.jpg`],
    ["a parent step with a tab in it", () => `${cache}expo-sharing/.\t./.\t./a.jpg`],
    ["a parent step with a line break in it", () => `${cache}expo-sharing/.\n./a.jpg`],
    ["a parent step at the end", () => `${cache}expo-sharing/folder-1/..`],
    ["a parent step before a fragment", () => `${cache}expo-sharing/..#x`],
    ["a raw question mark", (copy) => `${copy}?x=1`],
    ["a raw number sign", (copy) => `${copy}#x`],
    ["a question mark in the path", () => `${cache}expo-sharing/a?/../../b.jpg`],
    ["a trailing line break", (copy) => `${copy}\n`],
    ["a trailing tab", (copy) => `${copy}\t`],
    ["a trailing space", (copy) => `${copy} `],
    ["a trailing control character", (copy) => `${copy}\u0001`],
    [
      "a parent step in the app's own folder",
      () => `${cache}SharedPhotos/../../document/photos/p21.jpg`,
    ],
    ["a trailing line break in the app's own folder", (_, own) => `${own}\n`],
  ];

  it.each(notPlain)("leaves a file named with %s", (_, address) => {
    const copy = libraryFile("IMG_14.jpg");
    const own = keepSharedCopy(libraryFile("IMG_15.jpg").uri) ?? "";
    const photo = photoFile();
    fileIn(new Directory(Paths.cache, "expo-sharing"), "a.jpg");
    const removal = jest.spyOn(File.prototype, "delete");
    try {
      deviceShareFiles.remove(address(copy.uri, own));
      expect(removal).not.toHaveBeenCalled();
    } finally {
      removal.mockRestore();
    }
    expect(copy.exists).toBe(true);
    expect(new File(own).exists).toBe(true);
    expect(photo.exists).toBe(true);
  });

  it("leaves the cache directory, the library's folder, a copy's folder and the app's own folder", () => {
    const copy = libraryFile("IMG_16.jpg");
    const own = keepSharedCopy(libraryFile("IMG_17.jpg").uri) ?? "";
    const removal = jest.spyOn(File.prototype, "delete");
    const folders = [
      cache,
      cache.replace(/\/$/, ""),
      `${cache}expo-sharing`,
      `${cache}expo-sharing/`,
      copy.uri.slice(0, copy.uri.lastIndexOf("/")),
      `${copy.uri.slice(0, copy.uri.lastIndexOf("/"))}/`,
      `${cache}SharedPhotos`,
      `${cache}SharedPhotos/`,
    ];
    try {
      for (const address of folders) {
        deviceShareFiles.remove(address);
      }
      expect(removal).not.toHaveBeenCalled();
    } finally {
      removal.mockRestore();
    }
    expect(copy.exists).toBe(true);
    expect(new File(own).exists).toBe(true);
  });

  it.each([
    "https://example.org/a.jpg",
    "http://example.org/expo-sharing/a.jpg",
    "content://media/external/images/media/1",
    "file:///data/user/0/other.app/cache/expo-sharing/a.jpg",
    "",
    "expo-sharing/a.jpg",
    null,
    undefined,
    7,
    { uri: "file:///mock/cache/expo-sharing/a.jpg" },
  ])("leaves what is no address of a file in the cache: %p", (address) => {
    const copy = libraryFile("IMG_18.jpg");
    const removal = jest.spyOn(File.prototype, "delete");
    try {
      expect(() => deviceShareFiles.remove(address as never)).not.toThrow();
      expect(removal).not.toHaveBeenCalled();
    } finally {
      removal.mockRestore();
    }
    expect(copy.exists).toBe(true);
  });

  it("asks the app's one guard for a cache file, and leaves a copy that guard refuses", () => {
    const copy = libraryFile("IMG_19.jpg");
    const guard = jest.spyOn(cacheFile, "isCacheFileAddress").mockReturnValue(false);
    try {
      deviceShareFiles.remove(copy.uri);
      expect(guard).toHaveBeenCalledWith(copy.uri);
    } finally {
      guard.mockRestore();
    }
    expect(copy.exists).toBe(true);
    deviceShareFiles.remove(copy.uri);
    expect(copy.exists).toBe(false);
  });

  it("removes a copy at its exact address, in either form, in either folder", () => {
    const library = libraryFile("IMG_20.jpg");
    const asJava = libraryFile("IMG_21.jpg");
    const own = keepSharedCopy(libraryFile("IMG_22.jpg").uri) ?? "";
    const named = libraryFile("a%20name%3F%23.png");
    deviceShareFiles.remove(library.uri);
    deviceShareFiles.remove(asJava.uri.replace("file:///", "file:/"));
    deviceShareFiles.remove(own);
    deviceShareFiles.remove(named.uri);
    expect(library.exists).toBe(false);
    expect(asJava.exists).toBe(false);
    expect(new File(own).exists).toBe(false);
    expect(named.exists).toBe(false);
  });

  it("does not fail for a copy that is gone, or when the removal fails", () => {
    const copy = libraryFile("IMG_23.jpg");
    deviceShareFiles.remove(`${cache}expo-sharing/folder-z/gone.jpg`);
    const removal = jest.spyOn(File.prototype, "delete").mockImplementation(() => {
      throw new Error("read-only file system");
    });
    try {
      expect(() => deviceShareFiles.remove(copy.uri)).not.toThrow();
    } finally {
      removal.mockRestore();
    }
    expect(copy.exists).toBe(true);
  });
});
