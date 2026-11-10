import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import { analysePhoto } from "../analysis/analyse";
import type { ApiAnswer } from "../analysis/answer";
import type { AnalysisError } from "../analysis/errors";
import { PhotoPreparationError, type PreparedPhoto } from "../image/prepareForAnalysis";
import type { ReadKeyResult } from "../key/apiKey";
import type {
  AnalysedAnswer,
  Analysis,
  AnalysisSent,
  FindFailure,
  FindPhoto,
  StoredFind,
} from "../store/find";
import { StoreError } from "../store/find";
import { AnalysisQueue, type QueueDeps, type QueueLog, type QueueState } from "./queue";

/** An answer as the API gives it: its confidence a number, never a Phase 1 level (PBI-2.12). */
const MATCH: ApiAnswer = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};
const OTHER_ANSWER: ApiAnswer = { result: "cannot_tell" };

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const SETTINGS = { apiAddress: "https://api.anthropic.com", timeLimitMs: 60_000 };

/**
 * The find log in memory: the finds by ID, as the store reads them in full (`getStored`, which the
 * queue reads since PBI-2.4), and every change the queue makes, in order.
 */
class FakeLog implements QueueLog {
  readonly finds = new Map<number, StoredFind>();
  readonly changes: string[] = [];
  /** What each stored answer's analysis sent, as the queue told the store (PBI-2.2). */
  readonly sent: { id: number; photoUris: string[] }[] = [];
  failOn: string | null = null;

  /** A photo find, its one photo named by its ID. */
  addFind(id: number, analysis: Analysis = { state: "waiting" }): void {
    this.put(id, analysis, null, [{ uri: `file:///photos/${id}.jpg`, batch: 1 }]);
  }

  /** A text find without photos (SPEC 3.9), or with the photos given. */
  addTextFind(
    id: number,
    text: string,
    analysis: Analysis = { state: "waiting" },
    photos: FindPhoto[] = [],
  ): void {
    this.put(id, analysis, text, photos);
  }

  /**
   * A photo find with several photos (PBI-2.5), each named by the find's ID and its number:
   * `file:///photos/<id>-<n>.jpg`, the first `n` 1, in the batches given.
   */
  addPhotos(id: number, batches: number[], analysis: Analysis = { state: "waiting" }): void {
    const photos = batches.map((batch, index) => ({
      uri: `file:///photos/${id}-${index + 1}.jpg`,
      batch,
    }));
    this.put(id, analysis, null, photos);
  }

  /** Changes a find as the store would hold it (an open batch, the photos added since). */
  set(id: number, change: Partial<StoredFind>): void {
    const find = this.finds.get(id);
    if (find === undefined) {
      throw new Error(`no find ${id}`);
    }
    this.finds.set(id, { ...find, ...change });
  }

  private put(id: number, analysis: Analysis, text: string | null, photos: FindPhoto[]): void {
    this.finds.set(id, {
      id,
      text,
      photos,
      batchOpen: false,
      time: { takenAtMs: NOW - id, utcOffsetMinutes: 60, source: "saved" },
      position: null,
      analysis,
      addedPhotos: analysis.state === "done" ? "analysed" : null,
      picture: null,
      selfCheck: null,
    });
  }

  state(id: number): Analysis | undefined {
    return this.finds.get(id)?.analysis;
  }

  /**
   * As the store's pick (PBI-2.5): a waiting find, or an analysed one whose photos added since its
   * answer wait, in either case with its batch complete; oldest first by ID.
   */
  async oldestWaiting(): Promise<number | null> {
    this.check("oldestWaiting");
    const ids = [...this.finds.values()]
      .filter(
        (find) =>
          !find.batchOpen &&
          (find.analysis.state === "waiting" ||
            (find.analysis.state === "done" && find.addedPhotos === "waiting")),
      )
      .map((find) => find.id)
      .sort((a, b) => a - b);
    return ids[0] ?? null;
  }

  async setAddedPhotos(id: number, state: "waiting" | "not-analysed"): Promise<void> {
    this.check("setAddedPhotos");
    this.changes.push(`setAddedPhotos ${id} ${state}`);
    const find = this.finds.get(id);
    const from = state === "waiting" ? "not-analysed" : "waiting";
    if (find === undefined || find.addedPhotos !== from) {
      throw new StoreError("wrong-state", `find ${id}'s added photos are not ${from}`);
    }
    this.finds.set(id, { ...find, addedPhotos: state });
  }

  async getStored(id: number): Promise<StoredFind | null> {
    this.check("getStored");
    return this.finds.get(id) ?? null;
  }

  async setAnswer(id: number, analysed: AnalysedAnswer, sent: AnalysisSent): Promise<void> {
    this.check("setAnswer");
    this.changes.push(`setAnswer ${id}`);
    this.sent.push({ id, photoUris: [...sent.photoUris] });
    this.change(id, { state: "done", ...analysed });
  }

  async replaceAnswer(id: number, analysed: AnalysedAnswer, sent: AnalysisSent): Promise<void> {
    this.check("replaceAnswer");
    this.changes.push(`replaceAnswer ${id}`);
    this.sent.push({ id, photoUris: [...sent.photoUris] });
    this.change(id, { state: "done", ...analysed });
  }

  async markFailed(id: number, failure: FindFailure): Promise<void> {
    this.check("markFailed");
    this.changes.push(`markFailed ${id} ${failure.cause}: ${failure.detail}`);
    this.change(id, { state: "failed", failure });
  }

  async markWaiting(id: number): Promise<void> {
    this.check("markWaiting");
    this.changes.push(`markWaiting ${id}`);
    this.change(id, { state: "waiting" });
  }

  /** Never reached here: no answer in these tests starts a self-check (`queuePicture.test.ts`). */
  async setPicture(id: number): Promise<void> {
    this.changes.push(`setPicture ${id}`);
  }

  async setSelfCheck(id: number): Promise<void> {
    this.changes.push(`setSelfCheck ${id}`);
  }

  private change(id: number, analysis: Analysis): void {
    const find = this.finds.get(id);
    if (find === undefined) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    // An answer covers every photo the find holds here: none is added while a test's analysis runs.
    const addedPhotos = analysis.state === "done" ? "analysed" : null;
    this.finds.set(id, { ...find, analysis, addedPhotos });
  }

  private check(method: string): void {
    if (this.failOn === method) {
      throw new StoreError("corrupt", `${method} failed`);
    }
  }
}

type Reply = AnalysisCallResult | (() => Promise<AnalysisCallResult>);

/** The parts of the app the queue uses, faked, and what each was asked. */
function setup() {
  const log = new FakeLog();
  const calls: AnalysisInput[] = [];
  const prepared: { uri: string; model: string }[] = [];
  const replies: Reply[] = [];
  const timers: { task: () => void; delayMs: number; cancelled: boolean }[] = [];
  let key: ReadKeyResult = { ok: true, key: "sk-ant-test" };
  let model = "claude-opus-5-5";
  let preparation: (uri: string) => Promise<PreparedPhoto> = async () => ({
    ok: true,
    imageBase64: "AAAA",
    width: 2212,
    height: 1659,
  });
  let keyReads = 0;
  let now = NOW;

  const deps: QueueDeps = {
    findLog: async () => log,
    readKey: async () => {
      keyReads += 1;
      return key;
    },
    readModelId: async () => model,
    preparePhoto: (uri, modelId) => {
      prepared.push({ uri, model: modelId });
      return preparation(uri);
    },
    analyse: async (input) => {
      calls.push(input);
      const reply = replies.shift() ?? { ok: true, answer: MATCH };
      return typeof reply === "function" ? reply() : reply;
    },
    now: () => now,
    schedule: (task, delayMs) => {
      const timer = { task, delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    // The fake log starts no self-check, so no picture is fetched (`queuePicture.test.ts`).
    fetchPicture: async () => {
      throw new Error("no picture is fetched in these tests");
    },
    removePictureCopy: () => undefined,
  };
  const queue = new AnalysisQueue(deps, SETTINGS);
  const states: QueueState[] = [];
  queue.subscribe((state) => states.push(state));
  queue.setInFront(true);
  return {
    queue,
    log,
    calls,
    prepared,
    replies,
    timers,
    states,
    deps,
    setKey: (value: ReadKeyResult) => {
      key = value;
    },
    setModel: (value: string) => {
      model = value;
    },
    setPreparation: (value: (uri: string) => Promise<PreparedPhoto>) => {
      preparation = value;
    },
    keyReads: () => keyReads,
    setNow: (value: number) => {
      now = value;
    },
  };
}

const fail = (error: AnalysisError): AnalysisCallResult => ({ ok: false, error });

/** A photo the encoder could not load. */
const loadFailed = (detail: string): PreparedPhoto => ({
  ok: false,
  loaded: false,
  failure: { cause: "photo", detail },
});

/** A photo that loaded, but whose decoded size cannot be used. */
const badSize = (detail: string): PreparedPhoto => ({
  ok: false,
  loaded: true,
  failure: { cause: "photo", detail },
});

const LOADED: Extract<PreparedPhoto, { ok: true }> = {
  ok: true,
  imageBase64: "BBBB",
  width: 1,
  height: 1,
};

/** Prepares each find's photo as `outcomes` gives it by the find's ID; a find not named loads. */
function photosById(outcomes: Record<number, PreparedPhoto>) {
  return async (uri: string): Promise<PreparedPhoto> => {
    const id = Number(/\/(\d+)\.jpg$/.exec(uri)?.[1]);
    return outcomes[id] ?? LOADED;
  };
}

describe("the run (SPEC 3.4)", () => {
  it("takes the waiting finds one at a time, oldest first by the find's ID, not by the time taken", async () => {
    const t = setup();
    // Find 3 was taken earliest (takenAtMs = NOW - id), but find 1 was saved first.
    t.log.addFind(3);
    t.log.addFind(1);
    t.log.addFind(2);
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1", "setAnswer 2", "setAnswer 3"]);
  });

  it("tells the store, with each answer, the photo it sent (PBI-2.2)", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    await t.queue.trigger();
    expect(t.log.sent).toEqual([
      { id: 1, photoUris: ["file:///photos/1.jpg"] },
      { id: 2, photoUris: ["file:///photos/2.jpg"] },
    ]);
  });

  it("stores each answer with the model that gave it and when", async () => {
    const t = setup();
    t.log.addFind(1);
    await t.queue.trigger();
    expect(t.log.state(1)).toEqual({
      state: "done",
      answer: MATCH,
      model: "claude-opus-5-5",
      analysedAtMs: NOW,
    });
  });

  it("sends the API address, the time limit, the key and the model in use with the prepared photo", async () => {
    const t = setup();
    t.setModel("claude-haiku-5-5");
    t.log.addFind(1);
    await t.queue.trigger();
    expect(t.prepared).toEqual([{ uri: "file:///photos/1.jpg", model: "claude-haiku-5-5" }]);
    expect(t.calls).toEqual([
      {
        apiAddress: SETTINGS.apiAddress,
        model: "claude-haiku-5-5",
        apiKey: "sk-ant-test",
        imagesBase64: ["AAAA"],
        timeLimitMs: SETTINGS.timeLimitMs,
      },
    ]);
  });

  it("leaves finds that are done or failed alone", async () => {
    const t = setup();
    t.log.addFind(1, { state: "done", answer: MATCH, model: "m", analysedAtMs: 1 });
    t.log.addFind(2, { state: "failed", failure: { cause: "request", detail: "x" } });
    await t.queue.trigger();
    expect(t.calls).toEqual([]);
    expect(t.log.changes).toEqual([]);
  });

  it("reports that it is running while it runs, and not once it ends", async () => {
    const t = setup();
    t.log.addFind(1);
    const run = t.queue.trigger();
    expect(t.queue.getState().running).toBe(true);
    await run;
    expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
    expect(t.states.at(-1)).toEqual({ running: false, stop: null, pause: null });
  });

  it("goes on with the next find when one is deleted between finding it and reading it", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    const original = t.log.getStored.bind(t.log);
    t.log.getStored = async (id) => {
      if (id === 1) {
        t.log.finds.delete(1);
        return null;
      }
      return original(id);
    };
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 2"]);
  });

  it("takes a find saved during the run in the same run", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(async () => {
      t.log.addFind(2);
      return { ok: true, answer: MATCH };
    });
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1", "setAnswer 2"]);
  });
});

describe("one run at a time", () => {
  it("does not start a second run on a trigger during a run", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    let release: () => void = () => undefined;
    t.replies.push(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, answer: MATCH });
        }),
    );
    const first = t.queue.trigger();
    await flush();
    const second = t.queue.trigger();
    const third = t.queue.trigger();
    await flush();
    expect(t.calls).toHaveLength(1);
    release();
    await Promise.all([first, second, third]);
    expect(t.calls).toHaveLength(2);
    expect(t.log.changes).toEqual(["setAnswer 1", "setAnswer 2"]);
  });

  it("checks once more for a find saved just as the run was ending, when a trigger came meanwhile", async () => {
    const t = setup();
    t.log.addFind(1);
    const original = t.log.oldestWaiting.bind(t.log);
    let reads = 0;
    t.log.oldestWaiting = async () => {
      reads += 1;
      const id = await original();
      if (reads === 2) {
        // The run has just found nothing left; a find is saved and its trigger comes.
        t.log.addFind(2);
        void t.queue.trigger();
      }
      return id;
    };
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1", "setAnswer 2"]);
  });

  it("does not send two requests at once when a find is analysed from its screen during a run", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2, { state: "failed", failure: { cause: "request", detail: "x" } });
    let inFlight = 0;
    let most = 0;
    t.deps.analyse = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await flush();
      inFlight -= 1;
      return { ok: true, answer: MATCH };
    };
    await Promise.all([t.queue.trigger(), t.queue.analyseFind(2)]);
    expect(most).toBe(1);
    expect(t.log.state(1)?.state).toBe("done");
    expect(t.log.state(2)?.state).toBe("done");
  });
});

describe("the triggers' conditions (SPEC 3.4)", () => {
  it("does not run while the app is not in front", async () => {
    const t = setup();
    t.queue.setInFront(false);
    t.log.addFind(1);
    await t.queue.trigger();
    expect(t.calls).toEqual([]);
    expect(t.queue.getState().running).toBe(false);
  });

  it("takes no next find once the app has left the front", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    t.replies.push(async () => {
      t.queue.setInFront(false);
      return { ok: true, answer: MATCH };
    });
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
    expect(t.log.state(2)).toEqual({ state: "waiting" });
  });

  it("does not run while the queue is stopped", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "no-credit", status: 402 }));
    await t.queue.trigger();
    expect(t.calls).toHaveLength(1);
    await t.queue.trigger();
    expect(t.calls).toHaveLength(1);
  });
});

describe("the error classes of SPEC 3.3 in a run", () => {
  it.each([
    ["no network", { kind: "stays-waiting", cause: "network", status: null }, "network"],
    ["the time limit", { kind: "stays-waiting", cause: "time-out", status: null }, "time-out"],
    [
      "a fault on Anthropic's side",
      { kind: "stays-waiting", cause: "server", status: 529 },
      "server",
    ],
  ] as const)(
    "%s: the find stays waiting and the run ends, not stopped",
    async (_name, error, cause) => {
      const t = setup();
      t.log.addFind(1);
      t.log.addFind(2);
      t.replies.push(fail(error));
      await t.queue.trigger();
      expect(t.calls).toHaveLength(1);
      expect(t.log.changes).toEqual([]);
      expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: cause });
    },
  );

  it("tries a find that stayed waiting again at the next run, and clears the pause", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "stays-waiting", cause: "network", status: null }));
    await t.queue.trigger();
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
    expect(t.queue.getState().pause).toBeNull();
  });

  it("429 with retry-after: stops until that time, then starts again by itself", async () => {
    const t = setup();
    t.log.addFind(1);
    const retryAt = NOW + 30_000;
    t.replies.push(fail({ kind: "rate-limited", retryAt }));
    await t.queue.trigger();
    expect(t.queue.getState().stop).toEqual({
      reason: "rate-limited",
      retryAtMs: retryAt,
      accessResumesAtMs: null,
    });
    expect(t.log.state(1)).toEqual({ state: "waiting" });
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]?.delayMs).toBe(30_000);
    await t.queue.trigger();
    expect(t.calls).toHaveLength(1);
    t.setNow(retryAt);
    t.timers[0]?.task();
    await flush();
    expect(t.queue.getState().stop).toBeNull();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
  });

  it("429 with retry-after: a trigger after that time runs, even if the timer did not fire", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "rate-limited", retryAt: NOW + 1_000 }));
    await t.queue.trigger();
    t.setNow(NOW + 1_000);
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("429 or the spend limit without retry-after: stops until the user starts it, with the time access resumes when the answer gives it", async () => {
    const t = setup();
    t.log.addFind(1);
    const resumes = Date.UTC(2026, 11, 1);
    t.replies.push({
      ok: false,
      error: { kind: "rate-limited", retryAt: null },
      accessResumesAtMs: resumes,
    });
    await t.queue.trigger();
    expect(t.queue.getState().stop).toEqual({
      reason: "rate-limited",
      retryAtMs: null,
      accessResumesAtMs: resumes,
    });
    expect(t.timers).toEqual([]);
    t.setNow(resumes + 1);
    await t.queue.trigger();
    expect(t.calls).toHaveLength(1);
  });

  it.each([
    ["401, 403", { kind: "key-refused", status: 401, cause: "refused" }, { reason: "key-refused" }],
    [
      "a key that cannot be sent",
      { kind: "key-refused", status: null, cause: "refused" },
      { reason: "key-refused" },
    ],
    [
      "the 400 of a key not scoped to a workspace (PBI-1.13)",
      { kind: "key-refused", status: 400, cause: "not-scoped" },
      { reason: "key-not-scoped" },
    ],
    [
      "another 400 classed as a refused key (PBI-1.21: by the class's own field, not its status)",
      { kind: "key-refused", status: 400, cause: "refused" },
      { reason: "key-refused" },
    ],
    [
      "a not-scoped key whatever its status (PBI-1.21)",
      { kind: "key-refused", status: 401, cause: "not-scoped" },
      { reason: "key-not-scoped" },
    ],
    ["402 or a billing error", { kind: "no-credit", status: 402 }, { reason: "no-credit" }],
    ["404", { kind: "model-unknown" }, { reason: "model-unknown" }],
    ["any other status", { kind: "other", status: 418 }, { reason: "other", status: 418 }],
  ] as const)("%s: the queue stops and the find stays waiting", async (_name, error, stop) => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    t.replies.push(fail(error));
    await t.queue.trigger();
    expect(t.calls).toHaveLength(1);
    expect(t.log.changes).toEqual([]);
    expect(t.queue.getState()).toEqual({ running: false, stop, pause: null });
  });

  it.each([
    ["400", "request-wrong", 400],
    ["413", "request-too-large", 413],
  ] as const)(
    "%s: that find is marked failed and the queue goes on",
    async (_name, reason, status) => {
      const t = setup();
      t.log.addFind(1);
      t.log.addFind(2);
      t.replies.push(fail({ kind: "find-failed", reason, status, queue: "goes-on" }));
      await t.queue.trigger();
      expect(t.log.changes).toEqual([
        `markFailed 1 request: ${reason} (status ${status})`,
        "setAnswer 2",
      ]);
      expect(t.queue.getState().stop).toBeNull();
    },
  );

  it.each([
    ["does not fit the shape", "shape"],
    ["is not from the API", "not-api"],
  ] as const)(
    "an answer that %s: that find is marked failed and the queue stops",
    async (_name, reason) => {
      const t = setup();
      t.log.addFind(1);
      t.log.addFind(2);
      t.replies.push(
        fail({
          kind: "find-failed",
          reason,
          detail: "the answer is not JSON",
          status: 200,
          queue: "stops",
        }),
      );
      await t.queue.trigger();
      expect(t.log.changes).toEqual(["markFailed 1 answer: the answer is not JSON"]);
      expect(t.log.state(2)).toEqual({ state: "waiting" });
      expect(t.queue.getState().stop).toEqual({ reason: "answer" });
    },
  );

  it("a refused answer: that find is marked failed with the cause refused, and the queue goes on (PBI-1.21)", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    t.replies.push(
      fail({
        kind: "find-failed",
        reason: "refused",
        detail: "the answer was refused (stop_reason refusal)",
        status: 200,
        queue: "goes-on",
      }),
    );
    await t.queue.trigger();
    expect(t.log.changes).toEqual([
      "markFailed 1 refused: the answer was refused (stop_reason refusal)",
      "setAnswer 2",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("a failed find is not tried again by the queue", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
    );
    await t.queue.trigger();
    await t.queue.trigger();
    expect(t.calls).toHaveLength(1);
  });
});

describe("the key (SPEC 3.2)", () => {
  it.each([
    ["no key is saved", { ok: true, key: null }],
    ["the key cannot be read", { ok: false }],
  ] as const)(
    "when %s, sends nothing: the find waits and the queue stops for a key",
    async (_name, key) => {
      const t = setup();
      t.setKey(key);
      t.log.addFind(1);
      await t.queue.trigger();
      expect(t.calls).toEqual([]);
      expect(t.prepared).toEqual([]);
      expect(t.log.state(1)).toEqual({ state: "waiting" });
      expect(t.queue.getState().stop).toEqual({ reason: "no-key" });
    },
  );

  it("reads no key when no find is waiting", async () => {
    const t = setup();
    await t.queue.trigger();
    expect(t.keyReads()).toBe(0);
  });
});

describe("the photo for analysis (SPEC 3.3)", () => {
  it("a photo that fails the segment check is not sent; the find is marked failed, naming the marker, and the queue goes on", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    t.setPreparation(async (uri) =>
      uri.endsWith("/1.jpg")
        ? {
            ok: false,
            loaded: true,
            failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
          }
        : { ok: true, imageBase64: "BBBB", width: 1, height: 1 },
    );
    await t.queue.trigger();
    expect(t.calls.map((call) => call.imagesBase64)).toEqual([["BBBB"]]);
    expect(t.log.changes).toEqual([
      "markFailed 1 segment-check: forbidden-segment 0xFFE1",
      "setAnswer 2",
    ]);
  });

  it("a photo that cannot be loaded, decoded or sized: the find is marked failed (photo) and the queue goes on", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    t.setPreparation(async (uri) =>
      uri.endsWith("/1.jpg")
        ? {
            ok: false,
            loaded: false,
            failure: { cause: "photo", detail: "load-failed: unsupported image format" },
          }
        : { ok: true, imageBase64: "BBBB", width: 1, height: 1 },
    );
    await t.queue.trigger();
    expect(t.calls.map((call) => call.imagesBase64)).toEqual([["BBBB"]]);
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: load-failed: unsupported image format",
      "setAnswer 2",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("an unreadable photo is not tried again by the queue", async () => {
    const t = setup();
    t.log.addFind(1);
    t.setPreparation(async () => loadFailed("gone"));
    await t.queue.trigger();
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["markFailed 1 photo: gone"]);
  });

  it.each([
    ["full storage", new Error("ENOSPC: no space left on device, write")],
    ["a failed read of the encoded bytes", new Error("File could not be read")],
    ["a programming error", new TypeError("Cannot read properties of undefined (reading 'uri')")],
    ["something that is not an Error", "busy"],
  ])(
    "an error while preparing the photo that is not the photo's (%s) passes through: the run rejects and the find stays waiting (PBI-1.21)",
    async (_name, thrown) => {
      const t = setup();
      t.log.addFind(1);
      t.log.addFind(2);
      t.setPreparation(async () => {
        throw thrown;
      });
      await expect(t.queue.trigger()).rejects.toBe(thrown);
      expect(t.calls).toEqual([]);
      expect(t.log.changes).toEqual([]);
      expect(t.log.state(1)).toEqual({ state: "waiting" });
      expect(t.log.state(2)).toEqual({ state: "waiting" });
      expect(t.queue.getState().running).toBe(false);
    },
  );

  it.each(["invalid-limits", "invalid-quality"] as const)(
    "a configuration error (%s) passes through, and the find stays waiting",
    async (code) => {
      const t = setup();
      t.log.addFind(1);
      t.setPreparation(async () => {
        throw new PhotoPreparationError(code, "bad config");
      });
      await expect(t.queue.trigger()).rejects.toBeInstanceOf(PhotoPreparationError);
      expect(t.log.state(1)).toEqual({ state: "waiting" });
      expect(t.queue.getState().running).toBe(false);
    },
  );
});

describe("two failed photo loads in a row in one run (PBI-1.25)", () => {
  it("the second does not fail its find: the run stops with internal-error, that find and every find after it stay waiting, and the first stays failed (photo)", async () => {
    const t = setup();
    for (const id of [1, 2, 3, 4]) {
      t.log.addFind(id);
    }
    t.setPreparation(
      photosById({ 1: loadFailed("load-failed: first"), 2: loadFailed("load-failed: second") }),
    );
    await expect(t.queue.trigger()).resolves.toBeUndefined();
    expect(t.log.changes).toEqual(["markFailed 1 photo: load-failed: first"]);
    expect(t.log.state(2)).toEqual({ state: "waiting" });
    expect(t.log.state(3)).toEqual({ state: "waiting" });
    expect(t.log.state(4)).toEqual({ state: "waiting" });
    expect(t.prepared.map((p) => p.uri)).toEqual(["file:///photos/1.jpg", "file:///photos/2.jpg"]);
    expect(t.calls).toEqual([]);
    expect(t.queue.getState()).toEqual({
      running: false,
      stop: { reason: "internal-error" },
      pause: null,
    });
  });

  it.each([
    ["the photo loads and the find is analysed", LOADED, null, "setAnswer 2"],
    [
      "the photo loads and then fails the segment check",
      {
        ok: false,
        loaded: true,
        failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
      },
      null,
      "markFailed 2 segment-check: forbidden-segment 0xFFE1",
    ],
    [
      "the photo loads and its decoded size cannot be used",
      badSize("invalid-size: 0 x 0"),
      null,
      "markFailed 2 photo: invalid-size: 0 x 0",
    ],
    [
      "the photo loads and the request is refused (400)",
      LOADED,
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
      "markFailed 2 request: request-wrong (status 400)",
    ],
  ] as const)(
    "a photo that loads ends the count, whatever comes of its find: %s",
    async (_name, second, reply, secondChange) => {
      const t = setup();
      for (const id of [1, 2, 3, 4]) {
        t.log.addFind(id);
      }
      t.setPreparation(
        photosById({ 1: loadFailed("load-failed: a"), 2: second, 3: loadFailed("load-failed: c") }),
      );
      if (reply !== null) {
        t.replies.push(reply);
      }
      await t.queue.trigger();
      expect(t.log.changes).toEqual([
        "markFailed 1 photo: load-failed: a",
        secondChange,
        "markFailed 3 photo: load-failed: c",
        "setAnswer 4",
      ]);
      expect(t.queue.getState().stop).toBeNull();
    },
  );

  it("only a failed load counts: two photos in a row whose decoded size cannot be used both fail, and the queue goes on", async () => {
    const t = setup();
    for (const id of [1, 2, 3]) {
      t.log.addFind(id);
    }
    t.setPreparation(photosById({ 1: badSize("invalid-size: a"), 2: badSize("invalid-size: b") }));
    await t.queue.trigger();
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: invalid-size: a",
      "markFailed 2 photo: invalid-size: b",
      "setAnswer 3",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("each run counts afresh: a failed load at the end of one run and one at the start of the next each fail their find", async () => {
    const t = setup();
    t.log.addFind(1);
    t.setPreparation(
      photosById({ 1: loadFailed("load-failed: a"), 2: loadFailed("load-failed: b") }),
    );
    await t.queue.trigger();
    t.log.addFind(2);
    await t.queue.trigger();
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: load-failed: a",
      "markFailed 2 photo: load-failed: b",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("analyse now starts a new run, so a new count: its first failed load fails its find, and a second one stops the queue again", async () => {
    const t = setup();
    for (const id of [1, 2, 3, 4]) {
      t.log.addFind(id);
    }
    t.setPreparation(
      photosById({
        1: loadFailed("load-failed: a"),
        2: loadFailed("load-failed: b"),
        3: loadFailed("load-failed: c"),
      }),
    );
    await t.queue.trigger();
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
    await t.queue.analyseNow();
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: load-failed: a",
      "markFailed 2 photo: load-failed: b",
    ]);
    expect(t.log.state(3)).toEqual({ state: "waiting" });
    expect(t.log.state(4)).toEqual({ state: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  it("a trigger during the run starts no new count, even when it comes as the run finds none left: a find saved then, whose photo does not load either, stops the run", async () => {
    const t = setup();
    t.log.addFind(1);
    t.setPreparation(async () => loadFailed("load-failed"));
    // Once find 1 has failed, the run's next step finds none waiting; the trigger comes just
    // then, so the run takes the path that goes on after "none" (Clead-role note 1 on #27).
    const oldestWaiting = t.log.oldestWaiting.bind(t.log);
    let triggered = false;
    jest.spyOn(t.log, "oldestWaiting").mockImplementation(async () => {
      const id = await oldestWaiting();
      if (id === null && !triggered) {
        triggered = true;
        t.log.addFind(2);
        void t.queue.trigger();
      }
      return id;
    });
    await t.queue.trigger();
    expect(triggered).toBe(true);
    expect(t.log.changes).toEqual(["markFailed 1 photo: load-failed"]);
    expect(t.prepared.map((p) => p.uri)).toEqual(["file:///photos/1.jpg", "file:///photos/2.jpg"]);
    expect(t.log.state(2)).toEqual({ state: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  it("a find analysed from its screen is not in a run, so not counted: two failed loads there each fail their find, and the queue does not stop", async () => {
    const t = setup();
    t.log.addFind(1, { state: "failed", failure: { cause: "photo", detail: "x" } });
    t.log.addFind(2, { state: "failed", failure: { cause: "photo", detail: "x" } });
    t.setPreparation(async () => loadFailed("load-failed"));
    for (const id of [1, 2]) {
      await expect(t.queue.analyseFind(id)).resolves.toEqual({
        ok: false,
        notice: { kind: "find-failed", failure: { cause: "photo", detail: "load-failed" } },
        answerKept: false,
      });
    }
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: load-failed",
      "markFailed 2 photo: load-failed",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });
});

describe("programming errors", () => {
  it("the time limit's RangeError passes through: not a failed find, and the run ends", async () => {
    const t = setup();
    t.log.addFind(1);
    // The real call, with a time limit it refuses as a programming error.
    const queue = new AnalysisQueue(
      { ...t.deps, analyse: (input) => analysePhoto(input, { fetch: jest.fn(), now: () => NOW }) },
      { ...SETTINGS, timeLimitMs: 0 },
    );
    queue.setInFront(true);
    await expect(queue.trigger()).rejects.toBeInstanceOf(RangeError);
    expect(t.log.state(1)).toEqual({ state: "waiting" });
    expect(t.log.changes).toEqual([]);
    expect(queue.getState()).toEqual({ running: false, stop: null, pause: null });
  });

  it("runs again after a run that threw", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(async () => {
      throw new RangeError("bad");
    });
    await expect(t.queue.trigger()).rejects.toBeInstanceOf(RangeError);
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
  });

  it("a store error passes through and ends the run", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.failOn = "setAnswer";
    await expect(t.queue.trigger()).rejects.toBeInstanceOf(StoreError);
    expect(t.queue.getState().running).toBe(false);
  });
});

describe("the internal-error stop", () => {
  it("stops the queue for an internal error, which analyse now lifts", async () => {
    const t = setup();
    t.log.addFind(1);
    t.queue.stopForInternalError();
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
    await t.queue.trigger();
    expect(t.calls).toEqual([]);
    await t.queue.analyseNow();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("is not lifted by a change of a setting", async () => {
    const t = setup();
    t.queue.stopForInternalError();
    await t.queue.settingChanged("key");
    await t.queue.settingChanged("model");
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  it("is set when the run the queue starts itself after a 429's retry-after rejects", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "rate-limited", retryAt: NOW + 1_000 }));
    t.replies.push(async () => {
      throw new RangeError("bad");
    });
    await t.queue.trigger();
    t.setNow(NOW + 1_000);
    t.timers[0]?.task();
    await flush();
    expect(t.queue.getState()).toEqual({
      running: false,
      stop: { reason: "internal-error" },
      pause: null,
    });
    expect(t.log.state(1)).toEqual({ state: "waiting" });
  });
});

describe("restarts (SPEC 3.3)", () => {
  it("analyse now starts a stopped queue again", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "no-credit", status: 402 }));
    await t.queue.trigger();
    await t.queue.analyseNow();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("analyse now cancels the timer of a 429 with retry-after", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "rate-limited", retryAt: NOW + 5_000 }));
    await t.queue.trigger();
    await t.queue.analyseNow();
    expect(t.timers[0]?.cancelled).toBe(true);
    expect(t.log.changes).toEqual(["setAnswer 1"]);
  });

  it("analyse now does not run while the app is not in front", async () => {
    const t = setup();
    t.log.addFind(1);
    t.queue.setInFront(false);
    await t.queue.analyseNow();
    expect(t.calls).toEqual([]);
  });

  it.each([
    ["key", { kind: "key-refused", status: 403, cause: "refused" }],
    ["key", { kind: "key-refused", status: 400, cause: "not-scoped" }],
    ["model", { kind: "model-unknown" }],
  ] as const)(
    "a change of the %s setting starts the queue stopped for it again",
    async (setting, error) => {
      const t = setup();
      t.log.addFind(1);
      t.replies.push(fail(error));
      await t.queue.trigger();
      await t.queue.settingChanged(setting);
      expect(t.log.changes).toEqual(["setAnswer 1"]);
    },
  );

  it("a change of the key starts the queue stopped for a missing key again", async () => {
    const t = setup();
    t.setKey({ ok: true, key: null });
    t.log.addFind(1);
    await t.queue.trigger();
    t.setKey({ ok: true, key: "sk-ant-new" });
    await t.queue.settingChanged("key");
    expect(t.calls.map((call) => call.apiKey)).toEqual(["sk-ant-new"]);
  });

  it.each([
    ["model", { kind: "key-refused", status: 401, cause: "refused" }, { reason: "key-refused" }],
    [
      "model",
      { kind: "key-refused", status: 400, cause: "not-scoped" },
      { reason: "key-not-scoped" },
    ],
    ["key", { kind: "model-unknown" }, { reason: "model-unknown" }],
    ["key", { kind: "no-credit", status: 402 }, { reason: "no-credit" }],
  ] as const)(
    "a change of the %s setting does not start a queue stopped for another cause",
    async (setting, error, stop) => {
      const t = setup();
      t.log.addFind(1);
      t.replies.push(fail(error));
      await t.queue.trigger();
      await t.queue.settingChanged(setting);
      expect(t.calls).toHaveLength(1);
      expect(t.queue.getState().stop).toEqual(stop);
    },
  );

  it("dispose cancels a pending restart", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "rate-limited", retryAt: NOW + 5_000 }));
    await t.queue.trigger();
    t.queue.dispose();
    expect(t.timers[0]?.cancelled).toBe(true);
  });

  it("a timer that fires after analyse now changes nothing", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "rate-limited", retryAt: NOW + 5_000 }));
    t.replies.push(fail({ kind: "no-credit", status: 402 }));
    await t.queue.trigger();
    await t.queue.analyseNow();
    expect(t.queue.getState().stop).toEqual({ reason: "no-credit" });
    t.timers[0]?.task();
    await flush();
    expect(t.queue.getState().stop).toEqual({ reason: "no-credit" });
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const t = setup();
    const listener = jest.fn();
    const unsubscribe = t.queue.subscribe(listener);
    unsubscribe();
    t.log.addFind(1);
    await t.queue.trigger();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("analysing one find from its screen (SPEC 3.3, 3.4)", () => {
  it("analyses a waiting find at once, also while the queue is stopped", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addFind(2);
    t.replies.push(fail({ kind: "no-credit", status: 402 }));
    await t.queue.trigger();
    await expect(t.queue.analyseFind(2)).resolves.toEqual({ ok: true });
    expect(t.log.changes).toEqual(["setAnswer 2"]);
    expect(t.queue.getState().stop).toEqual({ reason: "no-credit" });
  });

  it("analyses a failed find again when the user asks", async () => {
    const t = setup();
    t.log.addFind(1, { state: "failed", failure: { cause: "request", detail: "x" } });
    await expect(t.queue.analyseFind(1)).resolves.toEqual({ ok: true });
    expect(t.log.changes).toEqual(["setAnswer 1"]);
  });

  it("tells the store the photo it sent, for a find analysed from its screen (PBI-2.2)", async () => {
    const t = setup();
    t.log.addFind(1, { state: "failed", failure: { cause: "request", detail: "x" } });
    t.log.addFind(2, { state: "done", answer: OTHER_ANSWER, model: "old", analysedAtMs: 1 });
    await t.queue.analyseFind(1);
    await t.queue.analyseFind(2);
    expect(t.log.sent).toEqual([
      { id: 1, photoUris: ["file:///photos/1.jpg"] },
      { id: 2, photoUris: ["file:///photos/2.jpg"] },
    ]);
  });

  it("replaces the answer of an analysed find", async () => {
    const t = setup();
    t.log.addFind(1, { state: "done", answer: OTHER_ANSWER, model: "old", analysedAtMs: 1 });
    await t.queue.analyseFind(1);
    expect(t.log.changes).toEqual(["replaceAnswer 1"]);
    expect(t.log.state(1)).toEqual({
      state: "done",
      answer: MATCH,
      model: "claude-opus-5-5",
      analysedAtMs: NOW,
    });
  });

  it("marks a waiting find failed on a 400 and says why", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
    );
    await expect(t.queue.analyseFind(1)).resolves.toEqual({
      ok: false,
      notice: {
        kind: "find-failed",
        failure: { cause: "request", detail: "request-wrong (status 400)" },
      },
      answerKept: false,
    });
    expect(t.log.changes).toEqual(["markFailed 1 request: request-wrong (status 400)"]);
  });

  it("puts a failed find back to waiting when it meets no network, so the queue tries it", async () => {
    const t = setup();
    t.log.addFind(1, { state: "failed", failure: { cause: "request", detail: "x" } });
    t.replies.push(fail({ kind: "stays-waiting", cause: "network", status: null }));
    await expect(t.queue.analyseFind(1)).resolves.toEqual({
      ok: false,
      notice: { kind: "paused", cause: "network" },
      answerKept: false,
    });
    expect(t.log.state(1)).toEqual({ state: "waiting" });
  });

  it("puts a failed find back to waiting when the queue stops for it", async () => {
    const t = setup();
    t.log.addFind(1, { state: "failed", failure: { cause: "request", detail: "x" } });
    t.replies.push(fail({ kind: "key-refused", status: 401, cause: "refused" }));
    await expect(t.queue.analyseFind(1)).resolves.toEqual({
      ok: false,
      notice: { kind: "stopped", stop: { reason: "key-refused" } },
      answerKept: false,
    });
    expect(t.log.state(1)).toEqual({ state: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "key-refused" });
  });

  it("leaves a waiting find waiting when the queue stops for it", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "model-unknown" }));
    await t.queue.analyseFind(1);
    expect(t.log.changes).toEqual([]);
    expect(t.log.state(1)).toEqual({ state: "waiting" });
  });

  it("refuses an ID no find has", async () => {
    const t = setup();
    await expect(t.queue.analyseFind(9)).rejects.toMatchObject({ code: "not-found" });
  });

  describe("a failed new analysis of an analysed find keeps its answer, whatever the class", () => {
    const analysed: Analysis = {
      state: "done",
      answer: OTHER_ANSWER,
      model: "old",
      analysedAtMs: 1,
    };

    it.each([
      [
        "no network",
        fail({ kind: "stays-waiting", cause: "network", status: null }),
        { kind: "paused", cause: "network" },
        null,
      ],
      [
        "400",
        fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
        {
          kind: "find-failed",
          failure: { cause: "request", detail: "request-wrong (status 400)" },
        },
        null,
      ],
      [
        "an answer not of the shape",
        fail({ kind: "find-failed", reason: "shape", detail: "bad", status: 200, queue: "stops" }),
        { kind: "find-failed", failure: { cause: "answer", detail: "bad" } },
        { reason: "answer" },
      ],
      [
        "401",
        fail({ kind: "key-refused", status: 401, cause: "refused" }),
        { kind: "stopped", stop: { reason: "key-refused" } },
        { reason: "key-refused" },
      ],
      [
        "404",
        fail({ kind: "model-unknown" }),
        { kind: "stopped", stop: { reason: "model-unknown" } },
        { reason: "model-unknown" },
      ],
      [
        "402",
        fail({ kind: "no-credit", status: 402 }),
        { kind: "stopped", stop: { reason: "no-credit" } },
        { reason: "no-credit" },
      ],
      [
        "429",
        fail({ kind: "rate-limited", retryAt: null }),
        {
          kind: "stopped",
          stop: { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
        },
        { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
      ],
      [
        "any other status",
        fail({ kind: "other", status: 418 }),
        { kind: "stopped", stop: { reason: "other", status: 418 } },
        { reason: "other", status: 418 },
      ],
    ] as const)(
      "%s: the answer is kept, nothing is stored, and the table's outcome for the queue applies",
      async (_name, reply, notice, stop) => {
        const t = setup();
        t.log.addFind(1, analysed);
        t.replies.push(reply);
        await expect(t.queue.analyseFind(1)).resolves.toEqual({
          ok: false,
          notice,
          answerKept: true,
        });
        expect(t.log.changes).toEqual([]);
        expect(t.log.state(1)).toEqual(analysed);
        expect(t.queue.getState().stop).toEqual(stop);
      },
    );

    it("a photo that cannot be loaded: the answer is kept", async () => {
      const t = setup();
      t.log.addFind(1, analysed);
      t.setPreparation(async () => loadFailed("gone"));
      await expect(t.queue.analyseFind(1)).resolves.toEqual({
        ok: false,
        notice: { kind: "find-failed", failure: { cause: "photo", detail: "gone" } },
        answerKept: true,
      });
      expect(t.log.changes).toEqual([]);
      expect(t.queue.getState().stop).toBeNull();
    });

    it("full storage while preparing the photo: rejects, and the answer is kept (PBI-1.21)", async () => {
      const t = setup();
      t.log.addFind(1, analysed);
      t.setPreparation(async () => {
        throw new Error("ENOSPC: no space left on device");
      });
      await expect(t.queue.analyseFind(1)).rejects.toThrow("ENOSPC");
      expect(t.log.changes).toEqual([]);
      expect(t.log.state(1)).toEqual(analysed);
    });

    it("a photo that fails the segment check: the answer is kept", async () => {
      const t = setup();
      t.log.addFind(1, analysed);
      t.setPreparation(async () => ({
        ok: false,
        loaded: true,
        failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
      }));
      await expect(t.queue.analyseFind(1)).resolves.toEqual({
        ok: false,
        notice: {
          kind: "find-failed",
          failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
        },
        answerKept: true,
      });
      expect(t.log.changes).toEqual([]);
    });

    it("no key: the answer is kept and the queue stops for a key", async () => {
      const t = setup();
      t.setKey({ ok: true, key: null });
      t.log.addFind(1, analysed);
      await expect(t.queue.analyseFind(1)).resolves.toEqual({
        ok: false,
        notice: { kind: "stopped", stop: { reason: "no-key" } },
        answerKept: true,
      });
      expect(t.log.changes).toEqual([]);
    });
  });
});

const DESCRIPTION = "A yellow funnel with false gills, in moss under spruce.";

describe("a text find in the queue (SPEC 3.9, PBI-2.4)", () => {
  it("takes a waiting text find and sends its text, preparing no photo, and tells the store it sent none", async () => {
    const t = setup();
    t.log.addTextFind(1, DESCRIPTION);
    await t.queue.trigger();
    expect(t.prepared).toEqual([]);
    expect(t.calls).toEqual([
      {
        apiAddress: SETTINGS.apiAddress,
        model: "claude-opus-5-5",
        apiKey: "sk-ant-test",
        text: DESCRIPTION,
        timeLimitMs: SETTINGS.timeLimitMs,
      },
    ]);
    expect(t.log.sent).toEqual([{ id: 1, photoUris: [] }]);
    expect(t.log.state(1)).toEqual({
      state: "done",
      answer: MATCH,
      model: "claude-opus-5-5",
      analysedAtMs: NOW,
    });
  });

  it("takes text and photo finds in one run, oldest first by the find's ID", async () => {
    const t = setup();
    t.log.addFind(2);
    t.log.addTextFind(1, DESCRIPTION);
    t.log.addTextFind(3, "A white cap.");
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAnswer 1", "setAnswer 2", "setAnswer 3"]);
    expect(t.calls.map((call) => call.text ?? call.imagesBase64?.[0])).toEqual([
      DESCRIPTION,
      "AAAA",
      "A white cap.",
    ]);
  });

  it("a text find without photos ends the count of failed photo loads (SPEC 3.9, Batches)", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addTextFind(2, DESCRIPTION);
    t.log.addFind(3);
    t.setPreparation(async () => loadFailed("load-failed"));
    await t.queue.trigger();
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: load-failed",
      "setAnswer 2",
      "markFailed 3 photo: load-failed",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("each error class has its outcome for a text find, as for a photo find: a 400 fails it and the queue goes on", async () => {
    const t = setup();
    t.log.addTextFind(1, DESCRIPTION);
    t.log.addTextFind(2, "A white cap.");
    t.replies.push(
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
    );
    await t.queue.trigger();
    expect(t.log.changes).toEqual([
      "markFailed 1 request: request-wrong (status 400)",
      "setAnswer 2",
    ]);
  });

  it("no network leaves a text find waiting and ends the run", async () => {
    const t = setup();
    t.log.addTextFind(1, DESCRIPTION);
    t.replies.push(fail({ kind: "stays-waiting", cause: "network", status: null }));
    await t.queue.trigger();
    expect(t.log.changes).toEqual([]);
    expect(t.queue.getState().pause).toBe("network");
  });

  it("analyses a text find from its screen by its text, also while the queue is stopped", async () => {
    const t = setup();
    t.log.addTextFind(1, DESCRIPTION, {
      state: "done",
      answer: OTHER_ANSWER,
      model: "m",
      analysedAtMs: 1,
    });
    t.queue.stopForInternalError();
    await expect(t.queue.analyseFind(1)).resolves.toEqual({ ok: true });
    expect(t.calls.map((call) => call.text)).toEqual([DESCRIPTION]);
    expect(t.log.changes).toEqual(["replaceAnswer 1"]);
    expect(t.log.sent).toEqual([{ id: 1, photoUris: [] }]);
  });

  it("sends a text find that has photos by all its photos and its text, in one request (SPEC 3.9, Batches; PBI-2.5)", async () => {
    const t = setup();
    t.log.addTextFind(1, DESCRIPTION, { state: "waiting" }, [
      { uri: "file:///photos/a.jpg", batch: 1 },
      { uri: "file:///photos/b.jpg", batch: 1 },
    ]);
    t.setPreparation(async (uri) => ({ ...LOADED, imageBase64: uri.slice(-5, -4) }));
    await t.queue.trigger();
    expect(t.prepared.map((call) => call.uri)).toEqual([
      "file:///photos/a.jpg",
      "file:///photos/b.jpg",
    ]);
    expect(t.calls).toEqual([
      expect.objectContaining({ imagesBase64: ["a", "b"], text: DESCRIPTION }),
    ]);
    expect(t.log.sent).toEqual([
      { id: 1, photoUris: ["file:///photos/a.jpg", "file:///photos/b.jpg"] },
    ]);
  });

  it("refuses, as a store error that stops the queue, a waiting find with neither text nor a photo, which the store never gives", async () => {
    const t = setup();
    t.log.addFind(1);
    const find = t.log.finds.get(1);
    if (find === undefined) {
      throw new Error("no find 1");
    }
    t.log.finds.set(1, { ...find, photos: [] });
    await expect(t.queue.trigger()).rejects.toMatchObject({ code: "corrupt" });
    expect(t.calls).toEqual([]);
    expect(t.log.changes).toEqual([]);
  });
});

/** A segment-check failure of a photo that loaded. */
const refused: PreparedPhoto = {
  ok: false,
  loaded: true,
  failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
};

/** Prepares each photo as `outcomes` gives it by its URI's name ("1-2" for find 1, photo 2). */
function photosByName(outcomes: Record<string, PreparedPhoto>) {
  return async (uri: string): Promise<PreparedPhoto> => {
    const name = /\/([^/]+)\.jpg$/.exec(uri)?.[1] ?? "";
    return outcomes[name] ?? { ...LOADED, imageBase64: name };
  };
}

const ANSWERED: Analysis = { state: "done", answer: OTHER_ANSWER, model: "m", analysedAtMs: 1 };

describe("all of a find's photos in one request (SPEC 3.9, Batches; PBI-2.5)", () => {
  it("prepares every photo in the order added and sends them all in one request, telling the store it sent them all", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1, 2]);
    t.setPreparation(photosByName({}));
    await t.queue.trigger();
    expect(t.prepared.map((call) => call.uri)).toEqual([
      "file:///photos/1-1.jpg",
      "file:///photos/1-2.jpg",
      "file:///photos/1-3.jpg",
    ]);
    expect(t.calls).toEqual([
      {
        apiAddress: SETTINGS.apiAddress,
        model: "claude-opus-5-5",
        apiKey: "sk-ant-test",
        imagesBase64: ["1-1", "1-2", "1-3"],
        timeLimitMs: SETTINGS.timeLimitMs,
      },
    ]);
    expect(t.log.sent).toEqual([
      {
        id: 1,
        photoUris: ["file:///photos/1-1.jpg", "file:///photos/1-2.jpg", "file:///photos/1-3.jpg"],
      },
    ]);
  });

  it("prepares the photos one at a time: the next only once the one before is ready", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1, 1]);
    let preparing = 0;
    let most = 0;
    t.setPreparation(async () => {
      preparing += 1;
      most = Math.max(most, preparing);
      await flush();
      preparing -= 1;
      return LOADED;
    });
    await t.queue.trigger();
    expect(t.prepared).toHaveLength(3);
    expect(most).toBe(1);
  });

  it("a photo that fails the segment check: nothing is sent, the find fails naming the photo, and the queue goes on", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1, 1]);
    t.log.addFind(2);
    t.setPreparation(photosByName({ "1-2": refused }));
    await t.queue.trigger();
    // Only find 2's photo is sent, whose prepared bytes the stand-in names "2".
    expect(t.calls.map((call) => call.imagesBase64)).toEqual([["2"]]);
    expect(t.log.changes).toEqual([
      "markFailed 1 segment-check: photo 2: forbidden-segment 0xFFE1",
      "setAnswer 2",
    ]);
  });

  it("a photo that cannot be loaded: nothing is sent, the find fails naming the photo, and no photo after it is prepared", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1, 1]);
    t.setPreparation(photosByName({ "1-2": loadFailed("load-failed") }));
    await t.queue.trigger();
    expect(t.calls).toEqual([]);
    expect(t.prepared.map((call) => call.uri)).toEqual([
      "file:///photos/1-1.jpg",
      "file:///photos/1-2.jpg",
    ]);
    expect(t.log.changes).toEqual(["markFailed 1 photo: photo 2: load-failed"]);
  });

  it("names the first photo that failed when two fail", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1, 1]);
    t.setPreparation(photosByName({ "1-1": refused, "1-3": badSize("invalid-size: x") }));
    await t.queue.trigger();
    expect(t.log.changes).toEqual([
      "markFailed 1 segment-check: photo 1: forbidden-segment 0xFFE1",
    ]);
  });

  it("analysed from its screen, stops preparing at the first photo that fails", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1, 1]);
    t.setPreparation(photosByName({ "1-1": refused }));
    await expect(t.queue.analyseFind(1)).resolves.toMatchObject({ ok: false });
    expect(t.prepared.map((call) => call.uri)).toEqual(["file:///photos/1-1.jpg"]);
    expect(t.log.changes).toEqual([
      "markFailed 1 segment-check: photo 1: forbidden-segment 0xFFE1",
    ]);
  });

  it("sends the photos left, and no photo of the find's removed one, after a photo was removed", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 2], ANSWERED);
    t.log.set(1, {
      addedPhotos: "waiting",
      photos: [{ uri: "file:///photos/1-1.jpg", batch: 1 }],
    });
    t.setPreparation(photosByName({}));
    await t.queue.trigger();
    expect(t.calls.map((call) => call.imagesBase64)).toEqual([["1-1"]]);
    expect(t.log.changes).toEqual(["replaceAnswer 1"]);
  });
});

describe("the count of failed loads with several photos (SPEC 3.9, Batches; PBI-1.25)", () => {
  it("a find counts as one whose photos cannot be loaded when any one of them cannot", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1]);
    t.log.addPhotos(2, [1, 1]);
    t.log.addFind(3);
    t.setPreparation(
      photosByName({ "1-2": loadFailed("load-failed"), "2-1": loadFailed("load-failed") }),
    );
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["markFailed 1 photo: photo 2: load-failed"]);
    expect(t.log.state(2)).toEqual({ state: "waiting" });
    expect(t.log.state(3)).toEqual({ state: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  it("in a run, the photos after one that fails the segment check are still loaded, and a find whose photos all load ends the count", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addPhotos(2, [1, 1]);
    t.log.addFind(3);
    t.setPreparation(
      photosByName({
        "1": loadFailed("load-failed"),
        "2-1": refused,
        "3": loadFailed("load-failed"),
      }),
    );
    await t.queue.trigger();
    expect(t.prepared.map((call) => call.uri)).toEqual([
      "file:///photos/1.jpg",
      "file:///photos/2-1.jpg",
      "file:///photos/2-2.jpg",
      "file:///photos/3.jpg",
    ]);
    expect(t.calls).toEqual([]);
    expect(t.log.changes).toEqual([
      "markFailed 1 photo: load-failed",
      "markFailed 2 segment-check: photo 1: forbidden-segment 0xFFE1",
      "markFailed 3 photo: load-failed",
    ]);
    expect(t.queue.getState().stop).toBeNull();
  });

  it("a find whose photo after a segment failure does not load counts as one whose photos cannot be loaded", async () => {
    const t = setup();
    t.log.addFind(1);
    t.log.addPhotos(2, [1, 1]);
    t.setPreparation(
      photosByName({ "1": loadFailed("load-failed"), "2-1": refused, "2-2": loadFailed("x") }),
    );
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["markFailed 1 photo: load-failed"]);
    expect(t.log.state(2)).toEqual({ state: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });
});

describe("a new batch on an analysed find (SPEC 3.9, Batches; PBI-2.5)", () => {
  /** An analysed find with a second batch whose photo waits for the queue. */
  function analysedWithNewPhotos(t: ReturnType<typeof setup>, id = 1): void {
    t.log.addPhotos(id, [1, 2], ANSWERED);
    t.log.set(id, { addedPhotos: "waiting" });
  }

  it("the queue takes it, sends all its photos and replaces its answer, covering them", async () => {
    const t = setup();
    analysedWithNewPhotos(t);
    t.setPreparation(photosByName({}));
    await t.queue.trigger();
    expect(t.calls.map((call) => call.imagesBase64)).toEqual([["1-1", "1-2"]]);
    expect(t.log.changes).toEqual(["replaceAnswer 1"]);
    expect(t.log.sent).toEqual([
      { id: 1, photoUris: ["file:///photos/1-1.jpg", "file:///photos/1-2.jpg"] },
    ]);
    expect(t.log.finds.get(1)).toMatchObject({
      analysis: { state: "done", answer: MATCH, analysedAtMs: NOW },
      addedPhotos: "analysed",
    });
  });

  it("the queue does not take a find while its batch is open", async () => {
    const t = setup();
    t.log.addPhotos(1, [1, 1]);
    t.log.set(1, { batchOpen: true });
    analysedWithNewPhotos(t, 2);
    t.log.set(2, { batchOpen: true });
    await t.queue.trigger();
    expect(t.calls).toEqual([]);
  });

  it.each(["analysed", "not-analysed"] as const)(
    "the queue does not take an analysed find whose added photos are %s",
    async (state) => {
      const t = setup();
      analysedWithNewPhotos(t);
      t.log.set(1, { addedPhotos: state });
      await t.queue.trigger();
      expect(t.calls).toEqual([]);
    },
  );

  it.each([
    ["no network", "network"],
    ["the time limit", "time-out"],
    ["a fault on Anthropic's side", "server"],
  ] as const)(
    "%s: the photos stay waiting, the find keeps its answer, and the run ends",
    async (_name, cause) => {
      const t = setup();
      analysedWithNewPhotos(t);
      analysedWithNewPhotos(t, 2);
      t.replies.push(fail({ kind: "stays-waiting", cause, status: null }));
      await t.queue.trigger();
      expect(t.calls).toHaveLength(1);
      expect(t.log.changes).toEqual([]);
      expect(t.log.finds.get(1)).toMatchObject({ analysis: ANSWERED, addedPhotos: "waiting" });
      expect(t.queue.getState().pause).toBe(cause);
    },
  );

  it("a 400: the find keeps its answer, is not marked failed, its new photos are not yet analysed, and the queue goes on", async () => {
    const t = setup();
    analysedWithNewPhotos(t);
    t.log.addFind(2);
    t.replies.push(
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
    );
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAddedPhotos 1 not-analysed", "setAnswer 2"]);
    expect(t.log.finds.get(1)).toMatchObject({ analysis: ANSWERED, addedPhotos: "not-analysed" });
  });

  it("a photo that cannot be sized: the find keeps its answer and its new photos are not yet analysed", async () => {
    const t = setup();
    analysedWithNewPhotos(t);
    t.setPreparation(photosByName({ "1-2": badSize("invalid-size: x") }));
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["setAddedPhotos 1 not-analysed"]);
    expect(t.log.finds.get(1)).toMatchObject({ analysis: ANSWERED });
  });

  it.each([
    [
      "an answer not of the shape",
      fail({ kind: "find-failed", reason: "shape", detail: "bad", status: 200, queue: "stops" }),
      { reason: "answer" },
    ],
    [
      "401",
      fail({ kind: "key-refused", status: 401, cause: "refused" }),
      { reason: "key-refused" },
    ],
    [
      "429",
      fail({ kind: "rate-limited", retryAt: null }),
      { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
    ],
    ["any other status", fail({ kind: "other", status: 418 }), { reason: "other", status: 418 }],
  ] as const)(
    "%s: the queue stops, the find keeps its answer, and its new photos are not yet analysed",
    async (_name, reply, stop) => {
      const t = setup();
      analysedWithNewPhotos(t);
      t.replies.push(reply);
      await t.queue.trigger();
      expect(t.log.changes).toEqual(["setAddedPhotos 1 not-analysed"]);
      expect(t.log.finds.get(1)).toMatchObject({ analysis: ANSWERED });
      expect(t.queue.getState().stop).toEqual(stop);
    },
  );

  it("without a key: nothing is sent, the photos stay waiting, as a find waits without a key (SPEC 3.2), and the queue stops for a key", async () => {
    const t = setup();
    analysedWithNewPhotos(t);
    t.setKey({ ok: true, key: null });
    await t.queue.trigger();
    expect(t.calls).toEqual([]);
    expect(t.log.changes).toEqual([]);
    expect(t.log.finds.get(1)).toMatchObject({ addedPhotos: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "no-key" });
  });

  it("the second find in a row whose photos do not load: its new photos stay waiting and the run stops (PBI-1.25)", async () => {
    const t = setup();
    t.log.addFind(1);
    analysedWithNewPhotos(t, 2);
    t.setPreparation(
      photosByName({ "1": loadFailed("load-failed"), "2-2": loadFailed("load-failed") }),
    );
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["markFailed 1 photo: load-failed"]);
    expect(t.log.finds.get(2)).toMatchObject({ analysis: ANSWERED, addedPhotos: "waiting" });
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  describe("analysed from its screen, when the user asks", () => {
    it("photos not yet analysed after a failure: an answer replaces the earlier one and covers them", async () => {
      const t = setup();
      analysedWithNewPhotos(t);
      t.log.set(1, { addedPhotos: "not-analysed" });
      await expect(t.queue.analyseFind(1)).resolves.toEqual({ ok: true });
      expect(t.log.changes).toEqual(["replaceAnswer 1"]);
      expect(t.log.finds.get(1)).toMatchObject({ addedPhotos: "analysed" });
    });

    it("a pause puts photos not yet analysed back to waiting, for the queue's next run", async () => {
      const t = setup();
      analysedWithNewPhotos(t);
      t.log.set(1, { addedPhotos: "not-analysed" });
      t.replies.push(fail({ kind: "stays-waiting", cause: "network", status: null }));
      await expect(t.queue.analyseFind(1)).resolves.toEqual({
        ok: false,
        notice: { kind: "paused", cause: "network" },
        answerKept: true,
      });
      expect(t.log.changes).toEqual(["setAddedPhotos 1 waiting"]);
    });

    it("a 400 marks waiting photos not yet analysed, and the answer is kept", async () => {
      const t = setup();
      analysedWithNewPhotos(t);
      t.replies.push(
        fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
      );
      await expect(t.queue.analyseFind(1)).resolves.toEqual({
        ok: false,
        notice: {
          kind: "find-failed",
          failure: { cause: "request", detail: "request-wrong (status 400)" },
        },
        answerKept: true,
      });
      expect(t.log.changes).toEqual(["setAddedPhotos 1 not-analysed"]);
      expect(t.log.finds.get(1)).toMatchObject({ analysis: ANSWERED });
    });

    it("a 400 leaves photos not yet analysed as they are", async () => {
      const t = setup();
      analysedWithNewPhotos(t);
      t.log.set(1, { addedPhotos: "not-analysed" });
      t.replies.push(
        fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
      );
      await t.queue.analyseFind(1);
      expect(t.log.changes).toEqual([]);
    });

    it("an analysed find whose photos are all analysed: a failure changes nothing, as in Phase 1", async () => {
      const t = setup();
      t.log.addPhotos(1, [1, 1], ANSWERED);
      t.replies.push(fail({ kind: "stays-waiting", cause: "network", status: null }));
      await t.queue.analyseFind(1);
      t.replies.push(fail({ kind: "other", status: 418 }));
      await t.queue.analyseFind(1);
      expect(t.log.changes).toEqual([]);
    });
  });
});

describe("an unsaved lookup, analysed from its screen (SPEC 3.9, Lookups)", () => {
  it("sends the text at once, also while the queue is stopped, and stores nothing", async () => {
    const t = setup();
    t.log.addFind(1);
    t.queue.stopForInternalError();
    await expect(t.queue.analyseLookup(DESCRIPTION)).resolves.toEqual({
      ok: true,
      answer: MATCH,
      model: "claude-opus-5-5",
    });
    expect(t.calls.map((call) => call.text)).toEqual([DESCRIPTION]);
    expect(t.prepared).toEqual([]);
    expect(t.log.changes).toEqual([]);
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  it.each([
    ["no network", "network"],
    ["the time limit", "time-out"],
    ["a fault on Anthropic's side", "server"],
  ] as const)(
    "%s: gives the pause, as for a find that stays waiting, and neither pauses nor stops the queue",
    async (_name, cause) => {
      const t = setup();
      t.replies.push(fail({ kind: "stays-waiting", cause, status: null }));
      await expect(t.queue.analyseLookup(DESCRIPTION)).resolves.toEqual({
        ok: false,
        notice: { kind: "paused", cause },
      });
      expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
    },
  );

  it.each([
    [
      "400",
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
      { cause: "request", detail: "request-wrong (status 400)" },
    ],
    [
      "a refusal",
      fail({ kind: "find-failed", reason: "refused", detail: "x", status: 200, queue: "goes-on" }),
      { cause: "refused", detail: "x" },
    ],
  ] as const)(
    "%s: gives the failure, as for a find marked failed, and does not stop the queue",
    async (_name, reply, failure) => {
      const t = setup();
      t.replies.push(reply);
      await expect(t.queue.analyseLookup(DESCRIPTION)).resolves.toEqual({
        ok: false,
        notice: { kind: "find-failed", failure },
      });
      expect(t.queue.getState().stop).toBeNull();
      expect(t.log.changes).toEqual([]);
    },
  );

  it.each([
    [
      "an answer not of the shape",
      fail({ kind: "find-failed", reason: "shape", detail: "bad", status: 200, queue: "stops" }),
      { kind: "find-failed", failure: { cause: "answer", detail: "bad" } },
      { reason: "answer" },
    ],
    [
      "401",
      fail({ kind: "key-refused", status: 401, cause: "refused" }),
      { kind: "stopped", stop: { reason: "key-refused" } },
      { reason: "key-refused" },
    ],
    [
      "the workspace 400",
      fail({ kind: "key-refused", status: 400, cause: "not-scoped" }),
      { kind: "stopped", stop: { reason: "key-not-scoped" } },
      { reason: "key-not-scoped" },
    ],
    [
      "402",
      fail({ kind: "no-credit", status: 402 }),
      { kind: "stopped", stop: { reason: "no-credit" } },
      { reason: "no-credit" },
    ],
    [
      "404",
      fail({ kind: "model-unknown" }),
      { kind: "stopped", stop: { reason: "model-unknown" } },
      { reason: "model-unknown" },
    ],
    [
      "429 without retry-after",
      fail({ kind: "rate-limited", retryAt: null }),
      {
        kind: "stopped",
        stop: { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
      },
      { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
    ],
    [
      "any other status",
      fail({ kind: "other", status: 418 }),
      { kind: "stopped", stop: { reason: "other", status: 418 } },
      { reason: "other", status: 418 },
    ],
  ] as const)(
    "%s: stops the queue as for a find, and gives the same message",
    async (_name, reply, notice, stop) => {
      const t = setup();
      t.replies.push(reply);
      await expect(t.queue.analyseLookup(DESCRIPTION)).resolves.toEqual({ ok: false, notice });
      expect(t.queue.getState().stop).toEqual(stop);
      expect(t.log.changes).toEqual([]);
    },
  );

  it("429 with retry-after: stops the queue until then, and it starts again by itself", async () => {
    const t = setup();
    t.log.addFind(1);
    t.replies.push(fail({ kind: "rate-limited", retryAt: NOW + 30_000 }));
    await t.queue.analyseLookup(DESCRIPTION);
    expect(t.queue.getState().stop).toEqual({
      reason: "rate-limited",
      retryAtMs: NOW + 30_000,
      accessResumesAtMs: null,
    });
    expect(t.timers.map((timer) => timer.delayMs)).toEqual([30_000]);
    t.setNow(NOW + 30_000);
    t.timers[0]?.task();
    await flush();
    expect(t.log.changes).toEqual(["setAnswer 1"]);
  });

  it("without a key: stops the queue for a key and says so, sending nothing", async () => {
    const t = setup();
    t.setKey({ ok: true, key: null });
    await expect(t.queue.analyseLookup(DESCRIPTION)).resolves.toEqual({
      ok: false,
      notice: { kind: "stopped", stop: { reason: "no-key" } },
    });
    expect(t.calls).toEqual([]);
    expect(t.queue.getState().stop).toEqual({ reason: "no-key" });
  });

  it("passes on an error the queue does not handle, storing nothing", async () => {
    const t = setup();
    t.replies.push(async () => {
      throw new RangeError("timeLimitMs must be an integer");
    });
    await expect(t.queue.analyseLookup(DESCRIPTION)).rejects.toThrow(RangeError);
    expect(t.log.changes).toEqual([]);
  });

  it("does not send while a run's request is under way, but after it", async () => {
    const t = setup();
    t.log.addFind(1);
    let release: () => void = () => undefined;
    t.replies.push(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, answer: MATCH });
        }),
    );
    const run = t.queue.trigger();
    await flush();
    const lookup = t.queue.analyseLookup(DESCRIPTION);
    await flush();
    expect(t.calls).toHaveLength(1);
    release();
    await Promise.all([run, lookup]);
    expect(t.calls.map((call) => call.text ?? call.imagesBase64?.[0])).toEqual([
      "AAAA",
      DESCRIPTION,
    ]);
  });
});

const LOOKUP_PHOTOS = [
  "file:///cache/ImagePicker/a.jpg",
  "file:///cache/ImagePicker/b.jpg",
  "file:///cache/ImagePicker/c.jpg",
];

describe("an unsaved photo lookup, analysed from its screen (SPEC 3.9, Lookups; PBI-2.13)", () => {
  it("prepares its photos one at a time, in order, and sends them all in one request, at once, also while the queue is stopped, storing nothing", async () => {
    const t = setup();
    t.log.addFind(1);
    t.queue.stopForInternalError();
    let preparing = 0;
    let most = 0;
    const byName = photosByName({});
    t.setPreparation(async (uri) => {
      preparing += 1;
      most = Math.max(most, preparing);
      await flush();
      preparing -= 1;
      return byName(uri);
    });
    await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).resolves.toEqual({
      ok: true,
      answer: MATCH,
      model: "claude-opus-5-5",
    });
    expect(t.prepared).toEqual(LOOKUP_PHOTOS.map((uri) => ({ uri, model: "claude-opus-5-5" })));
    expect(most).toBe(1);
    expect(t.calls).toEqual([
      {
        apiAddress: SETTINGS.apiAddress,
        model: "claude-opus-5-5",
        apiKey: "sk-ant-test",
        imagesBase64: ["a", "b", "c"],
        timeLimitMs: SETTINGS.timeLimitMs,
      },
    ]);
    expect(t.log.changes).toEqual([]);
    expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
  });

  it("a photo that fails the segment check: nothing is sent, the failure names the photo, and the queue goes on", async () => {
    const t = setup();
    t.setPreparation(photosByName({ b: refused }));
    await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).resolves.toEqual({
      ok: false,
      notice: {
        kind: "find-failed",
        failure: { cause: "segment-check", detail: "photo 2: forbidden-segment 0xFFE1" },
      },
    });
    expect(t.calls).toEqual([]);
    // From its screen, as a find analysed there: no photo after the failure is prepared.
    expect(t.prepared.map((call) => call.uri)).toEqual(LOOKUP_PHOTOS.slice(0, 2));
    expect(t.queue.getState().stop).toBeNull();
  });

  it("a single photo that cannot be loaded: the failure is the photo's own, not numbered, and the queue neither stops nor counts it", async () => {
    const t = setup();
    t.setPreparation(async () => loadFailed("load-failed"));
    for (let i = 0; i < 3; i += 1) {
      await expect(t.queue.analysePhotoLookup(["file:///cache/a.jpg"])).resolves.toEqual({
        ok: false,
        notice: { kind: "find-failed", failure: { cause: "photo", detail: "load-failed" } },
      });
    }
    expect(t.queue.getState().stop).toBeNull();
  });

  it.each([
    ["no network", "network"],
    ["the time limit", "time-out"],
    ["a fault on Anthropic's side", "server"],
  ] as const)(
    "%s: gives the pause, as for a find that stays waiting, and neither pauses nor stops the queue",
    async (_name, cause) => {
      const t = setup();
      t.replies.push(fail({ kind: "stays-waiting", cause, status: null }));
      await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).resolves.toEqual({
        ok: false,
        notice: { kind: "paused", cause },
      });
      expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
    },
  );

  it("a 400: gives the failure, as for a find marked failed, and does not stop the queue", async () => {
    const t = setup();
    t.replies.push(
      fail({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }),
    );
    await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).resolves.toEqual({
      ok: false,
      notice: {
        kind: "find-failed",
        failure: { cause: "request", detail: "request-wrong (status 400)" },
      },
    });
    expect(t.queue.getState().stop).toBeNull();
  });

  it.each([
    [
      "an answer not of the shape",
      fail({ kind: "find-failed", reason: "shape", detail: "bad", status: 200, queue: "stops" }),
      { kind: "find-failed", failure: { cause: "answer", detail: "bad" } },
      { reason: "answer" },
    ],
    [
      "401",
      fail({ kind: "key-refused", status: 401, cause: "refused" }),
      { kind: "stopped", stop: { reason: "key-refused" } },
      { reason: "key-refused" },
    ],
    [
      "404",
      fail({ kind: "model-unknown" }),
      { kind: "stopped", stop: { reason: "model-unknown" } },
      { reason: "model-unknown" },
    ],
    [
      "429 without retry-after",
      fail({ kind: "rate-limited", retryAt: null }),
      {
        kind: "stopped",
        stop: { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
      },
      { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
    ],
  ] as const)(
    "%s: stops the queue as for a find, and gives the same message",
    async (_name, reply, notice, stop) => {
      const t = setup();
      t.replies.push(reply);
      await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).resolves.toEqual({
        ok: false,
        notice,
      });
      expect(t.queue.getState().stop).toEqual(stop);
      expect(t.log.changes).toEqual([]);
    },
  );

  it("without a key: stops the queue for a key and says so, preparing and sending nothing", async () => {
    const t = setup();
    t.setKey({ ok: true, key: null });
    await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).resolves.toEqual({
      ok: false,
      notice: { kind: "stopped", stop: { reason: "no-key" } },
    });
    expect(t.prepared).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(t.queue.getState().stop).toEqual({ reason: "no-key" });
  });

  it("passes on an error while preparing a photo that is not the photo's own, storing nothing", async () => {
    const t = setup();
    t.setPreparation(async () => {
      throw new Error("ENOSPC: no space left on device");
    });
    await expect(t.queue.analysePhotoLookup(LOOKUP_PHOTOS)).rejects.toThrow("ENOSPC");
    expect(t.calls).toEqual([]);
    expect(t.log.changes).toEqual([]);
  });

  it.each([
    ["no photo", []],
    ["more photos than a find holds", ["1", "2", "3", "4", "5", "6"].map((n) => `file:///${n}`)],
  ])("refuses %s as a programming error, sending nothing", async (_name, uris) => {
    const t = setup();
    await expect(t.queue.analysePhotoLookup(uris)).rejects.toThrow(RangeError);
    expect(t.prepared).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  it("does not send while a run's request is under way, but after it", async () => {
    const t = setup();
    t.log.addFind(1);
    let release: () => void = () => undefined;
    t.replies.push(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, answer: MATCH });
        }),
    );
    t.setPreparation(photosByName({}));
    const run = t.queue.trigger();
    await flush();
    const lookup = t.queue.analysePhotoLookup(LOOKUP_PHOTOS.slice(0, 1));
    await flush();
    expect(t.calls).toHaveLength(1);
    expect(t.prepared.map((call) => call.uri)).toEqual(["file:///photos/1.jpg"]);
    release();
    await Promise.all([run, lookup]);
    expect(t.calls.map((call) => call.imagesBase64)).toEqual([["1"], ["a"]]);
  });
});

/** Lets every pending promise callback run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}
