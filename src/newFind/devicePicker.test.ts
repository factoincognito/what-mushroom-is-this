import * as ImagePicker from "expo-image-picker";

import { cameraPermission, pickFromGallery, takePhoto } from "./devicePicker";

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
