/**
 * The store's Phase 2 fields (PBI-2.2, docs/SPEC.md 3.9 "The store") against a real SQLite
 * (`src/testing/sqliteDatabase.ts`): a find's text, its photos in batches, the open batch, the
 * state of the photos added since its answer, its representative picture and its self-check, and
 * the constraints of schema version 2 that keep them.
 */

import type { ApiMatch } from "../analysis/answer";
import { config } from "../config/config";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import type { NewAnalysedAnswer, NewFind, NewPicture, NewTextFind } from "./find";
import { createFindStore, type FindStore, type LookupStore } from "./findStore";

const match: ApiMatch = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};
const analysed: NewAnalysedAnswer = {
  answer: match,
  model: "claude-model-x",
  analysedAtMs: 5_000,
};

const time = { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" } as const;
const position = { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" } as const;

const photoFind = (photoUri = "file:///cache/camera.jpg"): NewFind => ({
  photoUri,
  time,
  position: null,
});
const textFind: NewTextFind = { text: "A yellow funnel with false gills.", time, position };
const newPicture: NewPicture = {
  sourceUri: "file:///cache/commons-thumb.png",
  author: "A. Photographer",
  licence: "CC BY-SA 4.0",
  page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
};
const falseChanterelle = {
  sv: "Narrkantarell",
  en: "False chanterelle",
  la: "Hygrophoropsis aurantiaca",
  it: "Falso gallinaccio",
};

let sqlite: DatabaseSync;
let photos: ReturnType<typeof memoryPhotos>;
let store: FindStore & LookupStore;
let photoCount: number;

function open(): Promise<FindStore & LookupStore> {
  return createFindStore(sqliteDatabase(sqlite), photos, {
    newPhotoName: () => {
      photoCount += 1;
      return `p${photoCount}`;
    },
  });
}

beforeEach(async () => {
  sqlite = memorySqlite();
  photos = memoryPhotos();
  photoCount = 0;
  store = await open();
});

afterEach(() => {
  sqlite.close();
});

/** The photos of a find as `getStored` gives them: each photo's file name and batch. */
async function photosOf(id: number): Promise<[string, number][]> {
  const stored = await store.getStored(id);
  return (stored?.photos ?? []).map((photo) => [
    photo.uri.replace("file:///photos/", ""),
    photo.batch,
  ]);
}

/** What an analysis sends of a find's photos: here all it holds now, in order (PBI-2.2). */
async function sentAll(id: number): Promise<{ photoUris: string[] }> {
  const stored = await store.getStored(id);
  return { photoUris: (stored?.photos ?? []).map((photo) => photo.uri) };
}

/** What an analysis of the text alone sends: no photo. */
const TEXT_ONLY = { photoUris: [] };

/** A text find whose answer from its text alone names a species: its self-check waits. */
async function answeredTextFind(): Promise<number> {
  const id = await store.addText(textFind);
  await store.setAnswer(id, analysed, await sentAll(id));
  return id;
}

describe("an answer stored after the find changed while it was analysed (PBI-2.2, review of #49)", () => {
  it("(A) keeps a text-only answer's self-check, and the photo added while it was analysed waits, its batch still open", async () => {
    const id = await store.addText(textFind);
    const sent = await sentAll(id);
    expect(sent).toEqual(TEXT_ONLY);
    // In flight: the user adds a photo from the find's screen.
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.setAnswer(id, analysed, sent);
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match },
      batchOpen: true,
      selfCheck: { state: "waiting" },
      addedPhotos: "waiting",
    });
  });

  it("(B) as (A) with the batch complete before the answer: the self-check waits, and so does the photo, for the queue", async () => {
    const id = await store.addText(textFind);
    const sent = await sentAll(id);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await store.setAnswer(id, analysed, sent);
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match },
      batchOpen: false,
      selfCheck: { state: "waiting" },
      addedPhotos: "waiting",
    });
  });

  it("(C) keeps a batch added to a photo find during a re-analysis waiting for the queue", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    const sent = await sentAll(id);
    // In flight: "analyse again" with photo 1; meanwhile a batch is added and completed.
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, sent);
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "done", analysedAtMs: 6_000 },
      addedPhotos: "waiting",
      selfCheck: null,
    });
  });

  it("marks the photos analysed when the answer covered every photo the find holds", async () => {
    const id = await store.add(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "analysed" });
  });

  it("marks the photos analysed when a photo the answer covered was removed meanwhile", async () => {
    const id = await store.add(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    const sent = await sentAll(id);
    await store.removePhoto(id, 2);
    await store.setAnswer(id, analysed, sent);
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "analysed" });
  });

  it("gives an answer from photos and text no self-check, though the find has text", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    const sent = await sentAll(id);
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.setAnswer(id, analysed, sent);
    await expect(store.getStored(id)).resolves.toMatchObject({
      selfCheck: null,
      addedPhotos: "waiting",
    });
  });

  it("starts a new check for a new text-only answer while a photo is added, and ends the check with an answer from the photos", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, { state: "agreed" });
    // A re-analysis of the text alone, while a photo is added: it starts a new check.
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, TEXT_ONLY);
    await expect(store.getStored(id)).resolves.toMatchObject({
      picture: null,
      selfCheck: { state: "waiting" },
      addedPhotos: "waiting",
    });
    await store.completeBatch(id);
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 7_000 }, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({
      selfCheck: null,
      addedPhotos: "analysed",
    });
  });
});

describe("a text find (PBI-2.2)", () => {
  it("is saved waiting, with its text, its time and position, no photo and no open batch", async () => {
    const id = await store.addText(textFind);
    await expect(store.getStored(id)).resolves.toEqual({
      id,
      text: "A yellow funnel with false gills.",
      photos: [],
      batchOpen: false,
      time,
      position,
      analysis: { state: "waiting" },
      answerBasis: null,
      addedPhotos: null,
      picture: null,
      selfCheck: null,
    });
    expect(photos.files.size).toBe(0);
  });

  it("is listed without a photo and taken by the queue's pick, though get, Phase 1's view by a photo, refuses it (PBI-2.4)", async () => {
    const id = await store.addText(textFind);
    await expect(store.get(id)).rejects.toMatchObject({ code: "corrupt" });
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id,
        photoUri: null,
        time,
        position,
        analysis: { state: "waiting" },
        answerBasis: null,
        selfCheck: null,
        species: null,
        picture: null,
      },
    ]);
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("is listed with its answer once analysed from its text, its self-check waiting, and taken by the queue's pick for its picture (PBI-2.4, PBI-2.9)", async () => {
    const id = await answeredTextFind();
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id,
        photoUri: null,
        time,
        position,
        analysis: {
          state: "done",
          result: "match",
          names: { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" },
          edibility: "edible",
          confidence: 90,
        },
        answerBasis: "text",
        selfCheck: { state: "waiting" },
        // The text answer's species, for the Library's filters while the check waits (PBI-2.7).
        species: match.names,
        picture: null,
      },
    ]);
    // Its picture waits for the queue (docs/SPEC.md 3.9, Fetching it; PBI-2.9).
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("is shown by Phase 1's views once it has a photo", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await expect(store.get(id)).resolves.toMatchObject({ id, photoUri: "file:///photos/p1.jpg" });
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("is deleted, with nothing to remove", async () => {
    const id = await store.addText(textFind);
    await expect(store.delete(id)).resolves.toEqual({ photoRemoved: true });
    await expect(store.getStored(id)).resolves.toBeNull();
  });
});

describe("a find's photos and batches (PBI-2.2)", () => {
  it("saves a photo lookup's find with its first photo in batch 1, the batch open, which the queue does not take", async () => {
    const id = await store.addWithOpenBatch(photoFind());
    await expect(store.getStored(id)).resolves.toMatchObject({
      photos: [{ uri: "file:///photos/p1.jpg", batch: 1 }],
      batchOpen: true,
      analysis: { state: "waiting" },
    });
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("adds each photo of an open batch to that batch, in the order added", async () => {
    const id = await store.addWithOpenBatch(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.addPhoto(id, "file:///cache/c.jpg");
    await expect(photosOf(id)).resolves.toEqual([
      ["p1.jpg", 1],
      ["p2.jpg", 1],
      ["p3.jpg", 1],
    ]);
  });

  it("lets the queue take the find once its batch is complete", async () => {
    const id = await store.addWithOpenBatch(photoFind());
    await store.completeBatch(id);
    await expect(store.getStored(id)).resolves.toMatchObject({ batchOpen: false });
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("opens a new batch, numbered one past the last, for a photo added once the batch is complete", async () => {
    const id = await store.add(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await expect(store.getStored(id)).resolves.toMatchObject({ batchOpen: true });
    await store.addPhoto(id, "file:///cache/c.jpg");
    await store.completeBatch(id);
    await store.addPhoto(id, "file:///cache/d.jpg");
    await expect(photosOf(id)).resolves.toEqual([
      ["p1.jpg", 1],
      ["p2.jpg", 2],
      ["p3.jpg", 2],
      ["p4.jpg", 3],
    ]);
  });

  it("gives a text find's first photo batch 1", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await expect(photosOf(id)).resolves.toEqual([["p1.jpg", 1]]);
  });

  it("keeps the batch's number when the only photo of the open batch was removed and another is added", async () => {
    const id = await store.add(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.removePhoto(id, 2);
    await store.addPhoto(id, "file:///cache/c.jpg");
    await expect(photosOf(id)).resolves.toEqual([
      ["p1.jpg", 1],
      ["p3.jpg", 2],
    ]);
  });

  it("holds up to 5 photos, and refuses a sixth as wrong-state, removing its copy and changing nothing", async () => {
    const id = await store.addWithOpenBatch(photoFind());
    for (const name of ["b", "c", "d", "e"]) {
      await store.addPhoto(id, `file:///cache/${name}.jpg`);
    }
    const before = await store.getStored(id);
    await expect(store.addPhoto(id, "file:///cache/f.jpg")).rejects.toMatchObject({
      code: "wrong-state",
    });
    await expect(store.getStored(id)).resolves.toEqual(before);
    expect(photos.files.has("p6.jpg")).toBe(false);
    expect(photos.files.size).toBe(5);
  });

  it("says no find has the ID when a photo is added to none, and removes its copy", async () => {
    await expect(store.addPhoto(99, "file:///cache/a.jpg")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(photos.files.size).toBe(0);
  });

  it("keeps a find's time and position when photos are added", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await expect(store.getStored(id)).resolves.toMatchObject({ time, position });
  });

  it("refuses to complete a batch on a find with none open, as wrong-state", async () => {
    const id = await store.add(photoFind());
    await expect(store.completeBatch(id)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("says no find has the ID when a batch of none is completed", async () => {
    await expect(store.completeBatch(99)).rejects.toMatchObject({ code: "not-found" });
  });

  it("completes every open batch when the store opens, as the app starts", async () => {
    const open1 = await store.addWithOpenBatch(photoFind());
    const open2 = await store.addWithOpenBatch(photoFind("file:///cache/b.jpg"));
    store = await open();
    await expect(store.getStored(open1)).resolves.toMatchObject({ batchOpen: false });
    await expect(store.getStored(open2)).resolves.toMatchObject({ batchOpen: false });
    await expect(store.oldestWaiting()).resolves.toBe(open1);
  });
});

describe("completing a batch on a find in each analysis state (PBI-2.2)", () => {
  it("leaves a waiting find waiting", async () => {
    const id = await store.add(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "waiting" },
      addedPhotos: null,
    });
  });

  it("puts a failed find back to waiting, without why it failed", async () => {
    const id = await store.add(photoFind());
    await store.markFailed(id, { cause: "photo", detail: "gone" });
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    await expect(store.getStored(id)).resolves.toMatchObject({ analysis: { state: "waiting" } });
    expect(
      sqlite.prepare("SELECT failure_cause, failure_detail FROM finds WHERE id = ?").get(id),
    ).toEqual({ failure_cause: null, failure_detail: null });
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("keeps a done find's answer, and its new photos wait", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await store.addPhoto(id, "file:///cache/b.jpg");
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "analysed" });
    await store.completeBatch(id);
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match },
      addedPhotos: "waiting",
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id, analysis: expect.objectContaining({ result: "match" }) }),
    ]);
  });
});

describe("the state of the photos added since the answer (PBI-2.2)", () => {
  async function doneWithWaitingPhotos(): Promise<number> {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    return id;
  }

  it("is none on a find without an answer, and analysed once an answer is stored", async () => {
    const id = await store.add(photoFind());
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: null });
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "analysed" });
  });

  it("goes from waiting to not yet analysed after a failure, and back to waiting when the user asks", async () => {
    const id = await doneWithWaitingPhotos();
    await store.setAddedPhotos(id, "not-analysed");
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match },
      addedPhotos: "not-analysed",
    });
    await store.setAddedPhotos(id, "waiting");
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "waiting" });
  });

  it("is analysed again once a new answer replaces the earlier one", async () => {
    const id = await doneWithWaitingPhotos();
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "analysed" });
  });

  it("refuses a change from analysed, as wrong-state", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.setAddedPhotos(id, "not-analysed")).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("refuses a change on a find without an answer, as wrong-state", async () => {
    const id = await store.add(photoFind());
    await expect(store.setAddedPhotos(id, "waiting")).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("refuses a change to the state it is in, as wrong-state", async () => {
    const id = await doneWithWaitingPhotos();
    await expect(store.setAddedPhotos(id, "waiting")).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("says no find has the ID", async () => {
    await expect(store.setAddedPhotos(99, "waiting")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("the queue's pick of an analysed find with new photos (SPEC 3.9, Batches; PBI-2.5)", () => {
  async function analysed1(): Promise<number> {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    return id;
  }

  it("takes an analysed find whose added photos wait, only once their batch is complete", async () => {
    const id = await analysed1();
    await expect(store.oldestWaiting()).resolves.toBeNull();
    await store.addPhoto(id, "file:///cache/b.jpg");
    await expect(store.oldestWaiting()).resolves.toBeNull();
    await store.completeBatch(id);
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("does not take it once its added photos are not yet analysed after a failure, and takes it again when they wait", async () => {
    const id = await analysed1();
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    await store.setAddedPhotos(id, "not-analysed");
    await expect(store.oldestWaiting()).resolves.toBeNull();
    await store.setAddedPhotos(id, "waiting");
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("does not take it once an answer covers its photos", async () => {
    const id = await analysed1();
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, await sentAll(id));
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("passes over one whose confidence column differs from its answer's, as a find it cannot read, and lists it so (PBI-2.12)", async () => {
    const damaged = await analysed1();
    const next = await analysed1();
    for (const id of [damaged, next]) {
      await store.addPhoto(id, "file:///cache/b.jpg");
      await store.completeBatch(id);
    }
    sqlite.prepare("UPDATE finds SET confidence_score = 85 WHERE id = ?").run(damaged);
    await expect(store.oldestWaiting()).resolves.toBe(next);
    await expect(store.getStored(damaged)).rejects.toMatchObject({ code: "corrupt" });
    await expect(store.list()).resolves.toEqual(
      expect.arrayContaining([{ readable: false, id: damaged }]),
    );
  });

  it("takes the finds oldest first by ID, waiting ones and analysed ones with new photos alike", async () => {
    const first = await analysed1();
    const second = await store.add(photoFind());
    await store.addPhoto(first, "file:///cache/b.jpg");
    await store.completeBatch(first);
    await expect(store.oldestWaiting()).resolves.toBe(first);
    await store.replaceAnswer(first, analysed, await sentAll(first));
    await expect(store.oldestWaiting()).resolves.toBe(second);
  });
});

describe("the queue's pick of a text answer whose picture or check waits (docs/SPEC.md 3.9; PBI-2.9, PBI-2.10)", () => {
  it("takes it until its check has an outcome, or has no picture", async () => {
    const pictured = await answeredTextFind();
    const without = await answeredTextFind();
    await expect(store.oldestWaiting()).resolves.toBe(pictured);
    await store.setPicture(pictured, newPicture);
    // Its check waits on the picture: still taken (PBI-2.10).
    await expect(store.oldestWaiting()).resolves.toBe(pictured);
    await store.setSelfCheck(pictured, { state: "agreed" });
    await expect(store.oldestWaiting()).resolves.toBe(without);
    await store.setSelfCheck(without, { state: "no-picture" });
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it.each([
    ["disagreed", { state: "disagreed", names: falseChanterelle }],
    ["could not name a species", { state: "no-species" }],
    ["failed", { state: "failed" }],
  ] as const)("does not take it once its check %s", async (_name, outcome) => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, outcome);
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("does not take a waiting check on a find that got photos since its answer, also once their analysis failed: that check is skipped (PBI-2.10)", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    // Taken for its photos.
    await expect(store.oldestWaiting()).resolves.toBe(id);
    await store.setAddedPhotos(id, "not-analysed");
    await expect(store.oldestWaiting()).resolves.toBeNull();
    await expect(store.getStored(id)).resolves.toMatchObject({
      selfCheck: { state: "waiting" },
      addedPhotos: "not-analysed",
    });
  });

  it("takes the finds oldest first by ID, waiting ones and those whose picture waits alike", async () => {
    const waiting = await store.add(photoFind());
    const text = await answeredTextFind();
    await expect(store.oldestWaiting()).resolves.toBe(waiting);
    await store.setAnswer(waiting, analysed, await sentAll(waiting));
    await expect(store.oldestWaiting()).resolves.toBe(text);
  });

  it("does not take it while a batch of photos is open on it, and takes it for its photos once complete", async () => {
    const id = await answeredTextFind();
    await store.addPhoto(id, "file:///cache/a.jpg");
    await expect(store.oldestWaiting()).resolves.toBeNull();
    await store.completeBatch(id);
    await expect(store.oldestWaiting()).resolves.toBe(id);
    await expect(store.getStored(id)).resolves.toMatchObject({
      addedPhotos: "waiting",
      selfCheck: { state: "waiting" },
      picture: null,
    });
  });

  it("does not take a text answer whose check agreed, nor one from photos, nor a photo find's", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, { state: "agreed" });
    const photo = await store.add(photoFind());
    await store.setAnswer(photo, analysed, await sentAll(photo));
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });
});

describe("the list's picture of a text find (docs/SPEC.md 3.9, The Library; PBI-2.9)", () => {
  it("gives the picture, with its credit, in place of a photo, also once the find has photos", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    const picture = {
      // The test's photo directory names every copy `.jpg` (`memoryPhotos`).
      uri: "file:///photos/p1.jpg",
      author: newPicture.author,
      licence: newPicture.licence,
      page: newPicture.page,
    };
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id, photoUri: null, picture }),
    ]);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id, photoUri: "file:///photos/p2.jpg", picture }),
    ]);
  });

  it("gives none once an answer from the find's photos replaces its text answer", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await store.replaceAnswer(id, analysed, await sentAll(id));
    await expect(store.list()).resolves.toEqual([expect.objectContaining({ id, picture: null })]);
  });
});

describe("removing a photo (PBI-2.2)", () => {
  it("removes the photo with the number given and its file, keeping the others in order with their batches", async () => {
    const id = await store.add(photoFind());
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.addPhoto(id, "file:///cache/c.jpg");
    await expect(store.removePhoto(id, 2)).resolves.toEqual({ photoRemoved: true });
    await expect(photosOf(id)).resolves.toEqual([
      ["p1.jpg", 1],
      ["p3.jpg", 2],
    ]);
    expect([...photos.files].sort()).toEqual(["p1.jpg", "p3.jpg"]);
  });

  it("keeps the find's time, position and answer when its first photo is removed", async () => {
    const id = await store.add({ ...photoFind(), position });
    await store.setAnswer(id, analysed, await sentAll(id));
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.completeBatch(id);
    const before = await store.getStored(id);
    await store.removePhoto(id, 1);
    await expect(store.getStored(id)).resolves.toEqual({
      ...before,
      photos: [{ uri: "file:///photos/p2.jpg", batch: 2 }],
    });
  });

  it("refuses to remove the last photo of a find without text, as wrong-state, changing nothing", async () => {
    const id = await store.add(photoFind());
    await expect(store.removePhoto(id, 1)).rejects.toMatchObject({ code: "wrong-state" });
    await expect(photosOf(id)).resolves.toEqual([["p1.jpg", 1]]);
    expect(photos.files.has("p1.jpg")).toBe(true);
  });

  it("removes the last photo of a text find", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.removePhoto(id, 1);
    await expect(photosOf(id)).resolves.toEqual([]);
    expect(photos.files.size).toBe(0);
  });

  it("refuses a number past the find's photos, as invalid input", async () => {
    const id = await store.add(photoFind());
    await expect(store.removePhoto(id, 2)).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("says no find has the ID", async () => {
    await expect(store.removePhoto(99, 1)).rejects.toMatchObject({ code: "not-found" });
  });

  it("leaves the photos added since the answer waiting for the queue, which then analyses those left", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.addPhoto(id, "file:///cache/c.jpg");
    await store.completeBatch(id);
    await store.removePhoto(id, 3);
    await expect(store.getStored(id)).resolves.toMatchObject({ addedPhotos: "waiting" });
  });
});

describe("deleting a find with several photos and a picture (PBI-2.2)", () => {
  it("removes every photo and the picture", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.addPhoto(id, "file:///cache/b.jpg");
    expect(photos.files.size).toBe(3);
    await expect(store.delete(id)).resolves.toEqual({ photoRemoved: true });
    expect(photos.files.size).toBe(0);
  });
});

describe("the self-check of a text find (PBI-2.2)", () => {
  it("waits once an answer from the text alone names a species", async () => {
    const id = await answeredTextFind();
    await expect(store.getStored(id)).resolves.toMatchObject({
      selfCheck: { state: "waiting" },
      picture: null,
    });
  });

  it.each([
    ["no mushroom", { result: "no_mushroom" as const }],
    ["cannot tell", { result: "cannot_tell" as const }],
  ])("is none when the text answer is %s, which names no species", async (_, answer) => {
    const id = await store.addText(textFind);
    await store.setAnswer(id, { ...analysed, answer }, TEXT_ONLY);
    await expect(store.getStored(id)).resolves.toMatchObject({ selfCheck: null });
  });

  it("is none for an answer to a photo find", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({ selfCheck: null, picture: null });
  });

  it("is none for an answer to a text find from its photos and text", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({ selfCheck: null });
  });

  it("stores the picture with its author, licence and page, apart from the photos", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await expect(store.getStored(id)).resolves.toMatchObject({
      photos: [],
      picture: {
        uri: "file:///photos/p1.jpg",
        author: "A. Photographer",
        licence: "CC BY-SA 4.0",
        page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
      },
      selfCheck: { state: "waiting" },
    });
  });

  it("does not count the picture toward the 5 photos", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    for (const name of ["a", "b", "c", "d", "e"]) {
      await store.addPhoto(id, `file:///cache/${name}.jpg`);
    }
    await expect(photosOf(id)).resolves.toHaveLength(5);
  });

  it("keeps the picture's file when the store opens", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await open();
    expect(photos.files.has("p1.jpg")).toBe(true);
  });

  it.each([
    ["agreed", { state: "agreed" } as const],
    ["disagreed", { state: "disagreed", names: falseChanterelle } as const],
    ["no-species", { state: "no-species" } as const],
    ["failed", { state: "failed" } as const],
  ])("is %s after the check on its picture", async (_, outcome) => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, outcome);
    await expect(store.getStored(id)).resolves.toMatchObject({ selfCheck: outcome });
  });

  it("is no picture when none could be had", async () => {
    const id = await answeredTextFind();
    await store.setSelfCheck(id, { state: "no-picture" });
    await expect(store.getStored(id)).resolves.toMatchObject({
      selfCheck: { state: "no-picture" },
      picture: null,
    });
  });

  it("refuses an outcome of the check without a picture, as wrong-state", async () => {
    const id = await answeredTextFind();
    await expect(store.setSelfCheck(id, { state: "agreed" })).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("refuses no picture when the find has one, as wrong-state", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await expect(store.setSelfCheck(id, { state: "no-picture" })).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("refuses a second outcome, as wrong-state", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, { state: "agreed" });
    await expect(store.setSelfCheck(id, { state: "failed" })).rejects.toMatchObject({
      code: "wrong-state",
    });
    await expect(store.getStored(id)).resolves.toMatchObject({ selfCheck: { state: "agreed" } });
  });

  it("refuses a check on a find that has none, as wrong-state", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.setSelfCheck(id, { state: "no-picture" })).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("refuses a picture for a find whose check does not wait, as wrong-state, removing its copy", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.setPicture(id, newPicture)).rejects.toMatchObject({ code: "wrong-state" });
    expect([...photos.files]).toEqual(["p1.jpg"]);
  });

  it("refuses a second picture, as wrong-state, removing its copy and keeping the first", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await expect(store.setPicture(id, newPicture)).rejects.toMatchObject({ code: "wrong-state" });
    expect([...photos.files]).toEqual(["p1.jpg"]);
    await expect(store.getStored(id)).resolves.toMatchObject({
      picture: { uri: "file:///photos/p1.jpg" },
    });
  });

  it("says no find has the ID for a picture or a check", async () => {
    await expect(store.setPicture(99, newPicture)).rejects.toMatchObject({ code: "not-found" });
    await expect(store.setSelfCheck(99, { state: "failed" })).rejects.toMatchObject({
      code: "not-found",
    });
    expect(photos.files.size).toBe(0);
  });

  it("keeps its answer, picture and check when the text find gets photos, until a new answer", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, { state: "disagreed", names: falseChanterelle });
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match },
      addedPhotos: "waiting",
      picture: { author: "A. Photographer" },
      selfCheck: { state: "disagreed", names: falseChanterelle },
    });
  });

  it("is gone, with the picture, once an answer from the photos and text replaces it; the picture's file goes at the next opening", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, { state: "agreed" });
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({
      picture: null,
      selfCheck: null,
      addedPhotos: "analysed",
    });
    expect(photos.files.has("p1.jpg")).toBe(true);
    await open();
    expect([...photos.files]).toEqual(["p2.jpg"]);
  });

  it("waits again, without the earlier picture, once a new answer from the text alone replaces it", async () => {
    const id = await answeredTextFind();
    await store.setPicture(id, newPicture);
    await store.setSelfCheck(id, { state: "disagreed", names: falseChanterelle });
    await store.replaceAnswer(id, { ...analysed, analysedAtMs: 6_000 }, await sentAll(id));
    await expect(store.getStored(id)).resolves.toMatchObject({
      picture: null,
      selfCheck: { state: "waiting" },
    });
  });
});

describe("what an answer was based on (docs/SPEC.md 3.9, Answers; PBI-2.15)", () => {
  const noMushroom: NewAnalysedAnswer = { ...analysed, answer: { result: "no_mushroom" } };
  const cannotTell: NewAnalysedAnswer = { ...analysed, answer: { result: "cannot_tell" } };

  async function basisOf(id: number): Promise<unknown> {
    return (await store.getStored(id))?.answerBasis;
  }

  it.each([
    ["names a species", analysed],
    ["sees no mushroom", noMushroom],
    ["cannot tell", cannotTell],
  ] as const)(
    "records an answer from the text alone that %s as one from the text, in the find and the list",
    async (_, given) => {
      const id = await store.addText(textFind);
      await store.setAnswer(id, given, TEXT_ONLY);
      await expect(basisOf(id)).resolves.toBe("text");
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ id, answerBasis: "text" }),
      ]);
    },
  );

  it.each([
    ["names a species", analysed],
    ["sees no mushroom", noMushroom],
    ["cannot tell", cannotTell],
  ] as const)(
    "records an answer from photos that %s as one from photos, with or without text",
    async (_, given) => {
      const photo = await store.add(photoFind());
      await store.setAnswer(photo, given, await sentAll(photo));
      const text = await store.addText(textFind);
      await store.addPhoto(text, "file:///cache/a.jpg");
      await store.completeBatch(text);
      await store.setAnswer(text, given, await sentAll(text));
      await expect(basisOf(photo)).resolves.toBe("photos");
      await expect(basisOf(text)).resolves.toBe("photos");
    },
  );

  it("records an answer as one from photos when every photo it sent was removed while it ran", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    const sent = await sentAll(id);
    await store.removePhoto(id, 1);
    await store.setAnswer(id, noMushroom, sent);
    await expect(basisOf(id)).resolves.toBe("photos");
  });

  it("records an answer from the text alone as one from the text, though a photo was added while it ran", async () => {
    const id = await store.addText(textFind);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.setAnswer(id, cannotTell, TEXT_ONLY);
    await expect(store.getStored(id)).resolves.toMatchObject({
      answerBasis: "text",
      addedPhotos: "waiting",
    });
  });

  it("keeps the basis while the find gets photos, loses them, gets a picture and a check outcome, and its added photos change state", async () => {
    const text = await answeredTextFind();
    await store.setPicture(text, newPicture);
    await store.setSelfCheck(text, { state: "agreed" });
    await store.addPhoto(text, "file:///cache/a.jpg");
    await store.completeBatch(text);
    await store.setAddedPhotos(text, "not-analysed");
    await store.removePhoto(text, 1);
    await expect(basisOf(text)).resolves.toBe("text");
    const photo = await store.addText(textFind);
    await store.addPhoto(photo, "file:///cache/b.jpg");
    await store.completeBatch(photo);
    await store.setAnswer(photo, noMushroom, await sentAll(photo));
    await store.removePhoto(photo, 1);
    await expect(basisOf(photo)).resolves.toBe("photos");
  });

  it("replaces the basis with the next answer's: from the text to photos, and from photos back to the text", async () => {
    const id = await store.addText(textFind);
    await store.setAnswer(id, noMushroom, TEXT_ONLY);
    await store.addPhoto(id, "file:///cache/a.jpg");
    await store.completeBatch(id);
    await store.replaceAnswer(id, cannotTell, await sentAll(id));
    await expect(basisOf(id)).resolves.toBe("photos");
    await store.removePhoto(id, 1);
    await store.replaceAnswer(id, noMushroom, TEXT_ONLY);
    await expect(basisOf(id)).resolves.toBe("text");
  });

  it("refuses, as wrong-state, an answer from the text alone for a find without text, and stores nothing", async () => {
    const id = await store.add(photoFind());
    await expect(store.setAnswer(id, noMushroom, TEXT_ONLY)).rejects.toMatchObject({
      code: "wrong-state",
    });
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { state: "waiting" },
      answerBasis: null,
    });
    await store.setAnswer(id, analysed, await sentAll(id));
    await expect(store.replaceAnswer(id, cannotTell, TEXT_ONLY)).rejects.toMatchObject({
      code: "wrong-state",
    });
    await expect(store.getStored(id)).resolves.toMatchObject({
      analysis: { answer: match },
      answerBasis: "photos",
    });
  });

  it("says no find has the ID before it judges an answer from the text alone", async () => {
    await expect(store.setAnswer(99, noMushroom, TEXT_ONLY)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("gives a find without an answer no basis, waiting or failed", async () => {
    const id = await store.addText(textFind);
    await expect(basisOf(id)).resolves.toBeNull();
    await store.markFailed(id, { cause: "refused", detail: "stop_reason refusal" });
    await expect(basisOf(id)).resolves.toBeNull();
  });
});

describe("the constraints of schema version 2 on a real SQLite (PBI-2.2)", () => {
  /** Runs an UPDATE on the find, as a writer other than the store might. */
  function update(id: number, set: string, ...params: unknown[]): void {
    sqlite.prepare(`UPDATE finds SET ${set} WHERE id = ?`).run(...params, id);
  }

  it("is accepted by SQLite as a STRICT table", () => {
    expect(
      sqlite.prepare("SELECT strict FROM pragma_table_list WHERE name = 'finds'").get(),
    ).toEqual({ strict: 1 });
  });

  it.each<[string, string, unknown[]]>([
    ["neither text nor a photo", "photos = '[]'", []],
    ["a photo list that is not JSON", "photos = '['", []],
    ["a photo list that is not an array", `photos = '{"file":"p1.jpg"}'`, []],
    ["an empty text", "text = ''", []],
    ["a batch count below 0", "batches = -1", []],
    ["an open-batch flag other than 0 or 1", "batch_open = 2", []],
    ["an open batch on a find that never began one", "batches = 0, batch_open = 1", []],
    ["a state of the added photos without an answer", "added_photos = 'waiting'", []],
    ["a self-check on a find without text", "self_check = 'waiting'", []],
  ])("refuses a waiting photo find with %s", async (_, set, params) => {
    const id = await store.add(photoFind());
    expect(() => update(id, set, ...params)).toThrow(/CHECK constraint failed/);
  });

  it.each<[string, string]>([
    ["no state of the added photos", "added_photos = NULL"],
    ["a state of the added photos it does not know", "added_photos = 'lost'"],
    ["a confidence both as a level and as a number", "confidence = 'high'"],
    ["a confidence as a number of 0", "confidence = NULL, confidence_score = 0"],
    ["a confidence as a number of 101", "confidence = NULL, confidence_score = 101"],
    ["no confidence at all", "confidence_score = NULL"],
  ])("refuses a done match with %s", async (_, set) => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    expect(() => update(id, set)).toThrow(/CHECK constraint failed/);
  });

  it.each([1, 100])("accepts a confidence as the number %s, in place of a level", async (score) => {
    const id = await store.add(photoFind());
    await store.setAnswer(id, analysed, await sentAll(id));
    expect(() => update(id, "confidence = NULL, confidence_score = ?", score)).not.toThrow();
  });

  it("refuses a confidence as a number on an answer that is not a match", async () => {
    const id = await store.add(photoFind());
    await store.setAnswer(
      id,
      { ...analysed, answer: { result: "cannot_tell" } },
      await sentAll(id),
    );
    expect(() => update(id, "confidence_score = 50")).toThrow(/CHECK constraint failed/);
  });

  it.each<[string, string]>([
    ["a self-check state it does not know", "self_check = 'maybe'"],
    [
      "a picture without its author",
      "picture_file = 'w.jpg', picture_licence = 'x', picture_page = 'y'",
    ],
    ["an outcome of the check without a picture", "self_check = 'agreed'"],
    [
      "a disagreement without the species named",
      "self_check = 'disagreed', picture_file = 'w.jpg', picture_author = 'a', picture_licence = 'l', picture_page = 'p'",
    ],
    [
      "names of a species beside a check that agreed",
      "self_check = 'agreed', picture_file = 'w.jpg', picture_author = 'a', picture_licence = 'l', picture_page = 'p', check_name_sv = 'a', check_name_en = 'b', check_name_la = 'c', check_name_it = 'd'",
    ],
    [
      "no picture beside a picture",
      "self_check = 'no-picture', picture_file = 'w.jpg', picture_author = 'a', picture_licence = 'l', picture_page = 'p'",
    ],
    [
      "a picture without a self-check",
      "self_check = NULL, picture_file = 'w.jpg', picture_author = 'a', picture_licence = 'l', picture_page = 'p'",
    ],
  ])("refuses a text find's answer with %s", async (_, set) => {
    const id = await answeredTextFind();
    expect(() => update(id, set)).toThrow(/CHECK constraint failed/);
  });

  it("refuses a self-check on a text find whose answer is not a match", async () => {
    const id = await store.addText(textFind);
    await store.setAnswer(id, { ...analysed, answer: { result: "no_mushroom" } }, TEXT_ONLY);
    expect(() => update(id, "self_check = 'waiting'")).toThrow(/CHECK constraint failed/);
  });

  it("refuses a picture file that another find's picture has", async () => {
    const first = await answeredTextFind();
    const second = await answeredTextFind();
    await store.setPicture(first, newPicture);
    expect(() =>
      update(
        second,
        "picture_file = 'p1.jpg', picture_author = 'a', picture_licence = 'l', picture_page = 'p'",
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

/** A stored list of `count` photos, all in batch 1, as the store writes one. */
function photoList(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, index) => ({ file: `d${index + 1}.jpg`, batch: 1 })),
  );
}

describe("a find a damaged file holds past the store's limits (PBI-2.14 note 1, PBI-2.16 note 1)", () => {
  /**
   * Ways to damage a waiting find the store saved; each gives the find's ID. The CHECKs set no
   * limit on either, so a plain UPDATE stores it, as a damaged file can hold it.
   */
  const damaged: [string, () => Promise<number>][] = [
    [
      "more photos than a find holds",
      async () => {
        const id = await store.add(photoFind());
        sqlite
          .prepare("UPDATE finds SET photos = ? WHERE id = ?")
          .run(photoList(config.maxPhotosPerFind + 1), id);
        return id;
      },
    ],
    [
      "a text longer than a lookup takes",
      async () => {
        const id = await store.addText(textFind);
        sqlite
          .prepare("UPDATE finds SET text = ? WHERE id = ?")
          .run("a".repeat(config.lookupTextMaxLength + 1), id);
        return id;
      },
    ],
  ];

  it.each(damaged)(
    "lists a waiting find with %s as unreadable, by its ID; getStored refuses it, the queue's pick passes over it and it stays waiting, and delete removes it",
    async (_, damageFind) => {
      const id = await damageFind();
      const next = await store.add(photoFind("file:///cache/next.jpg"));
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: next }),
        { readable: false, id },
      ]);
      await expect(store.getStored(id)).rejects.toMatchObject({ code: "corrupt" });
      await expect(store.oldestWaiting()).resolves.toBe(next);
      expect(sqlite.prepare("SELECT state FROM finds WHERE id = ?").get(id)).toEqual({
        state: "waiting",
      });
      await expect(store.delete(id)).resolves.toEqual({ photoRemoved: true });
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: next }),
      ]);
    },
  );

  it("reads a find the store filled with as many photos as a find holds, and refuses one more", async () => {
    const id = await store.addWithOpenBatch(photoFind());
    for (let photo = 2; photo <= config.maxPhotosPerFind; photo += 1) {
      await store.addPhoto(id, `file:///cache/${photo}.jpg`);
    }
    await expect(store.addPhoto(id, "file:///cache/past.jpg")).rejects.toMatchObject({
      code: "wrong-state",
    });
    await store.completeBatch(id);
    await expect(photosOf(id)).resolves.toHaveLength(config.maxPhotosPerFind);
    await expect(store.list()).resolves.toEqual([expect.objectContaining({ readable: true, id })]);
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("reads a text find the store saved with a text as long as a lookup takes, counted in code points, and refuses one longer", async () => {
    // Each character is outside the Basic Multilingual Plane: two UTF-16 units, one code point.
    const longest = "\u{1F344}".repeat(config.lookupTextMaxLength);
    const id = await store.addText({ ...textFind, text: longest });
    await expect(store.addText({ ...textFind, text: `${longest}a` })).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(store.getStored(id)).resolves.toMatchObject({ text: longest });
    await expect(store.list()).resolves.toEqual([expect.objectContaining({ readable: true, id })]);
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });
});

describe("an answer whose columns differ from it, which only a damaged file can hold (PBI-2.17)", () => {
  it.each<[string, string]>([
    ["edibility", "edibility = 'deadly_poisonous'"],
    ["Swedish name", "name_sv = 'Narrkantarell'"],
  ])(
    "passes over a find whose new photos wait and whose %s column differs from its answer's, in the queue's pick, and lists it as unreadable",
    async (_, set) => {
      const id = await store.add(photoFind());
      await store.setAnswer(id, analysed, await sentAll(id));
      await store.addPhoto(id, "file:///cache/b.jpg");
      await store.completeBatch(id);
      const next = await store.add(photoFind("file:///cache/next.jpg"));
      sqlite.prepare(`UPDATE finds SET ${set} WHERE id = ?`).run(id);
      await expect(store.oldestWaiting()).resolves.toBe(next);
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: next }),
        { readable: false, id },
      ]);
      await expect(store.getStored(id)).rejects.toMatchObject({ code: "corrupt" });
    },
  );

  it("passes over a text answer whose self-check waits and whose edibility column differs from it, and lists it as unreadable", async () => {
    const id = await answeredTextFind();
    const next = await store.add(photoFind("file:///cache/next.jpg"));
    sqlite.prepare("UPDATE finds SET edibility = 'poisonous' WHERE id = ?").run(id);
    await expect(store.oldestWaiting()).resolves.toBe(next);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ readable: true, id: next }),
      { readable: false, id },
    ]);
  });
});

describe("a text find whose answer naming a species has no self-check (PBI-2.14, note 4)", () => {
  /**
   * Closed by #84 (PBI-2.15) without new code: an answer naming a species is from the text alone
   * exactly when it has a self-check, so such a find, which only a damaged file can hold, is one
   * the store cannot read, and no reader shows its answer's edibility. Here its added photos wait,
   * so the queue's pick would take it if it could read it.
   */
  it.each<[string, string]>([
    ["its basis the text alone", "self_check = NULL"],
    ["no basis", "self_check = NULL, answer_basis = NULL"],
  ])(
    "lists one with %s as unreadable; getStored refuses it and the queue's pick passes over it",
    async (_, set) => {
      const id = await answeredTextFind();
      await store.addPhoto(id, "file:///cache/b.jpg");
      await store.completeBatch(id);
      const next = await store.add(photoFind("file:///cache/next.jpg"));
      sqlite.exec("PRAGMA ignore_check_constraints = ON");
      try {
        sqlite.prepare(`UPDATE finds SET ${set} WHERE id = ?`).run(id);
      } finally {
        sqlite.exec("PRAGMA ignore_check_constraints = OFF");
      }
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: next }),
        { readable: false, id },
      ]);
      await expect(store.getStored(id)).rejects.toMatchObject({ code: "corrupt" });
      await expect(store.oldestWaiting()).resolves.toBe(next);
    },
  );
});
