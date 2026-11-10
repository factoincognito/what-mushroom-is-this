/**
 * A find log in memory, for the screen tests: the store's interface and its state changes
 * (`src/store/findStore.ts`), without SQLite or photo files. The finds are kept as the store
 * would give them back; the tests set them directly in `finds`, either as Phase 1's view of a
 * photo find (`Find`) or as everything the store holds (`StoredFind`, for a text find, PBI-2.4).
 * A find whose ID is in `unreadable` stands for a row the store cannot read (PBI-1.16): the list
 * marks it in its place, `get` and `getStored` refuse it as corrupt, the queue's pick passes over
 * it, and `delete` still removes it. As in the store, `get` refuses a find without a photo, and an
 * answer to a text find from its text alone starts its self-check, waiting (PBI-2.4).
 *
 * A find's photos in batches (PBI-2.5) follow the store's rules: a photo lookup's find saved with
 * its batch open, a photo added to the open batch or as the first of a new one numbered one past
 * the last begun (kept per find, as the store's `batches` column, also when photos are removed),
 * up to `config.maxPhotosPerFind`; completing a batch; the queue's pick of a waiting find or an
 * analysed one whose added photos wait, its batch complete; removing a photo; and the state of
 * the photos added since an answer. `memoryFindLog.test.ts` runs the same changes on both.
 */

import { config } from "../config/config";
import {
  type AnalysedAnswer,
  type Analysis,
  type AnalysisSent,
  checkId,
  checkUri,
  type Find,
  type FindSummary,
  invalid,
  type ListedFind,
  type StoredFind,
  StoreError,
  type SummaryAnalysis,
  speciesOf,
} from "../store/find";
import type { FindLog } from "../store/findStore";

export interface MemoryFindLog extends FindLog {
  readonly finds: Map<number, Find | StoredFind>;
  /** The IDs of the finds the store cannot read. */
  readonly unreadable: Set<number>;
  /**
   * The finds whose ID the store cannot read, by their ID as SQLite writes it (PBI-1.26): listed
   * after the others, in this order, and deleted by `deleteUnreadable`.
   */
  readonly withoutId: string[];
}

function isStored(find: Find | StoredFind): find is StoredFind {
  return "photos" in find;
}

/** Everything the store holds of a find given as Phase 1's view: its one photo, no text. */
export function storedOf(find: Find | StoredFind): StoredFind {
  if (isStored(find)) {
    return find;
  }
  const { id, photoUri, time, position, analysis } = find;
  return {
    id,
    text: null,
    photos: [{ uri: photoUri, batch: 1 }],
    batchOpen: false,
    time,
    position,
    analysis,
    addedPhotos: analysis.state === "done" ? "analysed" : null,
    picture: null,
    selfCheck: null,
  };
}

function summaryOf(stored: StoredFind): FindSummary {
  const { analysis } = stored;
  let summary: SummaryAnalysis;
  if (analysis.state !== "done") {
    summary = analysis;
  } else if (analysis.answer.result === "match") {
    const { names, edibility, confidence } = analysis.answer;
    summary = {
      state: "done",
      result: "match",
      names: { sv: names.sv, en: names.en, it: names.it },
      edibility,
      confidence,
    };
  } else {
    summary = { state: "done", result: analysis.answer.result };
  }
  return {
    id: stored.id,
    photoUri: stored.photos[0]?.uri ?? null,
    time: stored.time,
    analysis: summary,
    selfCheck: stored.selfCheck,
    species: speciesOf(analysis),
  };
}

export function memoryFindLog(): MemoryFindLog {
  const finds = new Map<number, Find | StoredFind>();
  const unreadable = new Set<number>();
  const withoutId: string[] = [];
  /**
   * The batches begun on each find, as the store's `batches` column, kept with the find they were
   * counted for: a find a test set in `finds` itself counts its photos' last batch.
   */
  const batchesBegun = new Map<number, { of: Find | StoredFind; batches: number }>();

  function batchesOf(id: number): number {
    const find = existing(id);
    const entry = batchesBegun.get(id);
    if (entry !== undefined && entry.of === find) {
      return entry.batches;
    }
    return Math.max(0, ...storedOf(find).photos.map((photo) => photo.batch));
  }

  /** Writes a find, with the batches begun on it. */
  function put(id: number, find: Find | StoredFind, batches: number): void {
    finds.set(id, find);
    batchesBegun.set(id, { of: find, batches });
  }

  /** The find, everything the store holds of it; `not-found` when there is none. */
  function stored(id: number): StoredFind {
    return storedOf(existing(id));
  }

  function listed(find: Find | StoredFind): ListedFind {
    return unreadable.has(find.id)
      ? { readable: false, id: find.id }
      : { readable: true, ...summaryOf(storedOf(find)) };
  }

  function existing(id: number): Find | StoredFind {
    const find = finds.get(id);
    if (find === undefined) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    return find;
  }

  function change(id: number, from: readonly string[], analysis: Analysis): void {
    const find = existing(id);
    if (!from.includes(find.analysis.state)) {
      throw new StoreError("wrong-state", `find ${id} is ${find.analysis.state}`);
    }
    put(id, { ...find, analysis }, batchesOf(id));
  }

  /**
   * Stores an answer as the real store's `ANSWER_COLUMNS` do (`src/store/findStore.ts`): the
   * self-check waits when the analysis sent no photo, the answer names a species and the find has
   * text, so the answer is from the text alone (docs/SPEC.md 3.9), and is none otherwise; the
   * picture goes; the photos added since wait when the find holds one the analysis did not send.
   * A find given as Phase 1's view has no text, so its answer never has a check.
   */
  function answer(
    id: number,
    from: readonly string[],
    analysed: AnalysedAnswer,
    sent: AnalysisSent,
  ): void {
    change(id, from, { state: "done", ...analysed });
    const find = stored(id);
    const fromTextAlone =
      sent.photoUris.length === 0 && analysed.answer.result === "match" && find.text !== null;
    const notSent = find.photos.some((photo) => !sent.photoUris.includes(photo.uri));
    put(
      id,
      {
        ...find,
        addedPhotos: notSent ? "waiting" : "analysed",
        picture: null,
        selfCheck: fromTextAlone ? { state: "waiting" } : null,
      },
      batchesOf(id),
    );
  }

  function readable(id: number): Find | StoredFind | null {
    if (unreadable.has(id) && finds.has(id)) {
      throw new StoreError("corrupt", `find ${id} cannot be read`);
    }
    return finds.get(id) ?? null;
  }

  function nextId(): number {
    return Math.max(0, ...finds.keys()) + 1;
  }

  return {
    finds,
    unreadable,
    withoutId,
    async add(find) {
      const id = nextId();
      put(id, { id, ...find, analysis: { state: "waiting" } }, 1);
      return id;
    },
    async addWithOpenBatch(find) {
      const id = nextId();
      put(id, { ...storedOf({ id, ...find, analysis: { state: "waiting" } }), batchOpen: true }, 1);
      return id;
    },
    async addPhoto(id, photoUri) {
      checkId(id);
      checkUri(photoUri, "the photo URI");
      const find = stored(id);
      if (find.photos.length >= config.maxPhotosPerFind) {
        throw new StoreError("wrong-state", `find ${id} holds the most photos it may`);
      }
      const batch = find.batchOpen ? batchesOf(id) : batchesOf(id) + 1;
      put(
        id,
        { ...find, photos: [...find.photos, { uri: photoUri, batch }], batchOpen: true },
        batch,
      );
    },
    async completeBatch(id) {
      checkId(id);
      const find = stored(id);
      if (!find.batchOpen) {
        throw new StoreError("wrong-state", `find ${id} has no open batch`);
      }
      const { analysis } = find;
      const next: StoredFind = {
        ...find,
        batchOpen: false,
        analysis: analysis.state === "failed" ? { state: "waiting" } : analysis,
        addedPhotos: analysis.state === "done" ? "waiting" : find.addedPhotos,
      };
      put(id, next, batchesOf(id));
    },
    async removePhoto(id, photoNumber) {
      checkId(id);
      if (!Number.isSafeInteger(photoNumber) || photoNumber < 1) {
        throw invalid("the photo number is not a positive whole number");
      }
      const find = stored(id);
      if (photoNumber > find.photos.length) {
        throw invalid(`find ${id} has no photo ${photoNumber}`);
      }
      if (find.text === null && find.photos.length === 1) {
        throw new StoreError("wrong-state", `find ${id} has no text, so keeps its last photo`);
      }
      const photos = find.photos.filter((_, index) => index !== photoNumber - 1);
      put(id, { ...find, photos }, batchesOf(id));
      return { photoRemoved: true };
    },
    async setAddedPhotos(id, state) {
      checkId(id);
      if (state !== "waiting" && state !== "not-analysed") {
        throw invalid("the photos added since the answer are set only to waiting or not-analysed");
      }
      const find = stored(id);
      const from = state === "waiting" ? "not-analysed" : "waiting";
      if (find.addedPhotos !== from) {
        throw new StoreError("wrong-state", `find ${id}'s added photos are not ${from}`);
      }
      put(id, { ...find, addedPhotos: state }, batchesOf(id));
    },
    async addText(find) {
      const id = nextId();
      const text: StoredFind = {
        id,
        text: find.text,
        photos: [],
        batchOpen: false,
        time: find.time,
        position: find.position,
        analysis: { state: "waiting" },
        addedPhotos: null,
        picture: null,
        selfCheck: null,
      };
      put(id, text, 0);
      return id;
    },
    async get(id) {
      const find = readable(id);
      if (find === null || !isStored(find)) {
        return find;
      }
      const first = find.photos[0];
      if (first === undefined) {
        throw new StoreError("corrupt", `find ${id} has no photo, by which Phase 1 shows a find`);
      }
      const { time, position, analysis } = find;
      return { id, photoUri: first.uri, time, position, analysis };
    },
    async getStored(id) {
      const find = readable(id);
      return find === null ? null : storedOf(find);
    },
    async list() {
      const readableFinds: ListedFind[] = [...finds.values()]
        .sort((a, b) => b.time.takenAtMs - a.time.takenAtMs || b.id - a.id)
        .map(listed);
      return [
        ...readableFinds,
        ...withoutId.map((storedId): ListedFind => ({ readable: false, id: null, storedId })),
      ];
    },
    async oldestWaiting() {
      const waiting = [...finds.values()]
        .map(storedOf)
        .filter(
          (find) =>
            !find.batchOpen &&
            (find.analysis.state === "waiting" ||
              (find.analysis.state === "done" && find.addedPhotos === "waiting")) &&
            !unreadable.has(find.id),
        );
      return waiting.length === 0 ? null : Math.min(...waiting.map((find) => find.id));
    },
    async setAnswer(id, analysed, sent) {
      answer(id, ["waiting", "failed"], analysed, sent);
    },
    async replaceAnswer(id, analysed, sent) {
      answer(id, ["done"], analysed, sent);
    },
    async markFailed(id, failure) {
      change(id, ["waiting", "failed"], { state: "failed", failure });
    },
    async markWaiting(id) {
      change(id, ["failed"], { state: "waiting" });
    },
    async setPosition(id, position) {
      const find = existing(id);
      if (find.position !== null) {
        throw new StoreError("wrong-state", `find ${id} already has a position`);
      }
      put(id, { ...find, position }, batchesOf(id));
    },
    async delete(id) {
      existing(id);
      finds.delete(id);
      unreadable.delete(id);
      batchesBegun.delete(id);
      return { photoRemoved: true };
    },
    async deleteUnreadable(storedId) {
      const index = withoutId.indexOf(storedId);
      if (index < 0) {
        throw new StoreError("not-found", `no find has the ID ${storedId}`);
      }
      withoutId.splice(index, 1);
      return { photoRemoved: true };
    },
  };
}
