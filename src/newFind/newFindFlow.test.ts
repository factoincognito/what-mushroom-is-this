import type { NewFind } from "../store/find";
import type { PickResult } from "./devicePicker";
import { INITIAL_VIEW, NewFindFlow, type NewFindView } from "./newFindFlow";

const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
const photo = (uri: string): PickResult => ({ kind: "photo", uri, exif: null });

/**
 * A flow with stand-ins: a store whose first `failures` saves fail, a camera and a gallery.
 * `holdNextSave()` holds the next save open until the function it gives is called.
 */
function setUp(failures: number) {
  const added: NewFind[] = [];
  let failing = failures;
  const holds: Promise<void>[] = [];
  const views: NewFindView[] = [];
  const take = jest.fn(async () => photo("file:///cache/first.jpg"));
  const pick = jest.fn(async () => photo("file:///cache/second.jpg"));
  const flow = new NewFindFlow(
    {
      findLog: async () => ({
        add: async (find: NewFind) => {
          const hold = holds.shift();
          if (hold !== undefined) {
            await hold;
          }
          if (failing > 0) {
            failing -= 1;
            throw new Error("database is locked");
          }
          added.push(find);
          return added.length;
        },
      }),
      camera: { permission: { get: async () => granted, request: async () => granted }, take },
      gallery: { pick },
      now: () => new Date(Date.UTC(2026, 10, 9, 12, 0, 0)),
    },
    (view) => views.push(view),
  );
  const holdNextSave = (): (() => void) => {
    let release: () => void = () => undefined;
    holds.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  };
  const last = () => views.at(-1) ?? INITIAL_VIEW;
  /** Lets the flow run until its save is under way (a bounded number of turns). */
  const untilSaving = async (): Promise<void> => {
    for (let i = 0; i < 50 && last().phase !== "saving"; i += 1) {
      await Promise.resolve();
    }
    expect(last()).toMatchObject({ phase: "saving" });
  };
  return { flow, added, views, take, pick, last, holdNextSave, untilSaving };
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
    flow.askToDiscard();
    expect(flow.discardPending()).toBe(true);
    expect(last()).toMatchObject({
      phase: "ready",
      message: null,
      canRetrySave: false,
      confirming: null,
    });
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

describe("NewFindFlow: dropping a kept photo asks first (PBI-1.20)", () => {
  it("Discard the photo asks, and the photo stays kept while the question is open", async () => {
    const { flow, added, last } = setUp(1);
    await flow.start();
    flow.askToDiscard();
    expect(last()).toMatchObject({ confirming: "discard", canRetrySave: true });
    await flow.retrySave();
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
  });

  it("keeps the photo when the user answers Keep, and offers Save again once more", async () => {
    const { flow, added, last } = setUp(1);
    await flow.start();
    flow.askToDiscard();
    flow.keepPhoto();
    expect(last()).toMatchObject({ confirming: null, canRetrySave: true, phase: "ready" });
    await flow.retrySave();
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
  });

  it("drops nothing when discarding is not first asked", async () => {
    const { flow, added, last } = setUp(1);
    await flow.start();
    expect(flow.discardPending()).toBe(false);
    expect(last()).toMatchObject({ canRetrySave: true, confirming: null });
    await flow.retrySave();
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
  });

  it("drops nothing after the user answered Keep", async () => {
    const { flow, last } = setUp(1);
    await flow.start();
    flow.askToDiscard();
    flow.keepPhoto();
    expect(flow.discardPending()).toBe(false);
    expect(last()).toMatchObject({ canRetrySave: true });
  });

  it("asks when the screen is left, and drops the photo only once that is confirmed", async () => {
    const { flow, last } = setUp(1);
    await flow.start();
    expect(flow.askToLeave()).toBe(true);
    expect(last()).toMatchObject({ confirming: "leave", canRetrySave: true });
    expect(flow.discardPending()).toBe(true);
    expect(last()).toMatchObject({ confirming: null, canRetrySave: false });
  });

  it("asks nothing, on discarding or on leaving, when no photo is kept", async () => {
    const { flow, last } = setUp(0);
    await flow.start();
    expect(last()).toMatchObject({ phase: "saved" });
    flow.askToDiscard();
    expect(flow.askToLeave()).toBe(false);
    expect(last()).toMatchObject({ confirming: null });
  });

  it("opens no question while Save again is under way, as the photo is then being saved", async () => {
    const { flow, last } = setUp(1);
    await flow.start();
    const saving = flow.retrySave();
    expect(last()).toMatchObject({ phase: "saving" });
    flow.askToDiscard();
    expect(flow.askToLeave()).toBe(true);
    expect(last()).toMatchObject({ confirming: null });
    await saving;
  });
});

describe("NewFindFlow: leaving while the photo is being saved (PBI-1.20, Clead's fix 1 on #32)", () => {
  it("holds a leave during the first save, and asks nothing once that save succeeds", async () => {
    const { flow, added, last, holdNextSave, untilSaving } = setUp(0);
    const release = holdNextSave();
    const starting = flow.start();
    await untilSaving();
    expect(flow.askToLeave()).toBe(true);
    expect(last()).toMatchObject({ phase: "saving", confirming: null });
    release();
    await starting;
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
    expect(last()).toMatchObject({ phase: "saved", canRetrySave: false, confirming: null });
  });

  it("holds a leave during the first save, and asks it once that save fails", async () => {
    const { flow, added, last, holdNextSave, untilSaving } = setUp(1);
    const release = holdNextSave();
    const starting = flow.start();
    await untilSaving();
    expect(flow.askToLeave()).toBe(true);
    release();
    await starting;
    expect(added).toEqual([]);
    expect(last()).toMatchObject({
      phase: "ready",
      message: "saveFailed",
      canRetrySave: true,
      confirming: "leave",
    });
    expect(flow.discardPending()).toBe(true);
  });

  it("holds a leave during Save again, and asks nothing once that save succeeds", async () => {
    const { flow, added, last, holdNextSave } = setUp(1);
    await flow.start();
    const release = holdNextSave();
    const saving = flow.retrySave();
    expect(flow.askToLeave()).toBe(true);
    expect(last()).toMatchObject({ phase: "saving", confirming: null });
    release();
    await saving;
    expect(added.map((find) => find.photoUri)).toEqual(["file:///cache/first.jpg"]);
    expect(last()).toMatchObject({ phase: "saved", canRetrySave: false, confirming: null });
  });

  it("holds a leave during Save again, and asks it once that save fails", async () => {
    const { flow, added, last, holdNextSave } = setUp(2);
    await flow.start();
    const release = holdNextSave();
    const saving = flow.retrySave();
    expect(flow.askToLeave()).toBe(true);
    release();
    await saving;
    expect(added).toEqual([]);
    expect(last()).toMatchObject({
      phase: "ready",
      message: "saveFailed",
      canRetrySave: true,
      confirming: "leave",
    });
  });

  it("asks a held leave only once: a later failed save, after Stay, asks nothing", async () => {
    const { flow, last, holdNextSave } = setUp(3);
    await flow.start();
    const release = holdNextSave();
    const saving = flow.retrySave();
    flow.askToLeave();
    release();
    await saving;
    expect(last()).toMatchObject({ confirming: "leave" });
    flow.keepPhoto();
    await flow.retrySave();
    expect(last()).toMatchObject({ message: "saveFailed", canRetrySave: true, confirming: null });
  });

  it("asks nothing on a failed save when no leave was held during it", async () => {
    const { flow, last } = setUp(2);
    await flow.start();
    await flow.retrySave();
    expect(last()).toMatchObject({ message: "saveFailed", canRetrySave: true, confirming: null });
  });
});
