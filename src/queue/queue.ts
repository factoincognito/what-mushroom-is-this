/**
 * The queue of finds waiting for analysis (docs/SPEC.md 3.3, 3.4). A run takes the waiting finds
 * one at a time, oldest first by the find's ID, and ends when none is left, when one stays waiting
 * for want of a network or for a fault on Anthropic's side, or when the queue stops. It runs only
 * while the app is in front and the queue is not stopped. One run at a time: a trigger during a
 * run starts no second run, and one request at most is sent at a time.
 *
 * Errors the queue does not know how to handle pass through: a programming or configuration error
 * (the time limit's RangeError, an image limit or JPEG quality the image module refuses), an
 * error while preparing a photo that is not the photo's own fault (full storage, for example) and
 * a store error reject the run, leave the find as it was, and end the run. Whoever started the run
 * then stops the queue with `stopForInternalError` (the provider for the runs it starts, the
 * queue for the restart after a `retry-after`), so no rejection goes unhandled.
 *
 * A photo the encoder cannot load fails its find. But on Android a failed load does not say why,
 * so low memory or a missing native module looks the same and would fail every waiting find: when
 * the photos of two finds in a row in one run do not load, the second find stays waiting and the
 * run stops with `internal-error` (Clead's decision for PBI-1.25). The count is kept per run: a
 * photo that loads ends it, whatever then comes of its find, and each run starts at nought, the run
 * "analyse now" starts too. A find analysed from its screen is not in a run and is not counted.
 *
 * A text find without photos is sent by its description, and ends that count (docs/SPEC.md 3.9,
 * PBI-2.4). An unsaved text lookup is sent from its screen (`analyseLookup`): nothing of it is
 * stored, and each error class has the outcome it has for a find analysed from its screen.
 */

import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import type { Answer } from "../analysis/answer";
import type { AnalysisError } from "../analysis/errors";
import type { PreparedPhoto } from "../image/prepareForAnalysis";
import type { ReadKeyResult } from "../key/apiKey";
import { type AnalysisSent, type FindFailure, type StoredFind, StoreError } from "../store/find";
import type { FindStore, LookupStore } from "../store/findStore";

/** Why the finds wait after a run: no network, the time limit passed, or a fault on Anthropic's side. */
export type PauseCause = "network" | "time-out" | "server";

/** Why the queue stopped. It starts again on "analyse now", or on a change of the setting named. */
export type QueueStop =
  /**
   * 429, or a spend limit. With `retryAtMs` (from `retry-after`) the queue starts again by itself
   * then; without it, when the user starts it. `accessResumesAtMs` is the time a spend limit's
   * message states, for the message only.
   */
  | { reason: "rate-limited"; retryAtMs: number | null; accessResumesAtMs: number | null }
  /** No key is saved, or the key store cannot be read: Settings asks for a key. */
  | { reason: "no-key" }
  /** 401, 403, or a key that cannot be sent: Settings asks for a key. */
  | { reason: "key-refused" }
  /**
   * The 400 of a key not scoped to a workspace (PBI-1.13 classes it as a refused key, status 400):
   * the app sends no workspace header, so Settings asks for a key created in a workspace.
   */
  | { reason: "key-not-scoped" }
  /** 402 or a billing error. */
  | { reason: "no-credit" }
  /** 404: Settings asks for a model. */
  | { reason: "model-unknown" }
  /** An answer not of the shape, or not from the API; that find was marked failed. */
  | { reason: "answer" }
  /**
   * A run rejected with an error the queue does not handle (a programming, configuration or store
   * error), or a find's analysis did, or the photos of two finds in a row in a run did not load
   * (PBI-1.25). The finds are as they were; only "analyse now" lifts it.
   */
  | { reason: "internal-error" }
  /** Any other status. */
  | { reason: "other"; status: number };

export interface QueueState {
  readonly running: boolean;
  readonly stop: QueueStop | null;
  /** Why the last run ended with finds waiting, or null; cleared when a run starts. */
  readonly pause: PauseCause | null;
}

/** What a message tells the user: a pause, a stop, or why a find failed. */
export type QueueNotice =
  | { kind: "paused"; cause: PauseCause }
  | { kind: "stopped"; stop: QueueStop }
  | { kind: "find-failed"; failure: FindFailure };

/**
 * The outcome of analysing one find from its screen. `answerKept` is true when the find had an
 * answer: a failed new analysis keeps it and stores nothing (SPEC 3.3).
 */
export type AnalyseFindResult =
  | { ok: true }
  | { ok: false; notice: QueueNotice; answerKept: boolean };

/**
 * The outcome of analysing an unsaved lookup from its screen (docs/SPEC.md 3.9): the answer and
 * the model that gave it, or the notice the screen shows in the find's place.
 */
export type AnalyseLookupResult =
  | { ok: true; answer: Answer; model: string }
  | { ok: false; notice: QueueNotice };

/**
 * The part of the find log the queue uses. It reads a find as `getStored` does, so that a text
 * find without photos, which Phase 1's `get` cannot show, is analysed (PBI-2.4).
 */
export type QueueLog = Pick<
  FindStore,
  "oldestWaiting" | "setAnswer" | "replaceAnswer" | "markFailed" | "markWaiting"
> &
  Pick<LookupStore, "getStored">;

export interface QueueDeps {
  findLog: () => Promise<QueueLog>;
  /** The key, read only once the first-start clearing has run. */
  readKey: () => Promise<ReadKeyResult>;
  /** The model ID in use. */
  readModelId: () => Promise<string>;
  /** The photo for analysis, prepared for the model in use (`preparePhotoForAnalysis`). */
  preparePhoto: (photoUri: string, modelId: string) => Promise<PreparedPhoto>;
  /** Sends the photo once (`analysePhoto`). */
  analyse: (input: AnalysisInput) => Promise<AnalysisCallResult>;
  /** The current time in ms since the epoch. */
  now: () => number;
  /** Runs `task` after `delayMs`; gives a function that cancels it. */
  schedule: (task: () => void, delayMs: number) => () => void;
}

export interface QueueSettings {
  /** The API address from the config module. */
  apiAddress: string;
  /** The request's time limit from the config module, in milliseconds. */
  timeLimitMs: number;
}

/** What one attempt at a find came to. */
type Attempt =
  | { type: "answered"; answer: Answer; model: string }
  | { type: "find-failed"; failure: FindFailure; stop: QueueStop | null }
  | { type: "stays-waiting"; cause: PauseCause }
  | { type: "stop"; stop: QueueStop };

/** What one step of a run came to: the next find, none left, or the end of the run. */
type Step = "next" | "none" | "end";

/** The finds in a row in one run whose photos did not load, at which the run stops (PBI-1.25). */
const FAILED_LOADS_THAT_STOP = 2;

/** What a run carries from one find to the next. */
interface RunCount {
  /** The finds in a row, in this run, whose photo did not load. */
  failedLoads: number;
}

export class AnalysisQueue {
  private state: QueueState = { running: false, stop: null, pause: null };
  private readonly listeners = new Set<(state: QueueState) => void>();
  private inFront = false;
  private run: Promise<void> | null = null;
  /** A trigger came during the run. */
  private triggered = false;
  /** The end of the last task that sends a request; the next one waits for it. */
  private lock: Promise<unknown> = Promise.resolve();
  private cancelRestart: (() => void) | null = null;

  constructor(
    private readonly deps: QueueDeps,
    private readonly settings: QueueSettings,
  ) {}

  getState(): QueueState {
    return this.state;
  }

  subscribe(listener: (state: QueueState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Whether the app is in front. While it is not, nothing runs and a run takes no next find. */
  setInFront(inFront: boolean): void {
    this.inFront = inFront;
  }

  /**
   * A trigger of SPEC 3.4: the app came to the front, a find was saved, or the network is back.
   * Runs only while the app is in front and the queue is not stopped; during a run, it starts no
   * second run. The promise rejects with an error the queue does not handle.
   */
  trigger(): Promise<void> {
    this.liftPassedRetry();
    if (!this.inFront || this.state.stop !== null) {
      return Promise.resolve();
    }
    return this.startRun();
  }

  /** "Analyse now" (SPEC 3.1, 3.3): starts a stopped queue again. */
  analyseNow(): Promise<void> {
    this.clearStop();
    return this.trigger();
  }

  /** A setting changed: starts the queue again when it stopped for that setting (SPEC 3.3). */
  settingChanged(setting: "key" | "model"): Promise<void> {
    const reason = this.state.stop?.reason;
    const named =
      setting === "key"
        ? reason === "no-key" || reason === "key-refused" || reason === "key-not-scoped"
        : reason === "model-unknown";
    if (!named) {
      return Promise.resolve();
    }
    this.clearStop();
    return this.trigger();
  }

  /**
   * Analyses one find at once, from its screen (SPEC 3.4), also while the queue is stopped; the
   * outcome for the queue of the error classes still applies (SPEC 3.3).
   */
  analyseFind(id: number): Promise<AnalyseFindResult> {
    return this.exclusive(async () => {
      const log = await this.deps.findLog();
      const find = await log.getStored(id);
      if (find === null) {
        throw new StoreError("not-found", `no find has the ID ${id}`);
      }
      const analysed = find.analysis.state === "done";
      const attempt = await this.attempt(find, null);
      switch (attempt.type) {
        case "answered": {
          const answer = {
            answer: attempt.answer,
            model: attempt.model,
            analysedAtMs: this.deps.now(),
          };
          const sent = sentOf(find);
          await (analysed ? log.replaceAnswer(id, answer, sent) : log.setAnswer(id, answer, sent));
          return { ok: true };
        }
        case "find-failed":
          if (!analysed) {
            await log.markFailed(id, attempt.failure);
          }
          if (attempt.stop !== null) {
            this.setStop(attempt.stop);
          }
          return {
            ok: false,
            notice: { kind: "find-failed", failure: attempt.failure },
            answerKept: analysed,
          };
        case "stays-waiting":
          await this.backToWaiting(log, find);
          return {
            ok: false,
            notice: { kind: "paused", cause: attempt.cause },
            answerKept: analysed,
          };
        case "stop":
          await this.backToWaiting(log, find);
          this.setStop(attempt.stop);
          return {
            ok: false,
            notice: { kind: "stopped", stop: attempt.stop },
            answerKept: analysed,
          };
      }
    });
  }

  /**
   * Analyses an unsaved text lookup at once, from its screen (docs/SPEC.md 3.9), also while the
   * queue is stopped, and stores nothing. Each error class has the outcome it has for a find
   * analysed from its screen, with the screen in the find's place: one that leaves a find waiting
   * gives its pause and sets none on the queue; one that marks a find failed gives the failure;
   * one that stops the queue stops it, as does a missing key. An error the queue does not handle
   * rejects, as for `analyseFind`.
   */
  analyseLookup(text: string): Promise<AnalyseLookupResult> {
    return this.exclusive(async () => {
      const access = await this.access();
      const attempt = access.ok ? await this.send({ text }, access) : access.attempt;
      switch (attempt.type) {
        case "answered":
          return { ok: true, answer: attempt.answer, model: attempt.model };
        case "find-failed":
          if (attempt.stop !== null) {
            this.setStop(attempt.stop);
          }
          return { ok: false, notice: { kind: "find-failed", failure: attempt.failure } };
        case "stays-waiting":
          return { ok: false, notice: { kind: "paused", cause: attempt.cause } };
        case "stop":
          this.setStop(attempt.stop);
          return { ok: false, notice: { kind: "stopped", stop: attempt.stop } };
      }
    });
  }

  /**
   * Stops the queue for an error it does not handle: whoever starts a run sets this when the run
   * rejects. The error is not kept: the user is told only that something went wrong.
   */
  stopForInternalError(): void {
    this.setStop({ reason: "internal-error" });
  }

  /** Cancels a pending restart; the queue is not used after this. */
  dispose(): void {
    this.cancelRestart?.();
    this.cancelRestart = null;
    this.listeners.clear();
  }

  private startRun(): Promise<void> {
    if (this.run !== null) {
      this.triggered = true;
      return this.run;
    }
    this.setState({ running: true, pause: null });
    const run = this.runLoop().finally(() => {
      this.run = null;
      this.setState({ running: false });
    });
    this.run = run;
    return run;
  }

  private async runLoop(): Promise<void> {
    const count: RunCount = { failedLoads: 0 };
    while (this.inFront && this.state.stop === null) {
      this.triggered = false;
      const step = await this.exclusive(() => this.stepOldest(count));
      if (step === "end" || (step === "none" && !this.triggered)) {
        return;
      }
    }
  }

  /** Analyses the oldest waiting find, and stores what came of it. */
  private async stepOldest(count: RunCount): Promise<Step> {
    const log = await this.deps.findLog();
    const id = await log.oldestWaiting();
    if (id === null) {
      return "none";
    }
    const find = await log.getStored(id);
    if (find === null || find.analysis.state !== "waiting") {
      // Deleted or analysed from its screen since; take the next.
      return "next";
    }
    const attempt = await this.attempt(find, count);
    switch (attempt.type) {
      case "answered":
        await log.setAnswer(
          id,
          { answer: attempt.answer, model: attempt.model, analysedAtMs: this.deps.now() },
          sentOf(find),
        );
        return "next";
      case "find-failed":
        await log.markFailed(id, attempt.failure);
        if (attempt.stop === null) {
          return "next";
        }
        this.setStop(attempt.stop);
        return "end";
      case "stays-waiting":
        this.setState({ pause: attempt.cause });
        return "end";
      case "stop":
        this.setStop(attempt.stop);
        return "end";
    }
  }

  /**
   * Prepares the find's photo and sends it once; a text find without photos is sent by its
   * description. Stores nothing. `count` is the run's, or null for a find analysed from its
   * screen. A find with photos is sent by its first photo, as in Phase 1, until PBI-2.5 sends them
   * all.
   */
  private async attempt(find: StoredFind, count: RunCount | null): Promise<Attempt> {
    const access = await this.access();
    if (!access.ok) {
      return access.attempt;
    }
    const first = find.photos[0];
    if (first === undefined) {
      // A text find without photos ends the count of failed loads (docs/SPEC.md 3.9, Batches).
      if (count !== null) {
        count.failedLoads = 0;
      }
      if (find.text === null) {
        throw new StoreError("corrupt", `find ${find.id} has neither text nor a photo`);
      }
      return this.send({ text: find.text }, access);
    }
    // A photo that cannot be loaded, decoded or sized comes back as a failure; any other error
    // while preparing it is not the photo's and passes through (Clead's decision for PBI-1.21).
    const photo = await this.deps.preparePhoto(first.uri, access.model);
    if (count !== null) {
      count.failedLoads = !photo.ok && !photo.loaded ? count.failedLoads + 1 : 0;
      if (count.failedLoads >= FAILED_LOADS_THAT_STOP) {
        // Not this photo's fault, most likely: the find stays waiting (PBI-1.25).
        return { type: "stop", stop: { reason: "internal-error" } };
      }
    }
    if (!photo.ok) {
      return { type: "find-failed", failure: photo.failure, stop: null };
    }
    return this.send({ imageBase64: photo.imageBase64 }, access);
  }

  /** The key and the model in use, or the stop a missing key brings. */
  private async access(): Promise<
    { ok: true; apiKey: string; model: string } | { ok: false; attempt: Attempt }
  > {
    const key = await this.deps.readKey();
    if (!key.ok || key.key === null) {
      return { ok: false, attempt: { type: "stop", stop: { reason: "no-key" } } };
    }
    return { ok: true, apiKey: key.key, model: await this.deps.readModelId() };
  }

  /** Sends a photo or a description once, and gives what came of it by SPEC 3.3's table. */
  private async send(
    content: { imageBase64: string } | { text: string },
    { apiKey, model }: { apiKey: string; model: string },
  ): Promise<Attempt> {
    const result = await this.deps.analyse({
      apiAddress: this.settings.apiAddress,
      model,
      apiKey,
      timeLimitMs: this.settings.timeLimitMs,
      ...content,
    });
    if (result.ok) {
      return { type: "answered", answer: result.answer, model };
    }
    return outcomeOf(result.error, result.accessResumesAtMs ?? null);
  }

  /** A failed find the user asked to analyse waits again when it meets a pause or a stop. */
  private async backToWaiting(log: QueueLog, find: StoredFind): Promise<void> {
    if (find.analysis.state === "failed") {
      await log.markWaiting(find.id);
    }
  }

  /** Runs tasks that send a request one after another. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.lock.then(task);
    this.lock = result.catch(() => undefined);
    return result;
  }

  private setStop(stop: QueueStop): void {
    this.cancelRestart?.();
    this.cancelRestart = null;
    this.setState({ stop });
    if (stop.reason === "rate-limited" && stop.retryAtMs !== null) {
      const delay = Math.max(0, stop.retryAtMs - this.deps.now());
      this.cancelRestart = this.deps.schedule(() => {
        if (this.state.stop === stop) {
          this.clearStop();
          // This run the queue starts itself, so it handles its rejection itself.
          this.trigger().catch(() => this.stopForInternalError());
        }
      }, delay);
    }
  }

  private clearStop(): void {
    this.cancelRestart?.();
    this.cancelRestart = null;
    if (this.state.stop !== null) {
      this.setState({ stop: null });
    }
  }

  /** A 429's stop ends at its `retry-after` time, also when its timer did not fire. */
  private liftPassedRetry(): void {
    const { stop } = this.state;
    if (
      stop?.reason === "rate-limited" &&
      stop.retryAtMs !== null &&
      this.deps.now() >= stop.retryAtMs
    ) {
      this.clearStop();
    }
  }

  private setState(change: Partial<QueueState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

/** The outcome of SPEC 3.3's table for an error class. */
/**
 * What an analysis of the find sends, so the store knows what the answer saw: its first photo, or
 * none for a text find without photos (`attempt`).
 */
function sentOf(find: StoredFind): AnalysisSent {
  const first = find.photos[0];
  return { photoUris: first === undefined ? [] : [first.uri] };
}

function outcomeOf(error: AnalysisError, accessResumesAtMs: number | null): Attempt {
  switch (error.kind) {
    case "stays-waiting":
      return { type: "stays-waiting", cause: error.cause };
    case "rate-limited":
      return {
        type: "stop",
        stop: { reason: "rate-limited", retryAtMs: error.retryAt, accessResumesAtMs },
      };
    case "key-refused":
      return {
        type: "stop",
        stop: { reason: error.cause === "not-scoped" ? "key-not-scoped" : "key-refused" },
      };
    case "no-credit":
      return { type: "stop", stop: { reason: "no-credit" } };
    case "model-unknown":
      return { type: "stop", stop: { reason: "model-unknown" } };
    case "find-failed": {
      // An answer's failure has a detail, a refused request a status; a refusal has its own cause
      // (PBI-1.21).
      const failure: FindFailure =
        "detail" in error
          ? { cause: error.reason === "refused" ? "refused" : "answer", detail: error.detail }
          : { cause: "request", detail: `${error.reason} (status ${error.status})` };
      return {
        type: "find-failed",
        failure,
        stop: error.queue === "stops" ? { reason: "answer" } : null,
      };
    }
    case "other":
      return { type: "stop", stop: { reason: "other", status: error.status } };
  }
}
