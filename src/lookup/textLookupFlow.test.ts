import type { Answer, SpeciesNames } from "../analysis/answer";
import { phoneTimeNow } from "../newFind/saveFind";
import type { PictureFetch } from "../picture/fetchPicture";
import type { AnalyseLookupResult, CheckLookupResult } from "../queue/queue";
import type { NewTextFind, Position } from "../store/find";
import {
  INITIAL_TEXT_LOOKUP_VIEW,
  lookupSelfCheck,
  TextLookupFlow,
  type TextLookupView,
} from "./textLookupFlow";

const NOW = new Date(Date.UTC(2026, 10, 9, 21, 0, 0));
const FIX = {
  coords: { latitude: 59.64, longitude: 17.08, accuracy: 6 },
  timestamp: NOW.getTime(),
};
const POSITION: Position = { latitude: 59.64, longitude: 17.08, accuracyM: 6, source: "fix" };
const MATCH: Answer = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};

const PICTURE = {
  uri: "file:///cache/picture-2.jpg",
  author: "Example Photographer",
  licence: "cc-by-sa-3.0",
  page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
};
const FOUND: PictureFetch = { kind: "picture", picture: PICTURE };
const SHOWN = { state: "shown", picture: PICTURE } as const;
/** The self-check's outcome the stand-in queue gives unless told otherwise (PBI-2.10). */
const AGREED = { state: "done", outcome: { state: "agreed" } } as const;
const PORCINI_NAMES = { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" };

const granted = { status: "granted", canAskAgain: true };
const undetermined = { status: "undetermined", canAskAgain: true };
const denied = { status: "denied", canAskAgain: true };

/** The flow with stand-ins for the store, the queue, the setting and the phone's location. */
function setup(options: { saveAtStart?: boolean; permission?: unknown; lastKnown?: unknown } = {}) {
  const added: NewTextFind[] = [];
  const positions: [number, Position][] = [];
  const lookups: string[] = [];
  const replies: (AnalyseLookupResult | Error)[] = [];
  const views: TextLookupView[] = [];
  let addError: Error | null = null;
  let addHold: Promise<void> | null = null;
  let onFix: ((reading: unknown) => void) | null = null;
  let watchStopped = 0;
  let permissionAsked = 0;
  let current = options.permission ?? granted;
  const pictures: (PictureFetch | Error)[] = [];
  const pictureNames: string[] = [];
  const removed: string[] = [];
  let pictureHold: Promise<void> | null = null;
  const checkReplies: (CheckLookupResult | Error)[] = [];
  const checks: [string, SpeciesNames][] = [];
  let checkHold: Promise<void> | null = null;

  const flow = new TextLookupFlow(
    {
      findLog: async () => ({
        async addText(find: NewTextFind) {
          if (addHold !== null) {
            await addHold;
          }
          if (addError !== null) {
            throw addError;
          }
          added.push(find);
          return 40 + added.length;
        },
        async setPosition(id: number, position: Position) {
          positions.push([id, position]);
        },
      }),
      analyseLookup: async (text) => {
        lookups.push(text);
        const reply = replies.shift() ?? { ok: true, answer: MATCH, model: "claude-opus-5-5" };
        if (reply instanceof Error) {
          throw reply;
        }
        return reply;
      },
      fetchPicture: async (latinName) => {
        pictureNames.push(latinName);
        if (pictureHold !== null) {
          await pictureHold;
        }
        const reply = pictures.shift() ?? FOUND;
        if (reply instanceof Error) {
          throw reply;
        }
        return reply;
      },
      removePictureCopy: (uri) => {
        removed.push(uri);
      },
      checkPicture: async (pictureUri, matched) => {
        checks.push([pictureUri, matched]);
        if (checkHold !== null) {
          await checkHold;
        }
        const reply = checkReplies.shift() ?? { ok: true, outcome: { state: "agreed" } };
        if (reply instanceof Error) {
          throw reply;
        }
        return reply;
      },
      readSaveSetting: async () => options.saveAtStart ?? false,
      location: {
        permission: {
          get: async () => current,
          request: async () => {
            permissionAsked += 1;
            current = granted;
            return granted;
          },
        },
        source: {
          watch: async (callback) => {
            onFix = callback;
            return () => {
              watchStopped += 1;
            };
          },
          lastKnown: async () => options.lastKnown ?? null,
        },
      },
      appConfig: {
        lastKnownPositionMaxAgeMs: 120_000,
        positionFixWaitMs: 30_000,
        lookupTextMaxLength: 20,
      },
      now: () => NOW,
    },
    (view) => views.push(view),
  );
  return {
    flow,
    added,
    positions,
    lookups,
    replies,
    view: () => views.at(-1) ?? INITIAL_TEXT_LOOKUP_VIEW,
    sendFix: (reading: unknown) => onFix?.(reading),
    watchStopped: () => watchStopped,
    permissionAsked: () => permissionAsked,
    failAdds: (error: Error | null) => {
      addError = error;
    },
    pictures,
    pictureNames,
    removed,
    checkReplies,
    checks,
    /** Holds the self-checks open until the function it gives is called. */
    holdChecks: () => {
      let release: () => void = () => undefined;
      checkHold = new Promise((resolve) => {
        release = () => {
          checkHold = null;
          resolve();
        };
      });
      return release;
    },
    /** Holds the picture fetches open until the function it gives is called. */
    holdPictures: () => {
      let release: () => void = () => undefined;
      pictureHold = new Promise((resolve) => {
        release = () => {
          pictureHold = null;
          resolve();
        };
      });
      return release;
    },
    /** Holds the saves open until the function it gives is called. */
    holdAdds: () => {
      let release: () => void = () => undefined;
      addHold = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

/** Lets every pending promise callback run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

const SHORT = "A yellow funnel.";

describe("opening the screen (SPEC 3.9, Lookups)", () => {
  it("asks for the location the first time, starts asking for a position, and sets Save off by default", async () => {
    const t = setup({ permission: undetermined });
    expect(t.view().phase).toBe("starting");
    await t.flow.start();
    expect(t.permissionAsked()).toBe(1);
    expect(t.view()).toMatchObject({ phase: "ready", save: false, location: "granted" });
    t.sendFix(FIX);
    t.flow.setText(SHORT);
    t.flow.setSave(true);
    await t.flow.analyse();
    expect(t.added[0]?.position).toEqual(POSITION);
  });

  it("starts with Save on when Settings holds that", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    expect(t.view().save).toBe(true);
  });

  it("does not ask for the location again once the user has said no, and says a saved lookup gets no position", async () => {
    const t = setup({ permission: denied });
    await t.flow.start();
    expect(t.permissionAsked()).toBe(0);
    expect(t.view().location).toBe("denied");
    t.flow.setText(SHORT);
    t.flow.setSave(true);
    await t.flow.analyse();
    expect(t.added[0]?.position).toBeNull();
  });
});

describe("the text (SPEC 3.9: up to the configured length)", () => {
  it("keeps at most the configured number of characters, each counted as one code point", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText("🍄".repeat(25));
    expect(t.view().text).toBe("🍄".repeat(20));
  });

  it("does not analyse or save an empty text, and says so", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText("   \n");
    await t.flow.analyse();
    expect(t.view().message).toBe("empty");
    expect(t.added).toEqual([]);
    expect(t.lookups).toEqual([]);
  });

  it("drops the answer shown once the text changes, as it is the answer to the earlier text", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: SHOWN,
      check: AGREED,
    });
    t.flow.setText(`${SHORT} White.`);
    expect(t.view().outcome).toBeNull();
    // Its picture goes with it (docs/SPEC.md 3.9: shown, not stored).
    expect(t.removed).toEqual([PICTURE.uri]);
  });
});

describe("a saved lookup (Save on)", () => {
  it("becomes a find when Analyse is tapped: the text, the time of saving and the position, and the screen is told its ID", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.sendFix(FIX);
    t.flow.setText(SHORT);
    await t.flow.analyse();
    expect(t.added).toEqual([{ text: SHORT, time: phoneTimeNow(NOW), position: POSITION }]);
    expect(t.lookups).toEqual([]);
    expect(t.view()).toMatchObject({ phase: "saved", saved: { id: 41, by: "analyse" } });
    expect(t.view().holdsLeave).toBe(false);
  });

  it("is saved without a position when none has come, then gets the first fix within the wait", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    expect(t.added[0]?.position).toBeNull();
    t.flow.close();
    expect(t.watchStopped()).toBe(0);
    t.sendFix(FIX);
    await flush();
    expect(t.positions).toEqual([[41, POSITION]]);
    expect(t.watchStopped()).toBe(1);
  });

  it("becomes a find when the screen is left with text entered, and the leave goes on once it is saved", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText(SHORT);
    expect(t.view().holdsLeave).toBe(true);
    expect(t.flow.askToLeave()).toBe(true);
    await flush();
    expect(t.added.map((find) => find.text)).toEqual([SHORT]);
    expect(t.view()).toMatchObject({ saved: { id: 41, by: "leave" }, holdsLeave: false });
    expect(t.view().confirming).toBeNull();
  });

  it("holds nothing when the screen is left with no text", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText("  ");
    expect(t.view().holdsLeave).toBe(false);
    expect(t.flow.askToLeave()).toBe(false);
    expect(t.added).toEqual([]);
  });

  it("keeps the lookup on the screen when the save fails, says so, and Analyse saves it again", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText(SHORT);
    t.failAdds(new Error("database is locked"));
    await t.flow.analyse();
    expect(t.view()).toMatchObject({ phase: "ready", message: "saveFailed", saved: null });
    expect(t.view().holdsLeave).toBe(true);
    t.failAdds(null);
    await t.flow.analyse();
    expect(t.view()).toMatchObject({ phase: "saved", saved: { id: 41, by: "analyse" } });
  });

  it("asks before leaving when the save on leaving fails, and leaves without it only when told to", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText(SHORT);
    t.failAdds(new Error("database is locked"));
    t.flow.askToLeave();
    await flush();
    expect(t.view()).toMatchObject({
      message: "saveFailed",
      confirming: "leave",
      holdsLeave: true,
    });
    t.flow.stay();
    expect(t.view()).toMatchObject({ confirming: null, holdsLeave: true });
    t.flow.askToLeave();
    await flush();
    t.flow.discardAndLeave();
    expect(t.view()).toMatchObject({ confirming: null, holdsLeave: false });
  });
});

describe("an unsaved lookup (Save off)", () => {
  it("is analysed when Analyse is tapped, stores nothing, and shows the answer", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    expect(t.lookups).toEqual([SHORT]);
    expect(t.added).toEqual([]);
    expect(t.view()).toMatchObject({
      phase: "ready",
      outcome: { kind: "answer", answer: MATCH },
      offerSave: false,
    });
  });

  it.each([
    ["no network", { kind: "paused", cause: "network" }],
    ["the time limit", { kind: "paused", cause: "time-out" }],
    ["a fault on Anthropic's side", { kind: "paused", cause: "server" }],
    ["no key", { kind: "stopped", stop: { reason: "no-key" } }],
  ] as const)("%s: keeps the lookup, shows why, and offers to turn Save on", async (_, notice) => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.replies.push({ ok: false, notice });
    await t.flow.analyse();
    expect(t.view()).toMatchObject({ outcome: { kind: "notice", notice }, offerSave: true });
    t.flow.turnSaveOn();
    expect(t.view()).toMatchObject({ save: true, offerSave: false });
    await t.flow.analyse();
    expect(t.added.map((find) => find.text)).toEqual([SHORT]);
  });

  it.each([
    [
      "a failure that marks a find failed",
      { kind: "find-failed", failure: { cause: "request", detail: "request-wrong (status 400)" } },
    ],
    ["a stop of the queue", { kind: "stopped", stop: { reason: "key-refused" } }],
    [
      "an answer not of the shape, which stops the queue",
      { kind: "find-failed", failure: { cause: "answer", detail: "bad" } },
    ],
  ] as const)(
    "%s: shows it, offers no Save, and Analyse can be tapped again",
    async (_, notice) => {
      const t = setup();
      await t.flow.start();
      t.flow.setText(SHORT);
      t.replies.push({ ok: false, notice });
      await t.flow.analyse();
      expect(t.view()).toMatchObject({
        phase: "ready",
        outcome: { kind: "notice", notice },
        offerSave: false,
      });
      await t.flow.analyse();
      expect(t.lookups).toEqual([SHORT, SHORT]);
      expect(t.view().outcome).toEqual({
        kind: "answer",
        answer: MATCH,
        picture: SHOWN,
        check: AGREED,
      });
    },
  );

  it("an error in the app: says the analysis could not run, and keeps the lookup", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.replies.push(new Error("full storage"));
    await t.flow.analyse();
    expect(t.view()).toMatchObject({ phase: "ready", outcome: { kind: "error" }, text: SHORT });
  });

  it("does not send a second request while one is under way", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const first = t.flow.analyse();
    expect(t.view().phase).toBe("analysing");
    await t.flow.analyse();
    await first;
    expect(t.lookups).toEqual([SHORT]);
  });

  it("asks before the screen is left with text entered, analysed or not, and leaves only when told to", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    expect(t.flow.askToLeave()).toBe(true);
    expect(t.view()).toMatchObject({ confirming: "leave", holdsLeave: true });
    t.flow.stay();
    expect(t.view().confirming).toBeNull();
    t.flow.askToLeave();
    t.flow.discardAndLeave();
    expect(t.view().holdsLeave).toBe(false);
    expect(t.added).toEqual([]);
  });

  it("stops asking for a position when the screen is closed", async () => {
    const t = setup();
    await t.flow.start();
    await flush();
    t.flow.close();
    expect(t.watchStopped()).toBe(1);
  });

  it("shows nothing after the screen is closed, when the answer comes late", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const pending = t.flow.analyse();
    const before = t.view();
    t.flow.close();
    await pending;
    expect(t.view()).toBe(before);
  });
});

describe("the edges of the flow", () => {
  it("does nothing when started again, and asks for nothing when closed while it starts", async () => {
    const t = setup({ permission: undetermined });
    const starting = t.flow.start();
    t.flow.close();
    await starting;
    await t.flow.start();
    expect(t.permissionAsked()).toBe(0);
    expect(t.view().phase).toBe("starting");
  });

  it("saves the phone's last known position when no fix has come and it is recent, marked as such", async () => {
    const t = setup({
      saveAtStart: true,
      lastKnown: {
        coords: { latitude: 59.6, longitude: 17.1, accuracy: 20 },
        timestamp: NOW.getTime() - 60_000,
      },
    });
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    expect(t.added[0]?.position).toEqual({
      latitude: 59.6,
      longitude: 17.1,
      accuracyM: 20,
      source: "last-known",
    });
  });

  it("keeps the Save switch as it is while an unsaved lookup is analysed", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const pending = t.flow.analyse();
    t.flow.setSave(true);
    expect(t.view().save).toBe(false);
    await pending;
    expect(t.added).toEqual([]);
  });

  it("drops an answer that comes after the text changed, as it is not the answer to the text shown", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const pending = t.flow.analyse();
    t.flow.setText(`${SHORT} Red`);
    await pending;
    expect(t.view()).toMatchObject({ phase: "ready", outcome: null, text: `${SHORT} Red` });
  });

  it("shows no new view when the text set is the text it holds", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const shown = t.view();
    t.flow.setText(SHORT);
    expect(t.view()).toBe(shown);
  });

  it("holds a leave during the save under way, and lets it go once the lookup is saved", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText(SHORT);
    const release = t.holdAdds();
    const saving = t.flow.analyse();
    expect(t.view().phase).toBe("saving");
    expect(t.flow.askToLeave()).toBe(true);
    release();
    await saving;
    expect(t.view()).toMatchObject({ saved: { id: 41, by: "leave" }, holdsLeave: false });
  });

  it("asks the leave question once a save under way fails, when the screen was left during it", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    t.flow.setText(SHORT);
    const release = t.holdAdds();
    t.failAdds(new Error("database is locked"));
    const saving = t.flow.analyse();
    t.flow.askToLeave();
    release();
    await saving;
    expect(t.view()).toMatchObject({ message: "saveFailed", confirming: "leave" });
  });

  it("drops nothing when no leave question is open", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    expect(t.flow.discardAndLeave()).toBe(false);
    expect(t.view().holdsLeave).toBe(true);
  });

  it("stops asking for a position when a save fails after the screen was closed", async () => {
    const t = setup({ saveAtStart: true });
    await t.flow.start();
    await flush();
    t.flow.setText(SHORT);
    const release = t.holdAdds();
    t.failAdds(new Error("database is locked"));
    const saving = t.flow.analyse();
    t.flow.close();
    expect(t.watchStopped()).toBe(0);
    release();
    await saving;
    expect(t.watchStopped()).toBe(1);
  });
});

describe("an unsaved lookup's representative picture (docs/SPEC.md 3.9; PBI-2.9)", () => {
  it("is fetched at once after an answer naming a species, by its Latin name, and shown", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const release = t.holdPictures();
    const analysing = t.flow.analyse();
    await flush();
    expect(t.view()).toMatchObject({
      phase: "ready",
      outcome: { kind: "answer", answer: MATCH, picture: { state: "fetching" } },
    });
    release();
    await analysing;
    expect(t.pictureNames).toEqual(["Cantharellus cibarius"]);
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: SHOWN,
      check: AGREED,
    });
    expect(t.added).toEqual([]);
  });

  it.each([
    ["no mushroom", { result: "no_mushroom" }],
    ["cannot tell", { result: "cannot_tell" }],
  ] as const)("is not fetched for %s", async (_name, answer) => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.replies.push({ ok: true, answer, model: "claude-opus-5-5" });
    await t.flow.analyse();
    expect(t.pictureNames).toEqual([]);
    expect(t.view().outcome).toEqual({ kind: "answer", answer, picture: null, check: null });
    expect(t.checks).toEqual([]);
  });

  it("with no picture for the answer, shows none, and runs no check", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.pictures.push({ kind: "none", reason: "no-author" });
    await t.flow.analyse();
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: { state: "none" },
      check: null,
    });
    expect(t.checks).toEqual([]);
  });

  it.each([
    ["no network", "network"],
    ["a fault on Wikimedia's side", "picture-source"],
  ] as const)("%s: the picture waits, and Check again fetches it again", async (_name, cause) => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.pictures.push({ kind: "waits", cause, retryAtMs: null });
    await t.flow.analyse();
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: { state: "waits", cause },
      check: null,
    });
    await t.flow.checkAgain();
    expect(t.pictureNames).toEqual(["Cantharellus cibarius", "Cantharellus cibarius"]);
    expect(t.lookups).toEqual([SHORT]);
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: SHOWN,
      check: AGREED,
    });
  });

  it("an error in the app while fetching it: says so, and Check again tries again", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.pictures.push(new Error("No space left on device"));
    await t.flow.analyse();
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: { state: "error" },
      check: null,
    });
    await t.flow.checkAgain();
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: SHOWN,
      check: AGREED,
    });
  });

  it("Check again does nothing while a picture is shown, or none was found", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    await t.flow.checkAgain();
    t.pictures.push({ kind: "none", reason: "licence" });
    t.flow.setText(`${SHORT} Red.`);
    await t.flow.analyse();
    await t.flow.checkAgain();
    expect(t.pictureNames).toHaveLength(2);
  });

  it("removes its copy when the screen is left, and a fetch that ends after that keeps nothing", async () => {
    const shown = setup();
    await shown.flow.start();
    shown.flow.setText(SHORT);
    await shown.flow.analyse();
    shown.flow.close();
    expect(shown.removed).toEqual([PICTURE.uri]);

    const late = setup();
    await late.flow.start();
    late.flow.setText(SHORT);
    const release = late.holdPictures();
    const analysing = late.flow.analyse();
    await flush();
    late.flow.close();
    release();
    await analysing;
    expect(late.removed).toEqual([PICTURE.uri]);
  });

  it("removes the copy of a picture that comes for an answer no longer shown", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const release = t.holdPictures();
    const analysing = t.flow.analyse();
    await flush();
    t.flow.setText(`${SHORT} Red.`);
    release();
    await analysing;
    expect(t.view().outcome).toBeNull();
    expect(t.removed).toEqual([PICTURE.uri]);
  });

  it("removes the copy shown when Analyse is tapped again, and shows the new answer's picture", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    const next = { ...PICTURE, uri: "file:///cache/picture-4.jpg" };
    t.pictures.push({ kind: "picture", picture: next });
    await t.flow.analyse();
    expect(t.removed).toEqual([PICTURE.uri]);
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: { state: "shown", picture: next },
      check: AGREED,
    });
  });
});

describe("an unsaved lookup's self-check (docs/SPEC.md 3.9; PBI-2.10)", () => {
  it("runs at once after its picture is shown, on that picture and the answer's species, and shows what came of it", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    const release = t.holdChecks();
    const analysing = t.flow.analyse();
    await flush();
    expect(t.view().outcome).toEqual({
      kind: "answer",
      answer: MATCH,
      picture: SHOWN,
      check: { state: "checking" },
    });
    expect(lookupSelfCheck(t.view().outcome)).toEqual({ state: "waiting" });
    release();
    await analysing;
    expect(t.checks).toEqual([[PICTURE.uri, MATCH.names]]);
    expect(lookupSelfCheck(t.view().outcome)).toEqual({ state: "agreed" });
    expect(t.added).toEqual([]);
  });

  it.each([
    ["another species", { state: "disagreed", names: PORCINI_NAMES }],
    ["no species", { state: "no-species" }],
    ["a failed check", { state: "failed" }],
  ] as const)("shows %s as the check's outcome", async (_name, outcome) => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.checkReplies.push({ ok: true, outcome });
    await t.flow.analyse();
    expect(t.view().outcome).toMatchObject({ check: { state: "done", outcome } });
    expect(lookupSelfCheck(t.view().outcome)).toEqual(outcome);
  });

  it.each([
    ["a class that leaves a find waiting", { kind: "paused", cause: "network" }],
    ["a class that stops the queue", { kind: "stopped", stop: { reason: "key-refused" } }],
    ["no key", { kind: "stopped", stop: { reason: "no-key" } }],
  ] as const)(
    "%s: the check waits with its notice, offers no Save, and Check again runs the check, not the analysis or the fetch",
    async (_name, notice) => {
      const t = setup();
      await t.flow.start();
      t.flow.setText(SHORT);
      t.checkReplies.push({ ok: false, notice });
      await t.flow.analyse();
      expect(t.view()).toMatchObject({
        outcome: { picture: SHOWN, check: { state: "waits", notice } },
        offerSave: false,
      });
      expect(lookupSelfCheck(t.view().outcome)).toEqual({ state: "waiting" });
      await t.flow.checkAgain();
      expect(t.lookups).toEqual([SHORT]);
      expect(t.pictureNames).toHaveLength(1);
      expect(t.checks).toHaveLength(2);
      expect(t.view().outcome).toMatchObject({ check: AGREED });
    },
  );

  it("an error in the app while checking: says so, and Check again runs the check again", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.checkReplies.push(new Error("No space left on device"));
    await t.flow.analyse();
    expect(t.view().outcome).toMatchObject({ check: { state: "error" } });
    expect(lookupSelfCheck(t.view().outcome)).toEqual({ state: "waiting" });
    await t.flow.checkAgain();
    expect(t.view().outcome).toMatchObject({ check: AGREED });
  });

  it("Check again after a picture that waited fetches it, then checks it", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    t.pictures.push({ kind: "waits", cause: "network", retryAtMs: null });
    await t.flow.analyse();
    expect(t.checks).toEqual([]);
    await t.flow.checkAgain();
    expect(t.checks).toHaveLength(1);
    expect(t.view().outcome).toMatchObject({ picture: SHOWN, check: AGREED });
  });

  it("Check again does nothing before an answer is shown, once the check has an outcome, and a failed check is not tried again", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.checkAgain();
    expect(t.pictureNames).toEqual([]);
    t.checkReplies.push({ ok: true, outcome: { state: "failed" } });
    await t.flow.analyse();
    await t.flow.checkAgain();
    expect(t.checks).toHaveLength(1);
  });

  it("drops a check that ends after its answer is no longer shown, and one that ends after the screen is left", async () => {
    const changed = setup();
    await changed.flow.start();
    changed.flow.setText(SHORT);
    const release = changed.holdChecks();
    const analysing = changed.flow.analyse();
    await flush();
    changed.flow.setText(`${SHORT} Red.`);
    release();
    await analysing;
    expect(changed.view().outcome).toBeNull();

    const left = setup();
    await left.flow.start();
    left.flow.setText(SHORT);
    const releaseLeft = left.holdChecks();
    const pending = left.flow.analyse();
    await flush();
    const before = left.view();
    left.flow.close();
    releaseLeft();
    await pending;
    expect(left.view()).toBe(before);
  });

  it("a new answer brings a new picture and a new check", async () => {
    const t = setup();
    await t.flow.start();
    t.flow.setText(SHORT);
    await t.flow.analyse();
    const next = { ...PICTURE, uri: "file:///cache/picture-4.jpg" };
    t.pictures.push({ kind: "picture", picture: next });
    t.checkReplies.push({ ok: true, outcome: { state: "no-species" } });
    await t.flow.analyse();
    expect(t.checks).toEqual([
      [PICTURE.uri, MATCH.names],
      [next.uri, MATCH.names],
    ]);
    expect(lookupSelfCheck(t.view().outcome)).toEqual({ state: "no-species" });
  });
});

describe("lookupSelfCheck (the self-check an unsaved lookup's answer is shown with)", () => {
  it.each([
    ["no outcome", null, null],
    ["a notice", { kind: "notice", notice: { kind: "paused", cause: "network" } }, null],
    [
      "an answer naming no species",
      { kind: "answer", answer: { result: "no_mushroom" }, picture: null, check: null },
      null,
    ],
    [
      "a picture fetched",
      { kind: "answer", answer: MATCH, picture: { state: "fetching" }, check: null },
      { state: "waiting" },
    ],
    [
      "a picture that waits",
      { kind: "answer", answer: MATCH, picture: { state: "waits", cause: "network" }, check: null },
      { state: "waiting" },
    ],
    [
      "a picture whose fetch met an error",
      { kind: "answer", answer: MATCH, picture: { state: "error" }, check: null },
      { state: "waiting" },
    ],
    [
      "no picture",
      { kind: "answer", answer: MATCH, picture: { state: "none" }, check: null },
      { state: "no-picture" },
    ],
  ] as const)("for %s", (_name, outcome, expected) => {
    expect(lookupSelfCheck(outcome)).toEqual(expected);
  });
});
