import { type BatchScreen, type SharedPhotos, ShareSession, type ShareState } from "./shareSession";

const image = (value: string) => ({ value, shareType: "image", mimeType: "image/jpeg" });
const URL_SHARE = [
  { value: "https://example.org/a.jpg", shareType: "url", mimeType: "text/plain" },
];
const TEXT_SHARE = [{ value: "Kantarell", shareType: "text", mimeType: "text/plain" }];

const A = "content://media/external/images/media/1";
const B = "content://media/external/images/media/2";
const C = "content://media/external/images/media/3";

/** The library's copy of a shared file, as its resolver names it. */
const copyOf = (value: string) => `file:///cache/expo-sharing/${value.slice(-1)}/photo.jpg`;
/** The app's own copy, which `keep` makes of a library copy. */
const keptOf = (copy: string) => copy.replace("/expo-sharing/", "/SharedPhotos/");

const resolvedOf = (payloads: readonly { value: string; mimeType: string }[]) =>
  payloads.map((payload) => ({
    ...payload,
    contentUri: copyOf(payload.value),
    contentType: payload.mimeType.startsWith("image/") ? "image" : "video",
  }));

/**
 * A session over a stand-in for the library: `shared` is what it holds, `clear` empties it, and
 * `resolve` gives the copies of what it holds when it is called, as the library does.
 */
function setUp(initial: unknown = []) {
  const lib = { shared: initial as unknown };
  const states: ShareState[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  /** Library copies that are not there, or cannot be moved or loaded. */
  const missing = new Set<string>();
  const unmovable = new Set<string>();
  const notImages = new Set<string>();
  const source = {
    read: jest.fn(() => lib.shared),
    resolve: jest.fn(async (): Promise<unknown> => resolvedOf(lib.shared as never)),
    clear: jest.fn(() => {
      lib.shared = [];
    }),
  };
  const files = {
    libraryCopy: jest.fn((uri: string) => (missing.has(uri) ? null : uri)),
    keep: jest.fn((uri: string) => {
      if (unmovable.has(uri)) {
        return null;
      }
      kept.push(uri);
      return keptOf(uri);
    }),
    remove: jest.fn((uri: string) => {
      removed.push(uri);
    }),
  };
  const loadsAsImage = jest.fn(async (uri: string) => !notImages.has(uri));
  const session = new ShareSession({ source, files, loadsAsImage }, (state) => states.push(state));
  return {
    lib,
    session,
    source,
    files,
    loadsAsImage,
    states,
    removed,
    kept,
    missing,
    unmovable,
    notImages,
  };
}

/** A promise held open until `release` is called. */
function held<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("ShareSession: reading a share (SPEC 3.9, Shared photos)", () => {
  it.each([[[]], [undefined], [null], ["x"]])(
    "holds no share when the library gives %p, and asks it for nothing more",
    async (nothing) => {
      const { session, source } = setUp(nothing);
      await session.refresh();
      expect(session.getState()).toEqual({ kind: "none" });
      expect(source.resolve).not.toHaveBeenCalled();
      expect(source.clear).not.toHaveBeenCalled();
    },
  );

  it("holds no share when the library cannot be read", async () => {
    const { session, source } = setUp();
    source.read.mockImplementation(() => {
      throw new Error("no native module");
    });
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "none" });
    expect(source.resolve).not.toHaveBeenCalled();
  });

  it("takes one shared photo, as the library's copy of it, and keeps the share with the library", async () => {
    const { session, source, files, states } = setUp([image(A)]);
    await session.refresh();
    expect(states.map((state) => state.kind)).toEqual(["reading", "ready"]);
    expect(session.getState()).toEqual({
      kind: "ready",
      photos: [copyOf(A)],
      refused: 0,
      choosing: false,
    });
    expect(source.resolve).toHaveBeenCalledTimes(1);
    expect(source.clear).not.toHaveBeenCalled();
    expect(files.keep).not.toHaveBeenCalled();
    expect(files.remove).not.toHaveBeenCalled();
  });

  it("takes several shared photos in the order shared", async () => {
    const { session } = setUp([image(B), image(A), image(C)]);
    await session.refresh();
    expect(session.getState()).toMatchObject({
      kind: "ready",
      photos: [copyOf(B), copyOf(A), copyOf(C)],
      refused: 0,
    });
  });

  it.each([
    ["a web address", URL_SHARE],
    ["a text", TEXT_SHARE],
    ["a web address the library typed as an image", [image("https://example.org/a.jpg")]],
  ])(
    "refuses %s without having the library resolve it, so nothing is fetched, and drops it",
    async (_, share) => {
      const { session, source, files, loadsAsImage } = setUp(share);
      await session.refresh();
      expect(session.getState()).toEqual({ kind: "refused", refused: 1 });
      expect(source.resolve).not.toHaveBeenCalled();
      expect(source.clear).toHaveBeenCalledTimes(1);
      expect(files.keep).not.toHaveBeenCalled();
      expect(loadsAsImage).not.toHaveBeenCalled();
    },
  );

  it("refuses a share that holds a web address beside image files whole, without resolving any of it", async () => {
    const { session, source } = setUp([image(A), ...URL_SHARE, image(B)]);
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "refused", refused: 3 });
    expect(source.resolve).not.toHaveBeenCalled();
    expect(source.clear).toHaveBeenCalledTimes(1);
  });

  it("takes the image files of a share and refuses its other files on the phone, counting them", async () => {
    const video = { value: B, shareType: "video", mimeType: "video/mp4" };
    const { session, source } = setUp([image(A), video, image(C)]);
    await session.refresh();
    expect(session.getState()).toMatchObject({
      kind: "ready",
      photos: [copyOf(A), copyOf(C)],
      refused: 1,
    });
    expect(source.resolve).toHaveBeenCalledTimes(1);
  });

  it("refuses a share of files that are no images without resolving it", async () => {
    const { session, source } = setUp([{ value: A, shareType: "video", mimeType: "video/mp4" }]);
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "refused", refused: 1 });
    expect(source.resolve).not.toHaveBeenCalled();
  });

  it("refuses a photo whose copy is not a file in the library's own folder", async () => {
    const { session, missing } = setUp([image(A), image(B)]);
    missing.add(copyOf(A));
    await session.refresh();
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(B)], refused: 1 });
  });

  it("says the share cannot be read when no photo of it has a copy, and drops it", async () => {
    const { session, source, missing } = setUp([image(A)]);
    missing.add(copyOf(A));
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "unreadable" });
    expect(source.clear).toHaveBeenCalledTimes(1);
  });

  it("says the share cannot be read when the library fails to resolve it, and drops it", async () => {
    const { session, source } = setUp([image(A)]);
    source.resolve.mockRejectedValueOnce(new Error("resolver failed"));
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "unreadable" });
    expect(source.clear).toHaveBeenCalledTimes(1);
  });

  it("says the share cannot be read when the library resolves something else, takes none of it and removes the copies it names", async () => {
    const { session, source, removed } = setUp([image(A)]);
    source.resolve.mockResolvedValueOnce([
      { value: "https://example.org/", contentUri: "file:///cache/expo-sharing/x/page.html" },
    ]);
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "unreadable" });
    expect(removed).toEqual(["file:///cache/expo-sharing/x/page.html"]);
    expect(source.clear).toHaveBeenCalledTimes(1);
  });

  it("does not read the same share twice: a second look resolves nothing again", async () => {
    const { session, source, states } = setUp([image(A)]);
    await session.refresh();
    await session.refresh();
    await session.refresh();
    expect(source.resolve).toHaveBeenCalledTimes(1);
    expect(states.map((state) => state.kind)).toEqual(["reading", "ready"]);
  });
});

describe("ShareSession: a second share (SPEC 3.9: it takes the first one's place)", () => {
  it("drops the share held as if cancelled, removing its copies one by one, and reads the new one", async () => {
    const { lib, session, source, removed } = setUp([image(A), image(B)]);
    await session.refresh();
    lib.shared = [image(C)];
    await session.refresh();
    expect(removed).toEqual([copyOf(A), copyOf(B)]);
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(C)] });
    // The library holds the new share: clearing it would drop that one.
    expect(source.clear).not.toHaveBeenCalled();
  });

  it("removes the copies of files it refused too, when the share is replaced", async () => {
    const video = { value: B, shareType: "video", mimeType: "video/mp4" };
    const { lib, session, removed } = setUp([image(A), video]);
    await session.refresh();
    lib.shared = [image(C)];
    await session.refresh();
    expect(removed.sort()).toEqual([copyOf(A), copyOf(B)].sort());
  });

  it("does not have the library resolve a web address that took the share's place while the earlier share's copies were removed", async () => {
    const { lib, session, source, files } = setUp([image(A)]);
    await session.refresh();
    lib.shared = [image(B)];
    files.remove.mockImplementationOnce(() => {
      lib.shared = URL_SHARE;
    });
    await session.refresh();
    expect(source.resolve).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ kind: "refused", refused: 1 });
  });

  it("takes nothing of a share that was replaced while the library resolved it", async () => {
    const { lib, session, source, removed } = setUp([image(A)]);
    const first = held<unknown>();
    source.resolve.mockReturnValueOnce(first.promise);
    const reading = session.refresh();
    lib.shared = [image(B)];
    await session.refresh();
    first.release(resolvedOf([image(A)]));
    await reading;
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(B)] });
    expect(removed).toEqual([copyOf(A)]);
  });

  it("reads the share that took the place of the one read, when the library resolved that one instead", async () => {
    const { lib, session, source, removed } = setUp([image(A)]);
    source.resolve.mockImplementationOnce(async () => {
      // The new share arrives between the read and the resolving: the library resolves it.
      lib.shared = [image(B)];
      return resolvedOf([image(B)]);
    });
    await session.refresh();
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(B)], refused: 0 });
    // The copies the first resolving made of the new share are removed; the second made its own.
    expect(removed).toEqual([copyOf(B)]);
    expect(source.resolve).toHaveBeenCalledTimes(2);
    expect(source.clear).not.toHaveBeenCalled();
  });
});

describe("ShareSession: Cancel, and leaving the choice", () => {
  it("drops the share and the library's copies of it, and holds nothing", async () => {
    const { session, source, files, loadsAsImage } = setUp([image(A), image(B)]);
    await session.refresh();
    session.cancel();
    expect(session.getState()).toEqual({ kind: "none" });
    expect(source.clear).toHaveBeenCalledTimes(1);
    expect(files.keep).not.toHaveBeenCalled();
    expect(loadsAsImage).not.toHaveBeenCalled();
    expect(session.takeHandOff({ kind: "new" })).toBeNull();
    await session.refresh();
    expect(session.getState()).toEqual({ kind: "none" });
  });

  it("lets the same photo be shared again afterwards", async () => {
    const { lib, session, source } = setUp([image(A)]);
    await session.refresh();
    session.cancel();
    lib.shared = [image(A)];
    await session.refresh();
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(A)] });
    expect(source.resolve).toHaveBeenCalledTimes(2);
  });

  it("removes the copies one by one, not through the library, when the library already holds another share", async () => {
    const { lib, session, source, removed } = setUp([image(A)]);
    await session.refresh();
    lib.shared = [image(B)];
    session.cancel();
    expect(removed).toEqual([copyOf(A)]);
    expect(source.clear).not.toHaveBeenCalled();
    await session.refresh();
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(B)] });
  });

  it("removes what the library resolves after the share was cancelled", async () => {
    const { session, source, removed } = setUp([image(A)]);
    const resolving = held<unknown>();
    source.resolve.mockReturnValueOnce(resolving.promise);
    const reading = session.refresh();
    session.cancel();
    resolving.release(resolvedOf([image(A)]));
    await reading;
    expect(session.getState()).toEqual({ kind: "none" });
    expect(removed).toEqual([copyOf(A)]);
  });

  it("leaves the message of a refused share to be closed, with nothing more to drop", async () => {
    const { session, source } = setUp(URL_SHARE);
    await session.refresh();
    session.cancel();
    expect(session.getState()).toEqual({ kind: "none" });
    expect(source.clear).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a share", () => {
    const { session, source, states } = setUp();
    session.cancel();
    expect(source.clear).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it("removes the copies one by one when the library fails to drop the share", async () => {
    const { session, source, removed } = setUp([image(A), image(B)]);
    await session.refresh();
    source.clear.mockImplementationOnce(() => {
      throw new Error("native module failed");
    });
    session.cancel();
    expect(session.getState()).toEqual({ kind: "none" });
    expect(removed).toEqual([copyOf(A), copyOf(B)]);
  });

  it("goes on when a copy cannot be removed: the others are, and the share is dropped", async () => {
    const { lib, session, files, removed } = setUp([image(A), image(B)]);
    await session.refresh();
    files.remove.mockImplementationOnce(() => {
      throw new Error("file is busy");
    });
    lib.shared = [image(C)];
    await session.refresh();
    expect(removed).toEqual([copyOf(B)]);
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(C)] });
  });
});

describe('ShareSession: "New find"', () => {
  it("hands the one photo, as the app's own copy, to the New find screen, and drops the share", async () => {
    const { session, source, kept, removed } = setUp([image(A)]);
    await session.refresh();
    await expect(session.choose({ kind: "new" })).resolves.toBe("open");
    expect(kept).toEqual([copyOf(A)]);
    expect(source.clear).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ kind: "none" });
    expect(session.takeHandOff({ kind: "new" })).toEqual({
      photos: [keptOf(copyOf(A))],
      refused: 0,
    });
    expect(removed).toEqual([]);
  });

  it("hands the photo over once", async () => {
    const { session } = setUp([image(A)]);
    await session.refresh();
    await session.choose({ kind: "new" });
    expect(session.takeHandOff({ kind: "new" })).not.toBeNull();
    expect(session.takeHandOff({ kind: "new" })).toBeNull();
  });

  it("hands it to no screen that adds photos to a find", async () => {
    const { session } = setUp([image(A)]);
    await session.refresh();
    await session.choose({ kind: "new" });
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toBeNull();
    expect(session.takeHandOff({ kind: "add", findId: null })).toBeNull();
    expect(session.takeHandOff({ kind: "new" })).not.toBeNull();
  });

  it("is never made of several photos: the share stays as it was", async () => {
    const { session, source, files, loadsAsImage } = setUp([image(A), image(B)]);
    await session.refresh();
    const before = session.getState();
    await expect(session.choose({ kind: "new" })).resolves.toBe("none");
    expect(session.getState()).toEqual(before);
    expect(files.keep).not.toHaveBeenCalled();
    expect(loadsAsImage).not.toHaveBeenCalled();
    expect(source.clear).not.toHaveBeenCalled();
    expect(session.takeHandOff({ kind: "new" })).toBeNull();
  });

  it("refuses a file that cannot be loaded as an image, saves nothing and says how many were refused", async () => {
    const { session, source, files, notImages } = setUp([image(A)]);
    notImages.add(copyOf(A));
    await session.refresh();
    await expect(session.choose({ kind: "new" })).resolves.toBe("none");
    expect(session.getState()).toEqual({ kind: "refused", refused: 1 });
    expect(files.keep).not.toHaveBeenCalled();
    expect(source.clear).toHaveBeenCalledTimes(1);
    expect(session.takeHandOff({ kind: "new" })).toBeNull();
  });

  it("does nothing without a share that is ready", async () => {
    const { session, source } = setUp();
    await expect(session.choose({ kind: "new" })).resolves.toBe("none");
    expect(source.clear).not.toHaveBeenCalled();
  });
});

describe('ShareSession: "Add to an earlier find"', () => {
  it("hands the photos, in the order shared, to the find's Add photos screen", async () => {
    const { session, source, kept } = setUp([image(B), image(A), image(C)]);
    await session.refresh();
    await expect(session.choose({ kind: "add", findId: 7 })).resolves.toBe("open");
    expect(kept).toEqual([copyOf(B), copyOf(A), copyOf(C)]);
    expect(source.clear).toHaveBeenCalledTimes(1);
    expect(session.takeHandOff({ kind: "new" })).toBeNull();
    expect(session.takeHandOff({ kind: "add", findId: 8 })).toBeNull();
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toEqual({
      photos: [keptOf(copyOf(B)), keptOf(copyOf(A)), keptOf(copyOf(C))],
      refused: 0,
    });
  });

  it("checks each file as an image before it is handed on, refuses those that are not, and counts them", async () => {
    const { session, kept, notImages, loadsAsImage } = setUp([image(A), image(B), image(C)]);
    notImages.add(copyOf(B));
    await session.refresh();
    await session.choose({ kind: "add", findId: 7 });
    expect(loadsAsImage.mock.calls.map(([uri]) => uri)).toEqual([copyOf(A), copyOf(B), copyOf(C)]);
    expect(kept).toEqual([copyOf(A), copyOf(C)]);
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toEqual({
      photos: [keptOf(copyOf(A)), keptOf(copyOf(C))],
      refused: 1,
    });
  });

  it("counts a file whose check throws as refused", async () => {
    const { session, loadsAsImage } = setUp([image(A), image(B)]);
    loadsAsImage.mockRejectedValueOnce(new Error("loader failed"));
    await session.refresh();
    await session.choose({ kind: "add", findId: 7 });
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toEqual({
      photos: [keptOf(copyOf(B))],
      refused: 1,
    });
  });

  it("counts a photo the app cannot make its own copy of as refused", async () => {
    const { session, unmovable } = setUp([image(A), image(B)]);
    unmovable.add(copyOf(A));
    await session.refresh();
    await session.choose({ kind: "add", findId: 7 });
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toEqual({
      photos: [keptOf(copyOf(B))],
      refused: 1,
    });
  });

  it("saves nothing when no file of the share is an image, and says how many were refused", async () => {
    const { session, source, notImages } = setUp([image(A), image(B)]);
    notImages.add(copyOf(A));
    notImages.add(copyOf(B));
    await session.refresh();
    await expect(session.choose({ kind: "add", findId: 7 })).resolves.toBe("none");
    expect(session.getState()).toEqual({ kind: "refused", refused: 2 });
    expect(source.clear).toHaveBeenCalledTimes(1);
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toBeNull();
  });

  it("adds what the choice already refused to that count", async () => {
    const video = { value: B, shareType: "video", mimeType: "video/mp4" };
    const { session, notImages } = setUp([image(A), video]);
    notImages.add(copyOf(A));
    await session.refresh();
    await session.choose({ kind: "add", findId: 7 });
    expect(session.getState()).toEqual({ kind: "refused", refused: 2 });
  });

  it("shows that it is choosing while the files are checked, and takes no second choice meanwhile", async () => {
    const { session, loadsAsImage, states } = setUp([image(A)]);
    await session.refresh();
    const check = held<boolean>();
    loadsAsImage.mockReturnValueOnce(check.promise);
    const first = session.choose({ kind: "add", findId: 7 });
    expect(session.getState()).toMatchObject({ kind: "ready", choosing: true });
    await expect(session.choose({ kind: "add", findId: 8 })).resolves.toBe("none");
    check.release(true);
    await expect(first).resolves.toBe("open");
    expect(states.at(-1)).toEqual({ kind: "none" });
    expect(session.takeHandOff({ kind: "add", findId: 8 })).toBeNull();
    expect(session.takeHandOff({ kind: "add", findId: 7 })).not.toBeNull();
  });

  it("hands nothing over when a new share takes the place of the one being chosen", async () => {
    const { lib, session, loadsAsImage, files, removed } = setUp([image(A)]);
    await session.refresh();
    const check = held<boolean>();
    loadsAsImage.mockReturnValueOnce(check.promise);
    const choosing = session.choose({ kind: "add", findId: 7 });
    lib.shared = [image(B)];
    await session.refresh();
    check.release(true);
    await expect(choosing).resolves.toBe("none");
    expect(files.keep).not.toHaveBeenCalled();
    expect(removed).toEqual([copyOf(A)]);
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toBeNull();
    expect(session.getState()).toMatchObject({ kind: "ready", photos: [copyOf(B)] });
  });

  it("removes the copies of a hand-off no screen took, when the next one is made", async () => {
    const { lib, session, removed } = setUp([image(A)]);
    await session.refresh();
    await session.choose({ kind: "add", findId: 7 });
    lib.shared = [image(B)];
    await session.refresh();
    await session.choose({ kind: "add", findId: 9 });
    expect(removed).toEqual([keptOf(copyOf(A))]);
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toBeNull();
    expect(session.takeHandOff({ kind: "add", findId: 9 })).toEqual({
      photos: [keptOf(copyOf(B))],
      refused: 0,
    });
  });
});

describe("ShareSession: a find whose batch is open on a screen under the choice", () => {
  /** A screen that holds an open batch of the find given. */
  function screenOf(findId: number): BatchScreen & { joined: SharedPhotos[] } {
    const joined: SharedPhotos[] = [];
    return { joined, canJoin: (id) => id === findId, join: (shared) => joined.push(shared) };
  }

  it("gives the photos to that screen, to join its batch, and opens no second one", async () => {
    const { session, source } = setUp([image(A), image(B)]);
    const screen = screenOf(7);
    session.register(screen);
    await session.refresh();
    await expect(session.choose({ kind: "add", findId: 7 })).resolves.toBe("joined");
    expect(screen.joined).toEqual([{ photos: [keptOf(copyOf(A)), keptOf(copyOf(B))], refused: 0 }]);
    expect(session.takeHandOff({ kind: "add", findId: 7 })).toBeNull();
    expect(source.clear).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ kind: "none" });
  });

  it("tells that screen how many files were refused", async () => {
    const { session, notImages } = setUp([image(A), image(B)]);
    notImages.add(copyOf(A));
    const screen = screenOf(7);
    session.register(screen);
    await session.refresh();
    await session.choose({ kind: "add", findId: 7 });
    expect(screen.joined).toEqual([{ photos: [keptOf(copyOf(B))], refused: 1 }]);
  });

  it("opens the find's own Add photos screen when the screen under the choice holds another find", async () => {
    const { session } = setUp([image(A)]);
    const screen = screenOf(8);
    session.register(screen);
    await session.refresh();
    await expect(session.choose({ kind: "add", findId: 7 })).resolves.toBe("open");
    expect(screen.joined).toEqual([]);
    expect(session.takeHandOff({ kind: "add", findId: 7 })).not.toBeNull();
  });

  it("asks no screen that has gone", async () => {
    const { session } = setUp([image(A)]);
    const screen = screenOf(7);
    const unregister = session.register(screen);
    unregister();
    await session.refresh();
    await expect(session.choose({ kind: "add", findId: 7 })).resolves.toBe("open");
    expect(screen.joined).toEqual([]);
  });

  it("gives a new find's photo to no screen under the choice", async () => {
    const { session } = setUp([image(A)]);
    const screen = screenOf(7);
    session.register(screen);
    await session.refresh();
    await expect(session.choose({ kind: "new" })).resolves.toBe("open");
    expect(screen.joined).toEqual([]);
  });
});
