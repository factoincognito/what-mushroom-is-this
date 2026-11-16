/**
 * The New find flow with photos another app shared to the app (docs/SPEC.md 3.9, Shared photos;
 * PBI-2.21): the one photo of "New find", the photos of "Add to an earlier find", and the photos
 * that join a batch open on a screen under the choice.
 */
import type { LocationSource } from "../position/positionTracker";
import type { AnalyseLookupResult } from "../queue/queue";
import type { SharedPhotos } from "../share/shareSession";
import type { NewFind, Position, StoredFind } from "../store/find";
import type { PickResult } from "./devicePicker";
import { INITIAL_VIEW, NewFindFlow, type NewFindTarget, type NewFindView } from "./newFindFlow";

const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" };

const NOW = new Date(Date.UTC(2026, 10, 16, 12, 0, 0));
const copy = (name: string) => `file:///cache/SharedPhotos/${name}.jpg`;
const shared = (names: string[], refused = 0): SharedPhotos => ({
  photos: names.map(copy),
  refused,
});

/** A reading the phone has ready, as expo-location gives it, which a shared photo must never take. */
const FIX = { coords: { latitude: 59.6, longitude: 17.1, accuracy: 5 }, timestamp: NOW.getTime() };

type Options = {
  /** The photos each find holds, by its ID, before the flow starts. */
  finds?: Record<number, number>;
  /** The Save switch's starting value in Settings. */
  saveSetting?: boolean;
  /** The saves that fail, counted from 1 over first photos and later ones alike. */
  failingSaves?: number[];
};

function setUp(target: NewFindTarget, handed: SharedPhotos | undefined, options: Options = {}) {
  const counts = new Map<number, number>(
    Object.entries(options.finds ?? {}).map(([id, count]) => [Number(id), count]),
  );
  const added: NewFind[] = [];
  /** The photos added to a find after its first, as [find ID, photo URI], in order. */
  const photosAdded: [number, string][] = [];
  const completed: number[] = [];
  const positions: [number, Position][] = [];
  const removed: string[] = [];
  const views: NewFindView[] = [];
  /** What the store was doing, in order, to show that one save ends before the next starts. */
  const trace: string[] = [];
  const failing = new Set(options.failingSaves ?? []);
  let saves = 0;
  let watching = 0;
  const save = async (what: string): Promise<void> => {
    saves += 1;
    trace.push(`start ${what}`);
    await Promise.resolve();
    if (failing.has(saves)) {
      trace.push(`fail ${what}`);
      throw new Error("database is locked");
    }
    trace.push(`end ${what}`);
  };
  const take = jest.fn(async (): Promise<PickResult> => ({ kind: "canceled" }));
  const pick = jest.fn(async (): Promise<PickResult> => ({ kind: "canceled" }));
  const pickFile = jest.fn(async (): Promise<PickResult> => ({ kind: "canceled" }));
  const readSaveSetting = jest.fn(async () => options.saveSetting ?? true);
  const locationGet = jest.fn(async () => granted);
  const source: LocationSource = {
    watch: async (onFix) => {
      watching += 1;
      onFix(FIX);
      return () => {
        watching -= 1;
      };
    },
    lastKnown: async () => FIX,
  };
  const flow = new NewFindFlow(
    {
      findLog: async () => ({
        addWithOpenBatch: async (find: NewFind) => {
          await save(find.photoUri);
          added.push(find);
          const id = 100 + added.length;
          counts.set(id, 1);
          return id;
        },
        addPhoto: async (id: number, photoUri: string) => {
          await save(photoUri);
          photosAdded.push([id, photoUri]);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        },
        completeBatch: async (id: number) => {
          completed.push(id);
        },
        getStored: async (id: number) => {
          const count = counts.get(id);
          return count === undefined
            ? null
            : ({
                photos: Array.from({ length: count }, (_, index) => ({
                  uri: `file:///photos/${id}-${index}.jpg`,
                  batch: 1,
                })),
              } as StoredFind);
        },
        setPosition: async (id: number, position: Position) => {
          positions.push([id, position]);
        },
      }),
      camera: { permission: { get: async () => granted, request: async () => granted }, take },
      gallery: { pick },
      files: { pick: pickFile },
      location: { permission: { get: locationGet, request: async () => granted }, source },
      readSaveSetting,
      analyseLookup: async (): Promise<AnalyseLookupResult> => {
        throw new Error("a shared photo is not analysed on the screen");
      },
      removeCopy: (uri) => removed.push(uri),
      appConfig: {
        lastKnownPositionMaxAgeMs: 120_000,
        positionFixWaitMs: 30_000,
        maxPhotosPerFind: 5,
      },
      now: () => NOW,
    },
    (view) => views.push(view),
    target,
    handed,
  );
  const last = () => views.at(-1) ?? INITIAL_VIEW;
  return {
    flow,
    added,
    photosAdded,
    completed,
    positions,
    removed,
    views,
    trace,
    take,
    pick,
    pickFile,
    readSaveSetting,
    locationGet,
    last,
    watching: () => watching,
  };
}

describe('NewFindFlow: the photo of "New find" from a share', () => {
  it("is saved at once as the first photo of a new find, its batch open, and the camera does not open", async () => {
    const { flow, added, take, pick, pickFile, last } = setUp({ kind: "new" }, shared(["a"]));
    await flow.start();
    expect(added.map((find) => find.photoUri)).toEqual([copy("a")]);
    expect(take).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    expect(pickFile).not.toHaveBeenCalled();
    expect(last()).toMatchObject({
      phase: "saved",
      photoCount: 1,
      batchOpen: true,
      canAddMore: true,
      message: null,
      sharedLeftOut: 0,
      sharedRefused: 0,
    });
  });

  it("has Save on whatever its starting value in Settings, and the switch cannot be turned off", async () => {
    const { flow, added, last } = setUp({ kind: "new" }, shared(["a"]), { saveSetting: false });
    await flow.start();
    expect(added).toHaveLength(1);
    expect(last().save).toEqual({ on: true, changeable: false });
    expect(last().held).toBe(0);
  });

  it("gets the time of saving and no position, never the phone's, as nothing is read from the shared file", async () => {
    const { flow, added, positions, last } = setUp({ kind: "new" }, shared(["a"]));
    await flow.start();
    expect(added).toEqual([
      {
        photoUri: copy("a"),
        time: {
          takenAtMs: NOW.getTime(),
          utcOffsetMinutes: -NOW.getTimezoneOffset(),
          source: "saved",
        },
        position: null,
      },
    ]);
    expect(positions).toEqual([]);
    expect(last().location).toBe("granted");
  });

  it("asks for the location permission when the screen opens, as for any new lookup, and stops asking for a position once the find is saved", async () => {
    const { flow, locationGet, watching } = setUp({ kind: "new" }, shared(["a"]));
    await flow.start();
    expect(locationGet).toHaveBeenCalledTimes(1);
    expect(watching()).toBe(0);
  });

  it("goes on as any saved lookup: Analyse completes the batch", async () => {
    const { flow, completed, last } = setUp({ kind: "new" }, shared(["a"]));
    await flow.start();
    await flow.analyse();
    expect(completed).toEqual([101]);
    expect(last()).toMatchObject({ analysed: 101, batchOpen: false });
  });

  it("is kept when its save fails, and Save again saves it", async () => {
    const { flow, added, removed, take, last } = setUp({ kind: "new" }, shared(["a"]), {
      failingSaves: [1],
    });
    await flow.start();
    expect(added).toEqual([]);
    expect(last()).toMatchObject({
      phase: "ready",
      message: "saveFailed",
      canRetrySave: true,
      kept: 1,
      holdsLeave: true,
    });
    expect(removed).toEqual([]);
    await flow.takePhoto();
    expect(take).not.toHaveBeenCalled();
    await flow.retrySave();
    expect(added.map((find) => find.photoUri)).toEqual([copy("a")]);
    expect(last()).toMatchObject({ phase: "saved", canRetrySave: false, kept: 0 });
    flow.close();
    expect(removed).toEqual([]);
  });

  it("has its copy removed when it is discarded after a failed save and the screen is left", async () => {
    const { flow, added, removed } = setUp({ kind: "new" }, shared(["a"]), { failingSaves: [1] });
    await flow.start();
    flow.askToDiscard();
    expect(flow.discardPending()).toBe(true);
    flow.close();
    expect(removed).toEqual([copy("a")]);
    expect(added).toEqual([]);
  });

  it("has its copy removed when the screen is left while it is kept", async () => {
    const { flow, removed } = setUp({ kind: "new" }, shared(["a"]), { failingSaves: [1] });
    await flow.start();
    expect(flow.askToLeave()).toBe(true);
    expect(flow.discardPending()).toBe(true);
    flow.close();
    expect(removed).toEqual([copy("a")]);
  });

  it("never makes a new find of several photos: only the first is taken, the others are left out and their copies removed", async () => {
    const { flow, added, photosAdded, removed, last } = setUp(
      { kind: "new" },
      shared(["a", "b", "c"]),
    );
    await flow.start();
    expect(added.map((find) => find.photoUri)).toEqual([copy("a")]);
    expect(photosAdded).toEqual([]);
    expect(removed).toEqual([copy("b"), copy("c")]);
    expect(last()).toMatchObject({ photoCount: 1, sharedLeftOut: 2 });
  });

  it("saves nothing and opens no camera when no photo was handed over, and says how many were refused", async () => {
    const { flow, added, take, last } = setUp({ kind: "new" }, shared([], 1));
    await flow.start();
    expect(added).toEqual([]);
    expect(take).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ phase: "ready", sharedRefused: 1, batchOpen: false });
  });
});

describe('NewFindFlow: the photos of "Add to an earlier find" from a share', () => {
  it("are saved to the find one after another, in the order shared, as one open batch, and the camera does not open", async () => {
    const { flow, added, photosAdded, trace, take, last } = setUp(
      { kind: "add", findId: 7 },
      shared(["a", "b", "c"]),
      { finds: { 7: 1 } },
    );
    await flow.start();
    expect(photosAdded).toEqual([
      [7, copy("a")],
      [7, copy("b")],
      [7, copy("c")],
    ]);
    expect(trace).toEqual([
      `start ${copy("a")}`,
      `end ${copy("a")}`,
      `start ${copy("b")}`,
      `end ${copy("b")}`,
      `start ${copy("c")}`,
      `end ${copy("c")}`,
    ]);
    expect(added).toEqual([]);
    expect(take).not.toHaveBeenCalled();
    expect(last()).toMatchObject({
      phase: "saved",
      photoCount: 4,
      batchOpen: true,
      canAddMore: true,
      sharedLeftOut: 0,
      sharedRefused: 0,
    });
  });

  it("leave the find its time and position: no permission is asked for and no position set", async () => {
    const { flow, positions, locationGet, readSaveSetting, last } = setUp(
      { kind: "add", findId: 7 },
      shared(["a"]),
      { finds: { 7: 1 } },
    );
    await flow.start();
    expect(locationGet).not.toHaveBeenCalled();
    expect(readSaveSetting).not.toHaveBeenCalled();
    expect(positions).toEqual([]);
    expect(last()).toMatchObject({ location: null, save: null });
  });

  it("are saved while they fit; the app says how many were left out, and removes their copies", async () => {
    const { flow, photosAdded, removed, last } = setUp(
      { kind: "add", findId: 7 },
      shared(["a", "b", "c", "d"]),
      { finds: { 7: 3 } },
    );
    await flow.start();
    expect(photosAdded).toEqual([
      [7, copy("a")],
      [7, copy("b")],
    ]);
    expect(removed).toEqual([copy("c"), copy("d")]);
    expect(last()).toMatchObject({
      phase: "saved",
      photoCount: 5,
      canAddMore: false,
      batchOpen: true,
      sharedLeftOut: 2,
    });
  });

  it("are all left out of a find that is full: nothing is saved and no batch opens", async () => {
    const { flow, photosAdded, removed, take, last } = setUp(
      { kind: "add", findId: 7 },
      shared(["a", "b"]),
      { finds: { 7: 5 } },
    );
    await flow.start();
    expect(photosAdded).toEqual([]);
    expect(removed).toEqual([copy("a"), copy("b")]);
    expect(take).not.toHaveBeenCalled();
    expect(last()).toMatchObject({
      phase: "ready",
      photoCount: 5,
      canAddMore: false,
      batchOpen: false,
      sharedLeftOut: 2,
    });
  });

  it("show how many files the choice refused as no images", async () => {
    const { flow, last } = setUp({ kind: "add", findId: 7 }, shared(["a"], 2), {
      finds: { 7: 1 },
    });
    await flow.start();
    expect(last()).toMatchObject({ photoCount: 2, sharedRefused: 2, sharedLeftOut: 0 });
  });

  it("keep those not yet saved when a save fails, in order, for Save again or Discard", async () => {
    const { flow, photosAdded, removed, take, last } = setUp(
      { kind: "add", findId: 7 },
      shared(["a", "b", "c"]),
      { finds: { 7: 1 }, failingSaves: [2] },
    );
    await flow.start();
    expect(photosAdded).toEqual([[7, copy("a")]]);
    expect(last()).toMatchObject({
      phase: "ready",
      message: "saveFailed",
      canRetrySave: true,
      kept: 2,
      photoCount: 2,
      batchOpen: true,
    });
    await flow.takePhoto();
    expect(take).not.toHaveBeenCalled();
    await flow.retrySave();
    expect(photosAdded).toEqual([
      [7, copy("a")],
      [7, copy("b")],
      [7, copy("c")],
    ]);
    expect(last()).toMatchObject({ phase: "saved", photoCount: 4, kept: 0 });
    flow.close();
    expect(removed).toEqual([]);
  });

  it("have the copies of those discarded after a failed save removed when the screen is left, not those saved", async () => {
    const { flow, removed, completed } = setUp(
      { kind: "add", findId: 7 },
      shared(["a", "b", "c"]),
      { finds: { 7: 1 }, failingSaves: [2] },
    );
    await flow.start();
    flow.askToDiscard();
    flow.discardPending();
    expect(removed).toEqual([]);
    flow.close();
    expect(removed).toEqual([copy("b"), copy("c")]);
    // Leaving the screen completes the batch the first photo opened (Batches).
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toEqual([7]);
  });

  it("are not saved to a find that is gone: their copies are removed, and the screen says the find is unavailable", async () => {
    const { flow, photosAdded, removed, take, last } = setUp(
      { kind: "add", findId: 9 },
      shared(["a", "b"]),
    );
    await flow.start();
    expect(photosAdded).toEqual([]);
    expect(removed).toEqual([copy("a"), copy("b")]);
    expect(take).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ phase: "ready", message: "findUnavailable", canAddMore: false });
  });

  it("have their batch completed by Analyse, as any batch", async () => {
    const { flow, completed, last } = setUp({ kind: "add", findId: 7 }, shared(["a"]), {
      finds: { 7: 1 },
    });
    await flow.start();
    await flow.analyse();
    expect(completed).toEqual([7]);
    expect(last()).toMatchObject({ analysed: 7, batchOpen: false });
  });

  it("drop the counts from the screen when another photo is taken", async () => {
    const { flow, take, last } = setUp({ kind: "add", findId: 7 }, shared(["a", "b", "c"], 1), {
      finds: { 7: 3 },
    });
    await flow.start();
    expect(last()).toMatchObject({ sharedLeftOut: 1, sharedRefused: 1, photoCount: 5 });
    // The find is full, so no photo is taken and the counts stay.
    await flow.takePhoto();
    expect(take).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ sharedLeftOut: 1, sharedRefused: 1 });
  });
});

describe("NewFindFlow: shared photos that join the batch open on the screen", () => {
  /** A flow whose find 7 has a batch open: opened to add photos, with one shared photo saved. */
  async function withOpenBatch(options: Options = {}) {
    const all = setUp({ kind: "add", findId: 7 }, shared(["first"]), {
      finds: { 7: 1 },
      ...options,
    });
    await all.flow.start();
    return all;
  }

  it("can join only the screen's own find, while its batch is open", async () => {
    const { flow } = await withOpenBatch();
    expect(flow.canJoin(7)).toBe(true);
    expect(flow.canJoin(8)).toBe(false);
  });

  it("cannot join before the screen has a batch open", async () => {
    const { flow, take } = setUp({ kind: "add", findId: 7 }, undefined, { finds: { 7: 1 } });
    expect(flow.canJoin(7)).toBe(false);
    await flow.start();
    expect(take).toHaveBeenCalledTimes(1);
    expect(flow.canJoin(7)).toBe(false);
  });

  it("can join a new lookup's find once its first photo is saved", async () => {
    const { flow } = setUp({ kind: "new" }, shared(["a"]));
    expect(flow.canJoin(101)).toBe(false);
    await flow.start();
    expect(flow.canJoin(101)).toBe(true);
  });

  it("cannot join while photos whose save failed are kept, after Analyse, or once the screen is gone", async () => {
    const kept = await withOpenBatch();
    await kept.flow.addShared({ photos: [copy("x")], refused: 0 });
    expect(kept.flow.canJoin(7)).toBe(true);

    const failed = setUp({ kind: "add", findId: 7 }, shared(["a", "b"]), {
      finds: { 7: 1 },
      failingSaves: [2],
    });
    await failed.flow.start();
    expect(failed.last()).toMatchObject({ batchOpen: true, canRetrySave: true });
    expect(failed.flow.canJoin(7)).toBe(false);

    const analysed = await withOpenBatch();
    await analysed.flow.analyse();
    expect(analysed.flow.canJoin(7)).toBe(false);

    const gone = await withOpenBatch();
    gone.flow.close();
    expect(gone.flow.canJoin(7)).toBe(false);
  });

  it("are saved to the find in order, in the batch that is open, with the count kept up", async () => {
    const { flow, photosAdded, completed, take, last } = await withOpenBatch();
    await flow.addShared(shared(["a", "b"]));
    expect(photosAdded).toEqual([
      [7, copy("first")],
      [7, copy("a")],
      [7, copy("b")],
    ]);
    expect(completed).toEqual([]);
    expect(take).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ phase: "saved", photoCount: 4, batchOpen: true });
  });

  it("are left out past the most a find holds, counted, and their copies removed", async () => {
    const { flow, photosAdded, removed, last } = await withOpenBatch({ finds: { 7: 3 } });
    await flow.addShared(shared(["a", "b", "c"], 1));
    expect(photosAdded.map(([, uri]) => uri)).toEqual([copy("first"), copy("a")]);
    expect(removed).toEqual([copy("b"), copy("c")]);
    expect(last()).toMatchObject({
      photoCount: 5,
      canAddMore: false,
      sharedLeftOut: 2,
      sharedRefused: 1,
    });
  });

  it("are not taken by a screen that cannot join: their copies are removed and nothing is saved", async () => {
    const { flow, photosAdded, removed } = await withOpenBatch();
    flow.close();
    await flow.addShared(shared(["a", "b"]));
    expect(photosAdded).toEqual([[7, copy("first")]]);
    expect(removed).toEqual([copy("a"), copy("b")]);
  });
});
