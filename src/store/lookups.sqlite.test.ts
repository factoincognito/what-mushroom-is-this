/**
 * The store's Phase 2 fields (PBI-2.2, docs/SPEC.md 3.9 "The store") against a real SQLite
 * (`src/testing/sqliteDatabase.ts`): a find's text, its photos in batches, the open batch, the
 * state of the photos added since its answer, its representative picture and its self-check, and
 * the constraints of schema version 2 that keep them.
 */

import type { Match } from "../analysis/answer";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import type { AnalysedAnswer, NewFind, NewPicture, NewTextFind } from "./find";
import { createFindStore, type FindStore, type LookupStore } from "./findStore";

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
        analysis: { state: "waiting" },
        selfCheck: null,
      },
    ]);
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });

  it("is listed with its answer once analysed from its text, its self-check waiting (PBI-2.4)", async () => {
    const id = await answeredTextFind();
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id,
        photoUri: null,
        time,
        analysis: {
          state: "done",
          result: "match",
          names: { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" },
          edibility: "edible",
          confidence: 90,
        },
        selfCheck: { state: "waiting" },
      },
    ]);
    await expect(store.oldestWaiting()).resolves.toBeNull();
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
