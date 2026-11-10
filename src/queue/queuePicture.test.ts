/**
 * The queue and a text answer's representative picture (docs/SPEC.md 3.9; PBI-2.9): the run that
 * brings the answer fetches it at once, before the next find; a picture that waits waits for the
 * next run, and not before Wikimedia's Retry-After; a find analysed from its screen gets its
 * picture too; an unsaved lookup's is fetched and given back, never stored. The self-check itself
 * is PBI-2.10's: here it stays waiting, or becomes "no picture". The find log is the in-memory
 * one, which `memoryFindLog.test.ts` holds to the real store.
 */

import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import type { Answer, Match } from "../analysis/answer";
import type { PictureFetch } from "../picture/fetchPicture";
import { StoreError } from "../store/find";
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
};
const time = { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" } as const;

const PICTURE = {
  uri: "file:///cache/picture-2.jpg",
  author: "Example Photographer",
  licence: "cc-by-sa-3.0",
  page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
};
const FOUND: PictureFetch = { kind: "picture", picture: PICTURE };

type PictureReply = PictureFetch | Error | (() => Promise<PictureFetch>);

function setup() {
  const log = memoryFindLog();
  const events: string[] = [];
  const analyses: AnalysisInput[] = [];
  const answers: Answer[] = [];
  const pictures: PictureReply[] = [];
  const removed: string[] = [];
  let now = NOW;

  const deps: QueueDeps = {
    findLog: async () => log,
    readKey: async () => ({ ok: true, key: "sk-ant-test" }),
    readModelId: async () => MODEL,
    preparePhoto: async () => ({ ok: true, imageBase64: "AAAA", width: 1, height: 1 }),
    analyse: async (input): Promise<AnalysisCallResult> => {
      analyses.push(input);
      events.push(`analyse ${"imagesBase64" in input ? "photos" : "text"}`);
      return { ok: true, answer: answers.shift() ?? MATCH };
    },
    now: () => now,
    schedule: () => () => undefined,
    fetchPicture: async (latinName, modelId) => {
      events.push(`picture ${latinName} ${modelId}`);
      const reply = pictures.shift() ?? FOUND;
      if (reply instanceof Error) {
        throw reply;
      }
      return typeof reply === "function" ? reply() : reply;
    },
    removePictureCopy: (uri) => {
      removed.push(uri);
    },
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
    answers,
    pictures,
    removed,
    setNow: (value: number) => {
      now = value;
    },
  };
}

async function textFind(log: ReturnType<typeof memoryFindLog>, takenAtMs = 1_000): Promise<number> {
  return log.addText({ text: "A yellow funnel.", time: { ...time, takenAtMs }, position: null });
}

async function photoFind(log: ReturnType<typeof memoryFindLog>): Promise<number> {
  return log.add({ photoUri: "file:///cache/a.jpg", time, position: null });
}

describe("a run that brings a text answer (docs/SPEC.md 3.9)", () => {
  it("fetches the picture at once, by the Latin name, for the model in use, before it takes the next find; stores it apart from the photos and removes the copy", async () => {
    const t = setup();
    const text = await textFind(t.log);
    const photo = await photoFind(t.log);
    await t.queue.trigger();
    expect(t.events).toEqual([
      "analyse text",
      `picture Cantharellus cibarius ${MODEL}`,
      "analyse photos",
    ]);
    const stored = await t.log.getStored(text);
    expect(stored?.picture).toEqual({
      uri: PICTURE.uri,
      author: PICTURE.author,
      licence: PICTURE.licence,
      page: PICTURE.page,
    });
    expect(stored?.photos).toEqual([]);
    // The check on the picture is PBI-2.10's: it waits.
    expect(stored?.selfCheck).toEqual({ state: "waiting" });
    expect(t.removed).toEqual([PICTURE.uri]);
    // An answer from a photo has no check, so no picture is fetched for it.
    expect((await t.log.getStored(photo))?.picture).toBeNull();
    expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: null });
  });

  it("with no picture for the answer, says the check has none, and goes on with the next find", async () => {
    const t = setup();
    const text = await textFind(t.log);
    await photoFind(t.log);
    t.pictures.push({ kind: "none", reason: "licence" });
    await t.queue.trigger();
    expect(t.events).toEqual([
      "analyse text",
      `picture Cantharellus cibarius ${MODEL}`,
      "analyse photos",
    ]);
    expect(await t.log.getStored(text)).toMatchObject({
      picture: null,
      selfCheck: { state: "no-picture" },
    });
    expect(t.removed).toEqual([]);
  });

  it("with no network, the picture waits and the run ends, as a waiting find's does; the next run fetches it first, without analysing the find again", async () => {
    const t = setup();
    const text = await textFind(t.log);
    await photoFind(t.log);
    t.pictures.push({ kind: "waits", cause: "network", retryAtMs: null });
    await t.queue.trigger();
    expect(t.events).toEqual(["analyse text", `picture Cantharellus cibarius ${MODEL}`]);
    expect(t.queue.getState()).toEqual({ running: false, stop: null, pause: "network" });
    expect(await t.log.getStored(text)).toMatchObject({
      analysis: { state: "done" },
      picture: null,
      selfCheck: { state: "waiting" },
    });
    await t.queue.trigger();
    expect(t.events.slice(2)).toEqual([`picture Cantharellus cibarius ${MODEL}`, "analyse photos"]);
    expect((await t.log.getStored(text))?.picture).not.toBeNull();
    expect(t.queue.getState().pause).toBeNull();
  });

  it("a fault on Wikimedia's side pauses the run with its own cause, and the picture is not asked for again before Retry-After (Clead's decision 5)", async () => {
    const t = setup();
    await textFind(t.log);
    await photoFind(t.log);
    t.pictures.push({ kind: "waits", cause: "picture-source", retryAtMs: NOW + 30_000 });
    await t.queue.trigger();
    expect(t.queue.getState().pause).toBe("picture-source");
    t.setNow(NOW + 29_999);
    await t.queue.trigger();
    expect(t.events).toEqual(["analyse text", `picture Cantharellus cibarius ${MODEL}`]);
    expect(t.queue.getState().pause).toBe("picture-source");
    t.setNow(NOW + 30_000);
    await t.queue.trigger();
    expect(t.events.slice(2)).toEqual([`picture Cantharellus cibarius ${MODEL}`, "analyse photos"]);
  });

  it("a fault without Retry-After lets the next run ask at once", async () => {
    const t = setup();
    await textFind(t.log);
    t.pictures.push({ kind: "waits", cause: "picture-source", retryAtMs: null });
    await t.queue.trigger();
    await t.queue.trigger();
    expect(t.events).toEqual([
      "analyse text",
      `picture Cantharellus cibarius ${MODEL}`,
      `picture Cantharellus cibarius ${MODEL}`,
    ]);
  });

  it("does not fetch a picture for a text find whose answer came from its photos and text", async () => {
    const t = setup();
    const id = await textFind(t.log);
    await t.log.addPhoto(id, "file:///cache/a.jpg");
    await t.log.completeBatch(id);
    await t.queue.trigger();
    expect(t.events).toEqual(["analyse photos"]);
    expect((await t.log.getStored(id))?.selfCheck).toBeNull();
  });

  it("analyses a text find's new photos before fetching the picture of its text answer, which their answer then replaces", async () => {
    const t = setup();
    const id = await textFind(t.log);
    t.pictures.push({ kind: "waits", cause: "network", retryAtMs: null });
    await t.queue.trigger();
    await t.log.addPhoto(id, "file:///cache/a.jpg");
    await t.log.completeBatch(id);
    t.answers.push(PORCINI);
    await t.queue.trigger();
    expect(t.events).toEqual([
      "analyse text",
      `picture Cantharellus cibarius ${MODEL}`,
      "analyse photos",
    ]);
    expect(await t.log.getStored(id)).toMatchObject({ picture: null, selfCheck: null });
  });

  it("removes the copy and goes on when the find was deleted while its picture was fetched", async () => {
    const t = setup();
    const text = await textFind(t.log);
    await photoFind(t.log);
    t.pictures.push(async () => {
      await t.log.delete(text);
      return FOUND;
    });
    await t.queue.trigger();
    expect(t.removed).toEqual([PICTURE.uri]);
    expect(t.events.at(-1)).toBe("analyse photos");
    expect(t.queue.getState().stop).toBeNull();
  });

  it("rejects the run with a store error that is not a change gone stale, still removing the copy", async () => {
    const t = setup();
    await textFind(t.log);
    jest
      .spyOn(t.log, "setPicture")
      .mockRejectedValueOnce(new StoreError("corrupt", "the picture's row is damaged"));
    await expect(t.queue.trigger()).rejects.toMatchObject({ code: "corrupt" });
    expect(t.removed).toEqual([PICTURE.uri]);
  });

  it("goes on when the check's 'no picture' finds the find changed meanwhile, and rejects on any other store error", async () => {
    const stale = setup();
    await textFind(stale.log);
    await photoFind(stale.log);
    stale.pictures.push({ kind: "none", reason: "no-item" });
    jest
      .spyOn(stale.log, "setSelfCheck")
      .mockRejectedValueOnce(new StoreError("wrong-state", "analysed again since"));
    await stale.queue.trigger();
    expect(stale.events.at(-1)).toBe("analyse photos");

    const damaged = setup();
    await textFind(damaged.log);
    damaged.pictures.push({ kind: "none", reason: "no-item" });
    jest
      .spyOn(damaged.log, "setSelfCheck")
      .mockRejectedValueOnce(new StoreError("corrupt", "damaged"));
    await expect(damaged.queue.trigger()).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects the run with an error of the fetch that is not Wikimedia's, leaving the check waiting", async () => {
    const t = setup();
    const text = await textFind(t.log);
    t.pictures.push(new Error("No space left on device"));
    await expect(t.queue.trigger()).rejects.toThrow("No space left");
    expect(await t.log.getStored(text)).toMatchObject({
      analysis: { state: "done" },
      selfCheck: { state: "waiting" },
      picture: null,
    });
  });
});

describe("a text find analysed from its screen (docs/SPEC.md 3.9)", () => {
  it("gets its picture at once too, and a new answer brings a new picture", async () => {
    const t = setup();
    const id = await textFind(t.log);
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect((await t.log.getStored(id))?.picture?.author).toBe(PICTURE.author);
    t.answers.push(PORCINI);
    t.pictures.push({
      kind: "picture",
      picture: { ...PICTURE, uri: "file:///cache/picture-3.jpg", author: "Another" },
    });
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect(t.events).toEqual([
      "analyse text",
      `picture Cantharellus cibarius ${MODEL}`,
      "analyse text",
      `picture Boletus edulis ${MODEL}`,
    ]);
    expect((await t.log.getStored(id))?.picture?.author).toBe("Another");
    expect(t.removed).toEqual([PICTURE.uri, "file:///cache/picture-3.jpg"]);
  });

  it("keeps its answer when the picture waits, sets no pause, and leaves the picture to the queue", async () => {
    const t = setup();
    const id = await textFind(t.log);
    t.pictures.push({ kind: "waits", cause: "network", retryAtMs: null });
    await expect(t.queue.analyseFind(id)).resolves.toEqual({ ok: true });
    expect(t.queue.getState().pause).toBeNull();
    expect(await t.log.oldestWaiting()).toBe(id);
  });
});

describe("an unsaved lookup's picture (docs/SPEC.md 3.9: shown, not stored)", () => {
  it("is fetched and given back, also while the queue is stopped, and nothing is stored or removed", async () => {
    const t = setup();
    t.queue.stopForInternalError();
    await expect(t.queue.fetchLookupPicture("Cantharellus cibarius")).resolves.toEqual(FOUND);
    expect(t.events).toEqual([`picture Cantharellus cibarius ${MODEL}`]);
    expect(t.removed).toEqual([]);
    expect(await t.log.list()).toEqual([]);
  });

  it("waits, without a request, until Wikimedia's Retry-After has passed", async () => {
    const t = setup();
    t.pictures.push({ kind: "waits", cause: "picture-source", retryAtMs: NOW + 5_000 });
    await t.queue.fetchLookupPicture("Cantharellus cibarius");
    await expect(t.queue.fetchLookupPicture("Cantharellus cibarius")).resolves.toEqual({
      kind: "waits",
      cause: "picture-source",
      retryAtMs: NOW + 5_000,
    });
    expect(t.events).toHaveLength(1);
    t.setNow(NOW + 5_000);
    await expect(t.queue.fetchLookupPicture("Cantharellus cibarius")).resolves.toEqual(FOUND);
  });

  it("removes a copy for the screen through the queue's own removal", () => {
    const t = setup();
    t.queue.removePictureCopy("file:///cache/picture-9.jpg");
    expect(t.removed).toEqual(["file:///cache/picture-9.jpg"]);
  });
});
