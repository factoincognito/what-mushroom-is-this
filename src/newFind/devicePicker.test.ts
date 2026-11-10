import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { cameraPermission, pickFromGallery, removePickedCopy, takePhoto } from "./devicePicker";

jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

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
