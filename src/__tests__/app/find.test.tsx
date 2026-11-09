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
import { formatFindTime, mapLink } from "../../find/display";
import { STRINGS } from "../../i18n/strings";
import { preparePhotoForAnalysis } from "../../image/prepareForAnalysis";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { failureMessage } from "../../queue/messages";
import { answerToJson } from "../../store/answerJson";
import { type Find, StoreError } from "../../store/find";
import { memoryFindLog } from "../../testing/memoryFindLog";

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
  confidence: "high",
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

beforeEach(async () => {
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

  it("shows Claude's confidence with the note that it is Claude's own statement", async () => {
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
      mapLink({ latitude: 59.6995, longitude: 17.1234 }, Platform.OS),
    );
    expect(find.position).toMatchObject({ latitude: 59.6995, longitude: 17.1234 });
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("names a segment-check failure's refused marker in plain words", async () => {
    const failure = { cause: "segment-check", detail: "APP1 (EXIF or XMP) at byte 2" } as const;
    mockLog.finds.set(1, aFind({ state: "failed", failure }));
    await startApp();
    expect(await screen.findByText(en.find.failed)).toBeOnTheScreen();
    expect(screen.getByText(failureMessage(failure, en))).toBeOnTheScreen();
    expect(screen.getByText(/APP1 \(EXIF or XMP\) at byte 2/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.find.analyseAgain })).toBeOnTheScreen();
  });

  it.each([
    [{ cause: "request", detail: "the request is wrong (status 400)" }],
    [{ cause: "answer", detail: "confidence is not one of low, medium, high" }],
    [{ cause: "photo", detail: "the photo could not be read" }],
  ] as const)("names the cause of %o in plain words", async (failure) => {
    mockLog.finds.set(1, aFind({ state: "failed", failure }));
    await startApp();
    expect(await screen.findByText(failureMessage(failure, en))).toBeOnTheScreen();
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
    expect(message.getByText(/status 400/)).toBeOnTheScreen();
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
    jest.mocked(preparePhotoForAnalysis).mockResolvedValueOnce({
      ok: false,
      failure: { cause: "segment-check", detail: "APP13 (IPTC)" },
    });
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.find.analyse }));
    expect(await screen.findByText(en.find.failed)).toBeOnTheScreen();
    expect(screen.getAllByText(/APP13 \(IPTC\)/)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLog.finds.get(1)?.analysis.state).toBe("failed");
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
    const get = jest.spyOn(mockLog, "get");
    mockLog.finds.set(1, aFind(done(PORCINI)));
    await startApp(`/find/${id}`);
    expect(await screen.findByText(en.find.notFound)).toBeOnTheScreen();
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });

  it("says a find cannot be read, without the error's text, and still lets it be deleted", async () => {
    mockLog.finds.set(1, aFind(done(PORCINI)));
    jest
      .spyOn(mockLog, "get")
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
