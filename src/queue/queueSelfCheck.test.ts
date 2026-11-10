/**
 * The queue and the self-check of a text lookup (docs/SPEC.md 3.9, "The self-check of a text
 * lookup"; PBI-2.10): the photo lookup on the representative picture, without the text, through
 * the same request as a photo find; the match on genus and species; its outcomes, stored as the
 * self-check's only, never as the find's answer; its place in the queue run; its error groups; and
 * an unsaved lookup's check, given back and never stored. The find log is the in-memory one, which
 * `memoryFindLog.test.ts` holds to the real store.
 */

import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import type { Match } from "../analysis/answer";
import type { PreparedPhoto } from "../image/prepareForAnalysis";
import type { ReadKeyResult } from "../key/apiKey";
import type { PictureFetch } from "../picture/fetchPicture";
import { type StoredFind, StoreError } from "../store/find";
import { memoryFindLog } from "../testing/memoryFindLog";
import { AnalysisQueue, type QueueDeps } from "./queue";

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const MODEL = "claude-opus-5-5";
const MATCH: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};
const PORCINI: Match = {
  ...MATCH,
  names: { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" },
  edibility: "edible",
};
const time = { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" } as const;

const PICTURE = {
  uri: "file:///photos/picture-2.jpg",
  author: "Example Photographer",
  licence: "cc-by-sa-3.0",
  page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
};
const FOUND: PictureFetch = { kind: "picture", picture: PICTURE };
/** Where the store keeps its copies of pictures, in these tests. */
const PICTURES = "file:///photos/picture-";
/** The base64 the stand-in encoder gives for a picture, and for any photo. */
const PICTURE_B64 = "UElDVFVSRQ==";
const PHOTO_B64 = "AAAA";

const ok = (answer: Match | { result: "no_mushroom" | "cannot_tell" }): AnalysisCallResult => ({
  ok: true,
  answer,
});

function setup() {
  const log = memoryFindLog();
  const events: string[] = [];
  const analyses: AnalysisInput[] = [];
  const replies: AnalysisCallResult[] = [];
  const pictures: PictureFetch[] = [];
  /** What preparing a URI gives, when not the stand-in's success. */
  const prepared = new Map<string, PreparedPhoto | Error>();
  let key: ReadKeyResult = { ok: true, key: "sk-ant-test" };

  const deps: QueueDeps = {
    findLog: async () => log,
    readKey: async () => key,
    readModelId: async () => MODEL,
    preparePhoto: async (uri, modelId) => {
      events.push(`prepare ${uri} ${modelId}`);
      const given = prepared.get(uri);
      if (given instanceof Error) {
        throw given;
      }
      return (
        given ?? {
          ok: true,
          imageBase64: uri.startsWith(PICTURES) ? PICTURE_B64 : PHOTO_B64,
          width: 1,
          height: 1,
        }
      );
    },
    analyse: async (input): Promise<AnalysisCallResult> => {
      analyses.push(input);
      const images = input.imagesBase64 ?? [];
      events.push(
        images.length === 0
          ? "analyse text"
          : images[0] === PICTURE_B64
            ? "check"
            : "analyse photos",
      );
      return replies.shift() ?? ok(MATCH);
    },
    now: () => NOW,
    schedule: () => () => undefined,
    fetchPicture: async (latinName) => {
      events.push(`picture ${latinName}`);
      return pictures.shift() ?? FOUND;
    },
    removePictureCopy: () => undefined,
  };
  const queue = new AnalysisQueue(deps, {
    apiAddress: "https://api.anthropic.com",
    timeLimitMs: 60_000,
  });
  queue.setInFront(true);
  return {
    queue,
    log,
    events,
    analyses,
    replies,
    pictures,
    prepared,
    setKey: (value: ReadKeyResult) => {
      key = value;
    },
  };
}

type Setup = ReturnType<typeof setup>;

async function textFind(t: Setup, takenAtMs = 1_000): Promise<number> {
  return t.log.addText({ text: "A yellow funnel.", time: { ...time, takenAtMs }, position: null });
}

async function photoFind(t: Setup, uri = "file:///cache/a.jpg"): Promise<number> {
  return t.log.add({ photoUri: uri, time, position: null });
}

/**
 * A text find analysed earlier from its text alone, its picture stored and its check waiting, as
 * the store holds it after a run whose check waited.
 */
function checkWaits(t: Setup, id: number): StoredFind {
  const find: StoredFind = {
    id,
    text: "A yellow funnel.",
    photos: [],
    batchOpen: false,
    time,
    position: null,
    analysis: { state: "done", answer: MATCH, model: MODEL, analysedAtMs: 500 },
    addedPhotos: "analysed",
    picture: PICTURE,
    selfCheck: { state: "waiting" },
  };
  t.log.finds.set(id, find);
  return find;
}

/** Fails the run after 20 picks of the store: a run that takes a find without end rejects. */
function boundedPicks(t: Setup) {
  const original = t.log.oldestWaiting.bind(t.log);
  return jest.spyOn(t.log, "oldestWaiting").mockImplementation(async () => {
    if (jest.mocked(t.log.oldestWaiting).mock.calls.length > 20) {
      throw new Error("the run took the same find without end");
    }
    return original();
  });
}

const NOT_LOADED: PreparedPhoto = {
  ok: false,
  loaded: false,
  failure: { cause: "photo", detail: "load-failed" },
};

describe("the run that brings a text answer (docs/SPEC.md 3.9)", () => {
  it("fetches the picture and runs the check at once, before the next find: the picture alone, as Image 1:, without the text, for the model in use", async () => {
    const t = setup();
    const text = await textFind(t);
    await photoFind(t);
    await t.queue.trigger();
    expect(t.events).toEqual([
      "analyse text",
      "picture Cantharellus cibarius",
      `prepare ${PICTURE.uri} ${MODEL}`,
      "check",
      `prepare file:///cache/a.jpg ${MODEL}`,
      "analyse photos",
    ]);
    const check = t.analyses[1];
    expect(check).toEqual({
      apiAddress: "https://api.anthropic.com",
      model: MODEL,
      apiKey: "sk-ant-test",
      timeLimitMs: 60_000,
      imagesBase64: [PICTURE_B64],
    });
    expect(check).not.toHaveProperty("text");
    expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "agreed" });
    expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
  });

  it("another species: stores that the check disagreed, naming its species, and keeps the text answer as the find's answer", async () => {
    const t = setup();
    const text = await textFind(t);
    t.replies.push(ok(MATCH), ok(PORCINI));
    await t.queue.trigger();
    const stored = await t.log.getStored(text);
    expect(stored?.selfCheck).toEqual({ state: "disagreed", names: PORCINI.names });
    expect(stored?.analysis).toEqual({
      state: "done",
      answer: MATCH,
      model: MODEL,
      analysedAtMs: NOW,
    });
  });

  it("agrees on genus and species whatever else the check says, its own confidence too", async () => {
    const t = setup();
    const text = await textFind(t);
    t.replies.push(
      ok(MATCH),
      ok({
        ...PORCINI,
        names: { ...PORCINI.names, la: "CANTHARELLUS Cibarius Fr." },
        confidence: 3,
      }),
    );
    await t.queue.trigger();
    expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "agreed" });
  });

  it.each([
    ["no mushroom", { result: "no_mushroom" }],
    ["cannot tell", { result: "cannot_tell" }],
  ] as const)("%s: stores that the check could not name a species", async (_name, answer) => {
    const t = setup();
    const text = await textFind(t);
    t.replies.push(ok(MATCH), ok(answer));
    await t.queue.trigger();
    expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "no-species" });
    expect((await t.log.getStored(text))?.analysis).toMatchObject({ answer: MATCH });
  });

  it("runs no check when there is no picture for the answer", async () => {
    const t = setup();
    const text = await textFind(t);
    t.pictures.push({ kind: "none", reason: "licence" });
    await t.queue.trigger();
    expect(t.events).toEqual(["analyse text", "picture Cantharellus cibarius"]);
    expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "no-picture" });
  });

  it("runs no check for an answer from photos", async () => {
    const t = setup();
    const photo = await photoFind(t);
    await t.queue.trigger();
    expect(t.events).toEqual([`prepare file:///cache/a.jpg ${MODEL}`, "analyse photos"]);
    expect((await t.log.getStored(photo))?.selfCheck).toBeNull();
  });
});

describe("the check's error groups in a run (docs/SPEC.md 3.9)", () => {
  it.each([
    ["no network", "network", { kind: "stays-waiting", cause: "network", status: null }],
    ["the time limit", "time-out", { kind: "stays-waiting", cause: "time-out", status: null }],
    [
      "a fault on Anthropic's side",
      "server",
      { kind: "stays-waiting", cause: "server", status: 529 },
    ],
  ] as const)(
    "%s: the check waits and the run ends, as a waiting find's does; the next run runs the check, not the text analysis, and goes on",
    async (_name, cause, error) => {
      const t = setup();
      const text = await textFind(t);
      await photoFind(t);
      t.replies.push(ok(MATCH), { ok: false, error });
      await t.queue.trigger();
      expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual([
        "analyse text",
        "picture Cantharellus cibarius",
        "check",
      ]);
      expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: cause });
      expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "waiting" });
      await t.queue.trigger();
      expect(t.events.filter((event) => !event.startsWith("prepare")).slice(3)).toEqual([
        "check",
        "analyse photos",
      ]);
      expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "agreed" });
      expect(t.queue.getState().pause).toBeNull();
    },
  );

  it.each([
    [
      "a 429",
      { kind: "rate-limited", retryAt: null },
      { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
    ],
    ["a 401", { kind: "key-refused", status: 401, cause: "refused" }, { reason: "key-refused" }],
    ["a 402", { kind: "no-credit", status: 402 }, { reason: "no-credit" }],
    ["a 404", { kind: "model-unknown" }, { reason: "model-unknown" }],
    [
      "an answer not of the shape",
      { kind: "find-failed", reason: "shape", detail: "no result", status: 200, queue: "stops" },
      { reason: "answer" },
    ],
    ["any other status", { kind: "other", status: 418 }, { reason: "other", status: 418 }],
  ] as const)(
    "%s: stops the queue as for a find, and the check waits",
    async (_name, error, stop) => {
      const t = setup();
      const text = await textFind(t);
      await photoFind(t);
      t.replies.push(ok(MATCH), { ok: false, error });
      await t.queue.trigger();
      expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual([
        "analyse text",
        "picture Cantharellus cibarius",
        "check",
      ]);
      expect(t.queue.getState().stop).toEqual(stop);
      expect(await t.log.getStored(text)).toMatchObject({
        analysis: { state: "done", answer: MATCH },
        selfCheck: { state: "waiting" },
      });
      // "Analyse now" starts the queue again, which takes the check first.
      await t.queue.analyseNow();
      expect(t.events.filter((event) => !event.startsWith("prepare")).slice(3)).toEqual([
        "check",
        "analyse photos",
      ]);
    },
  );

  it("without a key: stops the queue for a key, and the check waits", async () => {
    const t = setup();
    checkWaits(t, 1);
    t.setKey({ ok: true, key: null });
    await t.queue.trigger();
    expect(t.events).toEqual([]);
    expect(t.queue.getState().stop).toEqual({ reason: "no-key" });
    expect((await t.log.getStored(1))?.selfCheck).toEqual({ state: "waiting" });
  });

  it.each([
    ["a 400", { kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" }],
    ["a 413", { kind: "find-failed", reason: "request-too-large", status: 413, queue: "goes-on" }],
    [
      "a refusal",
      { kind: "find-failed", reason: "refused", detail: "refusal", status: 200, queue: "goes-on" },
    ],
  ] as const)(
    "%s: marks the check failed, keeps the answer, and the run goes on",
    async (_name, error) => {
      const t = setup();
      const text = await textFind(t);
      await photoFind(t);
      t.replies.push(ok(MATCH), { ok: false, error });
      await t.queue.trigger();
      expect(t.events.at(-1)).toBe("analyse photos");
      expect(await t.log.getStored(text)).toMatchObject({
        analysis: { state: "done", answer: MATCH },
        selfCheck: { state: "failed" },
      });
      expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
    },
  );

  it.each([
    ["cannot be loaded", NOT_LOADED],
    [
      "fails the metadata check",
      {
        ok: false,
        loaded: true,
        failure: { cause: "segment-check", detail: "app1 0xFFE1" },
      } as const,
    ],
  ])(
    "a check picture that %s marks the check failed, sends nothing, and the run goes on",
    async (_name, result) => {
      const t = setup();
      const text = await textFind(t);
      await photoFind(t);
      t.prepared.set(PICTURE.uri, result);
      await t.queue.trigger();
      expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual([
        "analyse text",
        "picture Cantharellus cibarius",
        "analyse photos",
      ]);
      expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "failed" });
    },
  );

  it("an error that is not the picture's while preparing it rejects the run and leaves the check waiting", async () => {
    const t = setup();
    const text = await textFind(t);
    t.prepared.set(PICTURE.uri, new Error("No space left on device"));
    await expect(t.queue.trigger()).rejects.toThrow("No space left");
    expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "waiting" });
  });

  it("a picture that waits for Wikimedia, as after its 429, ends the run as 3.3 does for Anthropic's, and runs no check", async () => {
    const t = setup();
    const text = await textFind(t);
    await photoFind(t);
    t.pictures.push({ kind: "waits", cause: "picture-source", retryAtMs: NOW + 5_000 });
    await t.queue.trigger();
    expect(t.events).toEqual(["analyse text", "picture Cantharellus cibarius"]);
    expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: "picture-source" });
    expect((await t.log.getStored(text))?.selfCheck).toEqual({ state: "waiting" });
  });
});

describe("waiting checks in the queue run (docs/SPEC.md 3.9)", () => {
  it("takes waiting checks together with waiting finds, oldest find first", async () => {
    const t = setup();
    await photoFind(t, "file:///cache/one.jpg");
    checkWaits(t, 2);
    await t.log.add({ photoUri: "file:///cache/three.jpg", time, position: null });
    await t.queue.trigger();
    expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual([
      "analyse photos",
      "check",
      "analyse photos",
    ]);
    expect(t.analyses.map((input) => input.imagesBase64)).toEqual([
      [PHOTO_B64],
      [PICTURE_B64],
      [PHOTO_B64],
    ]);
    expect((await t.log.getStored(2))?.selfCheck).toEqual({ state: "agreed" });
  });

  it.each([
    ["cannot be loaded", NOT_LOADED],
    ["loads", null],
  ])(
    "a check picture that %s neither counts toward the failed loads that stop the queue nor ends their count (PBI-1.25)",
    async (_name, result) => {
      const t = setup();
      await photoFind(t, "file:///cache/one.jpg");
      checkWaits(t, 2);
      await t.log.add({ photoUri: "file:///cache/three.jpg", time, position: null });
      t.prepared.set("file:///cache/one.jpg", NOT_LOADED);
      t.prepared.set("file:///cache/three.jpg", NOT_LOADED);
      if (result !== null) {
        t.prepared.set(PICTURE.uri, result);
      }
      await t.queue.trigger();
      // The second photo find in a row whose photo does not load stops the queue and waits.
      expect(t.queue.getState().stop).toEqual({ reason: "internal-error" });
      expect((await t.log.getStored(1))?.analysis.state).toBe("failed");
      expect((await t.log.getStored(3))?.analysis.state).toBe("waiting");
      expect((await t.log.getStored(2))?.selfCheck).toEqual({
        state: result === null ? "agreed" : "failed",
      });
    },
  );

  it("skips a check still waiting when a batch completes on its find: its photos are analysed instead, and their answer ends it", async () => {
    const t = setup();
    const id = await textFind(t);
    // The check waits for want of a network.
    t.replies.push(ok(MATCH), {
      ok: false,
      error: { kind: "stays-waiting", cause: "network", status: null },
    });
    await t.queue.trigger();
    await t.log.addPhoto(id, "file:///cache/a.jpg");
    await t.log.completeBatch(id);
    t.replies.push(ok(PORCINI));
    await t.queue.trigger();
    expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual([
      "analyse text",
      "picture Cantharellus cibarius",
      "check",
      "analyse photos",
    ]);
    expect(t.analyses[2]).toMatchObject({ imagesBase64: [PHOTO_B64], text: "A yellow funnel." });
    expect(await t.log.getStored(id)).toMatchObject({
      analysis: { answer: PORCINI },
      picture: null,
      selfCheck: null,
    });
  });

  it("does not run the skipped check after the photos' analysis failed: the find keeps its text answer and its waiting check", async () => {
    const t = setup();
    checkWaits(t, 1);
    await t.log.addPhoto(1, "file:///cache/a.jpg");
    await t.log.completeBatch(1);
    t.replies.push({
      ok: false,
      error: { kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" },
    });
    const picks = boundedPicks(t);
    await t.queue.trigger();
    await t.queue.trigger();
    expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual(["analyse photos"]);
    expect(await t.log.getStored(1)).toMatchObject({
      addedPhotos: "not-analysed",
      analysis: { answer: MATCH },
      selfCheck: { state: "waiting" },
    });
    expect(picks.mock.calls.length).toBeLessThan(6);
  });

  it("ends the run, and does not loop, when the store keeps giving a find whose check it would not store", async () => {
    const t = setup();
    checkWaits(t, 1);
    await photoFind(t);
    jest
      .spyOn(t.log, "setSelfCheck")
      .mockRejectedValue(new StoreError("wrong-state", "the check changed meanwhile"));
    const picks = boundedPicks(t);
    await t.queue.trigger();
    expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual(["check"]);
    expect(picks.mock.calls.length).toBeLessThan(5);
    // The next run tries it again, once.
    await t.queue.trigger();
    expect(t.events.filter((event) => event === "check")).toHaveLength(2);
  });

  it("goes on when the find was deleted while its check ran", async () => {
    const t = setup();
    checkWaits(t, 1);
    await photoFind(t);
    jest.spyOn(t.log, "setSelfCheck").mockImplementationOnce(async (id) => {
      await t.log.delete(id);
      throw new StoreError("not-found", `no find has the ID ${id}`);
    });
    await t.queue.trigger();
    expect(t.events.at(-1)).toBe("analyse photos");
    expect(t.queue.getState().stop).toBeNull();
  });

  it("rejects the run with a store error that is not a change gone stale", async () => {
    const t = setup();
    checkWaits(t, 1);
    jest
      .spyOn(t.log, "setSelfCheck")
      .mockRejectedValueOnce(new StoreError("corrupt", "the row is damaged"));
    await expect(t.queue.trigger()).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("a text find analysed from its screen (docs/SPEC.md 3.9)", () => {
  it("runs its check at once too, and a new answer brings a new picture and a new check", async () => {
    const t = setup();
    const id = await textFind(t);
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect((await t.log.getStored(id))?.selfCheck).toEqual({ state: "agreed" });
    const next = { ...PICTURE, uri: "file:///photos/picture-3.jpg" };
    t.pictures.push({ kind: "picture", picture: next });
    t.replies.push(ok(PORCINI), ok(MATCH));
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect(t.events.filter((event) => !event.startsWith("prepare"))).toEqual([
      "analyse text",
      "picture Cantharellus cibarius",
      "check",
      "analyse text",
      "picture Boletus edulis",
      "check",
    ]);
    expect(t.events).toContain(`prepare ${next.uri} ${MODEL}`);
    expect((await t.log.getStored(id))?.selfCheck).toEqual({
      state: "disagreed",
      names: MATCH.names,
    });
  });

  it("keeps its answer when the check waits, sets no pause, and leaves the check to the queue", async () => {
    const t = setup();
    const id = await textFind(t);
    t.replies.push(ok(MATCH), {
      ok: false,
      error: { kind: "stays-waiting", cause: "network", status: null },
    });
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect(t.queue.getState().pause).toBeNull();
    expect((await t.log.getStored(id))?.selfCheck).toEqual({ state: "waiting" });
    expect(await t.log.oldestWaiting()).toBe(id);
  });

  it("stops the queue when the check meets a class that stops it, keeping the answer", async () => {
    const t = setup();
    const id = await textFind(t);
    t.replies.push(ok(MATCH), { ok: false, error: { kind: "rate-limited", retryAt: null } });
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect(t.queue.getState().stop).toMatchObject({ reason: "rate-limited" });
    expect(await t.log.getStored(id)).toMatchObject({
      analysis: { answer: MATCH },
      selfCheck: { state: "waiting" },
    });
  });
});

describe("an unsaved lookup's check (docs/SPEC.md 3.9: run at once after its answer, not stored)", () => {
  it("sends the picture alone, for the model in use, also while the queue is stopped, and stores nothing", async () => {
    const t = setup();
    t.queue.stopForInternalError();
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: true,
      outcome: { state: "agreed" },
    });
    expect(t.events).toEqual([`prepare ${PICTURE.uri} ${MODEL}`, "check"]);
    expect(t.analyses[0]).not.toHaveProperty("text");
    expect(await t.log.list()).toEqual([]);
  });

  it("gives the other species, or that the check could not name one", async () => {
    const t = setup();
    t.replies.push(ok(PORCINI), ok({ result: "cannot_tell" }));
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: true,
      outcome: { state: "disagreed", names: PORCINI.names },
    });
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: true,
      outcome: { state: "no-species" },
    });
  });

  it("a class that leaves a find waiting: the check waits, with the pause, and no pause is set on the queue", async () => {
    const t = setup();
    t.replies.push({ ok: false, error: { kind: "stays-waiting", cause: "server", status: 500 } });
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: false,
      notice: { kind: "paused", cause: "server" },
    });
    expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
  });

  it("a class that stops the queue stops it, and the check waits with the stop; so does a missing key", async () => {
    const t = setup();
    t.replies.push({ ok: false, error: { kind: "key-refused", status: 403, cause: "refused" } });
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: false,
      notice: { kind: "stopped", stop: { reason: "key-refused" } },
    });
    expect(t.queue.getState().stop).toEqual({ reason: "key-refused" });

    const keyless = setup();
    keyless.setKey({ ok: true, key: null });
    await expect(keyless.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: false,
      notice: { kind: "stopped", stop: { reason: "no-key" } },
    });
    expect(keyless.events).toEqual([]);
  });

  it("any other class, or a picture that cannot be loaded, fails the check", async () => {
    const t = setup();
    t.replies.push({
      ok: false,
      error: { kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" },
    });
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: true,
      outcome: { state: "failed" },
    });
    t.prepared.set(PICTURE.uri, NOT_LOADED);
    await expect(t.queue.checkLookupPicture(PICTURE.uri, MATCH.names)).resolves.toEqual({
      ok: true,
      outcome: { state: "failed" },
    });
    expect(t.events.filter((event) => event === "check")).toHaveLength(1);
    expect(t.queue.getState().stop).toBeNull();
  });
});
