/**
 * Tests of the New find screen (docs/SPEC.md 3.1, 3.6), through the router, with the camera,
 * the gallery and the find log replaced by stand-ins. The phone's position is not taken here:
 * it waits for the escalation of expo-location's Google Play services (the parked PR on
 * feat/pbi-1.6-position).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Alert, Linking } from "react-native";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import type { NewFind } from "../../store/find";

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

/** The find log, in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = {
  added: [] as NewFind[],
  addErrors: [] as Error[],
  /** Saves held open, one per call to `add`, until released (`holdNextAdd`). */
  addHolds: [] as Promise<void>[],
  async add(find: NewFind): Promise<number> {
    const hold = mockLog.addHolds.shift();
    if (hold !== undefined) {
      await hold;
    }
    const error = mockLog.addErrors.shift();
    if (error !== undefined) {
      throw error;
    }
    mockLog.added.push(find);
    return mockLog.added.length;
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

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  phoneIn("en");
  mockLog.added = [];
  mockLog.addErrors = [];
  mockLog.addHolds = [];
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
});

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

describe("opening New find from the Log screen", () => {
  it("opens the camera at once", async () => {
    const app = await openNewFind();
    expect(app.pathname()).toBe("/new-find");
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
  });

  it("offers no way to the phone's settings while the camera is allowed: it asks for no location", async () => {
    await openNewFind();
    expect(
      screen.queryByRole("button", { name: STRINGS.en.newFind.openSettings }),
    ).not.toBeOnTheScreen();
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
  it("is saved at once, at the moment of saving and without a position, and the screen says so", async () => {
    let photoTaken: (value: unknown) => void = () => undefined;
    jest.mocked(ImagePicker.launchCameraAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          photoTaken = (value) => resolve(wrong(value));
        }),
    );
    await openNewFind();
    await act(async () => photoTaken({ canceled: false, assets: [cameraPhoto] }));
    await settle();
    expect(mockLog.added).toEqual([
      {
        photoUri: cameraPhoto.uri,
        time: expect.objectContaining({ source: "saved" }),
        position: null,
      },
    ]);
    expect(screen.getByText(STRINGS.en.newFind.saved)).toBeOnTheScreen();
  });

  it("goes back to the Log screen from the saved message", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [cameraPhoto] }));
    const app = await openNewFind();
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.back }));
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
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
    it("the first save: once it succeeds, the held leave goes ahead, asking nothing", async () => {
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

  it("when refused, keeps the camera closed, says so and still offers the gallery", async () => {
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
      screen.getByRole("button", { name: STRINGS.en.newFind.pickFromGallery }),
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
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.newFind.openSettings }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});

describe("a photo from the gallery", () => {
  it("is saved with the time and position of its own metadata", async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue(wrong({ canceled: false, assets: [galleryPhoto] }));
    await openNewFind();
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

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}
