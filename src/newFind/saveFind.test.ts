import type { PositionTracker } from "../position/positionTracker";
import { type NewFind, type NewTextFind, type Position, StoreError } from "../store/find";
import {
  phoneTimeNow,
  type SaveDeps,
  saveCameraFind,
  saveGalleryFind,
  saveTakenFind,
  saveTextFind,
  type TextSaveDeps,
  takenByCamera,
  takenFromGallery,
} from "./saveFind";

const NOW = new Date(Date.UTC(2026, 10, 9, 10, 15, 0));
const FIX: Position = { latitude: 59.64, longitude: 17.08, accuracyM: 6, source: "fix" };

/** Stands in for the store: the finds added and the positions set later. */
class FakeStore {
  added: NewFind[] = [];
  positions: [number, Position][] = [];
  addError: Error | null = null;
  setPositionError: Error | null = null;

  async add(find: NewFind): Promise<number> {
    if (this.addError !== null) {
      throw this.addError;
    }
    this.added.push(find);
    return 41 + this.added.length;
  }

  addedText: NewTextFind[] = [];

  async addText(find: NewTextFind): Promise<number> {
    if (this.addError !== null) {
      throw this.addError;
    }
    this.addedText.push(find);
    return 41 + this.addedText.length;
  }

  async setPosition(id: number, position: Position): Promise<void> {
    if (this.setPositionError !== null) {
      throw this.setPositionError;
    }
    this.positions.push([id, position]);
  }
}

/** Stands in for the position tracker: what it has now, and the first fix it will give. */
class FakeTracker implements PositionTracker {
  now: Position | null = null;
  first: Promise<Position | null> = Promise.resolve(null);
  stops = 0;
  firstFixAsked = 0;

  async positionNow(): Promise<Position | null> {
    return this.now;
  }

  firstFix(): Promise<Position | null> {
    this.firstFixAsked += 1;
    return this.first;
  }

  stop(): void {
    this.stops += 1;
  }
}

let store: FakeStore;
let tracker: FakeTracker;
let deps: SaveDeps & TextSaveDeps;

beforeEach(() => {
  store = new FakeStore();
  tracker = new FakeTracker();
  deps = { store, now: () => NOW };
});

describe("phoneTimeNow", () => {
  it("is the moment of saving with the phone's own UTC offset", () => {
    expect(phoneTimeNow(NOW)).toEqual({
      takenAtMs: NOW.getTime(),
      utcOffsetMinutes: -NOW.getTimezoneOffset(),
      source: "saved",
    });
  });
});

describe("saveCameraFind", () => {
  it("saves the photo at once, at the moment of saving, with the best fix the tracker has", async () => {
    tracker.now = FIX;
    const saved = await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    expect(saved).toEqual({ id: 42, positionLater: null });
    expect(store.added).toEqual([
      { photoUri: "file:///cache/IMG_1.jpg", time: phoneTimeNow(NOW), position: FIX },
    ]);
    expect(tracker.firstFixAsked).toBe(0);
    expect(tracker.stops).toBe(1);
  });

  it("saves the last known position the tracker gives, marked as such", async () => {
    tracker.now = { ...FIX, source: "last-known" };
    await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    expect(store.added[0]?.position).toEqual({ ...FIX, source: "last-known" });
  });

  it("saves without a position when it has none, then adds the first fix that comes", async () => {
    let comes: (position: Position | null) => void = () => undefined;
    tracker.first = new Promise((resolve) => {
      comes = resolve;
    });
    const saved = await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    expect(store.added[0]?.position).toBeNull();
    expect(store.positions).toEqual([]);
    expect(tracker.stops).toBe(0);

    comes(FIX);
    await expect(saved.positionLater).resolves.toEqual(FIX);
    expect(store.positions).toEqual([[42, FIX]]);
    expect(tracker.stops).toBe(1);
  });

  it("leaves the find without a position when no fix comes in time", async () => {
    tracker.first = Promise.resolve(null);
    const saved = await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    await expect(saved.positionLater).resolves.toBeNull();
    expect(store.positions).toEqual([]);
    expect(tracker.stops).toBe(1);
  });

  it("gives up the later fix quietly when the store refuses it, for example after a delete", async () => {
    tracker.first = Promise.resolve(FIX);
    store.setPositionError = new StoreError("not-found", "no find has the ID 42");
    const saved = await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    await expect(saved.positionLater).resolves.toBeNull();
    expect(tracker.stops).toBe(1);
  });

  it("gives up the later fix quietly when waiting for it fails", async () => {
    tracker.firstFix = () => Promise.reject(new Error("location service died"));
    const saved = await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    await expect(saved.positionLater).resolves.toBeNull();
    expect(tracker.stops).toBe(1);
  });

  it("saves without a position, and waits for none, without the location permission", async () => {
    const saved = await saveCameraFind("file:///cache/IMG_1.jpg", null, deps);
    expect(saved).toEqual({ id: 42, positionLater: null });
    expect(store.added[0]?.position).toBeNull();
  });

  it("saves without a position when the tracker cannot give one", async () => {
    tracker.positionNow = async () => {
      throw new Error("location service died");
    };
    tracker.first = Promise.resolve(null);
    await saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps);
    expect(store.added[0]?.position).toBeNull();
  });

  it("passes the store's error on and keeps the tracker running, so the save can be tried again", async () => {
    tracker.now = FIX;
    store.addError = new StoreError("invalid-input", "the photo's file does not exist");
    await expect(saveCameraFind("file:///cache/IMG_1.jpg", tracker, deps)).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(tracker.stops).toBe(0);
  });
});

describe("saveGalleryFind", () => {
  it("saves the time and position the photo's metadata holds, marked as the photo's", async () => {
    const id = await saveGalleryFind(
      {
        uri: "file:///cache/picked.jpg",
        exif: {
          DateTimeOriginal: "2026:09:14 15:42:07",
          OffsetTimeOriginal: "+02:00",
          GPSLatitude: 59.64,
          GPSLatitudeRef: "N",
          GPSLongitude: 17.08,
          GPSLongitudeRef: "E",
        },
      },
      deps,
    );
    expect(id).toBe(42);
    expect(store.added).toEqual([
      {
        photoUri: "file:///cache/picked.jpg",
        time: {
          takenAtMs: Date.UTC(2026, 8, 14, 13, 42, 7),
          utcOffsetMinutes: 120,
          source: "photo",
        },
        position: { latitude: 59.64, longitude: 17.08, accuracyM: null, source: "photo" },
      },
    ]);
  });

  it("saves the time of saving and no position when the photo's metadata holds neither", async () => {
    await saveGalleryFind({ uri: "content://media/picker/0/media/1000000033", exif: null }, deps);
    expect(store.added).toEqual([
      {
        photoUri: "content://media/picker/0/media/1000000033",
        time: phoneTimeNow(NOW),
        position: null,
      },
    ]);
  });

  it("never takes the phone's own position for a gallery photo", async () => {
    await saveGalleryFind(
      { uri: "file:///cache/picked.jpg", exif: { DateTimeOriginal: "2026:09:14 15:42:07" } },
      deps,
    );
    expect(store.added[0]?.position).toBeNull();
    expect(store.added[0]?.time.source).toBe("photo-phone-offset");
  });

  it("passes the store's error on", async () => {
    store.addError = new Error("database is locked");
    await expect(
      saveGalleryFind({ uri: "file:///cache/picked.jpg", exif: null }, deps),
    ).rejects.toThrow("database is locked");
  });
});

describe("saveTextFind (SPEC 3.9: the time of saving, the position as for a camera find)", () => {
  const TEXT = "A yellow funnel with false gills.";

  it("saves the text at once, at the moment of saving, with the best fix the tracker has", async () => {
    tracker.now = FIX;
    const saved = await saveTextFind(TEXT, tracker, deps);
    expect(saved).toEqual({ id: 42, positionLater: null });
    expect(store.addedText).toEqual([{ text: TEXT, time: phoneTimeNow(NOW), position: FIX }]);
    expect(store.added).toEqual([]);
    expect(tracker.stops).toBe(1);
  });

  it("saves the last known position the tracker gives, marked as such", async () => {
    tracker.now = { ...FIX, source: "last-known" };
    await saveTextFind(TEXT, tracker, deps);
    expect(store.addedText[0]?.position).toEqual({ ...FIX, source: "last-known" });
  });

  it("saves without a position when it has none, then adds the first fix that comes", async () => {
    let comes: (position: Position | null) => void = () => undefined;
    tracker.first = new Promise((resolve) => {
      comes = resolve;
    });
    const saved = await saveTextFind(TEXT, tracker, deps);
    expect(store.addedText[0]?.position).toBeNull();
    expect(tracker.stops).toBe(0);
    comes(FIX);
    await expect(saved.positionLater).resolves.toEqual(FIX);
    expect(store.positions).toEqual([[42, FIX]]);
    expect(tracker.stops).toBe(1);
  });

  it("gives up the later fix quietly when the store refuses it, for example after a delete", async () => {
    tracker.first = Promise.resolve(FIX);
    store.setPositionError = new StoreError("not-found", "no find has the ID 42");
    const saved = await saveTextFind(TEXT, tracker, deps);
    await expect(saved.positionLater).resolves.toBeNull();
    expect(tracker.stops).toBe(1);
  });

  it("saves without a position, and waits for none, without the location permission", async () => {
    const saved = await saveTextFind(TEXT, null, deps);
    expect(saved).toEqual({ id: 42, positionLater: null });
    expect(store.addedText[0]?.position).toBeNull();
  });

  it("passes the store's error on and keeps the tracker running, so the save can be tried again", async () => {
    store.addError = new StoreError("invalid-input", "the text is empty");
    await expect(saveTextFind(" ", tracker, deps)).rejects.toMatchObject({ code: "invalid-input" });
    expect(tracker.stops).toBe(0);
    expect(tracker.firstFixAsked).toBe(0);
  });
});

/**
 * An unsaved photo lookup's first photo keeps its time and position for the find the lookup may
 * become when Save is turned on later (docs/SPEC.md 3.9, Lookups; PBI-2.13).
 */
describe("takenByCamera", () => {
  it("is the moment the photo was taken, with the best fix the tracker has, waiting for none", async () => {
    tracker.now = FIX;
    const taken = await takenByCamera(tracker, () => NOW);
    expect(taken.time).toEqual(phoneTimeNow(NOW));
    expect(taken.position()).toEqual(FIX);
    expect(taken.later).toBeNull();
    expect(tracker.firstFixAsked).toBe(0);
  });

  it("without a position, waits for the first fix that comes, and has it once it came", async () => {
    let comes: (position: Position | null) => void = () => undefined;
    tracker.first = new Promise((resolve) => {
      comes = resolve;
    });
    const taken = await takenByCamera(tracker, () => NOW);
    expect(taken.position()).toBeNull();
    expect(tracker.firstFixAsked).toBe(1);
    comes(FIX);
    await expect(taken.later).resolves.toEqual(FIX);
    expect(taken.position()).toEqual(FIX);
  });

  it("stays without a position when no fix comes in time, or waiting for it fails", async () => {
    tracker.firstFix = () => Promise.reject(new Error("location service died"));
    const taken = await takenByCamera(tracker, () => NOW);
    await expect(taken.later).resolves.toBeNull();
    expect(taken.position()).toBeNull();
  });

  it("has no position when the tracker cannot give one", async () => {
    tracker.positionNow = async () => {
      throw new Error("location service died");
    };
    const taken = await takenByCamera(tracker, () => NOW);
    expect(taken.position()).toBeNull();
    await expect(taken.later).resolves.toBeNull();
  });

  it("has no position, and waits for none, without the location permission", async () => {
    const taken = await takenByCamera(null, () => NOW);
    expect(taken.position()).toBeNull();
    expect(taken.later).toBeNull();
  });
});

describe("takenFromGallery", () => {
  it("is the time and position the photo's metadata holds, marked as the photo's", () => {
    const taken = takenFromGallery(
      {
        uri: "file:///cache/picked.jpg",
        exif: {
          DateTimeOriginal: "2026:09:14 15:42:07",
          OffsetTimeOriginal: "+02:00",
          GPSLatitude: 59.64,
          GPSLatitudeRef: "N",
          GPSLongitude: 17.08,
          GPSLongitudeRef: "E",
        },
      },
      () => NOW,
    );
    expect(taken.time).toEqual({
      takenAtMs: Date.UTC(2026, 8, 14, 13, 42, 7),
      utcOffsetMinutes: 120,
      source: "photo",
    });
    expect(taken.position()).toEqual({
      latitude: 59.64,
      longitude: 17.08,
      accuracyM: null,
      source: "photo",
    });
    expect(taken.later).toBeNull();
  });

  it("is the moment it was picked, without a position, when the metadata holds neither", () => {
    const taken = takenFromGallery({ uri: "content://media/1", exif: null }, () => NOW);
    expect(taken.time).toEqual(phoneTimeNow(NOW));
    expect(taken.position()).toBeNull();
  });
});

describe("saveTakenFind", () => {
  const LATER = new Date(NOW.getTime() + 90_000);

  it("saves the find with the time and position of its first photo, not the moment of saving", async () => {
    tracker.now = FIX;
    const taken = await takenByCamera(tracker, () => NOW);
    const saved = await saveTakenFind("file:///cache/a.jpg", taken, { store, now: () => LATER });
    expect(saved).toEqual({ id: 42, positionLater: null });
    expect(store.added).toEqual([
      { photoUri: "file:///cache/a.jpg", time: phoneTimeNow(NOW), position: FIX },
    ]);
  });

  it("saves the fix that came after the photo was taken, before the save", async () => {
    tracker.first = Promise.resolve(FIX);
    const taken = await takenByCamera(tracker, () => NOW);
    await taken.later;
    const saved = await saveTakenFind("file:///cache/a.jpg", taken, deps);
    expect(saved.positionLater).toBeNull();
    expect(store.added[0]?.position).toEqual(FIX);
    expect(store.positions).toEqual([]);
  });

  it("saves without a position while the photo still waits for its fix, then adds the fix when it comes", async () => {
    let comes: (position: Position | null) => void = () => undefined;
    tracker.first = new Promise((resolve) => {
      comes = resolve;
    });
    const taken = await takenByCamera(tracker, () => NOW);
    const saved = await saveTakenFind("file:///cache/a.jpg", taken, deps);
    expect(store.added[0]?.position).toBeNull();
    comes(FIX);
    await expect(saved.positionLater).resolves.toEqual(FIX);
    expect(store.positions).toEqual([[42, FIX]]);
  });

  it("adds no position when none comes in time", async () => {
    let comes: (position: Position | null) => void = () => undefined;
    tracker.first = new Promise((resolve) => {
      comes = resolve;
    });
    const taken = await takenByCamera(tracker, () => NOW);
    const saved = await saveTakenFind("file:///cache/a.jpg", taken, deps);
    comes(null);
    await expect(saved.positionLater).resolves.toBeNull();
    expect(store.positions).toEqual([]);
  });

  it("gives up the later fix quietly when the store refuses it, for example after a delete", async () => {
    let comes: (position: Position | null) => void = () => undefined;
    tracker.first = new Promise((resolve) => {
      comes = resolve;
    });
    store.setPositionError = new StoreError("not-found", "no find has the ID 42");
    const taken = await takenByCamera(tracker, () => NOW);
    const saved = await saveTakenFind("file:///cache/a.jpg", taken, deps);
    comes(FIX);
    await expect(saved.positionLater).resolves.toBeNull();
  });

  it("passes the store's error on, so the save can be tried again with the same time and position", async () => {
    tracker.now = FIX;
    const taken = await takenByCamera(tracker, () => NOW);
    store.addError = new Error("database is locked");
    await expect(saveTakenFind("file:///cache/a.jpg", taken, deps)).rejects.toThrow("locked");
    store.addError = null;
    await saveTakenFind("file:///cache/a.jpg", taken, { store, now: () => LATER });
    expect(store.added).toEqual([
      { photoUri: "file:///cache/a.jpg", time: phoneTimeNow(NOW), position: FIX },
    ]);
  });
});
