import type { Answer } from "../analysis/answer";
import type { LocationSource } from "../position/positionTracker";
import type { AnalyseLookupResult } from "../queue/queue";
import type { NewFind, Position } from "../store/find";
import type { PickResult } from "./devicePicker";
import { INITIAL_VIEW, NewFindFlow, type NewFindTarget, type NewFindView } from "./newFindFlow";
import { phoneTimeNow } from "./saveFind";

const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
const denied = { status: "denied", granted: false, canAskAgain: false, expires: "never" };
const photo = (uri: string): PickResult => ({ kind: "photo", uri, exif: null });

/** The find log's batch methods, which these tests of the first photo do not reach. */
const UNUSED_BATCH = {
  addPhoto: async () => undefined,
  completeBatch: async () => undefined,
  getStored: async () => null,
};

/**
 * The parts of a photo lookup these tests of a saved lookup do not reach: Save is on when the
 * lookup starts, as Settings has it by default (docs/SPEC.md 3.9; PBI-2.13).
 */
const SAVED_LOOKUP = {
  readSaveSetting: async () => true,
  analyseLookup: async (): Promise<AnalyseLookupResult> => {
    throw new Error("a saved lookup is not analysed on the screen");
  },
  removeCopy: () => undefined,
};

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
        // A photo lookup's find is saved with its batch open (PBI-2.5).
        addWithOpenBatch: async (find: NewFind) => {
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
        ...UNUSED_BATCH,
        setPosition: async () => undefined,
      }),
      camera: { permission: { get: async () => granted, request: async () => granted }, take },
      gallery: { pick },
      ...SAVED_LOOKUP,
      // No location permission: these tests are of the photo, not the position.
      location: {
        permission: { get: async () => denied, request: async () => denied },
        source: { watch: async () => () => undefined, lastKnown: async () => null },
      },
      appConfig: {
        lastKnownPositionMaxAgeMs: 120_000,
        positionFixWaitMs: 30_000,
        maxPhotosPerFind: 5,
      },
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

const NOW_MS = Date.UTC(2026, 10, 9, 12, 0, 0);

/** Stands in for the phone's location service: fixes are sent by the test. */
class FakeLocation implements LocationSource {
  onFix: ((fix: unknown) => void) | null = null;
  stops = 0;
  lastKnownAsked: number[] = [];
  lastKnownReply: unknown = null;

  async watch(onFix: (fix: unknown) => void): Promise<() => void> {
    this.onFix = onFix;
    return () => {
      this.stops += 1;
      this.onFix = null;
    };
  }

  async lastKnown(maxAgeMs: number): Promise<unknown> {
    this.lastKnownAsked.push(maxAgeMs);
    return this.lastKnownReply;
  }

  send(latitude: number, longitude: number, accuracy: number): void {
    this.onFix?.({ coords: { latitude, longitude, accuracy }, timestamp: NOW_MS });
  }
}

/**
 * A flow with the location permission, a camera that gives a photo, and a store that opens only
 * when the test lets it (`openLog`), whose saves fail while `addFails` is set.
 */
function setUpWithLocation(limits: {
  lastKnownPositionMaxAgeMs: number;
  positionFixWaitMs: number;
}) {
  const location = new FakeLocation();
  const added: NewFind[] = [];
  const positions: [number, Position][] = [];
  const state = { addFails: false, logAsked: false };
  let openLog: () => void = () => undefined;
  const logOpen = new Promise<void>((resolve) => {
    openLog = resolve;
  });
  let view: NewFindView = INITIAL_VIEW;
  const flow = new NewFindFlow(
    {
      findLog: async () => {
        state.logAsked = true;
        await logOpen;
        return {
          ...UNUSED_BATCH,
          addWithOpenBatch: async (find: NewFind) => {
            if (state.addFails) {
              throw new Error("database is locked");
            }
            added.push(find);
            return added.length;
          },
          setPosition: async (id: number, position: Position) => {
            positions.push([id, position]);
          },
        };
      },
      camera: {
        permission: { get: async () => granted, request: async () => granted },
        take: async () => photo("file:///cache/first.jpg"),
      },
      gallery: { pick: async () => photo("file:///cache/second.jpg") },
      ...SAVED_LOOKUP,
      location: {
        permission: { get: async () => granted, request: async () => granted },
        source: location,
      },
      appConfig: { ...limits, maxPhotosPerFind: 5 },
      now: () => new Date(NOW_MS),
    },
    (shown) => {
      view = shown;
    },
  );
  return { flow, location, added, positions, state, openLog, last: () => view };
}

/** Lets the promises queued so far run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  jest.useRealTimers();
});

describe("NewFindFlow: the position of a camera find", () => {
  it("passes both position limits from the config to the tracker", async () => {
    jest.useFakeTimers();
    const { flow, location, added, positions, openLog } = setUpWithLocation({
      lastKnownPositionMaxAgeMs: 45_000,
      positionFixWaitMs: 7_000,
    });
    location.lastKnownReply = {
      coords: { latitude: 59.5, longitude: 17.5, accuracy: 40 },
      timestamp: NOW_MS - 45_001,
    };
    openLog();
    await flow.start();
    expect(location.lastKnownAsked).toEqual([45_000]);
    expect(added[0]?.position).toBeNull();
    jest.advanceTimersByTime(6_999);
    expect(location.stops).toBe(0);
    jest.advanceTimersByTime(1);
    expect(location.stops).toBe(1);
    location.send(59.66, 17.1, 9);
    await settle();
    expect(positions).toEqual([]);
  });

  it("still gets its later fix when the screen closes while it is being saved", async () => {
    const { flow, location, positions, state, openLog } = setUpWithLocation({
      lastKnownPositionMaxAgeMs: 120_000,
      positionFixWaitMs: 30_000,
    });
    const started = flow.start();
    await settle();
    expect(state.logAsked).toBe(true);
    flow.close();
    expect(location.stops).toBe(0);
    openLog();
    await started;
    expect(location.stops).toBe(0);
    location.send(59.66, 17.1, 9);
    await settle();
    expect(positions).toEqual([
      [1, { latitude: 59.66, longitude: 17.1, accuracyM: 9, source: "fix" }],
    ]);
    expect(location.stops).toBe(1);
  });

  it("stops asking for the position when the screen closes while a save runs that then fails", async () => {
    const { flow, location, added, state, openLog } = setUpWithLocation({
      lastKnownPositionMaxAgeMs: 120_000,
      positionFixWaitMs: 30_000,
    });
    state.addFails = true;
    const started = flow.start();
    await settle();
    flow.close();
    openLog();
    await started;
    expect(added).toEqual([]);
    expect(location.stops).toBe(1);
  });

  it("keeps asking for the position when a save fails while the screen is open, for Save again", async () => {
    const { flow, location, added, state, openLog } = setUpWithLocation({
      lastKnownPositionMaxAgeMs: 120_000,
      positionFixWaitMs: 30_000,
    });
    state.addFails = true;
    openLog();
    await flow.start();
    expect(location.stops).toBe(0);
    location.send(59.66, 17.1, 9);
    state.addFails = false;
    await flow.retrySave();
    expect(added[0]?.position).toEqual({
      latitude: 59.66,
      longitude: 17.1,
      accuracyM: 9,
      source: "fix",
    });
    expect(location.stops).toBe(1);
  });

  it("still gets its later fix when the screen is left during the save, as the leave waits for it (PBI-1.20)", async () => {
    const { flow, location, positions, openLog, last } = setUpWithLocation({
      lastKnownPositionMaxAgeMs: 120_000,
      positionFixWaitMs: 30_000,
    });
    const started = flow.start();
    await settle();
    expect(last()).toMatchObject({ phase: "saving" });
    expect(flow.askToLeave()).toBe(true);
    openLog();
    await started;
    expect(last()).toMatchObject({ phase: "saved", confirming: null });
    // The held leave goes ahead once the save has succeeded, and the screen closes.
    flow.close();
    expect(location.stops).toBe(0);
    location.send(59.66, 17.1, 9);
    await settle();
    expect(positions).toEqual([
      [1, { latitude: 59.66, longitude: 17.1, accuracyM: 9, source: "fix" }],
    ]);
    expect(location.stops).toBe(1);
  });

  it("stops asking for the position when a leave held during a failed save is confirmed (PBI-1.20)", async () => {
    const { flow, location, added, state, openLog, last } = setUpWithLocation({
      lastKnownPositionMaxAgeMs: 120_000,
      positionFixWaitMs: 30_000,
    });
    state.addFails = true;
    const started = flow.start();
    await settle();
    expect(flow.askToLeave()).toBe(true);
    openLog();
    await started;
    expect(last()).toMatchObject({ canRetrySave: true, confirming: "leave" });
    expect(location.stops).toBe(0);
    expect(flow.discardPending()).toBe(true);
    flow.close();
    expect(added).toEqual([]);
    expect(location.stops).toBe(1);
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

const MATCH: Answer = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};

const GALLERY_EXIF = {
  DateTimeOriginal: "2026:09:14 15:42:07",
  OffsetTimeOriginal: "+02:00",
  GPSLatitude: 59.7,
  GPSLatitudeRef: "N",
  GPSLongitude: 17.2,
  GPSLongitudeRef: "E",
};

/**
 * A photo lookup (docs/SPEC.md 3.9, Lookups; PBI-2.13) with Save off at its start unless
 * `saveAtStart` says otherwise: the camera gives `camera-1.jpg`, `camera-2.jpg` and so on, the
 * gallery `gallery-1.jpg` and so on with `GALLERY_EXIF`, the clock moves on a minute at each
 * reading, and the find log records what it is asked. `failNext` makes the log's next saves fail;
 * `answers` are what the queue's analysis of an unsaved lookup gives, in turn.
 */
function setUpLookup(
  options: {
    saveAtStart?: boolean;
    location?: FakeLocation;
    target?: NewFindTarget;
    storedPhotos?: number;
    /** How many times the camera is closed without a photo before it gives one. */
    cancelCamera?: number;
  } = {},
) {
  const location = options.location;
  let cancels = options.cancelCamera ?? 0;
  /** The Save setting's reading and the camera's opening, in order. */
  const events: string[] = [];
  const log = {
    added: [] as NewFind[],
    photosAdded: [] as [number, string][],
    completed: [] as number[],
    positions: [] as [number, Position][],
    failNext: [] as boolean[],
  };
  const analysed: string[][] = [];
  const answers: (AnalyseLookupResult | Error)[] = [];
  let releaseAnalysis: (() => void) | null = null;
  const holdAnalysis = { on: false };
  const removed: string[] = [];
  let cameraShots = 0;
  let galleryPicks = 0;
  let minutes = 0;
  let view: NewFindView = INITIAL_VIEW;
  const fails = () => log.failNext.shift() === true;
  const flow = new NewFindFlow(
    {
      findLog: async () => ({
        addWithOpenBatch: async (find: NewFind) => {
          if (fails()) {
            throw new Error("database is locked");
          }
          log.added.push(find);
          return log.added.length;
        },
        addPhoto: async (id: number, uri: string) => {
          if (fails()) {
            throw new Error("database is locked");
          }
          log.photosAdded.push([id, uri]);
        },
        completeBatch: async (id: number) => {
          log.completed.push(id);
        },
        getStored: async (id: number) =>
          options.storedPhotos === undefined
            ? null
            : ({
                id,
                photos: Array.from({ length: options.storedPhotos }, (_, i) => ({
                  uri: `file:///photos/${i}.jpg`,
                  batch: 1,
                })),
              } as never),
        setPosition: async (id: number, position: Position) => {
          log.positions.push([id, position]);
        },
      }),
      camera: {
        permission: { get: async () => granted, request: async () => granted },
        take: async (): Promise<PickResult> => {
          events.push("camera");
          if (cancels > 0) {
            cancels -= 1;
            return { kind: "canceled" };
          }
          cameraShots += 1;
          return photo(`file:///cache/camera-${cameraShots}.jpg`);
        },
      },
      gallery: {
        pick: async () => {
          galleryPicks += 1;
          return {
            kind: "photo",
            uri: `file:///cache/gallery-${galleryPicks}.jpg`,
            exif: GALLERY_EXIF,
          };
        },
      },
      location:
        location === undefined
          ? {
              permission: { get: async () => denied, request: async () => denied },
              source: { watch: async () => () => undefined, lastKnown: async () => null },
            }
          : {
              permission: { get: async () => granted, request: async () => granted },
              source: location,
            },
      readSaveSetting: async () => {
        events.push("setting");
        return options.saveAtStart ?? false;
      },
      analyseLookup: async (uris) => {
        analysed.push([...uris]);
        if (holdAnalysis.on) {
          await new Promise<void>((resolve) => {
            releaseAnalysis = resolve;
          });
        }
        const answer = answers.shift() ?? { ok: true, answer: MATCH, model: "m" };
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      },
      removeCopy: (uri) => {
        removed.push(uri);
      },
      appConfig: {
        lastKnownPositionMaxAgeMs: 120_000,
        positionFixWaitMs: 30_000,
        maxPhotosPerFind: 5,
      },
      now: () => {
        minutes += 1;
        return new Date(NOW_MS + minutes * 60_000);
      },
    },
    (shown) => {
      view = shown;
    },
    options.target,
  );
  return {
    flow,
    log,
    events,
    analysed,
    answers,
    removed,
    last: () => view,
    holdAnalysis,
    release: () => releaseAnalysis?.(),
  };
}

describe("a photo lookup's Save switch (SPEC 3.9, Lookups; PBI-2.13)", () => {
  it("starts on when Settings has it on: the first photo is saved as a find, and the switch can then not be turned off", async () => {
    const { flow, log, last } = setUpLookup({ saveAtStart: true });
    await flow.start();
    expect(log.added.map((find) => find.photoUri)).toEqual(["file:///cache/camera-1.jpg"]);
    expect(last()).toMatchObject({ phase: "saved", save: { on: true, changeable: false } });
    await flow.setSave(false);
    expect(last()).toMatchObject({ save: { on: true, changeable: false } });
    await flow.takePhoto();
    expect(log.photosAdded).toEqual([[1, "file:///cache/camera-2.jpg"]]);
  });

  it("starts off when Settings has it off: the photos are held on the screen and nothing is saved", async () => {
    const { flow, log, last } = setUpLookup();
    await flow.start();
    await flow.pickFromGallery();
    expect(log.added).toEqual([]);
    expect(log.photosAdded).toEqual([]);
    expect(last()).toMatchObject({
      phase: "ready",
      held: 2,
      photoCount: 0,
      batchOpen: false,
      save: { on: false, changeable: true },
      holdsLeave: true,
    });
  });

  it("reads its starting value before the camera opens", async () => {
    const { flow, events } = setUpLookup();
    await flow.start();
    expect(events).toEqual(["setting", "camera"]);
  });

  it("is not there when photos are added to a find from its screen: they are saved to it", async () => {
    const { flow, events, log, last } = setUpLookup({
      target: { kind: "add", findId: 7 },
      storedPhotos: 1,
    });
    await flow.start();
    expect(events).toEqual(["camera"]);
    expect(last()).toMatchObject({ save: null, held: 0 });
    expect(log.photosAdded).toEqual([[7, "file:///cache/camera-1.jpg"]]);
  });

  it("holds up to the most photos a find holds, then offers no more", async () => {
    const { flow, last } = setUpLookup();
    await flow.start();
    for (let i = 0; i < 6; i += 1) {
      await flow.takePhoto();
    }
    expect(last()).toMatchObject({ held: 5, canAddMore: false });
  });

  it("can be turned on and off while the lookup holds no photo; a photo then follows the switch", async () => {
    const { flow, log, last } = setUpLookup({ cancelCamera: 1 });
    await flow.start();
    expect(last()).toMatchObject({ held: 0, save: { on: false, changeable: true } });
    await flow.setSave(true);
    await flow.setSave(false);
    await flow.setSave(true);
    expect(log.added).toEqual([]);
    expect(last()).toMatchObject({ save: { on: true, changeable: true } });
    await flow.takePhoto();
    expect(log.added.map((find) => find.photoUri)).toEqual(["file:///cache/camera-1.jpg"]);
    expect(last()).toMatchObject({ held: 0, save: { on: true, changeable: false } });
  });
});

describe("an unsaved photo lookup, analysed on the screen (SPEC 3.9, Lookups; PBI-2.13)", () => {
  it("sends all its photos, in the order taken, and shows the answer, storing nothing", async () => {
    const { flow, log, analysed, last } = setUpLookup();
    await flow.start();
    await flow.pickFromGallery();
    await flow.analyse();
    expect(analysed).toEqual([["file:///cache/camera-1.jpg", "file:///cache/gallery-1.jpg"]]);
    expect(last()).toMatchObject({
      phase: "ready",
      outcome: { kind: "answer", answer: MATCH },
      offerSave: false,
      held: 2,
      analysed: null,
    });
    expect(log.added).toEqual([]);
    expect(log.completed).toEqual([]);
    await flow.analyse();
    expect(analysed).toHaveLength(2);
  });

  it("does nothing on Analyse while it holds no photo", async () => {
    const { flow, analysed, last } = setUpLookup({ cancelCamera: 1 });
    await flow.start();
    await flow.analyse();
    expect(analysed).toEqual([]);
    expect(last()).toMatchObject({ phase: "ready", outcome: null });
  });

  it.each([
    ["a pause", { kind: "paused", cause: "network" }, true],
    ["a stop for a missing key", { kind: "stopped", stop: { reason: "no-key" } }, true],
    ["a stop for a refused key", { kind: "stopped", stop: { reason: "key-refused" } }, false],
    [
      "a failure",
      { kind: "find-failed", failure: { cause: "request", detail: "request-wrong (status 400)" } },
      false,
    ],
  ] as const)(
    "after %s shows the notice, offering to turn Save on only where a find would wait",
    async (_name, notice, offers) => {
      const { flow, answers, last } = setUpLookup();
      answers.push({ ok: false, notice });
      await flow.start();
      await flow.analyse();
      expect(last()).toMatchObject({
        phase: "ready",
        outcome: { kind: "notice", notice },
        offerSave: offers,
        held: 1,
      });
    },
  );

  it("says so when the analysis could not run for an error in the app, keeping the photos", async () => {
    const { flow, answers, last } = setUpLookup();
    answers.push(new Error("ENOSPC"));
    await flow.start();
    await flow.analyse();
    expect(last()).toMatchObject({ phase: "ready", outcome: { kind: "error" }, held: 1 });
  });

  it("takes no photo, and the switch cannot change, while the analysis runs", async () => {
    const { flow, holdAnalysis, release, last, log } = setUpLookup();
    await flow.start();
    holdAnalysis.on = true;
    const analysing = flow.analyse();
    await settle();
    expect(last()).toMatchObject({ phase: "analysing", save: { on: false, changeable: false } });
    await flow.takePhoto();
    await flow.pickFromGallery();
    await flow.setSave(true);
    release();
    await analysing;
    expect(last()).toMatchObject({ held: 1, save: { on: false, changeable: true } });
    expect(log.added).toEqual([]);
  });

  it("drops the answer once another photo is added, as it is no longer the lookup's", async () => {
    const { flow, last } = setUpLookup();
    await flow.start();
    await flow.analyse();
    expect(last().outcome).not.toBeNull();
    await flow.takePhoto();
    expect(last()).toMatchObject({ outcome: null, held: 2 });
  });
});

describe("turning Save on during an unsaved photo lookup (SPEC 3.9, Lookups; PBI-2.13)", () => {
  it("saves it as one find with its photos, in one open batch, with the first photo's time and position", async () => {
    const location = new FakeLocation();
    const { flow, log, last } = setUpLookup({ location, cancelCamera: 1 });
    await flow.start();
    location.send(59.66, 17.1, 9);
    await flow.takePhoto();
    location.send(59.0, 17.0, 3);
    await flow.takePhoto();
    await flow.pickFromGallery();
    // The first photo was taken at the first reading of the clock, before the save.
    await flow.setSave(true);
    expect(log.added).toEqual([
      {
        photoUri: "file:///cache/camera-1.jpg",
        time: phoneTimeNow(new Date(NOW_MS + 60_000)),
        position: { latitude: 59.66, longitude: 17.1, accuracyM: 9, source: "fix" },
      },
    ]);
    expect(log.photosAdded).toEqual([
      [1, "file:///cache/camera-2.jpg"],
      [1, "file:///cache/gallery-1.jpg"],
    ]);
    expect(log.completed).toEqual([]);
    expect(last()).toMatchObject({
      phase: "saved",
      held: 0,
      photoCount: 3,
      batchOpen: true,
      save: { on: true, changeable: false },
      holdsLeave: false,
    });
  });

  it("then completes the batch on Analyse, and goes to the find", async () => {
    const { flow, log, analysed, last } = setUpLookup();
    await flow.start();
    await flow.turnSaveOn();
    await flow.analyse();
    expect(log.completed).toEqual([1]);
    expect(analysed).toEqual([]);
    expect(last()).toMatchObject({ analysed: 1 });
  });

  it("keeps a gallery photo's own time and position when it was the first", async () => {
    const location = new FakeLocation();
    const { flow, log } = setUpLookup({ cancelCamera: 1, location });
    await flow.start();
    // The camera was closed without a photo; the first photo comes from the gallery.
    await flow.pickFromGallery();
    location.send(59.66, 17.1, 9);
    await flow.takePhoto();
    await flow.setSave(true);
    expect(log.added).toEqual([
      {
        photoUri: "file:///cache/gallery-1.jpg",
        time: { takenAtMs: Date.UTC(2026, 8, 14, 13, 42, 7), utcOffsetMinutes: 120, source: "photo" },
        position: { latitude: 59.7, longitude: 17.2, accuracyM: null, source: "photo" },
      },
    ]);
    expect(log.photosAdded).toEqual([[1, "file:///cache/camera-1.jpg"]]);
    expect(log.positions).toEqual([]);
  });

  it("keeps the first fix that came after the first photo, while the lookup was unsaved", async () => {
    const location = new FakeLocation();
    const { flow, log } = setUpLookup({ location });
    await flow.start();
    location.send(59.66, 17.1, 9);
    await settle();
    await flow.setSave(true);
    expect(log.added[0]?.position).toEqual({
      latitude: 59.66,
      longitude: 17.1,
      accuracyM: 9,
      source: "fix",
    });
  });

  it("adds the first photo's later fix to the find when it comes after Save was turned on, also once the screen is gone", async () => {
    const location = new FakeLocation();
    const { flow, log } = setUpLookup({ location });
    await flow.start();
    await flow.setSave(true);
    expect(log.added[0]?.position).toBeNull();
    flow.close();
    expect(location.stops).toBe(0);
    location.send(59.66, 17.1, 9);
    await settle();
    expect(log.positions).toEqual([
      [1, { latitude: 59.66, longitude: 17.1, accuracyM: 9, source: "fix" }],
    ]);
    expect(location.stops).toBe(1);
  });

  it("keeps the photos when the find cannot be saved, with Save again, which saves them with the first photo's time", async () => {
    const { flow, log, last } = setUpLookup();
    await flow.start();
    await flow.takePhoto();
    log.failNext.push(true);
    await flow.setSave(true);
    expect(log.added).toEqual([]);
    expect(last()).toMatchObject({
      phase: "ready",
      message: "saveFailed",
      canRetrySave: true,
      kept: 2,
      held: 0,
      save: { on: true, changeable: false },
      holdsLeave: true,
    });
    await flow.retrySave();
    expect(log.added).toEqual([
      expect.objectContaining({
        photoUri: "file:///cache/camera-1.jpg",
        time: phoneTimeNow(new Date(NOW_MS + 60_000)),
      }),
    ]);
    expect(log.photosAdded).toEqual([[1, "file:///cache/camera-2.jpg"]]);
    expect(last()).toMatchObject({ phase: "saved", kept: 0, photoCount: 2 });
  });

  it("keeps the photos not yet saved when a later one fails, and Save again adds them to the same find", async () => {
    const { flow, log, last } = setUpLookup();
    await flow.start();
    await flow.takePhoto();
    await flow.takePhoto();
    log.failNext.push(false, false, true);
    await flow.setSave(true);
    expect(log.added).toHaveLength(1);
    expect(log.photosAdded).toEqual([[1, "file:///cache/camera-2.jpg"]]);
    expect(last()).toMatchObject({ canRetrySave: true, kept: 1, photoCount: 2 });
    await flow.retrySave();
    expect(log.added).toHaveLength(1);
    expect(log.photosAdded).toEqual([
      [1, "file:///cache/camera-2.jpg"],
      [1, "file:///cache/camera-3.jpg"],
    ]);
    expect(last()).toMatchObject({ phase: "saved", kept: 0, photoCount: 3 });
  });

  it("drops the kept photos only after the question, after which the switch can change again", async () => {
    const { flow, log, last } = setUpLookup();
    await flow.start();
    log.failNext.push(true);
    await flow.setSave(true);
    flow.askToDiscard();
    expect(flow.discardPending()).toBe(true);
    expect(last()).toMatchObject({
      kept: 0,
      held: 0,
      canRetrySave: false,
      save: { on: true, changeable: true },
    });
  });
});

describe("leaving an unsaved photo lookup (SPEC 3.9, Lookups; PBI-2.13)", () => {
  it("asks first, on the screen; Stay keeps it", async () => {
    const { flow, last } = setUpLookup();
    await flow.start();
    expect(flow.askToLeave()).toBe(true);
    expect(last()).toMatchObject({ confirming: "leaveLookup", holdsLeave: true });
    flow.keepPhoto();
    expect(last()).toMatchObject({ confirming: null, held: 1, holdsLeave: true });
  });

  it("drops it once confirmed, and removes the app's copies of its photos and stops asking for a position when the screen is gone", async () => {
    const location = new FakeLocation();
    const { flow, log, removed, last } = setUpLookup({ location });
    await flow.start();
    await flow.pickFromGallery();
    flow.askToLeave();
    expect(removed).toEqual([]);
    expect(flow.discardPending()).toBe(true);
    expect(last()).toMatchObject({ confirming: null, holdsLeave: false });
    flow.close();
    expect(removed).toEqual(["file:///cache/camera-1.jpg", "file:///cache/gallery-1.jpg"]);
    expect(location.stops).toBe(1);
    expect(log.added).toEqual([]);
  });

  it("asks nothing, and removes nothing, when it holds no photo", async () => {
    const { flow, removed } = setUpLookup();
    expect(flow.askToLeave()).toBe(false);
    flow.close();
    expect(removed).toEqual([]);
  });

  it("asks while the analysis runs too, and shows nothing of it once the screen is gone", async () => {
    const { flow, holdAnalysis, release, removed, last } = setUpLookup();
    await flow.start();
    holdAnalysis.on = true;
    const analysing = flow.analyse();
    await settle();
    expect(flow.askToLeave()).toBe(true);
    expect(flow.discardPending()).toBe(true);
    flow.close();
    const shown = last();
    release();
    await analysing;
    expect(last()).toBe(shown);
    expect(removed).toEqual(["file:///cache/camera-1.jpg"]);
  });

  it("removes the copies of photos kept after a failed save when no find was made", async () => {
    const { flow, log, removed } = setUpLookup();
    await flow.start();
    log.failNext.push(true);
    await flow.setSave(true);
    flow.askToLeave();
    flow.discardPending();
    flow.close();
    expect(removed).toEqual(["file:///cache/camera-1.jpg"]);
  });

  it("removes nothing once the lookup is a find, whose photos the store has copied, and completes its batch", async () => {
    const { flow, log, removed } = setUpLookup();
    await flow.start();
    await flow.setSave(true);
    expect(flow.askToLeave()).toBe(false);
    flow.close();
    await settle();
    expect(removed).toEqual([]);
    expect(log.completed).toEqual([1]);
  });
});

describe("the position of a photo lookup (SPEC 3.9: asked for when the camera opens, whether or not Save is on)", () => {
  it("is asked for from the start with Save off", async () => {
    const location = new FakeLocation();
    const { flow } = setUpLookup({ location });
    await flow.start();
    expect(location.onFix).not.toBeNull();
  });
});
