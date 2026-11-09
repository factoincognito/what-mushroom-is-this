import type { Answer } from "../analysis/answer";
import { phoneTimeNow } from "../newFind/saveFind";
import type { AnalyseLookupResult } from "../queue/queue";
import type { NewTextFind, Position } from "../store/find";
import { INITIAL_TEXT_LOOKUP_VIEW, TextLookupFlow, type TextLookupView } from "./textLookupFlow";

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
    expect(t.view().outcome).toEqual({ kind: "answer", answer: MATCH });
    t.flow.setText(`${SHORT} White.`);
    expect(t.view().outcome).toBeNull();
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
      expect(t.view().outcome).toEqual({ kind: "answer", answer: MATCH });
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
