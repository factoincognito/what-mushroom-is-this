/**
 * The share target for images (docs/SPEC.md 3.9, Shared photos; PBI-2.21), through the router:
 * the choice a share opens, its two paths into the New find screen, Cancel, a second share, a
 * batch open under the choice, and the first-start disclaimer. expo-sharing is replaced by a
 * stand-in that holds a share as the library does; the files are jest-expo's in-memory ones, the
 * find log is in memory, and the camera, the location and the network are stand-ins.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { getLocales } from "expo-localization";
import * as Location from "expo-location";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import * as Sharing from "expo-sharing";
import { AppState, BackHandler, Linking } from "react-native";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { fillIn } from "../../find/display";
import { STRINGS } from "../../i18n/strings";
import { deviceJpegEncoder } from "../../image/deviceJpegEncoder";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { PHOTO_LOOKUP_SAVE_KEY } from "../../lookup/saveSetting";
import type { Find, StoredFind } from "../../store/find";
import { memoryFindLog, storedOf } from "../../testing/memoryFindLog";
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
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
// The phone's image loader, which checks that a shared file is an image.
jest.mock("../../image/deviceJpegEncoder", () => ({ deviceJpegEncoder: { load: jest.fn() } }));
jest.mock("../../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(async () => ({
    ok: true,
    imageBase64: "AAAA",
    width: 2212,
    height: 1659,
  })),
}));
jest.mock("../../picture/devicePicture", () => ({
  fetchDevicePicture: jest.fn(async () => ({ kind: "waits", cause: "network", retryAtMs: null })),
  removePictureCopy: jest.fn(),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));

/**
 * expo-sharing, as the library behaves on Android (57.0.26, read): it holds the last share's raw
 * payloads until it is cleared; resolving copies each shared file into a folder of its own under
 * `expo-sharing/` in the cache; clearing drops the share and removes that folder.
 */
const mockShare = {
  payloads: [] as unknown,
  resolved: [] as unknown,
};
jest.mock("expo-sharing", () => ({
  getSharedPayloads: jest.fn(() => mockShare.payloads),
  getResolvedSharedPayloadsAsync: jest.fn(async () => mockShare.resolved),
  clearSharedPayloads: jest.fn(),
  useIncomingShare: jest.fn(() => {
    throw new Error("the app does not use the library's hook");
  }),
}));

const APP_DIR = "./src/app";
const en = STRINGS.en;
const t = en.share;
const MAX = "5";
const A_KEY = "sk-ant-api03-abcDEF_123";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const fetchMock = jest.fn();

const libraryFolder = () => new Directory(Paths.cache, "expo-sharing");
const appFolder = `${Paths.cache.uri}SharedPhotos/`;

let folders = 0;
/**
 * The library's copy of a shared file, at the address Java gives it (one slash). Its bytes are
 * its name, so that a test can tell which shared file a saved photo is.
 */
function libraryCopyOf(name: string): string {
  folders += 1;
  const folder = new Directory(libraryFolder(), `share-${folders}`);
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, name);
  file.write(new TextEncoder().encode(name));
  return file.uri.replace("file:///", "file:/");
}

/** The name of the shared file a photo at the address is a copy of. */
const sharedNameOf = (uri: string) => new TextDecoder().decode(new File(uri).bytesSync());

/** Another app shares the image files named: what the library then holds and resolves. */
function shareImages(...names: string[]): string[] {
  const payloads = names.map((name) => ({
    value: `content://media/external/images/media/${name}`,
    shareType: "image",
    mimeType: "image/jpeg",
  }));
  const copies = names.map(libraryCopyOf);
  mockShare.payloads = payloads;
  mockShare.resolved = payloads.map((payload, index) => ({
    ...payload,
    contentUri: copies[index],
    contentType: "image",
    contentMimeType: "image/jpeg",
    contentSize: JPEG.length,
    originalName: names[index],
  }));
  return copies;
}

const exists = (uri: string) => new File(uri.replace(/^file:\/(?=[^/])/, "file:///")).exists;

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1, 10, 0);

/** A find with the number of photos given, taken `daysLater` days after the first. */
function findWith(id: number, photos: number, daysLater = id): StoredFind {
  const find: Find = {
    id,
    photoUri: `file:///photos/${id}-1.jpg`,
    time: { takenAtMs: BASE + daysLater * DAY, utcOffsetMinutes: 120, source: "saved" },
    position: { latitude: 59.6, longitude: 17.1, accuracyM: 8, source: "fix" },
    analysis: { state: "waiting" },
  };
  return {
    ...storedOf(find),
    photos: Array.from({ length: photos }, (_, index) => ({
      uri: `file:///photos/${id}-${index + 1}.jpg`,
      batch: 1,
    })),
  };
}

const stored = (id: number): StoredFind => {
  const find = mockLog.finds.get(id);
  if (find === undefined) {
    throw new Error(`the test's log has no find ${id}`);
  }
  return storedOf(find);
};

const permission = (status: "granted" | "denied") => ({
  status,
  granted: status === "granted",
  canAskAgain: true,
  expires: "never",
});

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

/** The listeners the app gave `AppState`, to tell it that the app came to the front. */
let appStateListeners: ((state: string) => void)[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockLog.finds.clear();
  mockLog.unreadable.clear();
  mockLog.withoutId.length = 0;
  mockShare.payloads = [];
  mockShare.resolved = [];
  for (const folder of [libraryFolder(), new Directory(Paths.cache, "SharedPhotos")]) {
    if (folder.exists) {
      folder.delete();
    }
  }
  jest.mocked(Sharing.clearSharedPayloads).mockImplementation(() => {
    mockShare.payloads = [];
    mockShare.resolved = [];
    if (libraryFolder().exists) {
      libraryFolder().delete();
    }
  });
  phoneIn("en");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    appStateListeners.push(listener as (state: string) => void);
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue(permission("granted") as never);
  jest
    .mocked(Location.requestForegroundPermissionsAsync)
    .mockResolvedValue(permission("granted") as never);
  jest.mocked(Location.watchPositionAsync).mockImplementation(async (_, callback) => {
    callback({
      coords: { latitude: 60.1, longitude: 18.2, accuracy: 4 },
      timestamp: Date.now(),
    } as never);
    return { remove: () => undefined };
  });
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
  jest
    .mocked(ImagePicker.getCameraPermissionsAsync)
    .mockResolvedValue(permission("granted") as never);
  jest
    .mocked(ImagePicker.requestCameraPermissionsAsync)
    .mockResolvedValue(permission("granted") as never);
  jest
    .mocked(ImagePicker.launchCameraAsync)
    .mockResolvedValue({ canceled: true, assets: null } as never);
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue({ canceled: true, assets: null } as never);
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue({ canceled: true, assets: null } as never);
  jest.mocked(deviceJpegEncoder.load).mockResolvedValue({
    width: 4032,
    height: 3024,
    encodeJpeg: jest.fn(),
    release: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  Object.defineProperty(AppState, "currentState", { value: undefined, configurable: true });
});

/** Lets the screens' chains of promises run (the router's test renderer runs fake timers). */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve();
    }
  });
}

async function startApp(initialUrl: string): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl });
  await app;
  await settle();
  return { pathname: () => app.getPathname() };
}

/** A share arrives while the app runs: the library's address opens the choice. */
async function shareArrives(): Promise<void> {
  await addressArrives("what-mushroom-is-this://expo-sharing");
  // Under Jest the router does not hear the phone's addresses (its test renderer replaces
  // expo-linking's listener), so the route the address leads to is opened here
  // (`shareAddress.test.ts` checks that the router's native-intent file gives this route).
  await act(async () => {
    router.navigate("/share");
  });
  await settle();
}

/** An address reaches the app from outside it while it runs, as React Native announces it. */
async function addressArrives(url: string): Promise<void> {
  const listeners = jest
    .mocked(Linking.addEventListener)
    .mock.calls.filter(([type]) => type === "url")
    .map(([, listener]) => listener as (event: { url: string }) => void);
  await act(async () => {
    for (const listener of listeners) {
      listener({ url });
    }
  });
  await settle();
}

/** The app comes to the front, as it does when a share is sent to it while it runs. */
async function comesToFront(): Promise<void> {
  await act(async () => {
    for (const listener of appStateListeners) {
      listener("active");
    }
  });
  await settle();
}

async function press(name: string): Promise<void> {
  await fireEvent.press(screen.getByRole("button", { name }));
  await settle();
}

/** The titles in the headers of the screens of the stack, the lowest first. */
function headerTitles(): string[] {
  return screen.container
    .queryAll((node) => node.type === "RNSScreenStackHeaderConfig")
    .map((node) => String(node.props.title));
}

warmUpRouter(async () => {
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  phoneIn("en");
  await startApp("/share");
});

describe("the choice a share opens (SPEC 3.9, Shared photos)", () => {
  it('is the first screen when a share starts the app, says that one photo was shared, and offers "New find", "Add to an earlier find" and "Cancel"', async () => {
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg");
    const app = await startApp("/share");
    expect(app.pathname()).toBe("/share");
    expect(screen.getByText(t.onePhoto)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.newFind })).toBeEnabled();
    expect(screen.getByRole("button", { name: t.addToFind })).toBeEnabled();
    expect(screen.getByRole("button", { name: t.cancel })).toBeEnabled();
    expect(screen.queryByText(t.severalOnlyAdd)).not.toBeOnTheScreen();
  });

  it("saves nothing, sends nothing, opens no camera and asks for no location before the choice is made", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, A_KEY);
    mockLog.finds.set(1, {
      ...findWith(1, 1),
      analysis: { state: "failed", failure: { cause: "request", detail: "400" } },
    });
    const before = JSON.stringify([...mockLog.finds]);
    shareImages("a.jpg", "b.jpg");
    await startApp("/share");
    expect(screen.getByText(fillIn(t.severalPhotos, { count: "2" }))).toBeOnTheScreen();
    expect(JSON.stringify([...mockLog.finds])).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(deviceJpegEncoder.load).not.toHaveBeenCalled();
    expect(Sharing.useIncomingShare).not.toHaveBeenCalled();
    // All the app holds of the share is the library's copies in the cache.
    expect(new Directory(Paths.cache, "SharedPhotos").exists).toBe(false);
  });

  it('offers only "Add to an earlier find" for several photos, with the line saying why, never "New find"', async () => {
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg", "b.jpg", "c.jpg");
    await startApp("/share");
    expect(screen.getByText(fillIn(t.severalPhotos, { count: "3" }))).toBeOnTheScreen();
    expect(screen.getByText(t.severalOnlyAdd)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.addToFind })).toBeEnabled();
    expect(screen.getByRole("button", { name: t.cancel })).toBeEnabled();
  });

  it('does not offer "Add to an earlier find" without a find, and says so', async () => {
    shareImages("a.jpg");
    await startApp("/share");
    expect(screen.getByRole("button", { name: t.newFind })).toBeEnabled();
    expect(screen.queryByRole("button", { name: t.addToFind })).not.toBeOnTheScreen();
    expect(screen.getByText(t.noFindToChoose)).toBeOnTheScreen();
  });

  it("does not offer it when every find is full or cannot be read, and for several photos then offers only Cancel", async () => {
    mockLog.finds.set(1, findWith(1, 5));
    mockLog.finds.set(2, findWith(2, 1));
    mockLog.unreadable.add(2);
    shareImages("a.jpg", "b.jpg");
    await startApp("/share");
    expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.addToFind })).not.toBeOnTheScreen();
    expect(screen.getByText(t.severalOnlyAdd)).toBeOnTheScreen();
    expect(screen.getByText(t.noFindToChoose)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.cancel })).toBeEnabled();
  });

  it("still offers New find when the finds cannot be read, and says that they could not", async () => {
    shareImages("a.jpg");
    jest.spyOn(mockLog, "list").mockRejectedValue(new Error("database is locked"));
    await startApp("/share");
    expect(screen.getByRole("button", { name: t.newFind })).toBeEnabled();
    expect(screen.queryByRole("button", { name: t.addToFind })).not.toBeOnTheScreen();
    expect(screen.getByText(en.log.unreadable)).toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("shows its texts in %s", async (language) => {
    phoneIn(language);
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg", "b.jpg");
    await startApp("/share");
    const texts = STRINGS[language].share;
    expect(screen.getByText(fillIn(texts.severalPhotos, { count: "2" }))).toBeOnTheScreen();
    expect(screen.getByText(texts.severalOnlyAdd)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: texts.addToFind })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: texts.cancel })).toBeOnTheScreen();
  });
});

describe("what a share may hold (SPEC 3.9: only an image file on the phone)", () => {
  it.each([
    [
      "a web address",
      { value: "https://example.org/a.jpg", shareType: "url", mimeType: "text/plain" },
    ],
    ["a text", { value: "Kantarell i skogen", shareType: "text", mimeType: "text/plain" }],
    [
      "a web address typed as an image",
      { value: "https://example.org/a.jpg", shareType: "image", mimeType: "image/jpeg" },
    ],
  ])(
    "refuses %s: the library is never asked to resolve it, nothing is fetched or saved, and the choice says so",
    async (_, payload) => {
      mockLog.finds.set(1, findWith(1, 1));
      mockShare.payloads = [payload];
      await startApp("/share");
      expect(screen.getByText(fillIn(t.refused, { count: "1" }))).toBeOnTheScreen();
      expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
      expect(screen.queryByRole("button", { name: t.addToFind })).not.toBeOnTheScreen();
      expect(stored(1).photos).toHaveLength(1);
      expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    },
  );

  it("says that a share it cannot read saved nothing", async () => {
    shareImages("a.jpg");
    jest
      .mocked(Sharing.getResolvedSharedPayloadsAsync)
      .mockRejectedValueOnce(new Error("resolver failed"));
    await startApp("/share");
    expect(screen.getByText(t.unreadable)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
    expect(mockLog.finds.size).toBe(0);
  });

  it("refuses a shared file that cannot be loaded as an image, saves nothing and says how many were refused", async () => {
    shareImages("not-an-image.jpg");
    jest.mocked(deviceJpegEncoder.load).mockRejectedValue(new Error("not an image"));
    const app = await startApp("/share");
    await press(t.newFind);
    expect(app.pathname()).toBe("/share");
    expect(screen.getByText(fillIn(t.refused, { count: "1" }))).toBeOnTheScreen();
    expect(mockLog.finds.size).toBe(0);
    expect(new Directory(Paths.cache, "expo-sharing").exists).toBe(false);
  });

  it("takes nothing from the address that opens the choice: with no share from the library it says so and saves nothing", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    const photo = new File(new Directory(Paths.document, "photos"), "1-1.jpg");
    new Directory(Paths.document, "photos").create({ intermediates: true, idempotent: true });
    photo.write(JPEG);
    const address = `/share?uri=${encodeURIComponent(photo.uri)}&photos=${encodeURIComponent(photo.uri)}&find=1&value=${encodeURIComponent("https://example.org/a.jpg")}`;
    const app = await startApp(address);
    expect(app.pathname()).toBe("/share");
    expect(screen.getByText(t.none)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.addToFind })).not.toBeOnTheScreen();
    expect(stored(1).photos).toHaveLength(1);
    expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(photo.exists).toBe(true);
    await fireEvent.press(screen.getByRole("link", { name: en.notFound.back }));
    await settle();
    expect(app.pathname()).toBe("/");
  });

  it("takes the library's share and nothing of the address when the address carries more", async () => {
    shareImages("a.jpg");
    await startApp("/share?photos=file%3A%2F%2F%2Fmock%2Fdocument%2Fphotos%2F9.jpg&count=7");
    expect(screen.getByText(t.onePhoto)).toBeOnTheScreen();
    await press(t.newFind);
    expect(mockLog.finds.size).toBe(1);
    expect(stored(1).photos).toHaveLength(1);
    expect(stored(1).photos[0]?.uri.startsWith(appFolder)).toBe(true);
  });
});

describe('"New find" from a share (SPEC 3.9)', () => {
  it("saves the photo at once as a new find on the New find screen, as if picked there, and the camera does not open", async () => {
    const [copy] = shareImages("a.jpg");
    const app = await startApp("/share");
    await press(t.newFind);
    expect(app.pathname()).toBe("/new-find");
    expect(screen.getByText(en.newFind.saved)).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(mockLog.finds.size).toBe(1);
    const find = stored(1);
    expect(find.photos).toHaveLength(1);
    expect(find.batchOpen).toBe(true);
    expect(find.photos[0]?.uri.startsWith(appFolder)).toBe(true);
    expect(exists(find.photos[0]?.uri ?? "")).toBe(true);
    // The share has ended: the library holds nothing of it, and its copy is the app's now.
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(exists(copy ?? "")).toBe(false);
  });

  it("gives the find the time of saving and no position, never the phone's, and asks for the location permission only now", async () => {
    shareImages("a.jpg");
    await startApp("/share");
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    const before = Date.now();
    await press(t.newFind);
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    const find = stored(1);
    expect(find.time.source).toBe("saved");
    expect(find.time.takenAtMs).toBeGreaterThanOrEqual(before);
    expect(find.position).toBeNull();
  });

  it("has Save on whatever its starting value in Settings", async () => {
    await AsyncStorage.setItem(PHOTO_LOOKUP_SAVE_KEY, "off");
    shareImages("a.jpg");
    await startApp("/share");
    await press(t.newFind);
    expect(mockLog.finds.size).toBe(1);
    const save = screen.getByRole("switch", { name: en.newFind.save });
    expect(save).toHaveProp("value", true);
    expect(save).toHaveProp("disabled", true);
  });

  it("sends the photo for analysis only with its find, once the batch is completed", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, A_KEY);
    fetchMock.mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: '{"result":"cannot_tell"}' }],
          stop_reason: "end_turn",
        }),
    });
    shareImages("a.jpg");
    const app = await startApp("/share");
    await press(t.newFind);
    await comesToFront();
    expect(fetchMock).not.toHaveBeenCalled();
    await press(en.newFind.analyse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(app.pathname()).toBe("/find/1");
    expect(stored(1).batchOpen).toBe(false);
  });

  it("keeps a photo whose save failed, for Save again or Discard, and removes its copy when it is discarded and the screen left", async () => {
    shareImages("a.jpg");
    const add = jest.spyOn(mockLog, "addWithOpenBatch");
    add.mockRejectedValueOnce(new Error("database is locked"));
    const app = await startApp("/share");
    await press(t.newFind);
    expect(screen.getByText(en.newFind.saveFailed)).toBeOnTheScreen();
    expect(mockLog.finds.size).toBe(0);
    const kept = add.mock.calls[0]?.[0].photoUri ?? "";
    expect(kept.startsWith(appFolder)).toBe(true);
    expect(exists(kept)).toBe(true);
    await press(en.newFind.discardPhoto);
    await press(en.newFind.discardYes);
    expect(exists(kept)).toBe(true);
    await act(async () => {
      router.replace("/");
    });
    await settle();
    expect(app.pathname()).toBe("/");
    expect(exists(kept)).toBe(false);
    expect(mockLog.finds.size).toBe(0);
  });
});

describe('"Add to an earlier find" from a share (SPEC 3.9)', () => {
  it("lists the finds as the Library does, newest first, a full find as full and not to be chosen, and leaves out a find that cannot be read", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    mockLog.finds.set(2, findWith(2, 5));
    mockLog.finds.set(3, findWith(3, 2));
    mockLog.finds.set(4, findWith(4, 1));
    mockLog.unreadable.add(4);
    mockLog.withoutId.push("0");
    shareImages("a.jpg");
    await startApp("/share");
    await press(t.addToFind);
    expect(screen.getByText(t.chooseFind)).toBeOnTheScreen();
    const rows = screen.getAllByTestId(/^share-find-\d+$/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      "share-find-3",
      "share-find-2",
      "share-find-1",
    ]);
    expect(screen.getByTestId("share-find-3")).toBeEnabled();
    expect(screen.getByTestId("share-find-1")).toBeEnabled();
    expect(screen.getByTestId("share-find-2")).toBeDisabled();
    expect(screen.getAllByText(fillIn(t.full, { max: MAX }))).toHaveLength(1);
    expect(screen.queryByText(en.find.unreadable)).not.toBeOnTheScreen();
    // Each find is shown as its row in the Library: its photo and what the list says of it.
    expect(within(screen.getByTestId("share-find-3")).getByText(en.log.waiting)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId("share-find-3")).getByLabelText(en.find.photo),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.cancel })).toBeEnabled();
  });

  it("draws only the rows near the top of a long list of finds, as the Library's list does, the newest first", async () => {
    for (let id = 1; id <= 40; id += 1) {
      mockLog.finds.set(id, findWith(id, 1));
    }
    shareImages("a.jpg");
    await startApp("/share");
    await press(t.addToFind);
    const rows = screen.getAllByTestId(/^share-find-\d+$/).map((row) => row.props.testID);
    expect(rows[0]).toBe("share-find-40");
    expect(rows[1]).toBe("share-find-39");
    expect(rows.length).toBeLessThan(40);
    expect(screen.getByRole("button", { name: t.cancel })).toBeEnabled();
  });

  it("does not choose a full find when its row is pressed", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    mockLog.finds.set(2, findWith(2, 5));
    shareImages("a.jpg");
    const app = await startApp("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-2"));
    await settle();
    expect(app.pathname()).toBe("/share");
    expect(stored(2).photos).toHaveLength(5);
    expect(Sharing.clearSharedPayloads).not.toHaveBeenCalled();
  });

  it("saves the photos to the chosen find in the order shared, as one open batch, on its Add photos screen, and the camera does not open", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    const before = stored(1);
    shareImages("a.jpg", "b.jpg", "c.jpg");
    const added = jest.spyOn(mockLog, "addPhoto");
    const app = await startApp("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(app.pathname()).toBe("/new-find");
    expect(headerTitles()).toEqual([en.newFind.addTitle]);
    expect(
      screen.getByText(fillIn(en.newFind.photoCount, { count: "4", max: MAX })),
    ).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    const find = stored(1);
    expect(find.photos).toHaveLength(4);
    expect(find.photos.slice(1).map((photo) => photo.batch)).toEqual([2, 2, 2]);
    expect(find.batchOpen).toBe(true);
    // In the order shared, each as the app's own copy.
    expect(added.mock.calls.map(([id]) => id)).toEqual([1, 1, 1]);
    const uris = added.mock.calls.map(([, uri]) => uri);
    expect(uris.every((uri) => uri.startsWith(appFolder))).toBe(true);
    expect(uris.map(sharedNameOf)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    // The find keeps its time and position, and no permission is asked for.
    expect(find.time).toEqual(before.time);
    expect(find.position).toEqual(before.position);
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
  });

  it("completes the batch there as any batch: Analyse leaves the find to the queue", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg");
    await startApp("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(stored(1).batchOpen).toBe(true);
    await press(en.newFind.analyse);
    expect(stored(1).batchOpen).toBe(false);
    expect(stored(1).photos).toHaveLength(2);
  });

  it("saves those that fit when the find cannot hold them all, says how many were left out, and removes their copies", async () => {
    mockLog.finds.set(1, findWith(1, 3));
    shareImages("a.jpg", "b.jpg", "c.jpg", "d.jpg");
    await startApp("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(stored(1).photos).toHaveLength(5);
    expect(screen.getByText(fillIn(t.leftOut, { count: "2", max: MAX }))).toBeOnTheScreen();
    expect(screen.getByText(en.newFind.maxReached)).toBeOnTheScreen();
    // Only the two saved photos' copies are left in the app's folder.
    expect(new Directory(Paths.cache, "SharedPhotos").list()).toHaveLength(2);
  });

  it("refuses a shared file that cannot be loaded as an image, saves the others, and says how many were refused", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    const copies = shareImages("a.jpg", "broken.jpg", "c.jpg");
    const broken = (copies[1] ?? "").replace("file:/", "file:///");
    jest.mocked(deviceJpegEncoder.load).mockImplementation(async (uri: string) => {
      if (uri === broken) {
        throw new Error("not an image");
      }
      return { width: 4032, height: 3024, encodeJpeg: jest.fn(), release: jest.fn() };
    });
    await startApp("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(stored(1).photos).toHaveLength(3);
    expect(screen.getByText(fillIn(t.notImages, { count: "1" }))).toBeOnTheScreen();
    expect(screen.queryByText(fillIn(t.leftOut, { count: "1", max: MAX }))).not.toBeOnTheScreen();
    expect(exists(broken)).toBe(false);
  });

  it("keeps the photos whose save failed, for Save again", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg", "b.jpg");
    jest.spyOn(mockLog, "addPhoto").mockRejectedValueOnce(new Error("database is locked"));
    await startApp("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(screen.getByText(en.newFind.savePhotosFailed)).toBeOnTheScreen();
    expect(stored(1).photos).toHaveLength(1);
    await press(en.newFind.retrySave);
    expect(stored(1).photos).toHaveLength(3);
  });
});

describe("Cancel, and leaving the choice (SPEC 3.9: nothing is saved)", () => {
  it("drops the share and the copies of its photos, saves nothing, and goes to the Library when the share started the app", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    const copies = shareImages("a.jpg", "b.jpg");
    const app = await startApp("/share");
    await press(t.cancel);
    expect(app.pathname()).toBe("/");
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(copies.map(exists)).toEqual([false, false]);
    expect(stored(1).photos).toHaveLength(1);
    expect(mockLog.finds.size).toBe(1);
    expect(deviceJpegEncoder.load).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes back to the screen the choice opened over", async () => {
    const app = await startApp("/settings");
    shareImages("a.jpg");
    await shareArrives();
    expect(app.pathname()).toBe("/share");
    expect(screen.getByText(t.onePhoto)).toBeOnTheScreen();
    await press(t.cancel);
    expect(app.pathname()).toBe("/settings");
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
  });

  it("drops the share when the choice is left by going back", async () => {
    const app = await startApp("/");
    const copies = shareImages("a.jpg");
    await shareArrives();
    expect(screen.getByText(t.onePhoto)).toBeOnTheScreen();
    await act(async () => {
      router.back();
    });
    await settle();
    expect(app.pathname()).toBe("/");
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(copies.map(exists)).toEqual([false]);
    expect(mockLog.finds.size).toBe(0);
  });

  it("drops the share when the list of finds is left by Cancel", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg");
    const app = await startApp("/share");
    await press(t.addToFind);
    await press(t.cancel);
    expect(app.pathname()).toBe("/");
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(stored(1).photos).toHaveLength(1);
  });

  /**
   * Android's back button, as React Native hands it on: to the listeners from the last added to
   * the first, until one says that it handled the press. Gives whether one did; without one the
   * phone closes the app.
   */
  function backButton(): { press: () => Promise<boolean> } {
    const added: { listener: () => boolean | null | undefined; removed: boolean }[] = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_, listener) => {
      const entry = { listener: listener as () => boolean | null | undefined, removed: false };
      added.push(entry);
      return {
        remove: () => {
          entry.removed = true;
        },
      };
    });
    return {
      press: async () => {
        let handled = false;
        await act(async () => {
          for (const entry of [...added].reverse()) {
            if (!entry.removed && entry.listener() === true) {
              handled = true;
              break;
            }
          }
        });
        await settle();
        return handled;
      },
    };
  }

  it("cancels on Android's back button when the choice is the app's first screen, and goes to the Library, where the phone would close the app with the share still held", async () => {
    const back = backButton();
    const copies = shareImages("a.jpg");
    const app = await startApp("/share");
    expect(router.canGoBack()).toBe(false);
    await expect(back.press()).resolves.toBe(true);
    expect(app.pathname()).toBe("/");
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(copies.map(exists)).toEqual([false]);
    expect(mockLog.finds.size).toBe(0);
  });

  it("goes back on Android's back button to the screen the choice opened over, which drops the share", async () => {
    const back = backButton();
    const app = await startApp("/settings");
    const copies = shareImages("a.jpg");
    await shareArrives();
    expect(app.pathname()).toBe("/share");
    await expect(back.press()).resolves.toBe(true);
    expect(app.pathname()).toBe("/settings");
    expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(copies.map(exists)).toEqual([false]);
  });
});

describe("a share the library kept from an earlier run of the screens", () => {
  it("is not read when the app opens at another screen: nothing is copied, shown or saved", async () => {
    shareImages("a.jpg");
    const app = await startApp("/");
    expect(app.pathname()).toBe("/");
    expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
    expect(screen.queryByText(t.onePhoto)).not.toBeOnTheScreen();
    await comesToFront();
    expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
    await addressArrives("what-mushroom-is-this://settings");
    expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
    expect(mockLog.finds.size).toBe(0);
  });
});

describe("a second share (SPEC 3.9: it takes the first one's place)", () => {
  it("replaces the share on the choice, and the first one's copies are removed as if it was cancelled", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    const first = shareImages("a.jpg");
    const app = await startApp("/share");
    expect(screen.getByText(t.onePhoto)).toBeOnTheScreen();
    await press(t.addToFind);
    expect(screen.getByText(t.chooseFind)).toBeOnTheScreen();
    const second = shareImages("b.jpg", "c.jpg");
    await comesToFront();
    expect(app.pathname()).toBe("/share");
    expect(screen.getByText(fillIn(t.severalPhotos, { count: "2" }))).toBeOnTheScreen();
    expect(screen.queryByText(t.onePhoto)).not.toBeOnTheScreen();
    // The new share starts at the choice, not in the first one's list of finds.
    expect(screen.queryByText(t.chooseFind)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
    expect(first.map(exists)).toEqual([false]);
    expect(second.map(exists)).toEqual([true, true]);
    expect(stored(1).photos).toHaveLength(1);
  });

  it("is added, not the first one, when a find is then chosen", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg");
    await startApp("/share");
    shareImages("b.jpg", "c.jpg");
    await comesToFront();
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(stored(1).photos).toHaveLength(3);
  });
});

describe("a find whose batch is open on a screen under the choice (SPEC 3.9)", () => {
  it("gets the photos into that batch, and the app goes back to that screen, not to a second one", async () => {
    mockLog.finds.set(1, findWith(1, 1));
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///mock/cache/ImagePicker/camera.jpg", width: 4032, height: 3024 }],
    } as never);
    const app = await startApp("/");
    await act(async () => {
      router.navigate("/new-find?find=1");
    });
    await settle();
    expect(stored(1).photos).toHaveLength(2);
    expect(stored(1).batchOpen).toBe(true);
    shareImages("a.jpg", "b.jpg");
    await shareArrives();
    expect(app.pathname()).toBe("/share");
    await press(t.addToFind);
    await fireEvent.press(screen.getByTestId("share-find-1"));
    await settle();
    expect(app.pathname()).toBe("/new-find");
    const find = stored(1);
    expect(find.photos).toHaveLength(4);
    // One batch: the camera's photo and the shared ones.
    expect(find.photos.slice(1).map((photo) => photo.batch)).toEqual([2, 2, 2]);
    expect(find.batchOpen).toBe(true);
    expect(
      screen.getByText(fillIn(en.newFind.photoCount, { count: "4", max: MAX })),
    ).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
    // The screen is the one the batch was opened on: Analyse there goes back to the Library.
    await press(en.newFind.analyse);
    expect(app.pathname()).toBe("/");
    expect(stored(1).batchOpen).toBe(false);
  });
});

describe("the first-start disclaimer and a share (SPEC 3.9)", () => {
  it("is shown first, with the share not read yet, and the choice once it is accepted", async () => {
    await AsyncStorage.removeItem(DISCLAIMER_ACCEPTED_KEY);
    mockLog.finds.set(1, findWith(1, 1));
    shareImages("a.jpg");
    const app = await startApp("/share");
    expect(screen.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByText(t.onePhoto)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.newFind })).not.toBeOnTheScreen();
    expect(Sharing.getResolvedSharedPayloadsAsync).not.toHaveBeenCalled();
    expect(mockLog.finds.size).toBe(1);
    await fireEvent.press(screen.getByRole("button", { name: en.firstStart.accept }));
    await settle();
    expect(app.pathname()).toBe("/share");
    expect(screen.getByText(t.onePhoto)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.newFind })).toBeEnabled();
    expect(stored(1).photos).toHaveLength(1);
  });
});
