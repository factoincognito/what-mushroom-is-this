import { Directory, File, Paths } from "expo-file-system";
import { requireNativeModule } from "expo-modules-core";

import { devicePhotoFiles } from "./photoFiles";

/** jest-expo backs expo-file-system's native module with an in-memory file system. */
const nativeFileSystem = requireNativeModule<{ __resetMockFileSystem(): void }>("FileSystem");

const photoDirectory = () => new Directory(Paths.document, "photos");

function cameraPhoto(name = "IMG_1.jpg"): File {
  const file = new File(Paths.cache, name);
  file.write(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return file;
}

beforeEach(() => {
  nativeFileSystem.__resetMockFileSystem();
});

describe("devicePhotoFiles", () => {
  it("makes the photo directory in the app's document directory, and may do so again", () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    photos.prepare();
    expect(photoDirectory().exists).toBe(true);
  });

  it("copies a photo in under the name given and the source's extension, keeping the source", async () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    const source = cameraPhoto();
    await expect(photos.copyIn(source.uri, "p1")).resolves.toBe("p1.jpg");
    const copy = new File(photoDirectory(), "p1.jpg");
    expect(copy.bytesSync()).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(source.exists).toBe(true);
  });

  it("refuses a source that does not exist", async () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    const missing = new File(Paths.cache, "gone.jpg");
    await expect(photos.copyIn(missing.uri, "p1")).rejects.toMatchObject({ code: "invalid-input" });
  });

  it.each([
    ["without an extension", "IMG_1"],
    ["with an extension of other characters", "IMG_1.jp-g"],
  ])("refuses a source %s", async (_, name) => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    const source = cameraPhoto(name);
    await expect(photos.copyIn(source.uri, "p1")).rejects.toMatchObject({ code: "invalid-input" });
    expect(photos.list()).toEqual([]);
  });

  it("refuses a name to copy in under that is not a plain file name", async () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    await expect(photos.copyIn(cameraPhoto().uri, "../p1")).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  it("does not overwrite a photo already there", async () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    await photos.copyIn(cameraPhoto().uri, "p1");
    await expect(photos.copyIn(cameraPhoto("IMG_2.jpg").uri, "p1")).rejects.toThrow();
  });

  it("lists the files in the directory and nothing in a directory below it", async () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    await photos.copyIn(cameraPhoto().uri, "p1");
    new Directory(photoDirectory(), "inner").create();
    expect(photos.list()).toEqual(["p1.jpg"]);
  });

  it("removes a photo, and removing one that is not there is no error", async () => {
    const photos = devicePhotoFiles("photos");
    photos.prepare();
    await photos.copyIn(cameraPhoto().uri, "p1");
    photos.remove("p1.jpg");
    expect(new File(photoDirectory(), "p1.jpg").exists).toBe(false);
    expect(() => photos.remove("p1.jpg")).not.toThrow();
  });

  it("gives a photo's URI in the directory", () => {
    const photos = devicePhotoFiles("photos");
    expect(photos.uriOf("p1.jpg")).toBe(new File(photoDirectory(), "p1.jpg").uri);
  });

  it.each(["../finds.db", "a/b.jpg", "", "p1"])(
    "refuses the stored name %j for a URI or a removal",
    (name) => {
      const photos = devicePhotoFiles("photos");
      expect(() => photos.uriOf(name)).toThrow(expect.objectContaining({ code: "corrupt" }));
      expect(() => photos.remove(name)).toThrow(expect.objectContaining({ code: "corrupt" }));
    },
  );
});
