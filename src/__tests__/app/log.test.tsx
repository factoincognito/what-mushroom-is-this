/**
 * The Log screen in full (docs/SPEC.md 3.1, 3.3, 3.5; PBI-1.8), through the router: the finds
 * newest first, each with its photo, date and time, the species name in the app's language and the
 * edibility shown with the disclaimer; a find waiting or failed says so; a log that cannot be read
 * says so. The native modules are mocked at their boundary, and the find log is in memory.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { AppState } from "react-native";

import type { Answer, Match } from "../../analysis/answer";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { formatFindTime } from "../../find/display";
import { STRINGS } from "../../i18n/strings";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { monthName } from "../../library/filters";
import { answerToJson } from "../../store/answerJson";
import { type Find, type ListedFind, type StoredFind, StoreError } from "../../store/find";
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
jest.mock("../../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(async () => ({
    ok: true,
    imageBase64: "AAAA",
    width: 2212,
    height: 1659,
  })),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));
/* Wikimedia, at the boundary of the picture's fetch: the picture waits (PBI-2.9). */
jest.mock("../../picture/devicePicture", () => ({
  fetchDevicePicture: jest.fn(async () => ({ kind: "waits", cause: "network", retryAtMs: null })),
  removePictureCopy: jest.fn(),
}));

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

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1, 10, 0);

function find(id: number, daysLater: number, analysis: Find["analysis"]): Find {
  return {
    id,
    photoUri: `file:///photos/${id}.jpg`,
    time: { takenAtMs: BASE + daysLater * DAY, utcOffsetMinutes: 120, source: "saved" },
    position: null,
    analysis,
  };
}

function done(answer: Answer): Find["analysis"] {
  return { state: "done", answer, model: "claude-opus-5-5", analysedAtMs: BASE };
}

/** The body of a Messages API answer whose text is the answer. */
function apiAnswer(answer: Answer) {
  return {
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: answerToJson(answer) }],
        stop_reason: "end_turn",
      }),
  };
}

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

async function startApp(initialUrl = "/"): Promise<{ pathname: () => string }> {
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
  mockLog.unreadable.clear();
  mockLog.withoutId.length = 0;
  phoneIn("en");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  // In the background: no run starts by itself unless a test brings the app to the front.
  Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
}

beforeEach(resetStandIns);

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await resetStandIns();
  mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
  await startApp();
  await screen.findByTestId("find-row-1");
});

afterAll(() => {
  Object.defineProperty(AppState, "currentState", { value: undefined, configurable: true });
});

describe("the Log screen's list (SPEC 3.1)", () => {
  it("lists the finds newest first, each with its photo, date and time and name", async () => {
    const first = find(1, 0, done(CHANTERELLE));
    mockLog.finds.set(1, first);
    mockLog.finds.set(2, find(2, 2, { state: "waiting" }));
    mockLog.finds.set(3, find(3, 1, done({ result: "no_mushroom" })));
    await startApp();
    const rows = await screen.findAllByTestId(/^find-row-/);
    expect(rows.map((row) => row.props.testID)).toEqual(["find-row-2", "find-row-3", "find-row-1"]);
    const row = within(screen.getByTestId("find-row-1"));
    expect(row.getByText("Chanterelle")).toBeOnTheScreen();
    expect(row.getByText(formatFindTime(first.time, "en"))).toBeOnTheScreen();
    expect(row.getByLabelText(en.find.photo)).toHaveProp("source", { uri: "file:///photos/1.jpg" });
    expect(screen.queryByText(en.log.empty)).not.toBeOnTheScreen();
  });

  it("shows the edibility of the matched species with the disclaimer next to it", async () => {
    mockLog.finds.set(
      1,
      find(1, 0, done({ ...CHANTERELLE, edibility: "edible_after_preparation" })),
    );
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(
      row.getByText(
        en.find.edibility.replace("{edibility}", en.find.edibilities.edibleAfterPreparation),
      ),
    ).toBeOnTheScreen();
    expect(row.getByText(en.disclaimer)).toBeOnTheScreen();
  });

  it("shows unknown below a confidence of 70, and the edibility from 70, whatever was stored (SPEC 3.9)", async () => {
    mockLog.finds.set(
      1,
      find(1, 0, done({ ...CHANTERELLE, edibility: "deadly_poisonous", confidence: 69 })),
    );
    mockLog.finds.set(
      2,
      find(2, 1, done({ ...CHANTERELLE, edibility: "poisonous", confidence: 70 })),
    );
    await startApp();
    const below = within(await screen.findByTestId("find-row-1"));
    expect(
      below.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(below.queryByText(en.find.edibilities.deadlyPoisonous, { exact: false })).toBeNull();
    expect(below.getByText(en.disclaimer)).toBeOnTheScreen();
    const at = within(screen.getByTestId("find-row-2"));
    expect(
      at.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.poisonous)),
    ).toBeOnTheScreen();
  });

  it("shows unknown when a Phase 1 find's confidence is low, whatever was stored", async () => {
    mockLog.finds.set(
      1,
      find(1, 0, done({ ...CHANTERELLE, edibility: "deadly_poisonous", confidence: "low" })),
    );
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(
      row.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(row.queryByText(en.find.edibilities.deadlyPoisonous, { exact: false })).toBeNull();
    expect(row.getByText(en.disclaimer)).toBeOnTheScreen();
  });

  it("says that a find waits, that one failed, and what Claude could not tell, with no edibility", async () => {
    mockLog.finds.set(1, find(1, 3, { state: "waiting" }));
    mockLog.finds.set(
      2,
      find(2, 2, { state: "failed", failure: { cause: "segment-check", detail: "APP1" } }),
    );
    mockLog.finds.set(3, find(3, 1, done({ result: "no_mushroom" })));
    mockLog.finds.set(4, find(4, 0, done({ result: "cannot_tell" })));
    await startApp();
    expect(within(await screen.findByTestId("find-row-1")).getByText(en.log.waiting)).toBeTruthy();
    expect(within(screen.getByTestId("find-row-2")).getByText(en.log.failed)).toBeTruthy();
    expect(within(screen.getByTestId("find-row-3")).getByText(en.find.noMushroom)).toBeTruthy();
    expect(within(screen.getByTestId("find-row-4")).getByText(en.find.cannotTell)).toBeTruthy();
    expect(screen.queryByText(en.disclaimer)).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)(
    "shows the name, the edibility and the disclaimer in %s",
    async (lang) => {
      phoneIn(lang);
      const only = find(1, 0, done(CHANTERELLE));
      mockLog.finds.set(1, only);
      await startApp();
      const t = STRINGS[lang];
      const row = within(await screen.findByTestId("find-row-1"));
      expect(row.getByText(CHANTERELLE.names[lang])).toBeOnTheScreen();
      expect(
        row.getByText(t.find.edibility.replace("{edibility}", t.find.edibilities.edible)),
      ).toBeOnTheScreen();
      expect(row.getByText(t.disclaimer)).toBeOnTheScreen();
      expect(row.getByText(formatFindTime(only.time, lang))).toBeOnTheScreen();
    },
  );

  it("says the log is empty when it has no finds", async () => {
    await startApp();
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
  });

  it("opens a find's own screen from its row", async () => {
    mockLog.finds.set(7, find(7, 0, done(CHANTERELLE)));
    const app = await startApp();
    await fireEvent.press(await screen.findByTestId("find-row-7"));
    expect(app.pathname()).toBe("/find/7");
    expect(await screen.findByText(CHANTERELLE.generalInformation.en)).toBeOnTheScreen();
  });
});

/**
 * A text find without photos (SPEC 3.9), as the store holds it. An answer naming a species is from
 * the text alone, so the store starts its self-check, waiting, unless another state is given.
 */
function textFind(
  id: number,
  daysLater: number,
  analysis: StoredFind["analysis"],
  selfCheck: StoredFind["selfCheck"] = analysis.state === "done" &&
  analysis.answer.result === "match"
    ? { state: "waiting" }
    : null,
): StoredFind {
  return {
    id,
    text: "A yellow funnel with false gills.",
    photos: [],
    batchOpen: false,
    time: { takenAtMs: BASE + daysLater * DAY, utcOffsetMinutes: 120, source: "saved" },
    position: null,
    analysis,
    addedPhotos: analysis.state === "done" ? "analysed" : null,
    picture: null,
    selfCheck,
  };
}

describe("a text find in the Log (SPEC 3.9, PBI-2.4)", () => {
  it("is listed in its place as a find, not as one that could not be read, with no photo", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, textFind(2, 1, { state: "waiting" }));
    await startApp();
    const rows = await screen.findAllByTestId(/^find-row-/);
    expect(rows.map((row) => row.props.testID)).toEqual(["find-row-2", "find-row-1"]);
    const row = within(screen.getByTestId("find-row-2"));
    expect(row.getByText(en.log.waiting)).toBeOnTheScreen();
    expect(row.queryByLabelText(en.find.photo)).not.toBeOnTheScreen();
    expect(screen.queryByText(en.find.unreadable)).not.toBeOnTheScreen();
  });

  it("shows its answer with the disclaimer for a lookup without photos", async () => {
    mockLog.finds.set(1, textFind(1, 0, done(CHANTERELLE)));
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(row.getByText("Chanterelle")).toBeOnTheScreen();
    expect(row.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
    expect(row.queryByText(en.disclaimer)).not.toBeOnTheScreen();
  });

  it("shows unknown, and why, while the self-check of its answer from the text waits (SPEC 3.9)", async () => {
    mockLog.finds.set(1, textFind(1, 0, done(CHANTERELLE)));
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(
      row.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(row.queryByText(en.find.edibilities.edible, { exact: false })).toBeNull();
    expect(row.getByText(en.find.selfCheck.waiting)).toBeOnTheScreen();
  });

  it("shows the answer's edibility once the self-check agreed (SPEC 3.9)", async () => {
    mockLog.finds.set(1, textFind(1, 0, done(CHANTERELLE), { state: "agreed" }));
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(
      row.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.edible)),
    ).toBeOnTheScreen();
    expect(row.queryByText(en.find.selfCheck.waiting)).toBeNull();
  });

  it.each([
    ["no_mushroom", en.find.noMushroomDescribed],
    ["cannot_tell", en.find.cannotTellDescribed],
  ] as const)("says %s in the words of a description", async (result, text) => {
    mockLog.finds.set(1, textFind(1, 0, done({ result })));
    await startApp();
    expect(within(await screen.findByTestId("find-row-1")).getByText(text)).toBeOnTheScreen();
  });

  it("shows its representative picture in place of the text mark, labelled as a picture of the species, with its credit (SPEC 3.9, The Library; PBI-2.9)", async () => {
    const picture = {
      uri: "file:///photos/picture-1.jpg",
      author: "Example Photographer",
      licence: "cc-by-4.0",
      page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
    };
    mockLog.finds.set(1, { ...textFind(1, 0, done(CHANTERELLE)), picture });
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(
      row.getByLabelText(en.find.picture.label.replace("{name}", CHANTERELLE.names.en)),
    ).toHaveProp("source", { uri: picture.uri });
    expect(row.queryByLabelText(en.log.textMarkLabel)).not.toBeOnTheScreen();
    const credit = within(screen.getByTestId("picture-credit-1"));
    expect(credit.getByText(en.find.picture.caption)).toBeOnTheScreen();
    expect(
      credit.getByText(en.find.picture.author.replace("{author}", picture.author)),
    ).toBeOnTheScreen();
    expect(
      credit.getByRole("link", { name: en.find.picture.licence.replace("{licence}", "CC BY 4.0") }),
    ).toBeOnTheScreen();
    expect(credit.getByRole("link", { name: en.find.picture.page })).toBeOnTheScreen();
  });

  it("with photos and an answer from its text alone, shows its picture, not its first photo, while it has one (SPEC 3.9, #63)", async () => {
    const picture = {
      uri: "file:///photos/picture-1.jpg",
      author: "Example Photographer",
      licence: "cc0",
      page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
    };
    mockLog.finds.set(1, {
      ...textFind(1, 0, done(CHANTERELLE)),
      photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
      addedPhotos: "waiting",
      picture,
    });
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(
      row.getByLabelText(en.find.picture.label.replace("{name}", CHANTERELLE.names.en)),
    ).toBeOnTheScreen();
    expect(row.queryByLabelText(en.find.photo)).not.toBeOnTheScreen();
  });

  it("without a picture, shows the text mark and no credit", async () => {
    mockLog.finds.set(1, textFind(1, 0, done(CHANTERELLE), { state: "no-picture" }));
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(row.getByLabelText(en.log.textMarkLabel)).toBeOnTheScreen();
    expect(screen.queryByTestId("picture-credit-1")).not.toBeOnTheScreen();
    expect(row.getByText(en.find.selfCheck.noPicture)).toBeOnTheScreen();
  });

  it("opens the text find's own screen from its row", async () => {
    mockLog.finds.set(4, textFind(4, 0, { state: "waiting" }));
    const app = await startApp();
    await fireEvent.press(await screen.findByTestId("find-row-4"));
    expect(app.pathname()).toBe("/find/4");
    expect(await screen.findByText("A yellow funnel with false gills.")).toBeOnTheScreen();
  });

  it("is analysed by a queue run by its text, which ends with the answer in the list, its edibility unknown until the self-check agrees (SPEC 3.9)", async () => {
    mockLog.finds.set(1, textFind(1, 0, { state: "waiting" }));
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText("Chanterelle")).toBeOnTheScreen();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content[0]).toEqual({
      type: "text",
      text: "A yellow funnel with false gills.",
    });
    const row = within(screen.getByTestId("find-row-1"));
    expect(
      row.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.unknown)),
    ).toBeOnTheScreen();
    expect(row.queryByText(en.find.edibilities.edible, { exact: false })).toBeNull();
    expect(row.getByText(en.find.selfCheck.waiting)).toBeOnTheScreen();
  });

  it("once it has photos and a queue run's answer from them replaced its text answer, shows its first photo and the edibility by the photo rule, with no self-check (SPEC 3.9; PBI-2.5)", async () => {
    // Its answer from the text alone; then a batch of two photos, completed.
    const id = await mockLog.addText({
      text: "A yellow funnel with false gills.",
      time: { takenAtMs: BASE, utcOffsetMinutes: 120, source: "saved" },
      position: null,
    });
    const porcini: Match = {
      ...CHANTERELLE,
      names: { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" },
    };
    await mockLog.setAnswer(
      id,
      { answer: porcini, model: "claude-opus-5-5", analysedAtMs: BASE },
      { photoUris: [] },
    );
    expect((await mockLog.getStored(id))?.selfCheck).toEqual({ state: "waiting" });
    await mockLog.addPhoto(id, "file:///photos/a.jpg");
    await mockLog.addPhoto(id, "file:///photos/b.jpg");
    await mockLog.completeBatch(id);
    fetchMock.mockResolvedValueOnce(apiAnswer(CHANTERELLE));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText("Chanterelle")).toBeOnTheScreen();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content.map((block: { type: string }) => block.type)).toEqual([
      "text",
      "image",
      "text",
      "image",
      "text",
      "text",
    ]);
    const row = within(screen.getByTestId(`find-row-${id}`));
    expect(row.getByLabelText(en.find.photo)).toBeOnTheScreen();
    expect(
      row.getByText(en.find.edibility.replace("{edibility}", en.find.edibilities.edible)),
    ).toBeOnTheScreen();
    expect(row.queryByText(en.find.selfCheck.waiting)).toBeNull();
    expect(row.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(row.queryByText(en.disclaimerDescribed)).toBeNull();
  });

  it("an answer from the text alone keeps the disclaimer for a description once the find has photos waiting (Clead's decision 3 on #57)", async () => {
    mockLog.finds.set(1, {
      ...textFind(1, 0, done(CHANTERELLE)),
      photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
      addedPhotos: "waiting",
    });
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(row.getByLabelText(en.find.photo)).toBeOnTheScreen();
    expect(row.getByText(en.disclaimerDescribed)).toBeOnTheScreen();
    expect(row.queryByText(en.disclaimer)).toBeNull();
  });

  it("an answer from photos keeps 3.5's disclaimer once the text find's photos are all removed (Clead's decision 3 on #57)", async () => {
    mockLog.finds.set(1, textFind(1, 0, done(CHANTERELLE), null));
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(row.queryByLabelText(en.find.photo)).toBeNull();
    expect(row.getByText(en.disclaimer)).toBeOnTheScreen();
    expect(row.queryByText(en.disclaimerDescribed)).toBeNull();
  });

  it("has a link to the text lookup", async () => {
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: en.log.textLookup }));
    expect(app.pathname()).toBe("/text-lookup");
  });
});

describe("a log the store cannot read (reviewer's note 5 on #11)", () => {
  it("says so, without an error's text, and reads it again when asked", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    jest
      .spyOn(mockLog, "list")
      .mockRejectedValueOnce(
        new StoreError("corrupt", "the stored edibility is not one the store knows"),
      );
    await startApp();
    expect(await screen.findByText(en.log.unreadable)).toBeOnTheScreen();
    expect(screen.queryByText(/stored edibility/)).not.toBeOnTheScreen();
    expect(screen.queryByText(en.log.empty)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.log.retry }));
    expect(await screen.findByText("Chanterelle")).toBeOnTheScreen();
    expect(screen.queryByText(en.log.unreadable)).not.toBeOnTheScreen();
  });

  it("says so when the log cannot be opened at all", async () => {
    const { openFindLog } = jest.requireMock("../../store/deviceFindStore");
    jest.mocked(openFindLog).mockRejectedValueOnce(new Error("disk I/O error"));
    await startApp();
    expect(await screen.findByText(en.log.unreadable)).toBeOnTheScreen();
    expect(screen.queryByText(/disk/)).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("says so in %s", async (lang) => {
    phoneIn(lang);
    jest.spyOn(mockLog, "list").mockRejectedValueOnce(new StoreError("corrupt", "x"));
    await startApp();
    expect(await screen.findByText(STRINGS[lang].log.unreadable)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS[lang].log.retry })).toBeOnTheScreen();
  });
});

describe("a find the store cannot read, in the list (PBI-1.16)", () => {
  it("is a row in its place saying the find could not be read, beside the finds it can read", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, { state: "waiting" }));
    mockLog.finds.set(3, find(3, 2, { state: "waiting" }));
    mockLog.unreadable.add(2);
    await startApp();
    const rows = await screen.findAllByTestId(/^find-row-/);
    expect(rows.map((row) => row.props.testID)).toEqual(["find-row-3", "find-row-2", "find-row-1"]);
    const row = within(screen.getByTestId("find-row-2"));
    expect(row.getByText(en.find.unreadable)).toBeOnTheScreen();
    expect(row.queryByText(en.log.waiting)).toBeNull();
    expect(within(screen.getByTestId("find-row-1")).getByText("Chanterelle")).toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("says so in %s", async (lang) => {
    phoneIn(lang);
    mockLog.finds.set(4, find(4, 0, { state: "waiting" }));
    mockLog.unreadable.add(4);
    await startApp();
    const row = within(await screen.findByTestId("find-row-4"));
    expect(row.getByText(STRINGS[lang].find.unreadable)).toBeOnTheScreen();
  });

  it("opens the find's own screen, which says it cannot be read and deletes it", async () => {
    mockLog.finds.set(5, find(5, 0, { state: "waiting" }));
    mockLog.finds.set(6, find(6, 1, done(CHANTERELLE)));
    mockLog.unreadable.add(5);
    const app = await startApp();
    await fireEvent.press(await screen.findByTestId("find-row-5"));
    expect(app.pathname()).toBe("/find/5");
    expect(await screen.findByText(en.find.unreadable)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(app.pathname()).toBe("/");
    expect(await screen.findByTestId("find-row-6")).toBeOnTheScreen();
    expect(screen.queryByTestId("find-row-5")).not.toBeOnTheScreen();
    expect(mockLog.finds.has(5)).toBe(false);
  });

  it("without an ID: a row saying so, with no link, under a key of its own", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { photoUri, time } = find(1, 0, { state: "waiting" });
    const entries: ListedFind[] = [
      { readable: false, id: null, storedId: null },
      { readable: false, id: null, storedId: null },
      {
        readable: true,
        id: 1,
        photoUri,
        time,
        position: null,
        analysis: { state: "waiting" },
        selfCheck: null,
        species: null,
        picture: null,
      },
    ];
    jest.spyOn(mockLog, "list").mockResolvedValue(entries);
    const app = await startApp();
    const rows = await screen.findAllByTestId("unreadable-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText(en.find.unreadable)).toBeOnTheScreen();
      expect(row.props.accessibilityRole).not.toBe("link");
    }
    const [first] = rows;
    if (first === undefined) {
      throw new Error("no row without an ID");
    }
    await fireEvent.press(first);
    expect(app.pathname()).toBe("/");
    expect(within(screen.getByTestId("find-row-1")).getByText(en.log.waiting)).toBeOnTheScreen();
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    expect(screen.queryByRole("button", { name: en.find.delete })).not.toBeOnTheScreen();
    errors.mockRestore();
    jest.mocked(mockLog.list).mockRestore();
  });
});

describe("a find whose ID the store cannot read, in the list (PBI-1.26)", () => {
  it("offers Delete in its row, which asks first and deletes nothing when the user cancels", async () => {
    mockLog.withoutId.push("9007199254740993");
    await startApp();
    const row = within(await screen.findByTestId("unreadable-row"));
    await fireEvent.press(row.getByRole("button", { name: en.find.delete }));
    expect(row.getByText(en.find.deleteConfirm)).toBeOnTheScreen();
    await fireEvent.press(row.getByRole("button", { name: en.find.deleteCancel }));
    expect(row.queryByText(en.find.deleteConfirm)).not.toBeOnTheScreen();
    expect(mockLog.withoutId).toEqual(["9007199254740993"]);
  });

  it("deletes that find, and only it, once confirmed, and lists the others", async () => {
    mockLog.withoutId.push("0", "-3");
    mockLog.finds.set(1, find(1, 0, { state: "waiting" }));
    const remove = jest.spyOn(mockLog, "deleteUnreadable");
    await startApp();
    const [first] = await screen.findAllByTestId("unreadable-row");
    if (first === undefined) {
      throw new Error("no row without an ID");
    }
    await fireEvent.press(within(first).getByRole("button", { name: en.find.delete }));
    await fireEvent.press(within(first).getByRole("button", { name: en.find.deleteYes }));
    expect(remove).toHaveBeenCalledWith("0");
    const left = await screen.findAllByTestId("unreadable-row");
    expect(left).toHaveLength(1);
    expect(mockLog.withoutId).toEqual(["-3"]);
    expect(screen.getByTestId("find-row-1")).toBeOnTheScreen();
    // The "-3" row does not inherit the deleted row's open question (Clead's review of #33, fix 1).
    const [other] = left;
    if (other === undefined) {
      throw new Error("no row without an ID left");
    }
    expect(within(other).getByRole("button", { name: en.find.delete })).toBeOnTheScreen();
    expect(screen.queryByText(en.find.deleteConfirm)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.find.deleteYes })).not.toBeOnTheScreen();
    remove.mockRestore();
  });

  it("keeps a question the user opened on another such row with that row when one is deleted", async () => {
    mockLog.withoutId.push("0", "-3");
    await startApp();
    const [first, second] = await screen.findAllByTestId("unreadable-row");
    if (first === undefined || second === undefined) {
      throw new Error("not two rows without an ID");
    }
    await fireEvent.press(within(second).getByRole("button", { name: en.find.delete }));
    await fireEvent.press(within(first).getByRole("button", { name: en.find.delete }));
    await fireEvent.press(within(first).getByRole("button", { name: en.find.deleteYes }));
    const left = await screen.findAllByTestId("unreadable-row");
    expect(mockLog.withoutId).toEqual(["-3"]);
    expect(left).toHaveLength(1);
    expect(screen.getAllByText(en.find.deleteConfirm)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: en.find.delete })).not.toBeOnTheScreen();
  });

  it("closes its question once the delete succeeds, even while the list still shows the find", async () => {
    mockLog.withoutId.push("0");
    jest.spyOn(mockLog, "deleteUnreadable").mockResolvedValueOnce({ photoRemoved: true });
    await startApp();
    const row = within(await screen.findByTestId("unreadable-row"));
    await fireEvent.press(row.getByRole("button", { name: en.find.delete }));
    await fireEvent.press(row.getByRole("button", { name: en.find.deleteYes }));
    expect(await row.findByRole("button", { name: en.find.delete })).toBeOnTheScreen();
    expect(row.queryByText(en.find.deleteConfirm)).not.toBeOnTheScreen();
    jest.mocked(mockLog.deleteUnreadable).mockRestore();
  });

  it("says so in its row when the find cannot be deleted, without the error's text, and keeps it", async () => {
    mockLog.withoutId.push("0");
    jest.spyOn(mockLog, "deleteUnreadable").mockRejectedValueOnce(new Error("database is locked"));
    await startApp();
    const row = within(await screen.findByTestId("unreadable-row"));
    await fireEvent.press(row.getByRole("button", { name: en.find.delete }));
    await fireEvent.press(row.getByRole("button", { name: en.find.deleteYes }));
    expect(await row.findByText(en.find.deleteFailed)).toBeOnTheScreen();
    expect(screen.queryByText(/locked/)).not.toBeOnTheScreen();
    expect(mockLog.withoutId).toEqual(["0"]);
    jest.mocked(mockLog.deleteUnreadable).mockRestore();
  });

  it("drops the row when the find was deleted already", async () => {
    mockLog.withoutId.push("0");
    jest.spyOn(mockLog, "deleteUnreadable").mockImplementationOnce(async (storedId) => {
      mockLog.withoutId.length = 0;
      throw new StoreError("not-found", `no find has the ID ${storedId}`);
    });
    await startApp();
    const row = within(await screen.findByTestId("unreadable-row"));
    await fireEvent.press(row.getByRole("button", { name: en.find.delete }));
    await fireEvent.press(row.getByRole("button", { name: en.find.deleteYes }));
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(screen.queryByText(en.find.deleteFailed)).not.toBeOnTheScreen();
    jest.mocked(mockLog.deleteUnreadable).mockRestore();
  });

  it.each(["sv", "it"] as const)("offers it in %s", async (lang) => {
    phoneIn(lang);
    mockLog.withoutId.push("0");
    await startApp();
    const row = within(await screen.findByTestId("unreadable-row"));
    expect(row.getByRole("button", { name: STRINGS[lang].find.delete })).toBeOnTheScreen();
  });
});

describe("the list follows the log", () => {
  it("shows a find's answer once the queue has analysed it", async () => {
    mockLog.finds.set(1, find(1, 0, { state: "waiting" }));
    fetchMock.mockResolvedValue(apiAnswer(CHANTERELLE));
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    await startApp();
    expect(await screen.findByText("Chanterelle")).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en.log.waiting)).not.toBeOnTheScreen();
  });

  it("no longer lists a find deleted on its own screen", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done({ result: "cannot_tell" })));
    const app = await startApp();
    await fireEvent.press(await screen.findByTestId("find-row-1"));
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(app.pathname()).toBe("/");
    expect(await screen.findByTestId("find-row-2")).toBeOnTheScreen();
    expect(screen.queryByTestId("find-row-1")).not.toBeOnTheScreen();
  });
});

const PORCINI: Match = {
  ...CHANTERELLE,
  names: { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" },
};

/** A find taken at `iso` (UTC), at the offset given. */
function takenAt(base: Find, iso: string, utcOffsetMinutes = 120): Find {
  return { ...base, time: { takenAtMs: Date.parse(iso), utcOffsetMinutes, source: "saved" } };
}

/** The IDs of the rows of finds the store could read, in the list's order. */
async function rowIds(): Promise<string[]> {
  return (await screen.findAllByTestId(/^find-row-/)).map((row) =>
    String(row.props.testID).replace("find-row-", ""),
  );
}

/**
 * The titles of the screens' headers. Under Jest the native stack's header is not drawn as text:
 * its title is a prop of the header's configuration element.
 */
function headerTitles(): string[] {
  return screen.container
    .queryAll((node) => node.type === "RNSScreenStackHeaderConfig")
    .map((node) => String(node.props.title));
}

/** The accessible names of the filter choices given, in their order on the screen. */
function labels(boxes: { props: { accessibilityLabel?: string } }[]): (string | undefined)[] {
  return boxes.map((box) => box.props.accessibilityLabel);
}

async function openFilters(label = en.log.filters): Promise<void> {
  await fireEvent.press(await screen.findByRole("button", { name: label }));
}

async function choose(name: string): Promise<void> {
  await fireEvent.press(screen.getByRole("checkbox", { name }));
}

describe("the Library, the start screen in place of the Log (SPEC 3.9, PBI-2.7)", () => {
  it("is titled the Library, and opens on its list with the filters at their defaults, closed", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    const app = await startApp();
    expect(app.pathname()).toBe("/");
    expect(await screen.findByTestId("find-row-1")).toBeOnTheScreen();
    expect(headerTitles()).toEqual([en.log.title]);
    expect(screen.getByRole("button", { name: en.log.filters })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ expanded: false }),
    );
    expect(screen.queryByRole("checkbox")).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("is titled the Library in %s", async (lang) => {
    phoneIn(lang);
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    await startApp();
    await screen.findByTestId("find-row-1");
    expect(headerTitles()).toEqual([STRINGS[lang].log.title]);
    expect(screen.getByRole("button", { name: STRINGS[lang].log.filters })).toBeOnTheScreen();
  });

  it("shows the text mark in place of a photo for a find without photos, and none for a find with one", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, textFind(2, 1, { state: "waiting" }));
    await startApp();
    const text = within(await screen.findByTestId("find-row-2"));
    expect(text.getByLabelText(en.log.textMarkLabel)).toBeOnTheScreen();
    expect(text.getByText(en.log.textMark)).toBeOnTheScreen();
    expect(text.queryByLabelText(en.find.photo)).not.toBeOnTheScreen();
    const photo = within(screen.getByTestId("find-row-1"));
    expect(photo.queryByLabelText(en.log.textMarkLabel)).not.toBeOnTheScreen();
    expect(photo.getByLabelText(en.find.photo)).toBeOnTheScreen();
  });

  it("shows a text find's first photo once it has photos, and no text mark (Clead's decision on #63)", async () => {
    mockLog.finds.set(1, {
      ...textFind(1, 0, done(CHANTERELLE)),
      photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
      addedPhotos: "waiting",
    });
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(row.getByLabelText(en.find.photo)).toHaveProp("source", { uri: "file:///photos/1.jpg" });
    expect(row.queryByLabelText(en.log.textMarkLabel)).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)("shows the text mark in %s", async (lang) => {
    phoneIn(lang);
    mockLog.finds.set(1, textFind(1, 0, { state: "waiting" }));
    await startApp();
    const row = within(await screen.findByTestId("find-row-1"));
    expect(row.getByLabelText(STRINGS[lang].log.textMarkLabel)).toBeOnTheScreen();
    expect(row.getByText(STRINGS[lang].log.textMark)).toBeOnTheScreen();
  });

  it("opens the filters with every one at all, and closes them again", async () => {
    mockLog.finds.set(1, takenAt(find(1, 0, done(CHANTERELLE)), "2026-09-01T10:00:00Z"));
    mockLog.finds.set(2, takenAt(find(2, 0, { state: "waiting" }), "2025-06-01T10:00:00Z"));
    await startApp();
    await openFilters();
    expect(screen.getByRole("button", { name: en.log.filters })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ expanded: true }),
    );
    for (const all of [en.log.allSpecies, en.log.allYears, en.log.allMonths]) {
      expect(screen.getByRole("checkbox", { name: all, checked: true })).toBeOnTheScreen();
    }
    expect(screen.getByText(en.log.species)).toBeOnTheScreen();
    expect(screen.getByText(en.log.years)).toBeOnTheScreen();
    expect(screen.getByText(en.log.months)).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Chanterelle", checked: false })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: en.log.notIdentified })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "2026" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "2025" })).toBeOnTheScreen();
    for (const month of [1, 6, 12]) {
      expect(screen.getByRole("checkbox", { name: monthName(month, "en") })).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole("button", { name: en.log.filters }));
    expect(screen.queryByRole("checkbox")).not.toBeOnTheScreen();
    expect(await rowIds()).toEqual(["1", "2"]);
  });
});

describe("the species filter (SPEC 3.9; Clead's decision 3 on PBI-2.7)", () => {
  it("offers each species once, grouped by the Latin name's genus and species ignoring case, by the newest find's name, and 'not identified'", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(
      2,
      find(
        2,
        2,
        done({
          ...CHANTERELLE,
          names: {
            ...CHANTERELLE.names,
            en: "Golden chanterelle",
            la: "CANTHARELLUS cibarius f. alba",
          },
        }),
      ),
    );
    mockLog.finds.set(3, find(3, 1, done(PORCINI)));
    mockLog.finds.set(4, find(4, 3, { state: "waiting" }));
    await startApp();
    await openFilters();
    expect(labels(screen.getAllByRole("checkbox")).slice(0, 4)).toEqual([
      en.log.allSpecies,
      "Golden chanterelle",
      "Porcini",
      en.log.notIdentified,
    ]);
    expect(screen.queryByRole("checkbox", { name: "Chanterelle" })).not.toBeOnTheScreen();
  });

  it("shows only the finds of the chosen species, and every find that could not be read, until all species is chosen again", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done(PORCINI)));
    mockLog.finds.set(3, find(3, 2, { state: "waiting" }));
    mockLog.finds.set(4, find(4, 3, { state: "waiting" }));
    mockLog.unreadable.add(4);
    mockLog.withoutId.push("0");
    await startApp();
    await openFilters();
    await choose("Porcini");
    expect(await rowIds()).toEqual(["4", "2"]);
    expect(screen.getByTestId("unreadable-row")).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Porcini", checked: true })).toBeOnTheScreen();
    expect(
      screen.getByRole("checkbox", { name: en.log.allSpecies, checked: false }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.log.filtersOn })).toBeOnTheScreen();
    await choose("Chanterelle");
    expect(await rowIds()).toEqual(["4", "2", "1"]);
    await choose(en.log.allSpecies);
    expect(await rowIds()).toEqual(["4", "3", "2", "1"]);
    expect(screen.getByRole("checkbox", { name: "Porcini", checked: false })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.log.filters })).toBeOnTheScreen();
  });

  it("goes back to all species when the last chosen species is unchosen", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done(PORCINI)));
    await startApp();
    await openFilters();
    await choose("Porcini");
    expect(await rowIds()).toEqual(["2"]);
    await choose("Porcini");
    expect(await rowIds()).toEqual(["2", "1"]);
    expect(
      screen.getByRole("checkbox", { name: en.log.allSpecies, checked: true }),
    ).toBeOnTheScreen();
  });

  it("holds under 'not identified' the finds waiting, failed, with no mushroom or that cannot tell", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, { state: "waiting" }));
    mockLog.finds.set(
      3,
      find(3, 2, { state: "failed", failure: { cause: "request", detail: "x" } }),
    );
    mockLog.finds.set(4, find(4, 3, done({ result: "no_mushroom" })));
    mockLog.finds.set(5, find(5, 4, done({ result: "cannot_tell" })));
    await startApp();
    await openFilters();
    await choose(en.log.notIdentified);
    expect(await rowIds()).toEqual(["5", "4", "3", "2"]);
  });

  it("counts a text find by its text answer's species while the self-check waits (SPEC 3.9)", async () => {
    mockLog.finds.set(1, textFind(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done(PORCINI)));
    await startApp();
    await openFilters();
    await choose("Chanterelle");
    expect(await rowIds()).toEqual(["1"]);
    expect(
      within(screen.getByTestId("find-row-1")).getByText(en.find.selfCheck.waiting),
    ).toBeOnTheScreen();
  });

  it("says that no find matches the filters, not that the Library is empty", async () => {
    mockLog.finds.set(1, takenAt(find(1, 0, done(CHANTERELLE)), "2026-09-01T10:00:00Z"));
    mockLog.finds.set(2, takenAt(find(2, 0, done(PORCINI)), "2025-09-01T10:00:00Z"));
    await startApp();
    await openFilters();
    await choose("Porcini");
    await choose("2026");
    expect(await screen.findByText(en.log.noMatch)).toBeOnTheScreen();
    expect(screen.queryByText(en.log.empty)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(/^find-row-/)).not.toBeOnTheScreen();
  });

  it.each(["sv", "it"] as const)(
    "offers the species by their names in %s, with 'not identified' and every filter in that language",
    async (lang) => {
      phoneIn(lang);
      const t = STRINGS[lang];
      mockLog.finds.set(1, find(1, 0, done(PORCINI)));
      mockLog.finds.set(2, find(2, 1, { state: "waiting" }));
      await startApp();
      await openFilters(t.log.filters);
      expect(screen.getByRole("checkbox", { name: PORCINI.names[lang] })).toBeOnTheScreen();
      expect(screen.getByRole("checkbox", { name: t.log.notIdentified })).toBeOnTheScreen();
      for (const all of [t.log.allSpecies, t.log.allYears, t.log.allMonths]) {
        expect(screen.getByRole("checkbox", { name: all, checked: true })).toBeOnTheScreen();
      }
      expect(screen.getByRole("checkbox", { name: monthName(1, lang) })).toBeOnTheScreen();
      await choose(PORCINI.names[lang]);
      expect(await rowIds()).toEqual(["1"]);
      expect(screen.getByRole("button", { name: t.log.filtersOn })).toBeOnTheScreen();
    },
  );
});

describe("the years and months filters (SPEC 3.9)", () => {
  it("takes a find's year and month in its own UTC offset", async () => {
    // 23:30 UTC on 31 December 2025 is January 2026 at UTC+01:00.
    mockLog.finds.set(1, takenAt(find(1, 0, done(CHANTERELLE)), "2025-12-31T23:30:00Z", 60));
    mockLog.finds.set(2, takenAt(find(2, 0, done(PORCINI)), "2025-06-01T10:00:00Z"));
    await startApp();
    await openFilters();
    await choose("2026");
    expect(await rowIds()).toEqual(["1"]);
    await choose("2026");
    await choose(monthName(12, "en"));
    expect(screen.queryByTestId(/^find-row-/)).not.toBeOnTheScreen();
    await choose(monthName(1, "en"));
    expect(await rowIds()).toEqual(["1"]);
  });

  it("offers only the years that have finds, newest first, and keeps the finds of any chosen year or month", async () => {
    mockLog.finds.set(1, takenAt(find(1, 0, done(CHANTERELLE)), "2024-05-01T10:00:00Z"));
    mockLog.finds.set(2, takenAt(find(2, 0, done(PORCINI)), "2026-09-01T10:00:00Z"));
    mockLog.finds.set(3, takenAt(find(3, 0, { state: "waiting" }), "2025-05-01T10:00:00Z"));
    await startApp();
    await openFilters();
    expect(labels(screen.getAllByRole("checkbox", { name: /^\d{4}$/ }))).toEqual([
      "2026",
      "2025",
      "2024",
    ]);
    expect(screen.queryByRole("checkbox", { name: "2023" })).not.toBeOnTheScreen();
    await choose("2024");
    await choose("2026");
    expect(await rowIds()).toEqual(["2", "1"]);
    await choose(en.log.allYears);
    await choose(monthName(5, "en"));
    expect(await rowIds()).toEqual(["3", "1"]);
  });

  it("keeps only the finds that pass every filter", async () => {
    mockLog.finds.set(1, takenAt(find(1, 0, done(CHANTERELLE)), "2025-09-01T10:00:00Z"));
    mockLog.finds.set(2, takenAt(find(2, 0, done(CHANTERELLE)), "2026-09-01T10:00:00Z"));
    mockLog.finds.set(3, takenAt(find(3, 0, done(CHANTERELLE)), "2026-08-01T10:00:00Z"));
    mockLog.finds.set(4, takenAt(find(4, 0, done(PORCINI)), "2026-09-02T10:00:00Z"));
    await startApp();
    await openFilters();
    await choose("Chanterelle");
    await choose("2026");
    await choose(monthName(9, "en"));
    expect(await rowIds()).toEqual(["2"]);
  });
});

describe("the filters while the app runs (SPEC 3.9)", () => {
  it("hold when another screen is opened and left", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done(PORCINI)));
    const app = await startApp();
    await openFilters();
    await choose("Porcini");
    expect(await rowIds()).toEqual(["2"]);
    await fireEvent.press(screen.getByTestId("find-row-2"));
    expect(app.pathname()).toBe("/find/2");
    await act(async () => router.back());
    expect(app.pathname()).toBe("/");
    expect(await rowIds()).toEqual(["2"]);
    await fireEvent.press(screen.getByRole("link", { name: en.log.settings }));
    expect(app.pathname()).toBe("/settings");
    await act(async () => router.back());
    expect(await rowIds()).toEqual(["2"]);
    expect(screen.getByRole("button", { name: en.log.filtersOn })).toBeOnTheScreen();
  });

  it("start at their defaults when the app starts again", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done(PORCINI)));
    await startApp();
    await openFilters();
    await choose("Porcini");
    expect(await rowIds()).toEqual(["2"]);
    await screen.unmount();
    await startApp();
    expect(await rowIds()).toEqual(["2", "1"]);
    expect(screen.getByRole("button", { name: en.log.filters })).toBeOnTheScreen();
  });

  it("go back to all species when the last find of the chosen species is deleted", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    mockLog.finds.set(2, find(2, 1, done(PORCINI)));
    const app = await startApp();
    await openFilters();
    await choose("Porcini");
    await fireEvent.press(await screen.findByTestId("find-row-2"));
    await fireEvent.press(await screen.findByRole("button", { name: en.find.delete }));
    await fireEvent.press(screen.getByRole("button", { name: en.find.deleteYes }));
    expect(app.pathname()).toBe("/");
    expect(await rowIds()).toEqual(["1"]);
    expect(await screen.findByRole("button", { name: en.log.filters })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.log.filtersOn })).not.toBeOnTheScreen();
  });

  it("are not offered while the Library cannot be read, and are once it is read again", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    jest
      .spyOn(mockLog, "list")
      .mockRejectedValueOnce(
        new StoreError("corrupt", "the stored edibility is not one the store knows"),
      );
    await startApp();
    expect(await screen.findByText(en.log.unreadable)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.log.filters })).not.toBeOnTheScreen();
    expect(screen.queryByRole("checkbox")).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.log.retry }));
    expect(await rowIds()).toEqual(["1"]);
    await openFilters();
    expect(screen.getByRole("checkbox", { name: "Chanterelle" })).toBeOnTheScreen();
    jest.mocked(mockLog.list).mockRestore();
  });
});

describe("the Log screen's other parts are kept", () => {
  it("still has New find and Settings below the list", async () => {
    mockLog.finds.set(1, find(1, 0, done(CHANTERELLE)));
    await startApp();
    expect(await screen.findByRole("link", { name: en.log.newFind })).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.log.settings })).toBeOnTheScreen();
    await act(async () => undefined);
  });
});
