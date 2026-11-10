/**
 * The in-memory find log the screen tests use (`memoryFindLog.ts`) behaves as the real store does
 * (`src/store/findStore.ts`, on a real SQLite) for what PBI-2.5 uses: a photo lookup's open batch,
 * adding photos, completing a batch, the queue's pick, the photos added since an answer, removing
 * a photo, and an answer that covers a text find's photos. Each scenario runs on both, and what
 * each gives is compared, the photos by their batches, since the store names its own copies.
 */

import type { Match } from "../analysis/answer";
import type { AnalysedAnswer, NewFind, NewTextFind, StoredFind } from "../store/find";
import { StoreError } from "../store/find";
import { createFindStore, type FindLog } from "../store/findStore";
import { memoryFindLog } from "./memoryFindLog";
import { memoryPhotos, memorySqlite, sqliteDatabase } from "./sqliteDatabase";

const match: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};
const analysed: AnalysedAnswer = { answer: match, model: "claude-model-x", analysedAtMs: 5_000 };
const time = { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" } as const;
const photoFind: NewFind = { photoUri: "file:///cache/a.jpg", time, position: null };
const textFind: NewTextFind = { text: "A yellow funnel.", time, position: null };

type Log = FindLog;

async function realStore(): Promise<Log> {
  let count = 0;
  return createFindStore(sqliteDatabase(memorySqlite()), memoryPhotos(), {
    newPhotoName: () => {
      count += 1;
      return `p${count}`;
    },
  });
}

/** What a find holds, its photos by their batches: the store's copies have names of its own. */
function view(find: StoredFind | null): unknown {
  if (find === null) {
    return null;
  }
  const { photos, picture, ...rest } = find;
  return { ...rest, batches: photos.map((photo) => photo.batch), picture: picture !== null };
}

/**
 * What the list gives, each find's first photo as whether it has one: the store's copies have
 * names of its own.
 */
async function listView(log: Log): Promise<unknown[]> {
  return (await log.list()).map((entry) =>
    entry.readable ? { ...entry, photoUri: entry.photoUri !== null } : entry,
  );
}

/** The outcome of a change: "ok", or the store's error code. */
async function outcome(change: () => Promise<unknown>): Promise<string> {
  try {
    await change();
    return "ok";
  } catch (error) {
    return error instanceof StoreError ? error.code : String(error);
  }
}

/** What an analysis of all the find's photos sends. */
async function sentAll(log: Log, id: number) {
  const find = await log.getStored(id);
  return { photoUris: (find?.photos ?? []).map((photo) => photo.uri) };
}

const scenarios: [string, (log: Log) => Promise<unknown[]>][] = [
  [
    "a photo lookup's open batch: saved, added to, completed, and only then taken by the queue",
    async (log) => {
      const id = await log.addWithOpenBatch(photoFind);
      const seen: unknown[] = [await log.oldestWaiting(), view(await log.getStored(id))];
      seen.push(await outcome(() => log.addPhoto(id, "file:///cache/b.jpg")));
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      seen.push(await outcome(() => log.completeBatch(id)));
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      seen.push(await outcome(() => log.completeBatch(id)));
      return seen;
    },
  ],
  [
    "a new batch on an analysed find: its photos wait, are not yet analysed, wait again, and an answer covers them",
    async (log) => {
      const id = await log.add(photoFind);
      await log.setAnswer(id, analysed, await sentAll(log, id));
      const seen: unknown[] = [view(await log.getStored(id))];
      await log.addPhoto(id, "file:///cache/b.jpg");
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      await log.completeBatch(id);
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      seen.push(await outcome(() => log.setAddedPhotos(id, "not-analysed")));
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      seen.push(await outcome(() => log.setAddedPhotos(id, "not-analysed")));
      seen.push(await outcome(() => log.setAddedPhotos(id, "waiting")));
      await log.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, await sentAll(log, id));
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      seen.push(await outcome(() => log.setAddedPhotos(id, "waiting")));
      return seen;
    },
  ],
  [
    "a photo added while the find was analysed waits after the answer",
    async (log) => {
      const id = await log.add(photoFind);
      const sent = await sentAll(log, id);
      await log.addPhoto(id, "file:///cache/b.jpg");
      await log.completeBatch(id);
      await log.setAnswer(id, analysed, sent);
      return [view(await log.getStored(id)), await log.oldestWaiting()];
    },
  ],
  [
    "a text find that gets photos keeps its check until an answer from its photos ends it",
    async (log) => {
      const id = await log.addText(textFind);
      await log.setAnswer(id, analysed, { photoUris: [] });
      const seen: unknown[] = [view(await log.getStored(id))];
      await log.addPhoto(id, "file:///cache/a.jpg");
      await log.completeBatch(id);
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      await log.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, await sentAll(log, id));
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      return seen;
    },
  ],
  [
    "a failed find waits again when a batch completes",
    async (log) => {
      const id = await log.add(photoFind);
      await log.markFailed(id, { cause: "request", detail: "request-wrong (status 400)" });
      await log.addPhoto(id, "file:///cache/b.jpg");
      await log.completeBatch(id);
      return [view(await log.getStored(id)), await log.oldestWaiting()];
    },
  ],
  [
    "removing photos: the others keep their batches, the last of a find without text stays",
    async (log) => {
      const id = await log.add(photoFind);
      await log.setAnswer(id, analysed, await sentAll(log, id));
      await log.addPhoto(id, "file:///cache/b.jpg");
      await log.addPhoto(id, "file:///cache/c.jpg");
      await log.completeBatch(id);
      const seen: unknown[] = [await outcome(() => log.removePhoto(id, 1))];
      seen.push(view(await log.getStored(id)), await log.oldestWaiting());
      seen.push(await outcome(() => log.removePhoto(id, 3)));
      seen.push(await outcome(() => log.removePhoto(id, 0)));
      seen.push(await outcome(() => log.removePhoto(id, 1)));
      seen.push(await outcome(() => log.removePhoto(id, 1)));
      seen.push(view(await log.getStored(id)));
      const text = await log.addText(textFind);
      await log.addPhoto(text, "file:///cache/d.jpg");
      seen.push(await outcome(() => log.removePhoto(text, 1)), view(await log.getStored(text)));
      return seen;
    },
  ],
  [
    "the list gives each find's species by its current answer, the text answer's too, and none without an answer naming one (PBI-2.7)",
    async (log) => {
      const porcini: Match = {
        ...match,
        names: { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" },
      };
      const waiting = await log.add({ ...photoFind, time: { ...time, takenAtMs: 1_000 } });
      const named = await log.add({ ...photoFind, time: { ...time, takenAtMs: 2_000 } });
      await log.setAnswer(named, analysed, await sentAll(log, named));
      const failed = await log.add({ ...photoFind, time: { ...time, takenAtMs: 3_000 } });
      await log.markFailed(failed, { cause: "request", detail: "request-wrong (status 400)" });
      const none = await log.add({ ...photoFind, time: { ...time, takenAtMs: 4_000 } });
      await log.setAnswer(
        none,
        { ...analysed, answer: { result: "no_mushroom" } },
        await sentAll(log, none),
      );
      const text = await log.addText({ ...textFind, time: { ...time, takenAtMs: 5_000 } });
      await log.setAnswer(text, { ...analysed, answer: porcini }, { photoUris: [] });
      const seen: unknown[] = [waiting, await listView(log)];
      // A new answer replaces the species; a photo added keeps the text answer's.
      await log.replaceAnswer(named, { ...analysed, answer: porcini }, await sentAll(log, named));
      await log.addPhoto(text, "file:///cache/b.jpg");
      await log.completeBatch(text);
      seen.push(await listView(log));
      return seen;
    },
  ],
  [
    "the list gives each find's position, a photo find's and a text find's, or null (PBI-2.8)",
    async (log) => {
      const at = { latitude: 59.64, longitude: 17.08, accuracyM: 12, source: "fix" as const };
      await log.add({ ...photoFind, position: at, time: { ...time, takenAtMs: 1_000 } });
      await log.add({ ...photoFind, time: { ...time, takenAtMs: 2_000 } });
      await log.addText({
        ...textFind,
        position: { ...at, accuracyM: null, source: "last-known" },
        time: { ...time, takenAtMs: 3_000 },
      });
      return [await listView(log)];
    },
  ],
  [
    "the most photos a find holds, and the refusals",
    async (log) => {
      const id = await log.addWithOpenBatch(photoFind);
      const seen: unknown[] = [];
      for (const name of ["b", "c", "d", "e", "f"]) {
        seen.push(await outcome(() => log.addPhoto(id, `file:///cache/${name}.jpg`)));
      }
      seen.push(view(await log.getStored(id)));
      seen.push(await outcome(() => log.addPhoto(99, "file:///cache/x.jpg")));
      seen.push(await outcome(() => log.completeBatch(99)));
      seen.push(await outcome(() => log.removePhoto(99, 1)));
      seen.push(await outcome(() => log.setAddedPhotos(99, "waiting")));
      seen.push(await outcome(() => log.setAddedPhotos(id, "waiting")));
      return seen;
    },
  ],
];

describe("the in-memory find log against the real store (PBI-2.5)", () => {
  it.each(scenarios)("%s", async (_name, scenario) => {
    const real = await scenario(await realStore());
    const memory = await scenario(memoryFindLog());
    expect(memory).toEqual(real);
  });

  it("the scenarios see what the store does, not nothing", async () => {
    const [, first] = scenarios[0] ?? ["", async () => []];
    const seen = await first(await realStore());
    expect(seen).toEqual([
      null,
      expect.objectContaining({ batchOpen: true, batches: [1] }),
      "ok",
      expect.objectContaining({ batchOpen: true, batches: [1, 1] }),
      null,
      "ok",
      expect.objectContaining({ batchOpen: false, batches: [1, 1] }),
      1,
      "wrong-state",
    ]);
  });

  it("the position scenario sees the positions the store gives, not nothing (PBI-2.8)", async () => {
    const scenario = scenarios.find(([name]) => name.startsWith("the list gives each find's position"));
    if (scenario === undefined) {
      throw new Error("no position scenario");
    }
    const [seen] = await scenario[1](await realStore());
    expect((seen as { position: unknown }[]).map((entry) => entry.position)).toEqual([
      { latitude: 59.64, longitude: 17.08, accuracyM: null, source: "last-known" },
      null,
      { latitude: 59.64, longitude: 17.08, accuracyM: 12, source: "fix" },
    ]);
  });

  it("the list scenario sees the species the store gives, not nothing (PBI-2.7)", async () => {
    const scenario = scenarios.find(([name]) => name.startsWith("the list gives"));
    if (scenario === undefined) {
      throw new Error("no list scenario");
    }
    const [, before, after] = await scenario[1](await realStore());
    const species = (seen: unknown) =>
      (seen as { id: number; species: { la: string } | null }[]).map((entry) => [
        entry.id,
        entry.species?.la ?? null,
      ]);
    expect(species(before)).toEqual([
      [5, "Boletus edulis"],
      [4, null],
      [3, null],
      [2, "Cantharellus cibarius"],
      [1, null],
    ]);
    expect(species(after)).toEqual([
      [5, "Boletus edulis"],
      [4, null],
      [3, null],
      [2, "Boletus edulis"],
      [1, null],
    ]);
  });
});
