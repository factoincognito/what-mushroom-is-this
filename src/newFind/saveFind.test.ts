import { type NewFind, StoreError } from "../store/find";
import { phoneTimeNow, type SaveDeps, saveCameraFind, saveGalleryFind } from "./saveFind";

const NOW = new Date(Date.UTC(2026, 10, 9, 10, 15, 0));

/** Stands in for the store: the finds added. */
class FakeStore {
  added: NewFind[] = [];
  addError: Error | null = null;

  async add(find: NewFind): Promise<number> {
    if (this.addError !== null) {
      throw this.addError;
    }
    this.added.push(find);
    return 41 + this.added.length;
  }
}

let store: FakeStore;
let deps: SaveDeps;

beforeEach(() => {
  store = new FakeStore();
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
  it("saves the photo at once, at the moment of saving, without a position from the phone", async () => {
    // The phone's position waits for the escalation of expo-location's Google Play services
    // (the parked PR on feat/pbi-1.6-position).
    await expect(saveCameraFind("file:///cache/IMG_1.jpg", deps)).resolves.toBe(42);
    expect(store.added).toEqual([
      { photoUri: "file:///cache/IMG_1.jpg", time: phoneTimeNow(NOW), position: null },
    ]);
  });

  it("passes the store's error on, so the save can be tried again", async () => {
    store.addError = new StoreError("invalid-input", "the photo's file does not exist");
    await expect(saveCameraFind("file:///cache/IMG_1.jpg", deps)).rejects.toMatchObject({
      code: "invalid-input",
    });
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
