/**
 * Tests of the New find screen (docs/SPEC.md 3.1, 3.6), through the router, with the camera,
 * the gallery and the find log replaced by stand-ins. The phone's position is not taken here:
 * it waits for the escalation of expo-location's Google Play services (the parked PR on
 * feat/pbi-1.6-position).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { getLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Linking } from "react-native";

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
  async add(find: NewFind): Promise<number> {
    const error = mockLog.addErrors.shift();
    if (error !== undefined) {
      throw error;
    }
    mockLog.added.push(find);
    return mockLog.added.length;
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
