/**
 * A find log in memory, for the screen tests: the store's interface and its state changes
 * (`src/store/findStore.ts`), without SQLite or photo files. The finds are kept as the store
 * would give them back; the tests set them directly in `finds`.
 */

import { type Find, type FindSummary, StoreError, type SummaryAnalysis } from "../store/find";
import type { FindStore } from "../store/findStore";

export interface MemoryFindLog extends FindStore {
  readonly finds: Map<number, Find>;
}

function summaryOf(find: Find): FindSummary {
  const { analysis } = find;
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
  return { id: find.id, photoUri: find.photoUri, time: find.time, analysis: summary };
}

export function memoryFindLog(): MemoryFindLog {
  const finds = new Map<number, Find>();

  function existing(id: number): Find {
    const find = finds.get(id);
    if (find === undefined) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    return find;
  }

  function change(id: number, from: readonly string[], analysis: Find["analysis"]): void {
    const find = existing(id);
    if (!from.includes(find.analysis.state)) {
      throw new StoreError("wrong-state", `find ${id} is ${find.analysis.state}`);
    }
    finds.set(id, { ...find, analysis });
  }

  return {
    finds,
    async add(find) {
      const id = Math.max(0, ...finds.keys()) + 1;
      finds.set(id, { id, ...find, analysis: { state: "waiting" } });
      return id;
    },
    async get(id) {
      return finds.get(id) ?? null;
    },
    async list() {
      return [...finds.values()]
        .sort((a, b) => b.time.takenAtMs - a.time.takenAtMs || b.id - a.id)
        .map(summaryOf);
    },
    async oldestWaiting() {
      const waiting = [...finds.values()].filter((find) => find.analysis.state === "waiting");
      return waiting.length === 0 ? null : Math.min(...waiting.map((find) => find.id));
    },
    async setAnswer(id, analysed) {
      change(id, ["waiting", "failed"], { state: "done", ...analysed });
    },
    async replaceAnswer(id, analysed) {
      change(id, ["done"], { state: "done", ...analysed });
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
      return { photoRemoved: true };
    },
  };
}
