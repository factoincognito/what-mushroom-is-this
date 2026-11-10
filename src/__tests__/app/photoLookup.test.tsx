/**
 * Tests of the photo lookup's "Save" switch on the New find screen (docs/SPEC.md 3.9, Lookups;
 * PBI-2.13), through the router: the switch and its starting value in Settings, an unsaved
 * lookup held on the screen and analysed there with its three error groups, turning Save on during
 * it, and leaving the screen. The camera, the gallery, the phone's location, the key store and the
 * network are stand-ins; the find log is in memory; the photo's preparation for analysis is a
 * stand-in; the queue is the app's own, with `fetch` replaced, and the app in the background so
 * that no queue run starts by itself.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { getLocales } from "expo-localization";
import * as Location from "expo-location";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { AppState } from "react-native";

import type { Answer, Match } from "../../analysis/answer";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { preparePhotoForAnalysis } from "../../image/prepareForAnalysis";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { PHOTO_LOOKUP_SAVE_KEY, TEXT_LOOKUP_SAVE_KEY } from "../../lookup/saveSetting";
import { answerToJson } from "../../store/answerJson";
import type { StoredFind } from "../../store/find";
import { memoryFindLog } from "../../testing/memoryFindLog";
import { warmUpRouter } from "../../testing/warmUpRouter";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

const mockSecrets = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecrets.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecrets.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecrets.delete(key);
  }),
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
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
jest.mock("../../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));

const APP_DIR = "./src/app";
const en = STRINGS.en;

const CHANTERELLE: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "En gul svamp.", en: "A yellow mushroom.", it: "Un fungo giallo." },
  lookAlikes: [],
};

function reply(status: number, body: string) {
  return { status, headers: { get: () => null }, text: async () => body };
}

function apiAnswer(answer: Answer) {
  return reply(
    200,
    JSON.stringify({
      type: "message",
      content: [{ type: "text", text: answerToJson(answer) }],
      stop_reason: "end_turn",
    }),
  );
}

const permission = (status: "granted" | "denied" | "undetermined", canAskAgain = true) => ({
  status,
  granted: status === "granted",
  canAskAgain,
  expires: "never",
});

const fetchMock = jest.fn();
/** The callback the screen gave watchPositionAsync, to send fixes through. */
let sendFix: ((fix: unknown) => void) | null;
let watchRemoved: number;
/** The photos the camera gives, in turn: the picker's copies, files in the app's cache. */
let shots: File[];

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

/** A copy of a photo in the app's cache, as the picker leaves one. */
function pickerCopy(name: string): File {
  const directory = new Directory(Paths.cache, "ImagePicker");
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, name);
  file.write(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return file;
}

/** Sets the stand-ins each test starts from. */
async function resetStandIns(): Promise<void> {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-api03-abcDEF_123");
  mockLog.finds.clear();
  phoneIn("en");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  sendFix = null;
  watchRemoved = 0;
  shots = [];
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
  jest.mocked(ImagePicker.launchCameraAsync).mockImplementation(async () => {
    const shot = pickerCopy(`camera-${shots.length + 1}.jpg`);
    shots.push(shot);
    return wrong({ canceled: false, assets: [{ uri: shot.uri, width: 4032, height: 3024 }] });
  });
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest.mocked(preparePhotoForAnalysis).mockReset();
  jest
    .mocked(preparePhotoForAnalysis)
    .mockImplementation(async (uri) => ({ ok: true, imageBase64: btoa(uri), width: 1, height: 1 }));
  Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
}

beforeEach(resetStandIns);

afterAll(() => {
  Object.defineProperty(AppState, "currentState", { value: undefined, configurable: true });
});

/** Lets the screen's chain of promises run. */
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

async function openNewFind(): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl: "/" });
  await app;
  await fireEvent.press(await screen.findByRole("link", { name: en.log.newFind }));
  await settle();
  return { pathname: () => app.getPathname() };
}

/** Opens New find with Save off at the start, as Settings can have it. */
async function openUnsaved(): Promise<{ pathname: () => string }> {
  await AsyncStorage.setItem(PHOTO_LOOKUP_SAVE_KEY, "off");
  return openNewFind();
}

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await resetStandIns();
  await openNewFind();
});

function saveSwitch() {
  return screen.getByRole("switch", { name: en.newFind.save });
}

async function press(name: string): Promise<void> {
  await fireEvent.press(screen.getByRole("button", { name }));
  await settle();
}

/** Leaves the screen as the header's back button or Android's back button would. */
async function goBack(): Promise<void> {
  await act(async () => {
    router.back();
  });
  await settle();
  await runTimers();
  await settle();
}

function fix(latitude: number, longitude: number, accuracy: number) {
  return { coords: { latitude, longitude, accuracy }, timestamp: Date.now() };
}

/** The only find in the log, as the store holds it. */
function onlyFind(): StoredFind {
  const finds = [...mockLog.finds.values()];
  expect(finds).toHaveLength(1);
  const [find] = finds;
  if (find === undefined || !("photos" in find)) {
    throw new Error("expected one find as the store holds it");
  }
  return find;
}

/** The images of the one request sent, as base64 of the photo URIs the stand-in prepared. */
function sentPhotos(): string[] {
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  return body.messages[0].content
    .filter((block: { type: string }) => block.type === "image")
    .map((block: { source: { data: string } }) => atob(block.source.data));
}

describe("the Save switch on New find (SPEC 3.9, Lookups)", () => {
  it("is on by default, and once the first photo is saved as a find it is shown but cannot be turned off", async () => {
    await openNewFind();
    expect(saveSwitch()).toHaveProp("value", true);
    expect(onlyFind().photos.map((photo) => photo.uri)).toEqual([shots[0]?.uri]);
    expect(saveSwitch()).toHaveProp("disabled", true);
    expect(screen.getByText(en.newFind.saveHint)).toBeOnTheScreen();
  });

  it("is not there when photos are added to a find from its screen", async () => {
    mockLog.finds.set(1, {
      id: 1,
      text: null,
      photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
      batchOpen: false,
      time: { takenAtMs: Date.UTC(2026, 8, 14, 13, 42), utcOffsetMinutes: 120, source: "saved" },
      position: null,
      analysis: { state: "waiting" },
      addedPhotos: null,
      picture: null,
      selfCheck: null,
    });
    await renderRouter(APP_DIR, { initialUrl: "/new-find?find=1" });
    await settle();
    expect(await screen.findByText(en.newFind.saved)).toBeOnTheScreen();
    expect(screen.queryByRole("switch", { name: en.newFind.save })).not.toBeOnTheScreen();
  });
});

describe("an unsaved photo lookup (Save off)", () => {
  it("is held on the screen, and Analyse sends all its photos and shows the answer as a find's, with the photo's disclaimer and no self-check, storing nothing", async () => {
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openUnsaved();
    expect(saveSwitch()).toHaveProp("value", false);
    expect(saveSwitch()).toHaveProp("disabled", false);
    await press(en.newFind.takePhoto);
    expect(
      screen.getByText(en.newFind.heldCount.replace("{count}", "2").replace("{max}", "5")),
    ).toBeOnTheScreen();
    expect(mockLog.finds.size).toBe(0);
    await press(en.newFind.analyse);
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(edibility.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(edibility.queryByText(en.disclaimerDescribed)).not.toBeOnTheScreen();
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.edible)),
    ).toBeOnTheScreen();
    expect(edibility.queryByText(en.find.selfCheck.waiting)).not.toBeOnTheScreen();
    expect(sentPhotos()).toEqual(shots.map((shot) => shot.uri));
    expect(mockLog.finds.size).toBe(0);
  });

  it("says no mushroom in the words of a photo", async () => {
    fetchMock.mockResolvedValueOnce(apiAnswer({ result: "no_mushroom" }));
    await openUnsaved();
    await press(en.newFind.analyse);
    expect(await screen.findByText(en.find.noMushroom)).toBeOnTheScreen();
  });

  it("no network: keeps the lookup, says why and offers to turn Save on, which saves it as one find with its photos and the first photo's time; Analyse then opens the find", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    const app = await openUnsaved();
    await press(en.newFind.takePhoto);
    await press(en.newFind.analyse);
    expect(await screen.findByText(en.queue.paused.network)).toBeOnTheScreen();
    await press(en.newFind.turnSaveOn);
    const find = onlyFind();
    expect(find.photos.map((photo) => photo.uri)).toEqual(shots.map((shot) => shot.uri));
    expect(find.batchOpen).toBe(true);
    expect(find.time.source).toBe("saved");
    expect(saveSwitch()).toHaveProp("value", true);
    expect(saveSwitch()).toHaveProp("disabled", true);
    await press(en.newFind.analyse);
    await runTimers();
    await settle();
    expect(onlyFind()).toMatchObject({ batchOpen: false, analysis: { state: "waiting" } });
    expect(app.pathname()).toBe(`/find/${find.id}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saved after its first photo, keeps that photo's position, from a fix that came once it was taken", async () => {
    await openUnsaved();
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await settle();
    await fireEvent(saveSwitch(), "valueChange", true);
    await settle();
    expect(onlyFind().position).toEqual({
      latitude: 59.66,
      longitude: 17.1,
      accuracyM: 9,
      source: "fix",
    });
  });

  it("without a key: says a key is needed, links to Settings and offers to turn Save on", async () => {
    mockSecrets.clear();
    await openUnsaved();
    await press(en.newFind.analyse);
    expect(await screen.findByText(en.queue.stopped.noKey)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.queue.openSettings })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.newFind.turnSaveOn })).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a photo that fails the metadata check: shows the failure naming the photo, offers no Save, and Analyse can be tapped again", async () => {
    await openUnsaved();
    await press(en.newFind.takePhoto);
    jest.mocked(preparePhotoForAnalysis).mockImplementation(async (uri) =>
      uri === shots[1]?.uri
        ? {
            ok: false,
            loaded: true,
            failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
          }
        : { ok: true, imageBase64: btoa(uri), width: 1, height: 1 },
    );
    await press(en.newFind.analyse);
    const notice = within(await screen.findByTestId("lookup-notice"));
    expect(
      notice.getByText(
        en.queue.failed.numbered
          .replace("{number}", "2")
          .replace("{reason}", en.queue.failed.segmentCheck.app1),
      ),
    ).toBeOnTheScreen();
    expect(notice.queryByText(/0x|forbidden-segment|file:/)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.newFind.turnSaveOn })).not.toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    jest.mocked(preparePhotoForAnalysis).mockImplementation(async (uri) => ({
      ok: true,
      imageBase64: btoa(uri),
      width: 1,
      height: 1,
    }));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await press(en.newFind.analyse);
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
  });

  it("a 401: stops the queue as for a find and shows the same message, which the Log shows too", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, "{}"));
    await openUnsaved();
    await press(en.newFind.analyse);
    expect(await screen.findByText(en.queue.stopped.keyRefused)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.newFind.turnSaveOn })).not.toBeOnTheScreen();
    await goBack();
    await press(en.newFind.leaveYes);
    await runTimers();
    await settle();
    expect(await screen.findByText(en.queue.stopped.keyRefused)).toBeOnTheScreen();
  });

  it("asks before the screen is left, on the screen; Stay keeps it, and the second answer leaves, removes the app's copies of its photos and saves nothing", async () => {
    const app = await openUnsaved();
    await press(en.newFind.takePhoto);
    expect(shots.map((shot) => shot.exists)).toEqual([true, true]);
    await goBack();
    expect(app.pathname()).toBe("/new-find");
    expect(screen.getByText(en.newFind.leaveLookupConfirm)).toBeOnTheScreen();
    await press(en.newFind.leaveCancel);
    expect(screen.queryByText(en.newFind.leaveLookupConfirm)).not.toBeOnTheScreen();
    expect(shots.map((shot) => shot.exists)).toEqual([true, true]);
    await goBack();
    await press(en.newFind.leaveYes);
    await runTimers();
    await settle();
    expect(app.pathname()).toBe("/");
    expect(shots.map((shot) => shot.exists)).toEqual([false, false]);
    expect(mockLog.finds.size).toBe(0);
    expect(watchRemoved).toBe(1);
  });

  it("leaves without asking when it holds no photo", async () => {
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValue(wrong({ canceled: true, assets: null }));
    const app = await openUnsaved();
    await goBack();
    expect(app.pathname()).toBe("/");
    expect(screen.queryByText(en.newFind.leaveLookupConfirm)).not.toBeOnTheScreen();
  });
});

describe("the photo lookup's starting value in Settings (SPEC 3.9)", () => {
  it("is on, beside the text lookup's, and turning it off there makes the next New find start with Save off, leaving the text lookup's alone", async () => {
    const app = renderRouter(APP_DIR, { initialUrl: "/settings" });
    await app;
    const setting = await screen.findByRole("switch", { name: en.settings.lookups.photoSave });
    expect(setting).toHaveProp("value", true);
    expect(screen.getByRole("switch", { name: en.settings.lookups.textSave })).toHaveProp(
      "value",
      false,
    );
    await fireEvent(setting, "valueChange", false);
    await settle();
    expect(await AsyncStorage.getItem(PHOTO_LOOKUP_SAVE_KEY)).toBe("off");
    expect(await AsyncStorage.getItem(TEXT_LOOKUP_SAVE_KEY)).toBeNull();
    expect(screen.getByRole("switch", { name: en.settings.lookups.photoSave })).toHaveProp(
      "value",
      false,
    );
    await act(async () => {
      router.replace("/new-find");
    });
    await settle();
    expect(saveSwitch()).toHaveProp("value", false);
    expect(mockLog.finds.size).toBe(0);
  });

  it("says so when the value cannot be saved, and shows the value kept", async () => {
    const app = renderRouter(APP_DIR, { initialUrl: "/settings" });
    await app;
    const setting = await screen.findByRole("switch", { name: en.settings.lookups.photoSave });
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("storage is full"));
    await fireEvent(setting, "valueChange", false);
    await settle();
    expect(screen.getByText(en.settings.lookups.saveFailed)).toBeOnTheScreen();
    expect(screen.getByRole("switch", { name: en.settings.lookups.photoSave })).toHaveProp(
      "value",
      true,
    );
  });
});

describe("in the app's language", () => {
  it.each(["sv", "it"] as const)("is in %s", async (lang) => {
    phoneIn(lang);
    const t = STRINGS[lang];
    await AsyncStorage.setItem(PHOTO_LOOKUP_SAVE_KEY, "off");
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await fireEvent.press(await screen.findByRole("link", { name: t.log.newFind }));
    await settle();
    expect(screen.getByRole("switch", { name: t.newFind.save })).toBeOnTheScreen();
    expect(screen.getByText(t.newFind.saveHint)).toBeOnTheScreen();
    expect(
      screen.getByText(t.newFind.heldCount.replace("{count}", "1").replace("{max}", "5")),
    ).toBeOnTheScreen();
  });
});

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}
