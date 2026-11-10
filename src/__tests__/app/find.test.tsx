/**
 * The Find screen (docs/SPEC.md 3.1, 3.3, 3.5; PBI-1.8), through the router: the photo, the names,
 * the edibility with the disclaimer, the confidence and its note, the general information, the
 * look-alikes, the time and the position with their sources and the map link, "analyse again"
 * through the queue, and delete after a confirmation; a failed find's cause; a find that does not
 * exist or that the store cannot read. The native modules are mocked at their boundary, the find
 * log is in memory, and the app is in the background so that no queue run starts by itself.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { AppState, Linking, Platform } from "react-native";

import type { Answer, Match } from "../../analysis/answer";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { fillIn, formatFindTime, mapLink } from "../../find/display";
import { STRINGS } from "../../i18n/strings";
import { preparePhotoForAnalysis } from "../../image/prepareForAnalysis";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { answerToJson } from "../../store/answerJson";
import { openFindLog } from "../../store/deviceFindStore";
import { type Find, type StoredFind, StoreError } from "../../store/find";
import { createFindStore } from "../../store/findStore";
import {
  analysisFailure,
  encoderOf,
  http,
  JPEG,
  jpegWith,
  messageBody,
  photoFailure,
  unloadableEncoder,
} from "../../testing/failureDetails";
import { memoryFindLog } from "../../testing/memoryFindLog";
import { memoryPhotos, memorySqlite, sqliteDatabase } from "../../testing/sqliteDatabase";
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
jest.mock("../../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));

const APP_DIR = "./src/app";
const en = STRINGS.en;

/** The image module as it is, for the failures it really stores; the screen gets the mock. */
const { preparePhotoForAnalysis: actualPrepare } = jest.requireActual<
  typeof import("../../image/prepareForAnalysis")
>("../../image/prepareForAnalysis");

/** What no failure on the screen may show: the stored codes, markers, statuses and paths. */
const INTERNAL =
  /0x|forbidden-segment|trailing-data|load-failed|invalid-size|request-wrong|request-too-large|stop_reason|status|file:/;

const FLY_AGARIC = {
  sv: "Röd flugsvamp",
  en: "Fly agaric",
  la: "Amanita muscaria",
  it: "Ovolo malefico",
};
const DESTROYING_ANGEL = {
  sv: "Vit flugsvamp",
  en: "Destroying angel",
  la: "Amanita virosa",
  it: "Tignosa bianca",
};

const CHANTERELLE: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: {
    sv: "En gul svamp i mossig skog.",
    en: "A yellow mushroom of mossy woods.",
    it: "Un fungo giallo dei boschi muschiosi.",
  },
  lookAlikes: [
    { names: FLY_AGARIC, edibility: "poisonous" },
    { names: DESTROYING_ANGEL, edibility: "deadly_poisonous" },
  ],
};

const PORCINI: Match = {
  ...CHANTERELLE,
  names: { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" },
  generalInformation: { sv: "En sopp.", en: "A bolete.", it: "Un boleto." },
  lookAlikes: [],
};

const TAKEN = { takenAtMs: Date.UTC(2026, 8, 14, 13, 42), utcOffsetMinutes: 120 };

function done(answer: Answer): Find["analysis"] {
  return { state: "done", answer, model: "claude-opus-5-5", analysedAtMs: TAKEN.takenAtMs };
}

function aFind(analysis: Find["analysis"], change: Partial<Find> = {}): Find {
  return {
    id: 1,
    photoUri: "file:///photos/1.jpg",
    time: { ...TAKEN, source: "saved" },
    position: { latitude: 59.6995, longitude: 17.1234, accuracyM: 12.4, source: "fix" },
    analysis,
    ...change,
  };
}

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

const BAD_REQUEST = reply(
  400,
  JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }),
);

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

async function startApp(initialUrl = "/find/1"): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl });
  await app;
  return { pathname: () => app.getPathname() };
}

const fetchMock = jest.fn();

/** Sets the stand-ins each test starts from. */
async function resetStandIns(): Promise<void> {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-api03-abcDEF_123");
  mockLog.finds.clear();
  phoneIn("en");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  jest.mocked(preparePhotoForAnalysis).mockReset();
  jest
    .mocked(preparePhotoForAnalysis)
    .mockResolvedValue({ ok: true, imageBase64: "AAAA", width: 2212, height: 1659 });
  Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
}

beforeEach(resetStandIns);

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await resetStandIns();
  mockLog.finds.set(1, aFind(done(CHANTERELLE)));
  await startApp();
  await screen.findByTestId("match-names");
});

afterAll(() => {
  Object.defineProperty(AppState, "currentState", { value: undefined, configurable: true });
});

describe("an analysed find (SPEC 3.1)", () => {
  it("shows the photo and the names in the app's language, in Latin and in the other two", async () => {
    mockLog.finds.set(1, aFind(done(CHANTERELLE)));
    await startApp();
    expect(await screen.findByLabelText(en.find.photo)).toHaveProp("source", {
      uri: "file:///photos/1.jpg",
    });
    const names = within(screen.getByTestId("match-names"));
    expect(names.getByRole("header", { name: "Chanterelle" })).toBeOnTheScreen();
    expect(names.getByText("Cantharellus cibarius")).toBeOnTheScreen();
    expect(names.getByText("Kantarell")).toBeOnTheScreen();
    expect(names.getByText("Gallinaccio")).toBeOnTheScreen();
    expect(names.getByText(en.find.latin)).toBeOnTheScreen();
    expect(names.getByText(STRINGS.sv.languageName)).toBeOnTheScreen();
    expect(names.getByText(STRINGS.it.languageName)).toBeOnTheScreen();
  });

  it("shows the edibility as that of the matched species, with the disclaimer next to it", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, edibility: "edible_after_preparation" })));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(
      edibility.getByText(
        en.find.edibility.replace("{edibility}", en.find.edibilities.edibleAfterPreparation),
      ),
    ).toBeOnTheScreen();
    expect(edibility.getByText(en.disclaimer)).toBeOnTheScreen();
  });

  it("shows Claude's confidence from 1 to 100 as a number, with the note that it is Claude's own statement (SPEC 3.9)", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, confidence: 90 })));
    await startApp();
    expect(
      await screen.findByText("Claude's confidence in the match: 90 of 100"),
    ).toBeOnTheScreen();
    expect(screen.getByText(en.find.confidenceNote)).toBeOnTheScreen();
  });

  it("shows unknown below a confidence of 70, whatever was stored, still with the disclaimer (SPEC 3.9)", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, edibility: "edible", confidence: 69 })));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(edibility.queryByText(en.find.edibilities.edible, { exact: false })).toBeNull();
    expect(edibility.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(screen.getByText("Claude's confidence in the match: 69 of 100")).toBeOnTheScreen();
  });

  it("shows the edibility from a confidence of 70 (SPEC 3.9)", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, edibility: "poisonous", confidence: 70 })));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.poisonous)),
    ).toBeOnTheScreen();
  });

  it("keeps a look-alike's own edibility below a confidence of 70 (SPEC 3.9)", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, confidence: 20 })));
    await startApp();
    const second = within(await screen.findByTestId("look-alike-1"));
    expect(
      second.getByText(
        en.find.lookAlikeEdibility.replace("{edibility}", en.find.edibilities.deadlyPoisonous),
      ),
    ).toBeOnTheScreen();
  });

  it("shows unknown when the confidence is low, whatever was stored, still with the disclaimer", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, edibility: "edible", confidence: "low" })));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(edibility.queryByText(en.find.edibilities.edible, { exact: false })).toBeNull();
    expect(edibility.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(
      screen.getByText(en.find.confidence.replace("{confidence}", en.find.confidences.low)),
    ).toBeOnTheScreen();
  });

  it("shows a Phase 1 find's level in words, with the note that it is Claude's own statement", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, confidence: "medium" })));
    await startApp();
    expect(
      await screen.findByText(
        en.find.confidence.replace("{confidence}", en.find.confidences.medium),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(en.find.confidenceNote)).toBeOnTheScreen();
  });

  it("shows the general information in the app's language only", async () => {
    mockLog.finds.set(1, aFind(done(CHANTERELLE)));
    await startApp();
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: en.find.generalInformation })).toBeOnTheScreen();
    expect(screen.queryByText(CHANTERELLE.generalInformation.sv)).not.toBeOnTheScreen();
    expect(screen.queryByText(CHANTERELLE.generalInformation.it)).not.toBeOnTheScreen();
  });

  it("lists the poisonous look-alikes, each with its four names and its edibility", async () => {
    mockLog.finds.set(1, aFind(done(CHANTERELLE)));
    await startApp();
    expect(await screen.findByRole("header", { name: en.find.lookAlikes })).toBeOnTheScreen();
    const first = within(screen.getByTestId("look-alike-0"));
    for (const name of Object.values(FLY_AGARIC)) {
      expect(first.getByText(name)).toBeOnTheScreen();
    }
    expect(
      first.getByText(
        en.find.lookAlikeEdibility.replace("{edibility}", en.find.edibilities.poisonous),
      ),
    ).toBeOnTheScreen();
    const second = within(screen.getByTestId("look-alike-1"));
    for (const name of Object.values(DESTROYING_ANGEL)) {
      expect(second.getByText(name)).toBeOnTheScreen();
    }
    expect(
      second.getByText(
        en.find.lookAlikeEdibility.replace("{edibility}", en.find.edibilities.deadlyPoisonous),
      ),
    ).toBeOnTheScreen();
  });

  it("keeps a look-alike's own edibility when the match's confidence is low", async () => {
    mockLog.finds.set(1, aFind(done({ ...CHANTERELLE, confidence: "low" })));
    await startApp();
    const second = within(await screen.findByTestId("look-alike-1"));
    expect(
      second.getByText(
        en.find.lookAlikeEdibility.replace("{edibility}", en.find.edibilities.deadlyPoisonous),
      ),
    ).toBeOnTheScreen();
  });

  it("says so when Claude named no look-alikes", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    await startApp();
    expect(await screen.findByText(en.find.noLookAlikes)).toBeOnTheScreen();
    expect(screen.queryByTestId("look-alike-0")).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("is in %s, the app's language", async (lang) => {
    phoneIn(lang);
    const t = STRINGS[lang];
    mockLog.finds.set(1, aFind(done(CHANTERELLE)));
    await startApp();
    const names = within(await screen.findByTestId("match-names"));
    expect(names.getByRole("header", { name: CHANTERELLE.names[lang] })).toBeOnTheScreen();
    expect(names.getByText(STRINGS.en.languageName)).toBeOnTheScreen();
    expect(within(screen.getByTestId("match-edibility")).getByText(t.disclaimer)).toBeTruthy();
    expect(
      screen.getByText(t.find.edibility.replace("{edibility}", t.find.edibilities.edible)),
    ).toBeOnTheScreen();
    expect(screen.getByText(CHANTERELLE.generalInformation[lang])).toBeOnTheScreen();
    expect(screen.getByText(t.find.confidenceNote)).toBeOnTheScreen();
    expect(
      screen.getByText(
        t.find.confidence.replace(
          "{confidence}",
          t.find.confidenceScore.replace("{score}", String(CHANTERELLE.confidence)),
        ),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.find.analyseAgain })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.find.delete })).toBeOnTheScreen();
  });
});

describe("an answer that names no species", () => {
  it.each([
    ["no_mushroom", en.find.noMushroom],
    ["cannot_tell", en.find.cannotTell],
  ] as const)("%s says so, with no edibility", async (result, text) => {
    mockLog.finds.set(1, aFind(done({ result })));
    await startApp();
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.queryByTestId("match-edibility")).not.toBeOnTheScreen();
    expect(screen.queryByText(en.find.confidenceNote)).not.toBeOnTheScreen();
  });
});

describe("the time and the position, with where each came from (SPEC 3.1, 3.6)", () => {
  it("shows the time at its own offset, the coordinates, the accuracy and the sources", async () => {
    const find = aFind(done(PORCINI));
    mockLog.finds.set(1, find);
    await startApp();
    expect(
      await screen.findByText(en.find.time.replace("{time}", formatFindTime(find.time, "en"))),
    ).toBeOnTheScreen();
    expect(screen.getByText(en.find.timeSources.saved)).toBeOnTheScreen();
    expect(
      screen.getByText(en.find.position.replace("{coordinates}", "59.69950, 17.12340")),
    ).toBeOnTheScreen();
    expect(screen.getByText(en.find.accuracy.replace("{metres}", "12"))).toBeOnTheScreen();
    expect(screen.getByText(en.find.positionSources.fix)).toBeOnTheScreen();
  });

  it.each([
    ["photo", en.find.timeSources.photo],
    ["photo-phone-offset", en.find.timeSources.photoPhoneOffset],
  ] as const)("says the time came from %s", async (source, text) => {
    mockLog.finds.set(1, aFind(done(PORCINI), { time: { ...TAKEN, source } }));
    await startApp();
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it.each([
    ["last-known", en.find.positionSources.lastKnown],
    ["photo", en.find.positionSources.photo],
  ] as const)(
    "says the position came from %s, and gives no accuracy the phone did not",
    async (source, text) => {
      mockLog.finds.set(
        1,
        aFind(done(PORCINI), { position: { latitude: 1, longitude: 2, accuracyM: null, source } }),
      );
      await startApp();
      expect(await screen.findByText(text)).toBeOnTheScreen();
      const accuracyStart = en.find.accuracy.slice(0, en.find.accuracy.indexOf("{"));
      expect(screen.queryByText(accuracyStart, { exact: false })).not.toBeOnTheScreen();
    },
  );

  it("says a find has no position, and offers no map link", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI), { position: null }));
    await startApp();
    expect(await screen.findByText(en.find.noPosition)).toBeOnTheScreen();
    expect(screen.queryByRole("link", { name: en.find.openMap })).not.toBeOnTheScreen();
  });

  it("opens the phone's own map app at the position, with no network call", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValueOnce(true);
    const find = aFind(done(PORCINI));
    mockLog.finds.set(1, find);
    await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: en.find.openMap }));
    expect(openURL).toHaveBeenCalledWith(
      mapLink({ latitude: 59.6995, longitude: 17.1234 }, Platform),
    );
    expect(find.position).toMatchObject({ latitude: 59.6995, longitude: 17.1234 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["18.4", "https://maps.apple.com/place?coordinate=59.699500,17.123400"],
    ["17.5", "https://maps.apple.com/?ll=59.699500,17.123400&q=59.699500,17.123400"],
  ])("on iOS %s, opens the form of the map link for that version", async (version, url) => {
    expect(Platform.OS).toBe("ios");
    const versionNow = jest.spyOn(Platform, "Version", "get").mockReturnValue(version);
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValueOnce(true);
    mockLog.finds.set(1, aFind(done(PORCINI)));
    await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: en.find.openMap }));
    expect(openURL).toHaveBeenLastCalledWith(url);
    versionNow.mockRestore();
  });

  it("opens no map app for a position out of range, and says the position could not be opened", async () => {
    const openURL = jest.spyOn(Linking, "openURL");
    openURL.mockClear();
    mockLog.finds.set(
      1,
      aFind(done(PORCINI), {
        position: { latitude: 91, longitude: 0, accuracyM: null, source: "photo" },
      }),
    );
    await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: en.find.openMap }));
    expect(await screen.findByText(en.find.mapFailed)).toBeOnTheScreen();
    expect(openURL).not.toHaveBeenCalled();
  });

  it("says so when no map app can open the position", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("No Activity found"));
    mockLog.finds.set(1, aFind(done(PORCINI)));
    await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: en.find.openMap }));
    expect(await screen.findByText(en.find.mapFailed)).toBeOnTheScreen();
  });
});

describe("a waiting or failed find", () => {
  it("says a find waits, offers to analyse it now, and shows no edibility", async () => {
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    await startApp();
    expect(await screen.findByText(en.find.waiting)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.find.analyse })).toBeOnTheScreen();
    expect(screen.queryByText(en.disclaimer)).not.toBeOnTheScreen();
  });

  it("names the marker a segment check refused in plain words, as the image module stored it", async () => {
    const failure = await photoFailure(actualPrepare, encoderOf(jpegWith(JPEG.EXIF)));
    expect(failure).toEqual({ cause: "segment-check", detail: "forbidden-segment 0xFFE1" });
    mockLog.finds.set(1, aFind({ state: "failed", failure }));
    await startApp();
    expect(await screen.findByText(en.find.failed)).toBeOnTheScreen();
    expect(screen.getByText(en.queue.failed.segmentCheck.app1)).toBeOnTheScreen();
    expect(screen.queryByText(INTERNAL)).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.find.analyseAgain })).toBeOnTheScreen();
  });

  it.each([
    [
      "a photo that cannot be loaded",
      () =>
        photoFailure(
          actualPrepare,
          unloadableEncoder(new Error("Could not load the image: file:///data/photos/p1.jpg")),
        ),
      en.queue.failed.photo.loadFailed,
    ],
    [
      "a photo whose size cannot be used",
      () => photoFailure(actualPrepare, encoderOf(jpegWith(), 0, 3024)),
      en.queue.failed.photo.invalidSize,
    ],
    ["a wrong request", () => analysisFailure(http(400, "{}")), en.queue.failed.request.wrong],
    ["a request too large", () => analysisFailure(http(413, "")), en.queue.failed.request.tooLarge],
    [
      "an answer not from the API",
      () => analysisFailure(http(200, "<html>Wi-Fi</html>")),
      en.queue.failed.answer.notApi,
    ],
    [
      "an answer cut off",
      () => analysisFailure(http(200, messageBody([], "max_tokens"))),
      en.queue.failed.answer.cutOff,
    ],
    [
      "an answer off the shape",
      () => analysisFailure(http(200, messageBody([{ type: "text", text: '{"result":"x"}' }]))),
      en.queue.failed.answer.shape,
    ],
    [
      "a refusal",
      () => analysisFailure(http(200, messageBody([], "refusal"))),
      en.queue.failed.refused,
    ],
  ] as const)("names %s in plain words, as the app stored it", async (_name, make, sentence) => {
    mockLog.finds.set(1, aFind({ state: "failed", failure: await make() }));
    await startApp();
    expect(await screen.findByText(sentence)).toBeOnTheScreen();
    expect(screen.queryByText(INTERNAL)).not.toBeOnTheScreen();
  });

  it("says a key is needed and links to Settings when analysing it finds no key (SPEC 3.2)", async () => {
    mockSecrets.clear();
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(await screen.findByText(en.queue.stopped.noKey)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("link", { name: en.queue.openSettings }));
    expect(app.pathname()).toBe("/settings");
  });
});

describe("a waiting find when the queue has stopped or paused", () => {
  it("says a key is needed and links to Settings, after a run stopped for want of one (SPEC 3.2)", async () => {
    mockSecrets.clear();
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText(en.queue.stopped.noKey)).toBeOnTheScreen();
    expect(screen.getByText(en.find.waiting)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.queue.openSettings })).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says why it waits after a run that found no network", async () => {
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText(en.queue.paused.network)).toBeOnTheScreen();
    expect(screen.queryByRole("link", { name: en.queue.openSettings })).not.toBeOnTheScreen();
  });
});

describe("analyse again (SPEC 3.1, 3.3)", () => {
  it("analyses a waiting find through the queue and shows the answer", async () => {
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockLog.finds.get(1)?.analysis.state).toBe("done");
  });

  it("replaces an answer with the new one", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyseAgain }));
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(screen.queryByText(PORCINI.generalInformation.en)).not.toBeOnTheScreen();
  });

  it("keeps the answer when a new analysis fails, and shows the failure in the message only", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    fetchMock.mockResolvedValueOnce(BAD_REQUEST);
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyseAgain }));
    const message = within(await screen.findByTestId("analysis-message"));
    expect(message.getByText(en.queue.answerKept)).toBeOnTheScreen();
    expect(message.getByText(en.queue.failed.request.wrong)).toBeOnTheScreen();
    expect(screen.queryByText(INTERNAL)).not.toBeOnTheScreen();
    expect(screen.getByText(PORCINI.generalInformation.en)).toBeOnTheScreen();
    expect(screen.queryByText(en.find.failed)).not.toBeOnTheScreen();
    expect(mockLog.finds.get(1)?.analysis).toEqual(done(PORCINI));
  });

  it("keeps the answer when a new analysis meets a stop, and says what the stop needs", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    fetchMock.mockResolvedValueOnce(reply(401, "{}"));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyseAgain }));
    const message = within(await screen.findByTestId("analysis-message"));
    expect(message.getByText(en.queue.answerKept)).toBeOnTheScreen();
    expect(message.getByText(en.queue.stopped.keyRefused)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.queue.openSettings })).toBeOnTheScreen();
    expect(screen.getByText(PORCINI.generalInformation.en)).toBeOnTheScreen();
    expect(mockLog.finds.get(1)?.analysis).toEqual(done(PORCINI));
  });

  it("marks a waiting find failed when the segment check refuses its photo, and names the marker", async () => {
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    jest
      .mocked(preparePhotoForAnalysis)
      .mockImplementationOnce((uri, model) =>
        actualPrepare(uri, model, encoderOf(jpegWith(JPEG.IPTC))),
      );
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(await screen.findByText(en.find.failed)).toBeOnTheScreen();
    expect(screen.getAllByText(en.queue.failed.segmentCheck.app13)).toHaveLength(1);
    expect(screen.queryByText(INTERNAL)).not.toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLog.finds.get(1)?.analysis).toEqual({
      state: "failed",
      failure: { cause: "segment-check", detail: "forbidden-segment 0xFFED" },
    });
  });

  it("says the find waits again when there is no network", async () => {
    mockLog.finds.set(1, aFind({ state: "failed", failure: { cause: "answer", detail: "x" } }));
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyseAgain }));
    expect(await screen.findByText(en.queue.paused.network)).toBeOnTheScreen();
    expect(await screen.findByText(en.find.waiting)).toBeOnTheScreen();
  });

  it("disables both buttons while it analyses", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    let answer: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyseAgain }));
    expect(screen.getByText(en.find.analysing)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.find.analyseAgain })).toBeDisabled();
    expect(screen.getByRole("button", { name: en.find.delete })).toBeDisabled();
    await act(async () => {
      answer(apiAnswer(CHANTERELLE));
    });
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.find.analyseAgain })).toBeEnabled();
  });

  it("shows the answer once a queue run has analysed the find while its screen is open", async () => {
    mockLog.finds.set(1, aFind({ state: "waiting" }));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(screen.queryByText(en.find.waiting)).not.toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says so, without the error itself, when the analysis cannot run for an error in the app", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    jest
      .spyOn(mockLog, "replaceAnswer")
      .mockRejectedValueOnce(new StoreError("corrupt", "the stored row is not an object"));
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyseAgain }));
    expect(await screen.findByText(en.find.analysisError)).toBeOnTheScreen();
    expect(screen.queryByText(/stored row/)).not.toBeOnTheScreen();
    expect(screen.getByText(PORCINI.generalInformation.en)).toBeOnTheScreen();
    await act(async () => {
      router.replace("/");
    });
    expect(app.pathname()).toBe("/");
    expect(await screen.findByText(en.queue.stopped.internalError)).toBeOnTheScreen();
  });
});

describe("delete (SPEC 3.1, 3.6)", () => {
  it("asks first, and deletes nothing when the user cancels", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    expect(screen.getByText(en.find.deleteConfirm)).toBeOnTheScreen();
    expect(mockLog.finds.has(1)).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteCancel }));
    expect(screen.queryByText(en.find.deleteConfirm)).not.toBeOnTheScreen();
    expect(mockLog.finds.has(1)).toBe(true);
  });

  it("deletes the find once confirmed, and goes back to the Log", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    const remove = jest.spyOn(mockLog, "delete");
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(remove).toHaveBeenCalledWith(1);
    expect(mockLog.finds.has(1)).toBe(false);
    expect(app.pathname()).toBe("/");
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
  });

  it("says so when the find cannot be deleted, and keeps showing it", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    jest.spyOn(mockLog, "delete").mockRejectedValueOnce(new Error("database is locked"));
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(await screen.findByText(en.find.deleteFailed)).toBeOnTheScreen();
    expect(screen.queryByText(/locked/)).not.toBeOnTheScreen();
    expect(app.pathname()).toBe("/find/1");
    expect(screen.getByText(PORCINI.generalInformation.en)).toBeOnTheScreen();
  });

  it("removes the find's photo too, through the real store on a real SQLite (PBI-1.26)", async () => {
    const sqlite = memorySqlite();
    const photos = memoryPhotos();
    const real = await createFindStore(sqliteDatabase(sqlite), photos, {
      newPhotoName: () => "p1",
    });
    const id = await real.add({
      photoUri: "file:///cache/camera.jpg",
      time: { ...TAKEN, source: "saved" },
      position: null,
    });
    expect([...photos.files]).toEqual(["p1.jpg"]);
    jest.mocked(openFindLog).mockResolvedValueOnce(real);
    const app = await startApp(`/find/${id}`);
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(app.pathname()).toBe("/");
    expect([...photos.files]).toEqual([]);
    await expect(real.get(id)).resolves.toBeNull();
    sqlite.close();
  });

  it("goes back to the Log when the find was deleted already", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    jest
      .spyOn(mockLog, "delete")
      .mockRejectedValueOnce(new StoreError("not-found", "no find has the ID 1"));
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(app.pathname()).toBe("/");
  });
});

describe("a find that is not there or cannot be read", () => {
  it("says a find does not exist, with a way back to the Log", async () => {
    await startApp("/find/5");
    expect(await screen.findByText(en.find.notFound)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.find.back })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.find.delete })).not.toBeOnTheScreen();
  });

  it.each(["abc", "0", "01", "1.5"])("reads no find for the address /find/%s", async (id) => {
    const get = jest.spyOn(mockLog, "getStored");
    mockLog.finds.set(1, aFind(done(PORCINI)));
    await startApp(`/find/${id}`);
    expect(await screen.findByText(en.find.notFound)).toBeOnTheScreen();
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });

  it("says a find cannot be read, without the error's text, and still lets it be deleted", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    jest
      .spyOn(mockLog, "getStored")
      .mockRejectedValueOnce(new StoreError("corrupt", "the stored answer is not of the shape"));
    const app = await startApp();
    expect(await screen.findByText(en.find.unreadable)).toBeOnTheScreen();
    expect(screen.queryByText(/stored answer/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(mockLog.finds.has(1)).toBe(false);
    expect(app.pathname()).toBe("/");
  });

  it.each(["sv", "it"] as const)("says so in %s", async (lang) => {
    phoneIn(lang);
    await startApp("/find/9");
    expect(await screen.findByText(STRINGS[lang].find.notFound)).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: STRINGS[lang].find.back })).toBeOnTheScreen();
  });
});

const DESCRIPTION = "A yellow funnel with false gills, in moss under spruce.";

/** A text find without photos (SPEC 3.9), as the store holds it. */
function aTextFind(analysis: StoredFind["analysis"], change: Partial<StoredFind> = {}): StoredFind {
  return {
    id: 1,
    text: DESCRIPTION,
    photos: [],
    batchOpen: false,
    time: { ...TAKEN, source: "saved" },
    position: { latitude: 59.6995, longitude: 17.1234, accuracyM: 12.4, source: "fix" },
    analysis,
    addedPhotos: analysis.state === "done" ? "analysed" : null,
    picture: null,
    selfCheck: null,
    ...change,
  };
}

describe("a text find (SPEC 3.9, PBI-2.4)", () => {
  it("shows its description, which cannot be edited, and no photo", async () => {
    mockLog.finds.set(1, aTextFind({ state: "waiting" }));
    await startApp();
    expect(await screen.findByRole("header", { name: en.find.description })).toBeOnTheScreen();
    expect(screen.getByText(DESCRIPTION)).toBeOnTheScreen();
    expect(screen.queryByLabelText(en.find.photo)).not.toBeOnTheScreen();
    expect(screen.queryByDisplayValue(DESCRIPTION)).not.toBeOnTheScreen();
    expect(screen.getByText(en.find.waiting)).toBeOnTheScreen();
    expect(screen.queryByText(en.find.unreadable)).not.toBeOnTheScreen();
  });

  it("shows its answer with the disclaimer for a lookup without photos, not the one about a photo", async () => {
    mockLog.finds.set(1, aTextFind(done(CHANTERELLE), { selfCheck: { state: "waiting" } }));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
    expect(edibility.queryByText(en.disclaimer)).not.toBeOnTheScreen();
    expect(screen.getByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(screen.getByText("Claude's confidence in the match: 90 of 100")).toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)(
    "shows the disclaimer for a lookup without photos in %s",
    async (lang) => {
      phoneIn(lang);
      // As the store holds it: an answer from the text alone that names a species has a check.
      mockLog.finds.set(1, aTextFind(done(CHANTERELLE), { selfCheck: { state: "waiting" } }));
      await startApp();
      const edibility = within(await screen.findByTestId("match-edibility"));
      expect(edibility.getByText(STRINGS[lang].disclaimerDescribed)).toBeOnTheScreen();
    },
  );

  it.each([
    ["no_mushroom", en.find.noMushroomDescribed, en.find.noMushroom],
    ["cannot_tell", en.find.cannotTellDescribed, en.find.cannotTell],
  ] as const)(
    "says %s in the words of a description, not of a photo",
    async (result, text, photoText) => {
      mockLog.finds.set(1, aTextFind(done({ result })));
      await startApp();
      expect(await screen.findByText(text)).toBeOnTheScreen();
      expect(screen.queryByText(photoText)).not.toBeOnTheScreen();
      expect(screen.queryByTestId("match-edibility")).not.toBeOnTheScreen();
    },
  );

  it("analyses its text through the queue when asked, sending the description and no image, and shows the edibility unknown until the self-check agrees (SPEC 3.9)", async () => {
    mockLog.finds.set(1, aTextFind({ state: "waiting" }));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(preparePhotoForAnalysis).not.toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: DESCRIPTION });
    expect(JSON.stringify(body)).not.toContain('"image"');
    expect(mockLog.finds.get(1)?.analysis.state).toBe("done");
    const edibility = within(screen.getByTestId("match-edibility"));
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(
      edibility.queryByText(en.find.edibility.replace("{edibility}", en.find.edibilities.edible)),
    ).not.toBeOnTheScreen();
    expect(edibility.getByText(en.find.selfCheck.waiting)).toBeOnTheScreen();
  });

  it("says a refusal in the words of a description", async () => {
    mockLog.finds.set(
      1,
      aTextFind({ state: "failed", failure: { cause: "refused", detail: "x" } }),
    );
    await startApp();
    expect(await screen.findByText(en.queue.failed.refusedDescribed)).toBeOnTheScreen();
    expect(screen.queryByText(en.queue.failed.refused)).not.toBeOnTheScreen();
  });

  it("asks before it is deleted without speaking of a photo, and deletes it once confirmed", async () => {
    mockLog.finds.set(1, aTextFind(done(PORCINI)));
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    expect(screen.getByText(en.find.deleteConfirmDescribed)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(mockLog.finds.has(1)).toBe(false);
    expect(app.pathname()).toBe("/");
  });

  it("shows unknown, and why, for an answer from its text, which the real store saves with its self-check waiting (SPEC 3.9)", async () => {
    const sqlite = memorySqlite();
    const real = await createFindStore(sqliteDatabase(sqlite), memoryPhotos(), {
      newPhotoName: () => "p1",
    });
    const id = await real.addText({
      text: DESCRIPTION,
      time: { ...TAKEN, source: "saved" },
      position: null,
    });
    await real.setAnswer(
      id,
      { answer: CHANTERELLE, model: "m", analysedAtMs: 1 },
      { photoUris: [] },
    );
    jest.mocked(openFindLog).mockResolvedValueOnce(real);
    await startApp(`/find/${id}`);
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(
      edibility.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(edibility.getByText(en.find.selfCheck.waiting)).toBeOnTheScreen();
    sqlite.close();
  });

  it("shows a text find saved by the real store on a real SQLite, which Phase 1's get could not show", async () => {
    const sqlite = memorySqlite();
    const real = await createFindStore(sqliteDatabase(sqlite), memoryPhotos(), {
      newPhotoName: () => "p1",
    });
    const id = await real.addText({
      text: DESCRIPTION,
      time: { ...TAKEN, source: "saved" },
      position: null,
    });
    jest.mocked(openFindLog).mockResolvedValueOnce(real);
    await startApp(`/find/${id}`);
    expect(await screen.findByText(DESCRIPTION)).toBeOnTheScreen();
    expect(screen.getByText(en.find.waiting)).toBeOnTheScreen();
    expect(screen.getByText(en.find.noPosition)).toBeOnTheScreen();
    sqlite.close();
  });
});

const FALSE_CHANTERELLE = {
  sv: "Narrkantarell",
  en: "False chanterelle",
  la: "Hygrophoropsis aurantiaca",
  it: "Falso gallinaccio",
};

describe("the edibility of an answer from text alone, until its self-check agrees (SPEC 3.9)", () => {
  const unknownText = en.find.edibility.replace("{edibility}", en.find.edibilities.unknown);
  const edibleText = en.find.edibility.replace("{edibility}", en.find.edibilities.edible);

  it.each([
    ["waiting", { state: "waiting" }, en.find.selfCheck.waiting],
    ["could not name a species", { state: "no-species" }, en.find.selfCheck.noSpecies],
    ["failed", { state: "failed" }, en.find.selfCheck.failed],
    ["without a picture", { state: "no-picture" }, en.find.selfCheck.noPicture],
    [
      "disagreed",
      { state: "disagreed", names: FALSE_CHANTERELLE },
      fillIn(en.find.selfCheck.disagreed, {
        matched: CHANTERELLE.names.en,
        named: FALSE_CHANTERELLE.en,
      }),
    ],
  ] as const)(
    "shows unknown while the check is %s, whatever the answer said, and says why next to it",
    async (_, selfCheck, reason) => {
      mockLog.finds.set(1, aTextFind(done(CHANTERELLE), { selfCheck }));
      await startApp();
      const edibility = within(await screen.findByTestId("match-edibility"));
      expect(edibility.getByText(unknownText)).toBeOnTheScreen();
      expect(edibility.queryByText(edibleText)).not.toBeOnTheScreen();
      expect(edibility.getByText(reason)).toBeOnTheScreen();
      expect(edibility.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
    },
  );

  it("shows the answer's edibility, and no reason, once the check agreed", async () => {
    mockLog.finds.set(1, aTextFind(done(CHANTERELLE), { selfCheck: { state: "agreed" } }));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(edibleText)).toBeOnTheScreen();
    expect(edibility.queryByText(en.find.selfCheck.waiting)).not.toBeOnTheScreen();
  });

  it("leaves an answer from photos and text as it is: a find with text whose answer has no check", async () => {
    mockLog.finds.set(
      1,
      aTextFind(done(CHANTERELLE), {
        photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
        selfCheck: null,
      }),
    );
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(edibleText)).toBeOnTheScreen();
    expect(edibility.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(edibility.queryByText(en.find.selfCheck.waiting)).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("says why in %s", async (lang) => {
    phoneIn(lang);
    const t = STRINGS[lang];
    mockLog.finds.set(1, aTextFind(done(CHANTERELLE), { selfCheck: { state: "waiting" } }));
    await startApp();
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(
      edibility.getByText(t.find.edibility.replace("{edibility}", t.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(edibility.getByText(t.find.selfCheck.waiting)).toBeOnTheScreen();
  });

  it("once a text find's answer from its photos and text replaces its text answer, shows the edibility by the photo rule, with no self-check and the photo disclaimer (PBI-2.5)", async () => {
    const id = await mockLog.addText({
      text: DESCRIPTION,
      time: { ...TAKEN, source: "saved" },
      position: null,
    });
    await mockLog.setAnswer(
      id,
      { answer: PORCINI, model: "m", analysedAtMs: 1 },
      { photoUris: [] },
    );
    // Its self-check agreed, on its picture (PBI-2.9, PBI-2.10 make these; here they are set).
    const answered = await mockLog.getStored(id);
    if (answered === null) {
      throw new Error("the text find was not saved");
    }
    mockLog.finds.set(id, {
      ...answered,
      selfCheck: { state: "agreed" },
      picture: {
        uri: "file:///photos/picture.jpg",
        author: "A. Photographer",
        licence: "CC BY-SA 4.0",
        page: "https://commons.wikimedia.org/wiki/File:Porcini.jpg",
      },
    });
    await mockLog.addPhoto(id, "file:///photos/a.jpg");
    await mockLog.completeBatch(id);
    await startApp(`/find/${id}`);
    // Until the new answer, it keeps its text answer and its check (SPEC 3.9).
    const before = within(await screen.findByTestId("match-edibility"));
    expect(before.getByText(edibleText)).toBeOnTheScreen();
    expect(screen.getByText(en.find.addedPhotos.waiting)).toBeOnTheScreen();
    fetchMock.mockResolvedValueOnce(apiAnswer({ ...CHANTERELLE, confidence: 69 }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.analyseAgain }));
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content.map((block: { type: string }) => block.type)).toEqual([
      "text",
      "image",
      "text",
      "text",
    ]);
    expect(mockLog.finds.get(id)).toMatchObject({ selfCheck: null, addedPhotos: "analysed" });
    // The photo rule: below 70 the edibility is unknown, with no reason of a check.
    const after = within(screen.getByTestId("match-edibility"));
    expect(after.getByText(unknownText)).toBeOnTheScreen();
    for (const reason of Object.values(en.find.selfCheck)) {
      expect(after.queryByText(reason)).not.toBeOnTheScreen();
    }
    expect(after.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(after.queryByText(en.disclaimerDescribed)).not.toBeOnTheScreen();
    expect(screen.queryByText(en.find.addedPhotos.waiting)).not.toBeOnTheScreen();
  });
});

describe("the disclaimer follows what the answer shown was based on (Clead's decision 3 on #57)", () => {
  it.each(["waiting", "not-analysed"] as const)(
    "an answer from the text alone keeps the disclaimer for a description once the find has photos that are %s",
    async (addedPhotos) => {
      mockLog.finds.set(
        1,
        aTextFind(done(CHANTERELLE), {
          photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
          addedPhotos,
          selfCheck: { state: "agreed" },
        }),
      );
      await startApp();
      const edibility = within(await screen.findByTestId("match-edibility"));
      expect(edibility.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
      expect(edibility.queryByText(en.disclaimer)).not.toBeOnTheScreen();
    },
  );

  it("an answer from the text alone keeps the disclaimer for a description after the photos added since are removed, through the find log", async () => {
    const id = await mockLog.addText({
      text: DESCRIPTION,
      time: { ...TAKEN, source: "saved" },
      position: null,
    });
    await mockLog.setAnswer(
      id,
      { answer: CHANTERELLE, model: "m", analysedAtMs: 1 },
      { photoUris: [] },
    );
    await mockLog.addPhoto(id, "file:///photos/a.jpg");
    await mockLog.completeBatch(id);
    await mockLog.removePhoto(id, 1);
    await startApp(`/find/${id}`);
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
  });

  it("an answer from photos keeps 3.5's disclaimer after the text find's photos are all removed, through the find log", async () => {
    const id = await mockLog.addText({
      text: DESCRIPTION,
      time: { ...TAKEN, source: "saved" },
      position: null,
    });
    await mockLog.addPhoto(id, "file:///photos/a.jpg");
    await mockLog.completeBatch(id);
    const sent = { photoUris: ["file:///photos/a.jpg"] };
    await mockLog.setAnswer(id, { answer: CHANTERELLE, model: "m", analysedAtMs: 1 }, sent);
    await mockLog.removePhoto(id, 1);
    expect((await mockLog.getStored(id))?.photos).toEqual([]);
    await startApp(`/find/${id}`);
    const edibility = within(await screen.findByTestId("match-edibility"));
    expect(edibility.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(edibility.queryByText(en.disclaimerDescribed)).not.toBeOnTheScreen();
  });
});

describe("a find's several photos (SPEC 3.9, Batches; PBI-2.5)", () => {
  /** A photo find with `count` photos, the first in batch 1 and the rest in batch 2. */
  function withPhotos(count: number, change: Partial<StoredFind> = {}): StoredFind {
    return {
      ...aTextFind(done(CHANTERELLE)),
      text: null,
      photos: Array.from({ length: count }, (_, i) => ({
        uri: `file:///photos/${i + 1}.jpg`,
        batch: i === 0 ? 1 : 2,
      })),
      ...change,
    };
  }
  const label = (number: number, count: number) =>
    fillIn(en.find.photoNumbered, { number: String(number), count: String(count) });
  /** The photos the find log holds of find 1. */
  const photosOf1 = async () => (await mockLog.getStored(1))?.photos;

  it("shows every photo in the order added, each labelled with its number", async () => {
    mockLog.finds.set(1, withPhotos(3));
    await startApp();
    expect(await screen.findByLabelText(label(1, 3))).toHaveProp("source", {
      uri: "file:///photos/1.jpg",
    });
    expect(screen.getByLabelText(label(2, 3))).toHaveProp("source", {
      uri: "file:///photos/2.jpg",
    });
    expect(screen.getByLabelText(label(3, 3))).toHaveProp("source", {
      uri: "file:///photos/3.jpg",
    });
  });

  it("offers adding photos, which opens New find for this find", async () => {
    mockLog.finds.set(1, withPhotos(2));
    const app = renderRouter(APP_DIR, { initialUrl: "/find/1" });
    await app;
    await fireEvent.press(await screen.findByRole("link", { name: en.find.addPhotos }));
    expect(app.getPathname()).toBe("/new-find");
    expect(app.getSearchParams()).toEqual({ find: "1" });
  });

  it("offers adding photos to a text find too", async () => {
    mockLog.finds.set(1, aTextFind(done(CHANTERELLE)));
    await startApp();
    expect(await screen.findByRole("link", { name: en.find.addPhotos })).toBeOnTheScreen();
  });

  it("offers no more photos once the find holds the most, and says so", async () => {
    mockLog.finds.set(1, withPhotos(5));
    await startApp();
    expect(await screen.findByText(en.find.maxPhotos.replace("{max}", "5"))).toBeOnTheScreen();
    expect(screen.queryByRole("link", { name: en.find.addPhotos })).not.toBeOnTheScreen();
  });

  it("removes a photo after asking on the screen, and the others stay in order; nothing is analysed", async () => {
    mockLog.finds.set(1, withPhotos(3));
    await startApp();
    const remove = fillIn(en.find.removePhoto, { number: "2" });
    await fireEvent.press(await screen.findByRole("button", { name: remove }));
    expect(screen.getByText(fillIn(en.find.removePhotoConfirm, { number: "2" }))).toBeOnTheScreen();
    expect(await photosOf1()).toHaveLength(3);
    await fireEvent.press(screen.getByRole("button", { name: en.find.removePhotoYes }));
    expect(await screen.findByLabelText(label(2, 2))).toHaveProp("source", {
      uri: "file:///photos/3.jpg",
    });
    expect(screen.getByLabelText(label(1, 2))).toHaveProp("source", {
      uri: "file:///photos/1.jpg",
    });
    expect((await photosOf1())?.map((photo) => photo.uri)).toEqual([
      "file:///photos/1.jpg",
      "file:///photos/3.jpg",
    ]);
    expect(screen.getByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(preparePhotoForAnalysis).not.toHaveBeenCalled();
  });

  it("keeps the photo when the user answers Keep", async () => {
    mockLog.finds.set(1, withPhotos(2));
    await startApp();
    await fireEvent.press(
      await screen.findByRole("button", { name: fillIn(en.find.removePhoto, { number: "1" }) }),
    );
    await fireEvent.press(screen.getByRole("button", { name: en.find.removePhotoCancel }));
    expect(
      screen.queryByText(fillIn(en.find.removePhotoConfirm, { number: "1" })),
    ).not.toBeOnTheScreen();
    expect(await photosOf1()).toHaveLength(2);
  });

  it("does not offer removing the last photo of a find without text", async () => {
    mockLog.finds.set(1, withPhotos(1));
    await startApp();
    await screen.findByTestId("match-names");
    expect(
      screen.queryByRole("button", { name: fillIn(en.find.removePhoto, { number: "1" }) }),
    ).not.toBeOnTheScreen();
  });

  it("offers removing the last photo of a text find, which then shows no photo", async () => {
    mockLog.finds.set(
      1,
      aTextFind({ state: "waiting" }, { photos: [{ uri: "file:///photos/1.jpg", batch: 1 }] }),
    );
    await startApp();
    await fireEvent.press(
      await screen.findByRole("button", { name: fillIn(en.find.removePhoto, { number: "1" }) }),
    );
    await fireEvent.press(screen.getByRole("button", { name: en.find.removePhotoYes }));
    expect(await screen.findByText(DESCRIPTION)).toBeOnTheScreen();
    await act(async () => undefined);
    expect(screen.queryByLabelText(en.find.photo)).not.toBeOnTheScreen();
    expect(await photosOf1()).toEqual([]);
  });

  it("says so when a photo cannot be removed, without the error's text, and keeps it", async () => {
    mockLog.finds.set(1, withPhotos(2));
    jest.spyOn(mockLog, "removePhoto").mockRejectedValueOnce(new Error("database is locked"));
    await startApp();
    await fireEvent.press(
      await screen.findByRole("button", { name: fillIn(en.find.removePhoto, { number: "2" }) }),
    );
    await fireEvent.press(screen.getByRole("button", { name: en.find.removePhotoYes }));
    expect(await screen.findByText(en.find.removePhotoFailed)).toBeOnTheScreen();
    expect(screen.queryByText(/locked/)).not.toBeOnTheScreen();
    expect(screen.getByLabelText(label(2, 2))).toBeOnTheScreen();
  });

  it("says the photos added since the answer wait, and keeps showing the answer", async () => {
    mockLog.finds.set(1, withPhotos(2, { addedPhotos: "waiting" }));
    await startApp();
    expect(await screen.findByText(en.find.addedPhotos.waiting)).toBeOnTheScreen();
    expect(screen.getByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
  });

  it("says why the photos added since the answer wait after a run that found no network", async () => {
    mockLog.finds.set(1, withPhotos(2, { addedPhotos: "waiting" }));
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText(en.queue.paused.network)).toBeOnTheScreen();
    expect(screen.getByText(en.find.addedPhotos.waiting)).toBeOnTheScreen();
  });

  it("says the photos added since the answer were not analysed, and Analyse again analyses them all with the answer replaced", async () => {
    mockLog.finds.set(1, withPhotos(2, { addedPhotos: "not-analysed" }));
    fetchMock.mockResolvedValueOnce(apiAnswer(PORCINI));
    await startApp();
    expect(await screen.findByText(en.find.addedPhotos.notAnalysed)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.find.analyseAgain }));
    expect(await screen.findByText(PORCINI.generalInformation.en)).toBeOnTheScreen();
    expect(preparePhotoForAnalysis).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(
      body.messages[0].content.filter((block: { type: string }) => block.type === "image"),
    ).toHaveLength(2);
    expect(screen.queryByText(en.find.addedPhotos.notAnalysed)).not.toBeOnTheScreen();
    expect(mockLog.finds.get(1)).toMatchObject({ addedPhotos: "analysed" });
  });

  it("names the photo that failed, in plain words", async () => {
    mockLog.finds.set(
      1,
      withPhotos(3, {
        analysis: { state: "failed", failure: { cause: "photo", detail: "photo 2: load-failed" } },
        addedPhotos: null,
      }),
    );
    await startApp();
    expect(
      await screen.findByText(
        fillIn(en.queue.failed.numbered, { number: "2", reason: en.queue.failed.photo.loadFailed }),
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(INTERNAL)).not.toBeOnTheScreen();
  });

  it("a find whose batch is still open: Analyse completes the batch and leaves the find to the queue", async () => {
    mockLog.finds.set(
      1,
      withPhotos(2, { analysis: { state: "waiting" }, addedPhotos: null, batchOpen: true }),
    );
    const complete = jest.spyOn(mockLog, "completeBatch");
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(complete).toHaveBeenCalledWith(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLog.finds.get(1)).toMatchObject({ batchOpen: false });
    expect(await screen.findByText(en.find.waiting)).toBeOnTheScreen();
  });

  it("says so, without the error, when the batch cannot be completed, and keeps it open", async () => {
    mockLog.finds.set(
      1,
      withPhotos(2, { analysis: { state: "waiting" }, addedPhotos: null, batchOpen: true }),
    );
    jest.spyOn(mockLog, "completeBatch").mockRejectedValueOnce(new Error("database is locked"));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(await screen.findByText(en.find.analysisError)).toBeOnTheScreen();
    expect(screen.queryByText(/locked/)).not.toBeOnTheScreen();
    expect(mockLog.finds.get(1)).toMatchObject({ batchOpen: true });
  });

  it("is read again when the screen comes back into view, so photos added meanwhile are shown", async () => {
    mockLog.finds.set(1, withPhotos(1));
    await startApp();
    expect(await screen.findByLabelText(en.find.photo)).toBeOnTheScreen();
    await act(async () => {
      router.push("/about");
    });
    await mockLog.addPhoto(1, "file:///photos/2.jpg");
    await mockLog.completeBatch(1);
    await act(async () => {
      router.back();
    });
    expect(await screen.findByLabelText(label(2, 2))).toHaveProp("source", {
      uri: "file:///photos/2.jpg",
    });
    expect(screen.getByText(en.find.addedPhotos.waiting)).toBeOnTheScreen();
  });
});
