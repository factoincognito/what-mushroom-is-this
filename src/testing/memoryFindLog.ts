/**
 * A find log in memory, for the screen tests: the store's interface and its state changes
 * (`src/store/findStore.ts`), without SQLite or photo files. The finds are kept as the store
 * would give them back; the tests set them directly in `finds`, either as Phase 1's view of a
 * photo find (`Find`) or as everything the store holds (`StoredFind`, for a text find, PBI-2.4).
 * A find whose ID is in `unreadable` stands for a row the store cannot read (PBI-1.16): the list
 * marks it in its place, `get` and `getStored` refuse it as corrupt, the queue's pick passes over
 * it, and `delete` still removes it. As in the store, `get` refuses a find without a photo, and an
 * answer to a text find from its text alone starts its self-check, waiting (PBI-2.4).
 */

import {
  type AnalysedAnswer,
  type Analysis,
  type AnalysisSent,
  type Find,
  type FindSummary,
  type ListedFind,
  type StoredFind,
  StoreError,
  type SummaryAnalysis,
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
  };
}

export function memoryFindLog(): MemoryFindLog {
  const finds = new Map<number, Find | StoredFind>();
  const unreadable = new Set<number>();
  const withoutId: string[] = [];

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
    finds.set(id, { ...find, analysis });
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
    const find = existing(id);
    if (!isStored(find)) {
      return;
    }
    const fromTextAlone =
      sent.photoUris.length === 0 && analysed.answer.result === "match" && find.text !== null;
    const notSent = find.photos.some((photo) => !sent.photoUris.includes(photo.uri));
    finds.set(id, {
      ...find,
      addedPhotos: notSent ? "waiting" : "analysed",
      picture: null,
      selfCheck: fromTextAlone ? { state: "waiting" } : null,
    });
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
      finds.set(id, { id, ...find, analysis: { state: "waiting" } });
      return id;
    },
    async addText(find) {
      const id = nextId();
      finds.set(id, {
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
      });
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
      const waiting = [...finds.values()].filter(
        (find) => find.analysis.state === "waiting" && !unreadable.has(find.id),
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
      finds.set(id, { ...find, position });
    },
    async delete(id) {
      existing(id);
      finds.delete(id);
      unreadable.delete(id);
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
