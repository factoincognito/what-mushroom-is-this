import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import { analysePhoto } from "../analysis/analyse";
import type { Answer } from "../analysis/answer";
import type { AnalysisError } from "../analysis/errors";
import { PhotoPreparationError, type PreparedPhoto } from "../image/prepareForAnalysis";
import type { ReadKeyResult } from "../key/apiKey";
import type { AnalysedAnswer, Analysis, Find, FindFailure } from "../store/find";
import { StoreError } from "../store/find";
import { AnalysisQueue, type QueueDeps, type QueueLog, type QueueState } from "./queue";

const MATCH: Answer = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: "high",
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};
const OTHER_ANSWER: Answer = { result: "cannot_tell" };

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const SETTINGS = { apiAddress: "https://api.anthropic.com", timeLimitMs: 60_000 };

/** The find log in memory: the finds by ID, and every change the queue makes, in order. */
class FakeLog implements QueueLog {
  readonly finds = new Map<number, Find>();
  readonly changes: string[] = [];
  failOn: string | null = null;

  addFind(id: number, analysis: Analysis = { state: "waiting" }): void {
    this.finds.set(id, {
      id,
      photoUri: `file:///photos/${id}.jpg`,
      time: { takenAtMs: NOW - id, utcOffsetMinutes: 60, source: "saved" },
      position: null,
      analysis,
    });
  }

  state(id: number): Analysis | undefined {
    return this.finds.get(id)?.analysis;
  }

  async oldestWaiting(): Promise<number | null> {
    this.check("oldestWaiting");
    const ids = [...this.finds.values()]
      .filter((find) => find.analysis.state === "waiting")
      .map((find) => find.id)
      .sort((a, b) => a - b);
    return ids[0] ?? null;
  }

  async get(id: number): Promise<Find | null> {
    this.check("get");
    return this.finds.get(id) ?? null;
  }

  async setAnswer(id: number, analysed: AnalysedAnswer): Promise<void> {
    this.check("setAnswer");
    this.changes.push(`setAnswer ${id}`);
    this.put(id, { state: "done", ...analysed });
  }

  async replaceAnswer(id: number, analysed: AnalysedAnswer): Promise<void> {
    this.check("replaceAnswer");
    this.changes.push(`replaceAnswer ${id}`);
    this.put(id, { state: "done", ...analysed });
  }

  async markFailed(id: number, failure: FindFailure): Promise<void> {
    this.check("markFailed");
    this.changes.push(`markFailed ${id} ${failure.cause}: ${failure.detail}`);
    this.put(id, { state: "failed", failure });
  }

  async markWaiting(id: number): Promise<void> {
    this.check("markWaiting");
    this.changes.push(`markWaiting ${id}`);
    this.put(id, { state: "waiting" });
  }

  private put(id: number, analysis: Analysis): void {
    const find = this.finds.get(id);
    if (find === undefined) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    this.finds.set(id, { ...find, analysis });
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

const LOADED: PreparedPhoto = { ok: true, imageBase64: "BBBB", width: 1, height: 1 };

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
        imageBase64: "AAAA",
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
    const original = t.log.get.bind(t.log);
    t.log.get = async (id) => {
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
    expect(t.calls.map((call) => call.imageBase64)).toEqual(["BBBB"]);
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
    expect(t.calls.map((call) => call.imageBase64)).toEqual(["BBBB"]);
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

  it("a trigger during the run starts no new count: a find saved then, whose photo does not load either, stops the run", async () => {
    const t = setup();
    t.log.addFind(1);
    t.setPreparation(async (uri) => {
      if (uri.endsWith("/1.jpg")) {
        t.log.addFind(2);
        void t.queue.trigger();
      }
      return loadFailed("load-failed");
    });
    await t.queue.trigger();
    expect(t.log.changes).toEqual(["markFailed 1 photo: load-failed"]);
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

/** Lets every pending promise callback run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}
