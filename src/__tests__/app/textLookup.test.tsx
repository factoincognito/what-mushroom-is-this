/**
 * Tests of the text lookup screen (docs/SPEC.md 3.9, Lookups and Answers; PBI-2.4), through the
 * router: the description, the "Save" switch and its starting value in Settings, a saved lookup
 * becoming a find with the time of saving and the position, an unsaved lookup analysed on the
 * screen with its three error groups, and leaving the screen. The phone's location, the key store
 * and the network are stand-ins; the find log is in memory; the queue is the app's own, with
 * `fetch` replaced, and the app in the background so that no queue run starts by itself.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import * as Location from "expo-location";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { AppState, Linking } from "react-native";

import type { Answer, Match } from "../../analysis/answer";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { preparePhotoForAnalysis } from "../../image/prepareForAnalysis";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { TEXT_LOOKUP_SAVE_KEY } from "../../lookup/saveSetting";
import { phoneTimeNow } from "../../newFind/saveFind";
import { fetchDevicePicture, removePictureCopy } from "../../picture/devicePicture";
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
jest.mock("expo-location", () => ({
  Accuracy: { Highest: 5 },
  watchPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));
/*
 * Wikimedia, at the boundary of the picture's fetch (`src/picture/fetchPicture.test.ts` tests the
 * fetch itself): by default the picture waits, so the self-check waits as before PBI-2.9.
 */
jest.mock("../../picture/devicePicture", () => ({
  fetchDevicePicture: jest.fn(),
  removePictureCopy: jest.fn(),
}));
/** The picture prepared for the self-check, as the phone's encoder would give it (PBI-2.10). */
jest.mock("../../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(),
}));

const APP_DIR = "./src/app";
const en = STRINGS.en;
const DESCRIPTION = "A yellow funnel with false gills.";

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

/** The picture's bytes as the self-check sends them (PBI-2.10). */
const PICTURE_B64 = "UElDVFVSRQ==";

const BAD_REQUEST = reply(
  400,
  JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }),
);

const permission = (status: "granted" | "denied" | "undetermined", canAskAgain = true) => ({
  status,
  granted: status === "granted",
  canAskAgain,
  expires: "never",
});

/** The callback the screen gave watchPositionAsync, to send fixes through. */
let sendFix: ((fix: unknown) => void) | null;
let watchRemoved: number;
const fetchMock = jest.fn();

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
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-api03-abcDEF_123");
  mockLog.finds.clear();
  phoneIn("en");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
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
    .mocked(fetchDevicePicture)
    .mockResolvedValue({ kind: "waits", cause: "network", retryAtMs: null });
  jest
    .mocked(preparePhotoForAnalysis)
    .mockResolvedValue({ ok: true, imageBase64: PICTURE_B64, width: 1270, height: 952 });
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

async function openLookup(): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl: "/" });
  await app;
  await fireEvent.press(await screen.findByRole("link", { name: en.log.textLookup }));
  await settle();
  return { pathname: () => app.getPathname() };
}

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await resetStandIns();
  await openLookup();
});

async function describe_(text: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(en.lookup.input), text);
}

function saveSwitch() {
  return screen.getByRole("switch", { name: en.lookup.save });
}

async function setSave(on: boolean): Promise<void> {
  await fireEvent(saveSwitch(), "valueChange", on);
}

async function analyse(): Promise<void> {
  await fireEvent.press(screen.getByRole("button", { name: en.lookup.analyse }));
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
    throw new Error("expected one text find");
  }
  return find;
}

describe("opening the text lookup (SPEC 3.9, Lookups)", () => {
  it("opens from the Log, asks for the location the first time, starts asking for a position, with Save off", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(wrong(permission("undetermined")));
    const app = await openLookup();
    expect(app.pathname()).toBe("/text-lookup");
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(saveSwitch()).toHaveProp("value", false);
    expect(screen.getByText(en.lookup.saveHint)).toBeOnTheScreen();
  });

  it("does not ask for the location again once refused, and says a saved lookup gets no position", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(wrong(permission("denied")));
    await openLookup();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(screen.getByText(en.lookup.locationDenied)).toBeOnTheScreen();
  });

  it("starts with Save on when Settings holds that", async () => {
    await AsyncStorage.setItem(TEXT_LOOKUP_SAVE_KEY, "on");
    await openLookup();
    expect(saveSwitch()).toHaveProp("value", true);
  });

  it("counts the characters written against the limit", async () => {
    await openLookup();
    await describe_(DESCRIPTION);
    expect(
      screen.getByText(
        en.lookup.count.replace("{count}", String(DESCRIPTION.length)).replace("{max}", "2000"),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(en.lookup.input)).toHaveProp("maxLength", 2000);
  });

  it("does not analyse an empty description, and says so", async () => {
    await openLookup();
    await describe_("   ");
    await analyse();
    expect(screen.getByText(en.lookup.empty)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLog.finds.size).toBe(0);
  });
});

describe("an unsaved lookup (Save off)", () => {
  it("is analysed on the screen and shows the answer with the disclaimer for a lookup without photos, storing nothing", async () => {
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(edibility.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
    expect(edibility.queryByText(en.disclaimer)).not.toBeOnTheScreen();
    // An answer from the text alone: unknown until a self-check agrees, which has not run (SPEC 3.9).
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(edibility.getByText(en.find.selfCheck.waiting)).toBeOnTheScreen();
    expect(
      edibility.queryByText(en.find.edibility.replace("{edibility}", en.find.edibilities.edible)),
    ).not.toBeOnTheScreen();
    expect(screen.getByText("Claude's confidence in the match: 90 of 100")).toBeOnTheScreen();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: DESCRIPTION });
    expect(mockLog.finds.size).toBe(0);
  });

  it.each([
    ["no_mushroom", en.find.noMushroomDescribed],
    ["cannot_tell", en.find.cannotTellDescribed],
  ] as const)("says %s in the words of a description", async (result, text) => {
    fetchMock.mockResolvedValueOnce(apiAnswer({ result }));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it("no network: keeps the lookup, says why, and offers to turn Save on; then Analyse saves it as a waiting find", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    const app = await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(en.queue.paused.network)).toBeOnTheScreen();
    expect(screen.getByLabelText(en.lookup.input)).toHaveProp("value", DESCRIPTION);
    await fireEvent.press(screen.getByRole("button", { name: en.lookup.turnSaveOn }));
    expect(saveSwitch()).toHaveProp("value", true);
    await analyse();
    await runTimers();
    await settle();
    const find = onlyFind();
    expect(find).toMatchObject({ text: DESCRIPTION, analysis: { state: "waiting" } });
    expect(app.pathname()).toBe(`/find/${find.id}`);
  });

  it("without a key: says a key is needed, links to Settings and offers to turn Save on", async () => {
    mockSecrets.clear();
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(en.queue.stopped.noKey)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.queue.openSettings })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.lookup.turnSaveOn })).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 400: shows the failure, offers no Save, and Analyse can be tapped again", async () => {
    fetchMock.mockResolvedValueOnce(BAD_REQUEST).mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(en.queue.failed.request.wrong)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.lookup.turnSaveOn })).not.toBeOnTheScreen();
    await analyse();
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a 401: stops the queue as for a find and shows the same message, which the Log shows too", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, "{}"));
    const app = await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(en.queue.stopped.keyRefused)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.queue.openSettings })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.lookup.turnSaveOn })).not.toBeOnTheScreen();
    // With nothing written, the screen is left without a question.
    await describe_("");
    await goBack();
    expect(app.pathname()).toBe("/");
    expect(await screen.findByText(en.queue.stopped.keyRefused)).toBeOnTheScreen();
  });

  it("asks before leaving with a description entered, on the screen; Stay keeps it, and the second answer leaves with nothing saved", async () => {
    const app = await openLookup();
    await describe_(DESCRIPTION);
    await goBack();
    expect(app.pathname()).toBe("/text-lookup");
    expect(screen.getByText(en.lookup.leaveConfirm)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.lookup.leaveCancel }));
    expect(screen.queryByText(en.lookup.leaveConfirm)).not.toBeOnTheScreen();
    expect(screen.getByLabelText(en.lookup.input)).toHaveProp("value", DESCRIPTION);
    await goBack();
    await fireEvent.press(screen.getByRole("button", { name: en.lookup.leaveYes }));
    await settle();
    await runTimers();
    await settle();
    expect(app.pathname()).toBe("/");
    expect(mockLog.finds.size).toBe(0);
    expect(watchRemoved).toBe(1);
  });

  it("leaves without asking when nothing is written", async () => {
    const app = await openLookup();
    await goBack();
    expect(app.pathname()).toBe("/");
    expect(screen.queryByText(en.lookup.leaveConfirm)).not.toBeOnTheScreen();
  });
});

describe("a saved lookup (Save on)", () => {
  it("becomes a find when Analyse is tapped, with the time of saving and the position, and its screen opens", async () => {
    const app = await openLookup();
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await setSave(true);
    await describe_(DESCRIPTION);
    await analyse();
    await runTimers();
    await settle();
    const find = onlyFind();
    expect(find.text).toBe(DESCRIPTION);
    expect(find.photos).toEqual([]);
    expect(find.position).toEqual({
      latitude: 59.66,
      longitude: 17.1,
      accuracyM: 9,
      source: "fix",
    });
    expect(find.time.source).toBe("saved");
    expect(find.time.utcOffsetMinutes).toBe(
      phoneTimeNow(new Date(find.time.takenAtMs)).utcOffsetMinutes,
    );
    expect(app.pathname()).toBe(`/find/${find.id}`);
    expect(await screen.findByText(DESCRIPTION)).toBeOnTheScreen();
    expect(screen.getByText(en.find.waiting)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("becomes a find when the screen is left with a description entered, asking nothing, and the Log lists it", async () => {
    const app = await openLookup();
    await setSave(true);
    await describe_(DESCRIPTION);
    await goBack();
    expect(screen.queryByText(en.lookup.leaveConfirm)).not.toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(onlyFind()).toMatchObject({ text: DESCRIPTION, position: null });
    expect(within(await screen.findByTestId("find-row-1")).getByText(en.log.waiting)).toBeTruthy();
  });

  it("adds the first fix that comes after it was saved without a position, also once the screen is gone", async () => {
    await openLookup();
    await setSave(true);
    await describe_(DESCRIPTION);
    // No timers are run here: the 30-second wait for the first fix is one of them.
    await analyse();
    await settle();
    expect(onlyFind().position).toBeNull();
    expect(watchRemoved).toBe(0);
    await act(async () => sendFix?.(fix(59.66, 17.1, 9)));
    await settle();
    expect(onlyFind().position).toEqual({
      latitude: 59.66,
      longitude: 17.1,
      accuracyM: 9,
      source: "fix",
    });
    expect(watchRemoved).toBe(1);
  });

  it("says so when it cannot be saved, and keeps the description on the screen", async () => {
    jest.spyOn(mockLog, "addText").mockRejectedValueOnce(new Error("database is locked"));
    const app = await openLookup();
    await setSave(true);
    await describe_(DESCRIPTION);
    await analyse();
    expect(screen.getByText(en.lookup.saveFailed)).toBeOnTheScreen();
    expect(screen.queryByText(/locked/)).not.toBeOnTheScreen();
    expect(app.pathname()).toBe("/text-lookup");
    expect(screen.getByLabelText(en.lookup.input)).toHaveProp("value", DESCRIPTION);
  });
});

describe("an unsaved lookup's representative picture (SPEC 3.9; PBI-2.9)", () => {
  const PICTURE = {
    uri: "file:///cache/picture-2.jpg",
    author: "Example Photographer",
    licence: "cc-by-sa-3.0",
    page: "https://commons.wikimedia.org/wiki/File:Chanterelle_Cantharellus_cibarius.jpg",
  };
  const label = en.find.picture.label.replace("{name}", CHANTERELLE.names.en);

  it("shows the species' picture, labelled as not of the user's mushroom, with its author, licence and page, from Wikimedia Commons", async () => {
    jest.mocked(fetchDevicePicture).mockResolvedValueOnce({ kind: "picture", picture: PICTURE });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    // The self-check's request does not get through, so the check waits.
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByLabelText(label)).toHaveProp("source", { uri: PICTURE.uri });
    expect(screen.getByText(en.find.picture.caption)).toBeOnTheScreen();
    expect(
      screen.getByText(en.find.picture.author.replace("{author}", PICTURE.author)),
    ).toBeOnTheScreen();
    expect(screen.getByText(en.find.picture.resized)).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole("link", {
        name: en.find.picture.licence.replace("{licence}", "CC BY-SA 3.0"),
      }),
    );
    expect(openURL).toHaveBeenCalledWith("https://creativecommons.org/licenses/by-sa/3.0/");
    await fireEvent.press(screen.getByRole("link", { name: en.find.picture.page }));
    expect(openURL).toHaveBeenLastCalledWith(PICTURE.page);
    // Only the Latin name goes to Wikimedia.
    expect(fetchDevicePicture).toHaveBeenCalledWith("Cantharellus cibarius", "claude-opus-5-5");
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(edibility.getByText(en.find.selfCheck.waiting)).toBeOnTheScreen();
    expect(mockLog.finds.size).toBe(0);
  });

  it("removes the app's copy when the screen is left", async () => {
    jest.mocked(fetchDevicePicture).mockResolvedValueOnce({ kind: "picture", picture: PICTURE });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    await screen.findByLabelText(label);
    expect(removePictureCopy).not.toHaveBeenCalled();
    await goBack();
    await fireEvent.press(screen.getByRole("button", { name: en.lookup.leaveYes }));
    await settle();
    await runTimers();
    await settle();
    expect(removePictureCopy).toHaveBeenCalledWith(PICTURE.uri);
  });

  it("when the picture waits, says so and offers Check again, which shows it", async () => {
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    expect(await screen.findByText(en.lookup.pictureWaits)).toBeOnTheScreen();
    jest.mocked(fetchDevicePicture).mockResolvedValueOnce({ kind: "picture", picture: PICTURE });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await fireEvent.press(screen.getByRole("button", { name: en.lookup.checkAgain }));
    await settle();
    expect(await screen.findByLabelText(label)).toBeOnTheScreen();
    expect(screen.queryByText(en.lookup.pictureWaits)).not.toBeOnTheScreen();
    // The description was analysed once; the second request is the check on the picture.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(en.find.selfCheck.agreed)).toBeOnTheScreen();
  });

  it("with no picture for the answer, says the edibility could not be checked", async () => {
    jest.mocked(fetchDevicePicture).mockResolvedValueOnce({ kind: "none", reason: "licence" });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(en.find.selfCheck.noPicture)).toBeOnTheScreen();
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.lookup.checkAgain })).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("credits the picture in %s", async (lang) => {
    phoneIn(lang);
    const t = STRINGS[lang];
    jest
      .mocked(fetchDevicePicture)
      .mockResolvedValueOnce({ kind: "picture", picture: { ...PICTURE, licence: "pd" } });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await fireEvent.press(await screen.findByRole("link", { name: t.log.textLookup }));
    await settle();
    await fireEvent.changeText(screen.getByLabelText(t.lookup.input), DESCRIPTION);
    await fireEvent.press(screen.getByRole("button", { name: t.lookup.analyse }));
    await settle();
    expect(
      await screen.findByLabelText(t.find.picture.label.replace("{name}", CHANTERELLE.names[lang])),
    ).toBeOnTheScreen();
    expect(screen.getByText(t.find.picture.caption)).toBeOnTheScreen();
    expect(
      screen.getByText(t.find.picture.licence.replace("{licence}", t.find.picture.publicDomain)),
    ).toBeOnTheScreen();
  });
});

describe("an unsaved lookup's self-check (SPEC 3.9; PBI-2.10)", () => {
  const PICTURE = {
    uri: "file:///cache/picture-2.jpg",
    author: "Example Photographer",
    licence: "cc-by-sa-3.0",
    page: "https://commons.wikimedia.org/wiki/File:Chanterelle_Cantharellus_cibarius.jpg",
  };
  const FALSE_CHANTERELLE: Match = {
    ...CHANTERELLE,
    names: {
      sv: "Narrkantarell",
      en: "False chanterelle",
      la: "Hygrophoropsis aurantiaca",
      it: "Falso gallinaccio",
    },
  };
  const shown = (edibility: string) =>
    en.find.edibility.replace("{edibility}", en.find.edibilities[edibility as "edible"]);

  /** Analyses the description; the check's request gets `checkReply`. */
  async function lookUp(checkReply: unknown): Promise<void> {
    jest.mocked(fetchDevicePicture).mockResolvedValueOnce({ kind: "picture", picture: PICTURE });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    if (checkReply instanceof Error) {
      fetchMock.mockRejectedValueOnce(checkReply);
    } else {
      fetchMock.mockResolvedValueOnce(checkReply);
    }
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    await settle();
  }

  /** The body of the self-check's request, the second the screen sent. */
  function checkRequest(): { messages: { content: unknown[] }[] } {
    return JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  }

  it("runs at once on the picture alone, as Image 1:, without the description; when it agrees, says so and shows the answer's edibility", async () => {
    await lookUp(apiAnswer(CHANTERELLE));
    expect(preparePhotoForAnalysis).toHaveBeenCalledWith(
      PICTURE.uri,
      "claude-opus-5-5",
      expect.anything(),
    );
    const content = checkRequest().messages[0]?.content ?? [];
    expect(content.slice(0, 2)).toEqual([
      { type: "text", text: "Image 1:" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: PICTURE_B64 } },
    ]);
    expect(JSON.stringify(content)).not.toContain(DESCRIPTION);
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(edibility.getByText(en.find.selfCheck.agreed)).toBeOnTheScreen();
    expect(edibility.getByText(shown("edible"))).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.lookup.checkAgain })).not.toBeOnTheScreen();
    expect(mockLog.finds.size).toBe(0);
  });

  it("when the check names another species, says so, names both, and the edibility is unknown", async () => {
    await lookUp(apiAnswer(FALSE_CHANTERELLE));
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(
      edibility.getByText(
        en.find.selfCheck.disagreed
          .replace("{matched}", CHANTERELLE.names.en)
          .replace("{named}", FALSE_CHANTERELLE.names.en),
      ),
    ).toBeOnTheScreen();
    expect(edibility.getByText(shown("unknown"))).toBeOnTheScreen();
  });

  it("when the check cannot name a species, says so, and the edibility is unknown", async () => {
    await lookUp(apiAnswer({ result: "no_mushroom" }));
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(edibility.getByText(en.find.selfCheck.noSpecies)).toBeOnTheScreen();
    expect(edibility.getByText(shown("unknown"))).toBeOnTheScreen();
  });

  it("without a network, says the check waits, why, and offers Check again, which runs the check alone", async () => {
    await lookUp(new TypeError("Network request failed"));
    expect(screen.getByText(en.lookup.checkWaits)).toBeOnTheScreen();
    expect(screen.getByText(en.queue.paused.network)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId("match-edibility")).getByText(shown("unknown")),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.lookup.turnSaveOn })).not.toBeOnTheScreen();
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await fireEvent.press(screen.getByRole("button", { name: en.lookup.checkAgain }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchDevicePicture).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en.lookup.checkWaits)).not.toBeOnTheScreen();
    expect(screen.getByText(en.find.selfCheck.agreed)).toBeOnTheScreen();
  });

  it("a 401 stops the queue as for a find: the check waits with the same message and a link to Settings", async () => {
    await lookUp(
      reply(
        401,
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
      ),
    );
    expect(screen.getByText(en.lookup.checkWaits)).toBeOnTheScreen();
    expect(screen.getByText(en.queue.stopped.keyRefused)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.queue.openSettings })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.lookup.checkAgain })).toBeOnTheScreen();
  });

  it("a 400 marks the check failed: the find says it could not be checked, with no Check again", async () => {
    await lookUp(BAD_REQUEST);
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(edibility.getByText(en.find.selfCheck.failed)).toBeOnTheScreen();
    expect(edibility.getByText(shown("unknown"))).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.lookup.checkAgain })).not.toBeOnTheScreen();
  });

  it("an error in the app while checking: says so, and offers Check again", async () => {
    jest
      .mocked(preparePhotoForAnalysis)
      .mockRejectedValueOnce(new Error("No space left on device"));
    jest.mocked(fetchDevicePicture).mockResolvedValueOnce({ kind: "picture", picture: PICTURE });
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await openLookup();
    await describe_(DESCRIPTION);
    await analyse();
    await settle();
    expect(screen.getByText(en.lookup.checkError)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.lookup.checkAgain })).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the starting value in Settings (SPEC 3.9)", () => {
  it("is off, and turning it on there makes the next text lookup start with Save on", async () => {
    const app = renderRouter(APP_DIR, { initialUrl: "/settings" });
    await app;
    const setting = await screen.findByRole("switch", { name: en.settings.lookups.textSave });
    expect(setting).toHaveProp("value", false);
    await fireEvent(setting, "valueChange", true);
    await settle();
    expect(await AsyncStorage.getItem(TEXT_LOOKUP_SAVE_KEY)).toBe("on");
    expect(screen.getByRole("switch", { name: en.settings.lookups.textSave })).toHaveProp(
      "value",
      true,
    );
    await act(async () => {
      router.replace("/text-lookup");
    });
    await settle();
    expect(saveSwitch()).toHaveProp("value", true);
  });

  it("says so when the value cannot be saved, and shows the value kept", async () => {
    const app = renderRouter(APP_DIR, { initialUrl: "/settings" });
    await app;
    const setting = await screen.findByRole("switch", { name: en.settings.lookups.textSave });
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("storage is full"));
    await fireEvent(setting, "valueChange", true);
    await settle();
    expect(screen.getByText(en.settings.lookups.saveFailed)).toBeOnTheScreen();
    expect(screen.getByRole("switch", { name: en.settings.lookups.textSave })).toHaveProp(
      "value",
      false,
    );
  });
});

describe("in the app's language", () => {
  it.each(["sv", "it"] as const)("is in %s, its disclaimer too", async (lang) => {
    phoneIn(lang);
    const t = STRINGS[lang];
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    const app = renderRouter(APP_DIR, { initialUrl: "/" });
    await app;
    await fireEvent.press(await screen.findByRole("link", { name: t.log.textLookup }));
    await settle();
    await fireEvent.changeText(screen.getByLabelText(t.lookup.input), DESCRIPTION);
    await fireEvent.press(screen.getByRole("button", { name: t.lookup.analyse }));
    await settle();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(t.disclaimerDescribed)).toBeOnTheScreen();
    expect(edibility.getByText(t.find.selfCheck.waiting)).toBeOnTheScreen();
    expect(screen.getByRole("switch", { name: t.lookup.save })).toBeOnTheScreen();
  });
});

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}
