import type { NewFind } from "../store/find";
import type { PickResult } from "./devicePicker";
import { INITIAL_VIEW, NewFindFlow, type NewFindView } from "./newFindFlow";

const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
const denied = { status: "denied", granted: false, canAskAgain: false, expires: "never" };
const photo = (uri: string): PickResult => ({ kind: "photo", uri, exif: null });

/** A flow with stand-ins: a store whose first `failures` saves fail, a camera and a gallery. */
function setUp(failures: number) {
  const added: NewFind[] = [];
  let failing = failures;
  const views: NewFindView[] = [];
  const take = jest.fn(async () => photo("file:///cache/first.jpg"));
  const pick = jest.fn(async () => photo("file:///cache/second.jpg"));
  const flow = new NewFindFlow(
    {
      findLog: async () => ({
        add: async (find: NewFind) => {
          if (failing > 0) {
            failing -= 1;
            throw new Error("database is locked");
          }
          added.push(find);
          return added.length;
        },
        setPosition: async () => undefined,
      }),
      camera: { permission: { get: async () => granted, request: async () => granted }, take },
      gallery: { pick },
      // No location permission: these tests are of the photo, not the position.
      location: {
        permission: { get: async () => denied, request: async () => denied },
        source: { watch: async () => () => undefined, lastKnown: async () => null },
      },
      appConfig: { lastKnownPositionMaxAgeMs: 120_000, positionFixWaitMs: 30_000 },
      now: () => new Date(Date.UTC(2026, 10, 9, 12, 0, 0)),
    },
    (view) => views.push(view),
  );
  return { flow, added, views, take, pick, last: () => views.at(-1) ?? INITIAL_VIEW };
}

describe("NewFindFlow: a photo whose save failed", () => {
  it("is kept: neither the camera nor the gallery opens for another until it is saved or discarded", async () => {
    const { flow, take, pick, last } = setUp(1);
    await flow.start();
    expect(last()).toMatchObject({ phase: "ready", message: "saveFailed", canRetrySave: true });
    await flow.takePhoto();
    await flow.pickFromGallery();
    expect(take).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ canRetrySave: true });
  });

  it("is the photo Save again saves", async () => {
    const { flow, added, last } = setUp(1);
    await flow.start();
    await flow.retrySave();
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
    expect(last()).toMatchObject({ phase: "saved", canRetrySave: false });
  });

  it("is dropped only when discarded, after which a new photo can be taken and saved", async () => {
    const { flow, added, pick, last } = setUp(1);
    await flow.start();
    flow.discardPending();
    expect(last()).toMatchObject({ phase: "ready", message: null, canRetrySave: false });
    await flow.retrySave();
    expect(added).toEqual([]);
    await flow.pickFromGallery();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/second.jpg"]);
  });

  it("stays kept when Save again fails too", async () => {
    const { flow, added, last } = setUp(2);
    await flow.start();
    await flow.retrySave();
    expect(added).toEqual([]);
    expect(last()).toMatchObject({ message: "saveFailed", canRetrySave: true });
    await flow.retrySave();
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
  });
});
