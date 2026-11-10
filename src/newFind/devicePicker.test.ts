import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { JpegEncoder, LoadedImage } from "../image/prepareForAnalysis";
import {
  cameraPermission,
  pickFromFiles,
  pickFromGallery,
  removePickedCopy,
  takePhoto,
} from "./devicePicker";

jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

const asset = { uri: "file:///cache/ImagePicker/1.jpg", width: 4032, height: 3024, exif: { a: 1 } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("takePhoto", () => {
  it("opens the camera for a still photo, unchanged, without its EXIF", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [asset] }));
    await expect(takePhoto()).resolves.toEqual({
      kind: "photo",
      uri: asset.uri,
      exif: null,
    });
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      quality: 1,
      exif: false,
    });
  });

  it("says when the user closed the camera without a photo", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: true, assets: null }));
    await expect(takePhoto()).resolves.toEqual({ kind: "canceled" });
  });
});

describe("pickFromGallery", () => {
  it("opens the gallery for one photo, unchanged, with its EXIF", async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [asset] }));
    await expect(pickFromGallery()).resolves.toEqual({
      kind: "photo",
      uri: asset.uri,
      exif: { a: 1 },
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      quality: 1,
      exif: true,
      allowsMultipleSelection: false,
    });
  });

  it("gives no EXIF when the picker gives none", async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [{ ...asset, exif: undefined }] }));
    await expect(pickFromGallery()).resolves.toMatchObject({ exif: null });
  });

  it.each<[string, unknown]>([
    ["no answer", null],
    ["no assets", { canceled: false, assets: [] }],
    ["assets that are not a list", { canceled: false, assets: "photo" }],
    ["an asset without an address", { canceled: false, assets: [{ width: 1 }] }],
    ["an asset with an empty address", { canceled: false, assets: [{ uri: "" }] }],
    ["a canceled flag that is not a boolean", { canceled: "no", assets: [asset] }],
  ])("refuses %s from the picker", async (_, answer) => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(wrong(answer));
    await expect(pickFromGallery()).rejects.toThrow("the picker gave no photo");
  });

  it("passes on a picker that fails", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValue(new Error("no activity"));
    await expect(pickFromGallery()).rejects.toThrow("no activity");
  });
});

/*
 * The phone's files (docs/SPEC.md 3.9, Lookups; Known unknown 13; PBI-2.6). The picker's copy is a
 * file in the app's cache, in jest-expo's in-memory file system, as the picker leaves one.
 */
describe("pickFromFiles", () => {
  function pickerCopy(name: string): File {
    const directory = new Directory(Paths.cache, "DocumentPicker");
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, name);
    file.write(new Uint8Array([0x3c, 0x73, 0x76, 0x67]));
    return file;
  }

  /** A file of the picker's answer, as its asset gives it, with a date it was last changed. */
  function fileAsset(uri: string) {
    return {
      uri,
      name: "IMG_0042.jpg",
      size: 4,
      mimeType: "image/jpeg",
      lastModified: Date.UTC(2020, 0, 1),
    };
  }

  /** An encoder stand-in whose `load` gives an image of the size given, or fails. */
  function encoderGiving(size: { width: number; height: number } | Error) {
    const release = jest.fn();
    const load = jest.fn(async (_uri: string): Promise<LoadedImage> => {
      if (size instanceof Error) {
        throw size;
      }
      return { ...size, encodeJpeg: jest.fn(), release };
    });
    const encoder: JpegEncoder = { load };
    return { encoder, load, release };
  }

  it("opens the phone's files for one image, copied to the app's cache, and gives it with no metadata of its own", async () => {
    const copy = pickerCopy("files-1.jpg");
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [fileAsset(copy.uri)] }));
    const { encoder, load, release } = encoderGiving({ width: 4032, height: 3024 });
    await expect(pickFromFiles(encoder)).resolves.toEqual({
      kind: "photo",
      uri: copy.uri,
      exif: null,
    });
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      type: "image/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    expect(load).toHaveBeenCalledWith(copy.uri);
    expect(release).toHaveBeenCalledTimes(1);
    expect(copy.exists).toBe(true);
  });

  it("says when the user closed the files without one, and loads nothing", async () => {
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: true, assets: null }));
    const { encoder, load } = encoderGiving({ width: 1, height: 1 });
    await expect(pickFromFiles(encoder)).resolves.toEqual({ kind: "canceled" });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a file the app cannot load as an image, and removes the app's copy of it", async () => {
    const copy = pickerCopy("files-2.svg");
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [fileAsset(copy.uri)] }));
    const { encoder } = encoderGiving(new Error("Could not load the image"));
    await expect(pickFromFiles(encoder)).resolves.toEqual({ kind: "notImage" });
    expect(copy.exists).toBe(false);
  });

  it.each<[string, { width: number; height: number }]>([
    ["no width", { width: 0, height: 3024 }],
    ["no height", { width: 4032, height: 0 }],
    ["a size that is not whole pixels", { width: 4032.5, height: 3024 }],
    ["a size that is not a number", { width: Number.NaN, height: 3024 }],
  ])("refuses a file that loads as an image of %s, releases it, and removes the copy", async (_, size) => {
    const copy = pickerCopy("files-3.jpg");
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [fileAsset(copy.uri)] }));
    const { encoder, release } = encoderGiving(size);
    await expect(pickFromFiles(encoder)).resolves.toEqual({ kind: "notImage" });
    expect(release).toHaveBeenCalledTimes(1);
    expect(copy.exists).toBe(false);
  });

  it("still gives the image when releasing it after the check fails", async () => {
    const copy = pickerCopy("files-4.jpg");
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [fileAsset(copy.uri)] }));
    const { encoder, release } = encoderGiving({ width: 10, height: 10 });
    release.mockImplementation(() => {
      throw new Error("already released");
    });
    await expect(pickFromFiles(encoder)).resolves.toEqual({
      kind: "photo",
      uri: copy.uri,
      exif: null,
    });
  });

  it.each<[string, unknown]>([
    ["no answer", null],
    ["no assets", { canceled: false, assets: [] }],
    ["an asset without an address", { canceled: false, assets: [{ name: "a.jpg" }] }],
    ["an asset with an empty address", { canceled: false, assets: [{ uri: "" }] }],
  ])("refuses %s from the picker, and loads nothing", async (_, answer) => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(wrong(answer));
    const { encoder, load } = encoderGiving({ width: 1, height: 1 });
    await expect(pickFromFiles(encoder)).rejects.toThrow("the picker gave no photo");
    expect(load).not.toHaveBeenCalled();
  });

  it("passes on a picker that fails", async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockRejectedValue(new Error("no activity"));
    await expect(pickFromFiles(encoderGiving({ width: 1, height: 1 }).encoder)).rejects.toThrow(
      "no activity",
    );
  });
});

/*
 * jest-expo backs expo-file-system's native module with an in-memory file system. The picker's
 * copies are in the app's cache directory, as the picker gives them.
 */
describe("removePickedCopy (SPEC 3.9: an unsaved lookup's copies of its photos)", () => {
  function fileIn(directory: Directory, name: string): File {
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, name);
    file.write(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    return file;
  }

  it("removes the picker's copy of a photo in the app's cache", () => {
    const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), "held-1.jpg");
    removePickedCopy(copy.uri);
    expect(copy.exists).toBe(false);
  });

  it("removes the files picker's copy of a photo in the app's cache (PBI-2.6)", () => {
    const copy = fileIn(new Directory(Paths.cache, "DocumentPicker"), "held-3.jpg");
    removePickedCopy(copy.uri);
    expect(copy.exists).toBe(false);
  });

  it("removes nothing outside the app's cache, such as the find log's own photos", () => {
    const photo = fileIn(new Directory(Paths.document, "photos-picker-test"), "p1.jpg");
    removePickedCopy(photo.uri);
    expect(photo.exists).toBe(true);
  });

  it("removes nothing named by a path with a parent step, which could leave the cache", () => {
    const copy = fileIn(new Directory(Paths.cache, "ImagePicker"), "held-2.jpg");
    const viaParent = copy.uri.replace("/ImagePicker/", "/ImagePicker/../ImagePicker/");
    expect(viaParent).not.toBe(copy.uri);
    removePickedCopy(viaParent);
    expect(copy.exists).toBe(true);
  });

  it.each([
    ["an address that is not a file's", "content://media/picker/0/media/1000000033"],
    ["a copy that is gone already", `${Paths.cache.uri}/ImagePicker/gone.jpg`],
    ["an empty address", ""],
  ])("does nothing, and does not throw, for %s", (_name, uri) => {
    expect(() => removePickedCopy(uri)).not.toThrow();
  });
});

describe("cameraPermission", () => {
  it("reads and asks for the camera permission", async () => {
    const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
    jest.mocked(ImagePicker.getCameraPermissionsAsync).mockResolvedValue(wrong(granted));
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(wrong(granted));
    await expect(cameraPermission.get()).resolves.toBe(granted);
    await expect(cameraPermission.request()).resolves.toBe(granted);
  });
});

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}
