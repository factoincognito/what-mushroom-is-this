/**
 * Tests of the New find screen (docs/SPEC.md 3.1, 3.6), through the router, with the camera,
 * the gallery, the phone's location and the find log replaced by stand-ins.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { getLocales } from "expo-localization";
import * as Location from "expo-location";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Alert, Linking } from "react-native";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { deviceJpegEncoder } from "../../image/deviceJpegEncoder";
import type { NewFind, Position, StoredFind } from "../../store/find";
import { warmUpRouter } from "../../testing/warmUpRouter";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-location", () => ({
  Accuracy: { Highest: 5 },
  watchPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));
// The phone's files, and the phone's image loader that checks a file is an image (PBI-2.6).
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("../../image/deviceJpegEncoder", () => ({ deviceJpegEncoder: { load: jest.fn() } }));

/**
 * The find log, in memory. (Named `mock…` so that the hoisted factory may use it.) A photo
 * lookup's find is saved with its first photo and its batch open (`addWithOpenBatch`, PBI-2.5);
 * each photo after it is added to the find (`addPhoto`), and the batch is completed at the end.
 */
const mockLog = {
  added: [] as NewFind[],
  /** The photos added to a find after its first, as [find ID, photo URI]. */
  photosAdded: [] as [number, string][],
  /** The finds whose batch was completed, in order. */
  completed: [] as number[],
  positions: [] as [number, Position][],
  /** The errors of the next saves, first and later photos alike. */
  addErrors: [] as Error[],
  /** Saves held open, one per save, until released (`holdNextAdd`). */
  addHolds: [] as Promise<void>[],
  /** The finds `getStored` gives, for photos added to a find from its screen. */
  stored: new Map<number, StoredFind>(),
  async save(): Promise<void> {
    const hold = mockLog.addHolds.shift();
    if (hold !== undefined) {
      await hold;
    }
    const error = mockLog.addErrors.shift();
    if (error !== undefined) {
      throw error;
    }
  },
  async addWithOpenBatch(find: NewFind): Promise<number> {
    await mockLog.save();
    mockLog.added.push(find);
    return mockLog.added.length;
  },
  async addPhoto(id: number, photoUri: string): Promise<void> {
    await mockLog.save();
    mockLog.photosAdded.push([id, photoUri]);
  },
  async completeBatch(id: number): Promise<void> {
    mockLog.completed.push(id);
  },
  async getStored(id: number): Promise<StoredFind | null> {
    return mockLog.stored.get(id) ?? null;
  },
  async setPosition(id: number, position: Position): Promise<void> {
    mockLog.positions.push([id, position]);
  },
  async list() {
    return [];
  },
};
jest.mock("../../store/deviceFindStore", () => ({
  openFindLog: jest.fn(async () => mockLog),
}));

const APP_DIR = "./src/app";

const permission = (status: "granted" | "denied" | "undetermined", canAskAgain = true) => ({
  status,
  granted: status === "granted",
  canAskAgain,
  expires: "never",
});

const cameraPhoto = { uri: "file:///cache/ImagePicker/camera.jpg", width: 4032, height: 3024 };
const galleryPhoto = {
  uri: "file:///cache/ImagePicker/gallery.jpg",
  width: 4032,
  height: 3024,
  exif: {
    DateTimeOriginal: "2026:09:14 15:42:07",
    OffsetTimeOriginal: "+02:00",
    GPSLatitude: 59.7,
    GPSLatitudeRef: "N",
    GPSLongitude: 17.2,
    GPSLongitudeRef: "E",
  },
};

/** The callback the screen gave watchPositionAsync, to send fixes through. */
let sendFix: ((fix: unknown) => void) | null;
let watchRemoved: number;

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

/** Sets the stand-ins each test starts from. */
async function resetStandIns(): Promise<void> {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  phoneIn("en");
  mockLog.added = [];
  mockLog.photosAdded = [];
  mockLog.completed = [];
  mockLog.positions = [];
  mockLog.addErrors = [];
  mockLog.addHolds = [];
  mockLog.stored.clear();
  sendFix = null;
  watchRemoved = 0;
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue(wrong(permission("granted")));
  jest
    .mocked(Location.requestForegroundPermissionsAsync)
    .mockResolvedValue(wrong(permission("granted")));
  jest.mocked(Location.watchPositionAsync).mockImplementation(async (_, callback) => {
    sendFix = callback as (fix: unknown) => void;
    return {
      remove: () => {
        watchRemoved += 1;
        sendFix = null;
      },
    };
  });
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
  jest
    .mocked(ImagePicker.getCameraPermissionsAsync)
    .mockResolvedValue(wrong(permission("granted")));
  jest
    .mocked(ImagePicker.requestCameraPermissionsAsync)
    .mockResolvedValue(wrong(permission("granted")));
  jest
    .mocked(ImagePicker.launchCameraAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest.mocked(deviceJpegEncoder.load).mockResolvedValue({
    width: 4032,
    height: 3024,
    encodeJpeg: jest.fn(),
    release: jest.fn(),
  });
}

beforeEach(resetStandIns);

/**
 * Lets the screen's chain of promises run. (The router's test renderer runs Jest's fake timers,
 * so a timer cannot be waited for; the chain is all promises, and 50 turns cover it.)
 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 50; i += 1) {
      await Promise.resolve();
    }
  });
}

/** Runs the timers the router has pending (its test renderer runs Jest's fake timers). */
async function runTimers(): Promise<void> {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

/** The releases of the saves `holdNextAdd` holds, so that a failed test leaves none held. */
const heldAdds: (() => void)[] = [];

/** Holds the next save to the find log open until the function it gives is called. */
function holdNextAdd(): () => void {
  let release: () => void = () => undefined;
  mockLog.addHolds.push(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  heldAdds.push(release);
  return release;
}

afterEach(async () => {
  for (const release of heldAdds.splice(0)) {
    release();
  }
  // The released saves end here, not in the next test, where they would take its stand-ins.
  await settle();
});

async function openNewFind(): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl: "/" });
  await app;
  await fireEvent.press(await screen.findByRole("link", { name: STRINGS.en.log.newFind }));
  await settle();
  return { pathname: () => app.getPathname() };
}

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await resetStandIns();
  await openNewFind();
});

function fix(latitude: number, longitude: number, accuracy: number) {
  return { coords: { latitude, longitude, accuracy }, timestamp: Date.now() };
}

describe("opening New find from the Log screen", () => {
  it("asks for the location the first time, starts asking for a position, then opens the camera", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(wrong(permission("undetermined")));
    const app = await openNewFind();
    expect(app.pathname()).toBe("/new-find");
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
    const order = [
      jest.mocked(Location.watchPositionAsync).mock.invocationCallOrder[0],
      jest.mocked(ImagePicker.launchCameraAsync).mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1] ?? 0);
  });

  it("does not ask for the location again once the user has said no, and says finds get no position", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied")));
    await openNewFind();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(screen.getByText(STRINGS.en.newFind.locationDenied)).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
  });

  it("with the location allowed, shows neither the refusal text nor the settings button (PBI-1.27)", async () => {
    await openNewFind();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.takePhoto })).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.newFind.locationDenied)).not.toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: STRINGS.en.newFind.openSettings }),
    ).not.toBeOnTheScreen();
  });

  it("offers the phone's settings when the location is not allowed", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied", false)));
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.openSettings }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it("shows the screen in the app's language", async () => {
    phoneIn("sv");
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await fireEvent.press(await screen.findByRole("link", { name: STRINGS.sv.log.newFind }));
    await settle();
    expect(
      screen.getByRole("button", { name: STRINGS.sv.newFind.pickFromGallery }),
    ).toBeOnTheScreen();
  });
});

describe("a photo from the camera", () => {
  it("is saved at once with the best fix that has come, and the screen says so", async () => {
    let photoTaken: (value: unknown) => void = () => undefined;
    jest.mocked(ImagePicker.launchCameraAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          photoTaken = (value) => resolve(wrong(value));
        }),
    );
    await openNewFind();
    await act(async () => {
      sendFix?.(fix(59.64, 17.08, 25));
      sendFix?.(fix(59.65, 17.09, 6));
    });
    await act(async () => photoTaken({ canceled: false, assets: [cameraPhoto] }));
    await settle();
    expect(mockLog.added).toEqual([
      {
        photoUri: cameraPhoto.uri,
        time: expect.objectContaining({ source: "saved" }),
        position: { latitude: 59.65, longitude: 17.09, accuracyM: 6, source: "fix" },
      },
    ]);
    expect(screen.getByText(STRINGS.en.newFind.saved)).toBeOnTheScreen();
    expect(watchRemoved).toBe(1);
  });

  it("is saved without a position when there is none yet, and gets the first fix that comes", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    await openNewFind();
    expect(mockLog.added[0]?.position).toBeNull();
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 120_000 });
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await settle();
    expect(mockLog.positions).toEqual([
      [1, { latitude: 59.66, longitude: 17.1, accuracyM: 9, source: "fix" }],
    ]);
    expect(watchRemoved).toBe(1);
  });

  it("is saved with its batch open, so that the queue does not take it yet (SPEC 3.9, Batches)", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [cameraPhoto] }));
    await openNewFind();
    expect(mockLog.added).toHaveLength(1);
    expect(mockLog.completed).toEqual([]);
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.analyse })).toBeOnTheScreen();
  });

  it("can be saved again when saving fails, and is then saved once", async () => {
    mockLog.addErrors = [new Error("database is locked")];
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    await openNewFind();
    expect(screen.getByText(STRINGS.en.newFind.saveFailed)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave }));
    await settle();
    expect(mockLog.added).toHaveLength(1);
    expect(mockLog.added[0]?.photoUri).toBe(cameraPhoto.uri);
    expect(screen.getByText(STRINGS.en.newFind.saved)).toBeOnTheScreen();
  });

  it("keeps the photo whose save failed: offers Save again and Discard, and no new photo, until one is chosen", async () => {
    mockLog.addErrors = [new Error("database is locked")];
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    await openNewFind();
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.discardPhoto })).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: STRINGS.en.newFind.takePhoto }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: STRINGS.en.newFind.pickFromGallery }),
    ).not.toBeOnTheScreen();
  });

  it("drops the photo whose save failed only when the user discards it, then offers a new photo", async () => {
    mockLog.addErrors = [new Error("database is locked")];
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [cameraPhoto] }));
    await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.discardPhoto }));
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.discardYes }));
    await settle();
    expect(mockLog.added).toEqual([]);
    expect(
      screen.queryByRole("button", { name: STRINGS.en.newFind.retrySave }),
    ).not.toBeOnTheScreen();
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [galleryPhoto] }));
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.pickFromGallery }));
    await settle();
    expect(mockLog.added).toHaveLength(1);
    expect(mockLog.added[0]?.photoUri).toBe(galleryPhoto.uri);
  });

  it("can be taken again after the camera was closed without a photo", async () => {
    await openNewFind();
    expect(mockLog.added).toEqual([]);
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.takePhoto }));
    await settle();
    expect(mockLog.added).toHaveLength(1);
  });

  it("says so when the camera fails, and offers it again", async () => {
    jest.mocked(ImagePicker.launchCameraAsync).mockRejectedValue(new Error("no camera"));
    await openNewFind();
    expect(screen.getByText(STRINGS.en.newFind.pickFailed)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.takePhoto })).toBeOnTheScreen();
  });

  it("is saved without a position, and nothing waits, without the location permission", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied")));
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    await openNewFind();
    expect(mockLog.added[0]?.position).toBeNull();
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });
});

describe("dropping a kept photo asks first (PBI-1.20, SPEC 3.1)", () => {
  /** Opens New find with a camera photo whose save failed, so that it is kept. */
  async function withKeptPhoto(): Promise<{ pathname: () => string }> {
    mockLog.addErrors = [new Error("database is locked")];
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    const app = await openNewFind();
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave })).toBeOnTheScreen();
    return app;
  }

  /** Leaves the screen as the header's back button or Android's back button would. */
  async function goBack(): Promise<void> {
    await act(async () => {
      router.back();
    });
    await settle();
    await runTimers();
  }

  /** Ends a save held open by `holdNextAdd`, and lets the screen and the router run after it. */
  async function endSave(release: () => void): Promise<void> {
    await act(async () => {
      release();
    });
    await settle();
    await runTimers();
    await settle();
  }

  describe("leaving while the photo is being saved is held until the save ends (Clead's fix 1 on #32)", () => {
    it("the first save: once it succeeds, the held leave goes ahead, asking nothing, and completes the batch", async () => {
      const release = holdNextAdd();
      jest
        .mocked(ImagePicker.launchCameraAsync)
        .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
      const app = await openNewFind();
      expect(screen.getByText(STRINGS.en.newFind.saving)).toBeOnTheScreen();
      await goBack();
      expect(app.pathname()).toBe("/new-find");
      expect(screen.queryByText(STRINGS.en.newFind.leaveConfirm)).not.toBeOnTheScreen();
      await endSave(release);
      expect(mockLog.added.map((find) => find.photoUri)).toEqual([cameraPhoto.uri]);
      expect(app.pathname()).toBe("/");
      expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
      expect(mockLog.completed).toEqual([1]);
    });

    it("the first save: once it fails, the screen stays and asks the leave question", async () => {
      const release = holdNextAdd();
      mockLog.addErrors = [new Error("database is locked")];
      jest
        .mocked(ImagePicker.launchCameraAsync)
        .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
      const app = await openNewFind();
      await goBack();
      expect(app.pathname()).toBe("/new-find");
      await endSave(release);
      expect(app.pathname()).toBe("/new-find");
      expect(mockLog.added).toEqual([]);
      expect(screen.getByText(STRINGS.en.newFind.leaveConfirm)).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.leaveYes }));
      await settle();
      expect(app.pathname()).toBe("/");
    });

    it("Save again: once it succeeds, the held leave goes ahead, asking nothing", async () => {
      const app = await withKeptPhoto();
      const release = holdNextAdd();
      await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave }));
      await settle();
      expect(screen.getByText(STRINGS.en.newFind.saving)).toBeOnTheScreen();
      await goBack();
      expect(app.pathname()).toBe("/new-find");
      expect(screen.queryByText(STRINGS.en.newFind.leaveConfirm)).not.toBeOnTheScreen();
      await endSave(release);
      expect(mockLog.added.map((find) => find.photoUri)).toEqual([cameraPhoto.uri]);
      expect(app.pathname()).toBe("/");
      expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
    });

    it("Save again: once it fails, the screen stays and asks the leave question, and Stay keeps the photo", async () => {
      const app = await withKeptPhoto();
      const release = holdNextAdd();
      mockLog.addErrors = [new Error("database is locked")];
      await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave }));
      await settle();
      await goBack();
      await endSave(release);
      expect(app.pathname()).toBe("/new-find");
      expect(mockLog.added).toEqual([]);
      expect(screen.getByText(STRINGS.en.newFind.leaveConfirm)).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.leaveCancel }));
      await settle();
      await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave }));
      await settle();
      await runTimers();
      expect(mockLog.added.map((find) => find.photoUri)).toEqual([cameraPhoto.uri]);
      expect(app.pathname()).toBe("/new-find");
    });
  });

  it("Discard the photo asks on the screen, not in a system alert, and offers only the answers", async () => {
    const alert = jest.spyOn(Alert, "alert");
    await withKeptPhoto();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.discardPhoto }));
    expect(screen.getByText(STRINGS.en.newFind.discardConfirm)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS.en.newFind.discardYes })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: STRINGS.en.newFind.discardCancel }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: STRINGS.en.newFind.retrySave }),
    ).not.toBeOnTheScreen();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("keeps the photo when the user answers Keep, which Save again then saves", async () => {
    await withKeptPhoto();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.discardPhoto }));
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.discardCancel }));
    expect(screen.queryByText(STRINGS.en.newFind.discardConfirm)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave }));
    await settle();
    expect(mockLog.added.map((find) => find.photoUri)).toEqual([cameraPhoto.uri]);
  });

  it("asks before the screen is left with a kept photo, and stays when the user answers Stay", async () => {
    const app = await withKeptPhoto();
    await goBack();
    expect(app.pathname()).toBe("/new-find");
    expect(screen.getByText(STRINGS.en.newFind.leaveConfirm)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.leaveCancel }));
    await settle();
    expect(app.pathname()).toBe("/new-find");
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.retrySave }));
    await settle();
    await runTimers();
    expect(mockLog.added.map((find) => find.photoUri)).toEqual([cameraPhoto.uri]);
    // Stay ends the leave for good: once the photo is saved, the screen does not leave unasked.
    expect(screen.getByText(STRINGS.en.newFind.saved)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/new-find");
  });

  it("leaves, dropping the kept photo, once the user confirms", async () => {
    const app = await withKeptPhoto();
    await goBack();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.leaveYes }));
    await settle();
    expect(app.pathname()).toBe("/");
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
    expect(mockLog.added).toEqual([]);
  });

  it("leaves without asking when no photo is kept", async () => {
    const app = await openNewFind();
    await goBack();
    expect(app.pathname()).toBe("/");
    expect(screen.queryByText(STRINGS.en.newFind.leaveConfirm)).not.toBeOnTheScreen();
  });
});

describe("the camera permission", () => {
  it("is asked for before the camera opens", async () => {
    jest
      .mocked(ImagePicker.getCameraPermissionsAsync)
      .mockResolvedValue(wrong(permission("undetermined")));
    await openNewFind();
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
  });

  it("when refused, keeps the camera closed, says so, naming the gallery and the files, and still offers both (PBI-2.16, #66)", async () => {
    jest
      .mocked(ImagePicker.getCameraPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied")));
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied")));
    await openNewFind();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(screen.getByText(STRINGS.en.newFind.cameraDenied)).toBeOnTheScreen();
    expect(
      screen.getByText(/pick a photo from the gallery or the files instead/),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: STRINGS.en.newFind.pickFromGallery }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: STRINGS.en.newFind.pickFromFiles }),
    ).toBeOnTheScreen();
  });

  it("when the phone lets the app ask no more, says so and offers the phone's settings", async () => {
    jest
      .mocked(ImagePicker.getCameraPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied", false)));
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await openNewFind();
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(screen.getByText(STRINGS.en.newFind.cameraBlocked)).toBeOnTheScreen();
    expect(screen.getByText(/or pick a photo from the gallery or the files\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.openSettings }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});

describe("a photo from the gallery", () => {
  it("is saved with the time and position of its own metadata, and the phone's position is not asked for", async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [galleryPhoto] }));
    await openNewFind();
    await act(async () => sendFix?.(fix(1, 2, 3)));
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.pickFromGallery }));
    await settle();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ exif: true }),
    );
    expect(mockLog.added).toEqual([
      {
        photoUri: galleryPhoto.uri,
        time: {
          takenAtMs: Date.UTC(2026, 8, 14, 13, 42, 7),
          utcOffsetMinutes: 120,
          source: "photo",
        },
        position: { latitude: 59.7, longitude: 17.2, accuracyM: null, source: "photo" },
      },
    ]);
    expect(watchRemoved).toBe(1);
    expect(screen.getByText(STRINGS.en.newFind.saved)).toBeOnTheScreen();
  });

  it("says so when the gallery fails", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValue(new Error("no activity"));
    await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.pickFromGallery }));
    await settle();
    expect(screen.getByText(STRINGS.en.newFind.pickFailed)).toBeOnTheScreen();
    expect(mockLog.added).toEqual([]);
  });
});

describe("leaving the screen", () => {
  it("stops asking for the position when no photo was saved", async () => {
    const app = await openNewFind();
    expect(watchRemoved).toBe(0);
    await act(async () => {
      router.back();
    });
    await settle();
    expect(app.pathname()).toBe("/");
    expect(watchRemoved).toBe(1);
  });

  it("keeps waiting for the first fix after a camera find saved without one, and adds it", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    const app = await openNewFind();
    expect(mockLog.added[0]?.position).toBeNull();
    await act(async () => {
      router.back();
    });
    await settle();
    expect(app.pathname()).toBe("/");
    expect(watchRemoved).toBe(0);
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await settle();
    expect(mockLog.positions).toEqual([
      [1, { latitude: 59.66, longitude: 17.1, accuracyM: 9, source: "fix" }],
    ]);
    expect(watchRemoved).toBe(1);
  });
});

const en = STRINGS.en;
const secondPhoto = { uri: "file:///cache/ImagePicker/second.jpg", width: 4032, height: 3024 };
const photoCount = (count: number) =>
  en.newFind.photoCount.replace("{count}", String(count)).replace("{max}", "5");

/** Leaves the screen as the header's back button would, and lets the router run. */
async function leaveScreen(): Promise<void> {
  await act(async () => {
    router.back();
  });
  await settle();
  await runTimers();
  await settle();
}

describe("several photos in one batch (SPEC 3.9, Batches; PBI-2.5)", () => {
  /** Opens New find; the camera gives the first photo, then `secondPhoto` each time after. */
  async function withFirstPhoto(): Promise<{ pathname: () => string }> {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [cameraPhoto] }))
      .mockResolvedValue(wrong({ canceled: false, assets: [secondPhoto] }));
    const app = await openNewFind();
    expect(mockLog.added).toHaveLength(1);
    return app;
  }

  it("after the first photo, offers another and Analyse, and saves the next to the same find, not a new one", async () => {
    await withFirstPhoto();
    expect(screen.getByText(photoCount(1))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.takePhoto }));
    await settle();
    expect(mockLog.added).toHaveLength(1);
    expect(mockLog.photosAdded).toEqual([[1, secondPhoto.uri]]);
    expect(screen.getByText(photoCount(2))).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.newFind.analyse })).toBeOnTheScreen();
    expect(mockLog.completed).toEqual([]);
  });

  it("saves a photo from the gallery after one from the camera to the same find, and takes no time or position from it", async () => {
    await withFirstPhoto();
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [galleryPhoto] }));
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.pickFromGallery }));
    await settle();
    expect(mockLog.photosAdded).toEqual([[1, galleryPhoto.uri]]);
    expect(mockLog.added).toHaveLength(1);
    expect(mockLog.added[0]?.time.source).toBe("saved");
  });

  it("offers no more photos once the find holds the most, and says so", async () => {
    await withFirstPhoto();
    for (let i = 0; i < 4; i += 1) {
      await fireEvent.press(screen.getByRole("button", { name: en.newFind.takePhoto }));
      await settle();
    }
    expect(mockLog.photosAdded).toHaveLength(4);
    expect(screen.getByText(photoCount(5))).toBeOnTheScreen();
    expect(screen.getByText(en.newFind.maxReached)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.newFind.takePhoto })).not.toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: en.newFind.pickFromGallery }),
    ).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.newFind.pickFromFiles })).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.newFind.analyse })).toBeOnTheScreen();
  });

  it("Analyse completes the batch, which is a queue trigger, and opens the find's screen", async () => {
    const app = await withFirstPhoto();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.analyse }));
    await settle();
    await runTimers();
    expect(mockLog.completed).toEqual([1]);
    expect(app.pathname()).toBe("/find/1");
  });

  it("says so when Analyse cannot complete the batch, stays, and Analyse can be tapped again", async () => {
    const app = await withFirstPhoto();
    const complete = jest
      .spyOn(mockLog, "completeBatch")
      .mockRejectedValueOnce(new Error("database is locked"));
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.analyse }));
    await settle();
    expect(screen.getByText(en.newFind.analyseFailed)).toBeOnTheScreen();
    expect(screen.queryByText(/locked/)).not.toBeOnTheScreen();
    expect(app.pathname()).toBe("/new-find");
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.analyse }));
    await settle();
    await runTimers();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(mockLog.completed).toEqual([1]);
    expect(app.pathname()).toBe("/find/1");
    complete.mockRestore();
  });

  it("leaving the screen with photos saved completes the batch, asking nothing", async () => {
    const app = await withFirstPhoto();
    await leaveScreen();
    expect(app.pathname()).toBe("/");
    expect(screen.queryByText(en.newFind.leaveConfirm)).not.toBeOnTheScreen();
    expect(mockLog.completed).toEqual([1]);
  });

  it("leaving the screen before any photo is saved completes nothing", async () => {
    const app = await openNewFind();
    await leaveScreen();
    expect(app.pathname()).toBe("/");
    expect(mockLog.completed).toEqual([]);
  });

  it("a later photo whose save fails is kept, and Save again saves it to the same find", async () => {
    await withFirstPhoto();
    mockLog.addErrors = [new Error("database is locked")];
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.takePhoto }));
    await settle();
    expect(screen.getByText(en.newFind.saveFailed)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.newFind.analyse })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.retrySave }));
    await settle();
    expect(mockLog.photosAdded).toEqual([[1, secondPhoto.uri]]);
    expect(mockLog.added).toHaveLength(1);
    expect(screen.getByText(photoCount(2))).toBeOnTheScreen();
  });

  it("asks before leaving with a later photo whose save failed, and completes the batch once left", async () => {
    const app = await withFirstPhoto();
    mockLog.addErrors = [new Error("database is locked")];
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.takePhoto }));
    await settle();
    await leaveScreen();
    expect(screen.getByText(en.newFind.leaveConfirm)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.leaveYes }));
    await settle();
    await runTimers();
    expect(app.pathname()).toBe("/");
    expect(mockLog.photosAdded).toEqual([]);
    expect(mockLog.completed).toEqual([1]);
  });

  it("a later camera photo changes nothing of the find's position", async () => {
    await withFirstPhoto();
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await settle();
    expect(mockLog.positions).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.takePhoto }));
    await settle();
    await act(async () => sendFix?.(fix(1, 2, 3)));
    await settle();
    expect(mockLog.positions).toHaveLength(1);
    expect(mockLog.added).toHaveLength(1);
  });
});

describe("adding photos to a find from its screen (SPEC 3.9, Batches; PBI-2.5)", () => {
  /** A find of the store with `count` photos, an answer, and text or none. */
  function storedFind(id: number, count: number, text: string | null = null): StoredFind {
    return {
      id,
      text,
      photos: Array.from({ length: count }, (_, i) => ({ uri: `file:///p/${i}.jpg`, batch: 1 })),
      batchOpen: false,
      time: { takenAtMs: 1, utcOffsetMinutes: 0, source: "saved" },
      position: null,
      analysis: { state: "waiting" },
      answerBasis: null,
      addedPhotos: null,
      picture: null,
      selfCheck: null,
    };
  }

  /** Opens the screen that adds photos to the find, from the Log, as its screen's link does. */
  async function openAddTo(id: number): Promise<{ pathname: () => string }> {
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await act(async () => {
      router.push(`/new-find?find=${id}`);
    });
    await settle();
    return { pathname: () => app.getPathname() };
  }

  it("opens the camera at once, asks for no location, and saves the photo to that find", async () => {
    mockLog.stored.set(7, storedFind(7, 2));
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [secondPhoto] }));
    await openAddTo(7);
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
    expect(mockLog.added).toEqual([]);
    expect(mockLog.photosAdded).toEqual([[7, secondPhoto.uri]]);
    expect(screen.getByText(photoCount(3))).toBeOnTheScreen();
  });

  it("adds photos to a text find too", async () => {
    mockLog.stored.set(7, storedFind(7, 0, "A yellow funnel."));
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [secondPhoto] }));
    await openAddTo(7);
    expect(mockLog.photosAdded).toEqual([[7, secondPhoto.uri]]);
    expect(screen.getByText(photoCount(1))).toBeOnTheScreen();
  });

  it("Analyse completes the batch and goes back to the screen it was opened from", async () => {
    mockLog.stored.set(7, storedFind(7, 1));
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [secondPhoto] }));
    const app = await openAddTo(7);
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.analyse }));
    await settle();
    await runTimers();
    expect(mockLog.completed).toEqual([7]);
    expect(app.pathname()).toBe("/");
  });

  it("leaving the screen completes the batch", async () => {
    mockLog.stored.set(7, storedFind(7, 1));
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [secondPhoto] }));
    const app = await openAddTo(7);
    await leaveScreen();
    expect(app.pathname()).toBe("/");
    expect(mockLog.completed).toEqual([7]);
  });

  it("offers no Analyse and completes nothing before a photo is added", async () => {
    mockLog.stored.set(7, storedFind(7, 1));
    await openAddTo(7);
    expect(screen.queryByRole("button", { name: en.newFind.analyse })).not.toBeOnTheScreen();
    await leaveScreen();
    expect(mockLog.completed).toEqual([]);
  });

  it("offers no photo for a find that holds the most, says so, and opens no camera", async () => {
    mockLog.stored.set(7, storedFind(7, 5));
    await openAddTo(7);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(screen.getByText(en.newFind.maxReached)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.newFind.takePhoto })).not.toBeOnTheScreen();
  });

  it.each([
    ["does not exist", "7", null],
    ["is named by no find ID", "abc", null],
    ["cannot be read", "7", new Error("the stored row is not an object")],
  ])("says so when the find %s, offers no photo, and opens no camera", async (_, param, error) => {
    if (error !== null) {
      jest.spyOn(mockLog, "getStored").mockRejectedValueOnce(error);
    }
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await act(async () => {
      router.push(`/new-find?find=${param}`);
    });
    await settle();
    expect(screen.getByText(en.newFind.findUnavailable)).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: en.newFind.takePhoto })).not.toBeOnTheScreen();
    expect(screen.queryByText(/stored row/)).not.toBeOnTheScreen();
  });

  it("adds a photo from the phone's files to the find (PBI-2.6)", async () => {
    mockLog.stored.set(7, storedFind(7, 1));
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValueOnce(wrong({ canceled: false, assets: [filesPhoto] }));
    await openAddTo(7);
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.pickFromFiles }));
    await settle();
    expect(mockLog.photosAdded).toEqual([[7, filesPhoto.uri]]);
    expect(mockLog.added).toEqual([]);
    expect(screen.getByText(photoCount(2))).toBeOnTheScreen();
  });
});

/** A file the phone's files give, copied to the app's cache, with a date it was last changed. */
const filesPhoto = {
  uri: "file:///cache/DocumentPicker/IMG_0042.jpg",
  name: "IMG_0042.jpg",
  size: 2_000_000,
  mimeType: "image/jpeg",
  lastModified: Date.UTC(2020, 0, 1),
};

describe("a photo from the phone's files (SPEC 3.9, Lookups; Known unknown 13; PBI-2.6)", () => {
  it("is offered beside the camera and the gallery, and opens the phone's files for one image, copied for the app", async () => {
    await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.pickFromFiles }));
    await settle();
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      type: "image/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    expect(mockLog.added).toEqual([]);
  });

  it("is saved at the time of saving and without a position, not the file's date or the phone's fix", async () => {
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [filesPhoto] }));
    await openNewFind();
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.pickFromFiles }));
    await settle();
    expect(deviceJpegEncoder.load).toHaveBeenCalledWith(filesPhoto.uri);
    expect(mockLog.added).toEqual([
      {
        photoUri: filesPhoto.uri,
        time: expect.objectContaining({ source: "saved" }),
        position: null,
      },
    ]);
    expect(mockLog.added[0]?.time.takenAtMs).not.toBe(filesPhoto.lastModified);
    expect(watchRemoved).toBe(1);
    expect(screen.getByText(en.newFind.saved)).toBeOnTheScreen();
  });

  it("is refused with a message when the app cannot load it as an image, and nothing is saved", async () => {
    jest
      .mocked(DocumentPicker.getDocumentAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [filesPhoto] }));
    jest.mocked(deviceJpegEncoder.load).mockRejectedValueOnce(new Error("Could not decode"));
    await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.pickFromFiles }));
    await settle();
    expect(screen.getByText(en.newFind.fileNotImage)).toBeOnTheScreen();
    expect(screen.queryByText(/decode/)).not.toBeOnTheScreen();
    expect(mockLog.added).toEqual([]);
    expect(screen.getByRole("button", { name: en.newFind.pickFromFiles })).toBeOnTheScreen();
  });

  it("says so when the files fail to open", async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockRejectedValue(new Error("no activity"));
    await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: en.newFind.pickFromFiles }));
    await settle();
    expect(screen.getByText(en.newFind.pickFailed)).toBeOnTheScreen();
    expect(mockLog.added).toEqual([]);
  });

  it("is offered when the camera may not be used", async () => {
    jest
      .mocked(ImagePicker.getCameraPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied", false)));
    await openNewFind();
    expect(screen.getByRole("button", { name: en.newFind.pickFromFiles })).toBeOnTheScreen();
  });

  it("is shown in the app's language", async () => {
    phoneIn("sv");
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await fireEvent.press(await screen.findByRole("link", { name: STRINGS.sv.log.newFind }));
    await settle();
    expect(
      screen.getByRole("button", { name: STRINGS.sv.newFind.pickFromFiles }),
    ).toBeOnTheScreen();
  });
});

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}
