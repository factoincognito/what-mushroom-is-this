import type { PositionTracker } from "../position/positionTracker";
import { type NewFind, type Position, StoreError } from "../store/find";
import { phoneTimeNow, type SaveDeps, saveCameraFind, saveGalleryFind } from "./saveFind";

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
let deps: SaveDeps;

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
