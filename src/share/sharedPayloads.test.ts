import { mayResolve, readShare, takeResolved } from "./sharedPayloads";

/** A shared image as expo-sharing's `getSharedPayloads` gives it on Android (57.0.26, read). */
const image = (value: string, mimeType = "image/jpeg") => ({
  value,
  shareType: "image",
  mimeType,
});

const GALLERY = "content://media/external/images/media/41";
const SECOND = "content://media/external/images/media/42";

describe("readShare: what the library holds of a share, checked", () => {
  it.each([undefined, null, [], "content://x", 42, { value: GALLERY }])(
    "is no share for %p",
    (raw) => {
      expect(readShare(raw)).toBeNull();
    },
  );

  it("takes an image at a content address as an image file on the phone", () => {
    expect(readShare([image(GALLERY)])?.items).toEqual([
      { value: GALLERY, image: true, onPhone: true },
    ]);
  });

  it("takes an image at a file address as an image file on the phone", () => {
    expect(readShare([image("file:///storage/emulated/0/DCIM/a.png", "image/png")])?.items).toEqual(
      [{ value: "file:///storage/emulated/0/DCIM/a.png", image: true, onPhone: true }],
    );
  });

  it("keeps the order shared", () => {
    expect(readShare([image(SECOND), image(GALLERY)])?.items.map((item) => item.value)).toEqual([
      SECOND,
      GALLERY,
    ]);
  });

  it.each([
    ["a web address shared as a link", { value: "https://example.org/a.jpg", shareType: "url" }],
    [
      "a web address the library typed as an image, from the share's own type",
      image("https://example.org/a.jpg"),
    ],
    ["an http address", image("http://example.org/a.jpg")],
    ["a text", { value: "Kantarell", shareType: "text", mimeType: "text/plain" }],
    ["an address of another kind", image("android.resource://com.example/drawable/a")],
    ["an address with no scheme", image("/storage/emulated/0/DCIM/a.jpg")],
    ["a scheme in other letters, which Android does not read as content", image("CONTENT://a/1")],
    ["an empty value", image("")],
  ])("refuses %s: it is not a file on the phone", (_, payload) => {
    expect(readShare([payload])?.items).toEqual([
      { value: payload.value, image: false, onPhone: false },
    ]);
  });

  it.each([
    ["a video", { value: GALLERY, shareType: "video", mimeType: "video/mp4" }],
    ["a file of another kind", { value: GALLERY, shareType: "file", mimeType: "application/pdf" }],
    ["an image by share type whose MIME type is not one", image(GALLERY, "video/mp4")],
    ["an image by MIME type whose share type is not one", { ...image(GALLERY), shareType: "file" }],
    ["an image without a MIME type", { value: GALLERY, shareType: "image" }],
  ])("refuses %s on the phone as not an image", (_, payload) => {
    expect(readShare([payload])?.items).toEqual([{ value: GALLERY, image: false, onPhone: true }]);
  });

  it.each([null, "content://a/1", 7, [image(GALLERY)], { shareType: "image" }, { value: 7 }])(
    "refuses an item that is no payload (%p), never coerced",
    (item) => {
      expect(readShare([item])?.items).toEqual([{ value: "", image: false, onPhone: false }]);
    },
  );

  it("gives two reads of one share the same key, and another share another key", () => {
    const first = readShare([image(GALLERY), image(SECOND)]);
    const again = readShare([image(GALLERY), image(SECOND)]);
    expect(first?.key).toBe(again?.key);
    expect(readShare([image(GALLERY)])?.key).not.toBe(first?.key);
    expect(readShare([image(SECOND), image(GALLERY)])?.key).not.toBe(first?.key);
    expect(readShare([image(GALLERY, "image/png"), image(SECOND)])?.key).not.toBe(first?.key);
  });
});

describe("mayResolve: whether the library may resolve the share (SPEC 3.9: nothing is fetched)", () => {
  const share = (...payloads: unknown[]) => {
    const read = readShare(payloads);
    if (read === null) {
      throw new Error("the test's share is empty");
    }
    return read;
  };

  it("lets image files on the phone be resolved", () => {
    expect(mayResolve(share(image(GALLERY)))).toBe(true);
    expect(mayResolve(share(image(GALLERY), image(SECOND)))).toBe(true);
  });

  it("lets a share of image files and other files on the phone be resolved: all are local", () => {
    expect(
      mayResolve(
        share(image(GALLERY), { value: SECOND, shareType: "video", mimeType: "video/mp4" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["a web address", { value: "https://example.org/", shareType: "url", mimeType: "text/plain" }],
    ["a text", { value: "Kantarell", shareType: "text", mimeType: "text/plain" }],
    ["a web address typed as an image", image("https://example.org/a.jpg")],
    ["an item that is no payload", null],
  ])("never lets a share that is %s be resolved", (_, payload) => {
    expect(mayResolve(share(payload))).toBe(false);
  });

  it.each([
    ["a web address", { value: "https://example.org/", shareType: "url", mimeType: "text/plain" }],
    ["a text", { value: "Kantarell", shareType: "text", mimeType: "text/plain" }],
    ["a web address typed as an image", image("https://example.org/a.jpg")],
  ])(
    "never lets a share that holds %s beside an image file be resolved: the library resolves every item of a share",
    (_, payload) => {
      expect(mayResolve(share(image(GALLERY), payload))).toBe(false);
      expect(mayResolve(share(payload, image(GALLERY)))).toBe(false);
    },
  );

  it("does not have a share of files that are no images resolved: nothing of it is taken", () => {
    expect(mayResolve(share({ value: GALLERY, shareType: "video", mimeType: "video/mp4" }))).toBe(
      false,
    );
  });
});

describe("takeResolved: the library's copies of the share that was read", () => {
  const read = (...payloads: unknown[]) => {
    const share = readShare(payloads);
    if (share === null) {
      throw new Error("the test's share is empty");
    }
    return share;
  };
  /** A resolved payload as the library gives it for a shared file (57.0.26, read). */
  const resolved = (value: string, contentUri: string, mimeType = "image/jpeg") => ({
    value,
    shareType: mimeType.startsWith("image/") ? "image" : "video",
    mimeType,
    contentUri,
    contentType: mimeType.startsWith("image/") ? "image" : "video",
    contentMimeType: mimeType,
    contentSize: 1234,
    originalName: "a.jpg",
  });

  it("takes the copy of each image, in the order shared", () => {
    const share = read(image(GALLERY), image(SECOND));
    expect(
      takeResolved(share, [
        resolved(GALLERY, "file:/cache/expo-sharing/u1/a.jpg"),
        resolved(SECOND, "file:/cache/expo-sharing/u2/b.jpg"),
      ]),
    ).toEqual({
      same: true,
      photos: ["file:/cache/expo-sharing/u1/a.jpg", "file:/cache/expo-sharing/u2/b.jpg"],
      refused: 0,
      others: [],
    });
  });

  it("refuses a file that is no image, counts it, and names its copy for removal", () => {
    const share = read(image(GALLERY), {
      value: SECOND,
      shareType: "video",
      mimeType: "video/mp4",
    });
    expect(
      takeResolved(share, [
        resolved(GALLERY, "file:/cache/expo-sharing/u1/a.jpg"),
        resolved(SECOND, "file:/cache/expo-sharing/u2/b.mp4", "video/mp4"),
      ]),
    ).toEqual({
      same: true,
      photos: ["file:/cache/expo-sharing/u1/a.jpg"],
      refused: 1,
      others: ["file:/cache/expo-sharing/u2/b.mp4"],
    });
  });

  it.each([
    ["no address of a copy", { contentUri: null }],
    ["an empty address", { contentUri: "" }],
    ["an address that is no string", { contentUri: 7 }],
  ])("refuses an image resolved with %s", (_, change) => {
    const share = read(image(GALLERY));
    expect(takeResolved(share, [{ ...resolved(GALLERY, "x"), ...change }])).toEqual({
      same: true,
      photos: [],
      refused: 1,
      others: [],
    });
  });

  it("refuses an image the library resolved as something else, and names its copy for removal", () => {
    const share = read(image(GALLERY));
    expect(
      takeResolved(share, [
        { ...resolved(GALLERY, "file:/cache/expo-sharing/u1/a"), contentType: "website" },
      ]),
    ).toEqual({
      same: true,
      photos: [],
      refused: 1,
      others: ["file:/cache/expo-sharing/u1/a"],
    });
  });

  it.each([
    ["nothing", undefined],
    ["something that is no list", { 0: resolved(GALLERY, "file:/c/a.jpg") }],
    ["fewer items", []],
    ["more items", [resolved(GALLERY, "file:/c/a.jpg"), resolved(SECOND, "file:/c/b.jpg")]],
    ["an item that is no payload", [null]],
  ])("takes nothing when the library gives %s: it is not the share that was read", (_, given) => {
    const taken = takeResolved(read(image(GALLERY)), given);
    expect(taken).toMatchObject({ same: false, photos: [], refused: 1 });
  });

  it("takes nothing of another share than the one read, and names every copy for removal", () => {
    // A share that took the place of the one read, between the read and the resolving.
    const taken = takeResolved(read(image(GALLERY)), [
      resolved(SECOND, "file:/cache/expo-sharing/u9/other.jpg"),
    ]);
    expect(taken).toEqual({
      same: false,
      photos: [],
      refused: 1,
      others: ["file:/cache/expo-sharing/u9/other.jpg"],
    });
  });

  it("takes nothing of a web address the library resolved in place of the share read", () => {
    const taken = takeResolved(read(image(GALLERY)), [
      {
        value: "https://example.org/a.jpg",
        shareType: "url",
        mimeType: "text/plain",
        contentUri: "https://example.org/a.jpg",
        contentType: "image",
      },
    ]);
    expect(taken).toMatchObject({ same: false, photos: [] });
  });
});
