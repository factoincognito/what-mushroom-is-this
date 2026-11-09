/**
 * The queue of finds waiting for analysis (docs/SPEC.md 3.3, 3.4). A run takes the waiting finds
 * one at a time, oldest first by the find's ID, and ends when none is left, when one stays waiting
 * for want of a network or for a fault on Anthropic's side, or when the queue stops. It runs only
 * while the app is in front and the queue is not stopped. One run at a time: a trigger during a
 * run starts no second run, and one request at most is sent at a time.
 *
 * Errors the queue does not know how to handle pass through: a programming or configuration error
 * (the time limit's RangeError, an image limit or JPEG quality the image module refuses) and a
 * store error reject the run, leave the find as it was, and end the run.
 */

import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import type { Answer } from "../analysis/answer";
import type { AnalysisError } from "../analysis/errors";
import { PhotoPreparationError, type PreparedPhoto } from "../image/prepareForAnalysis";
import type { ReadKeyResult } from "../key/apiKey";
import { type Find, type FindFailure, StoreError } from "../store/find";
import type { FindStore } from "../store/findStore";

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
  /** 401, 403: Settings asks for a key. */
  | { reason: "key-refused" }
  /** 402 or a billing error. */
  | { reason: "no-credit" }
  /** 404: Settings asks for a model. */
  | { reason: "model-unknown" }
  /** An answer not of the shape, or not from the API; that find was marked failed. */
  | { reason: "answer" }
  /** The encoder could not read a find's photo; the find stays waiting. */
  | { reason: "photo-unreadable" }
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

/** The part of the find log the queue uses. */
export type QueueLog = Pick<
  FindStore,
  "oldestWaiting" | "get" | "setAnswer" | "replaceAnswer" | "markFailed" | "markWaiting"
>;

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
        ? reason === "no-key" || reason === "key-refused"
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
      const find = await log.get(id);
      if (find === null) {
        throw new StoreError("not-found", `no find has the ID ${id}`);
      }
      const analysed = find.analysis.state === "done";
      const attempt = await this.attempt(find);
      switch (attempt.type) {
        case "answered": {
          const answer = {
            answer: attempt.answer,
            model: attempt.model,
            analysedAtMs: this.deps.now(),
          };
          await (analysed ? log.replaceAnswer(id, answer) : log.setAnswer(id, answer));
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
    while (this.inFront && this.state.stop === null) {
      this.triggered = false;
      const step = await this.exclusive(() => this.stepOldest());
      if (step === "end" || (step === "none" && !this.triggered)) {
        return;
      }
    }
  }

  /** Analyses the oldest waiting find, and stores what came of it. */
  private async stepOldest(): Promise<Step> {
    const log = await this.deps.findLog();
    const id = await log.oldestWaiting();
    if (id === null) {
      return "none";
    }
    const find = await log.get(id);
    if (find === null || find.analysis.state !== "waiting") {
      // Deleted or analysed from its screen since; take the next.
      return "next";
    }
    const attempt = await this.attempt(find);
    switch (attempt.type) {
      case "answered":
        await log.setAnswer(id, {
          answer: attempt.answer,
          model: attempt.model,
          analysedAtMs: this.deps.now(),
        });
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

  /** Prepares the find's photo and sends it once. Stores nothing. */
  private async attempt(find: Find): Promise<Attempt> {
    const key = await this.deps.readKey();
    if (!key.ok || key.key === null) {
      return { type: "stop", stop: { reason: "no-key" } };
    }
    const model = await this.deps.readModelId();
    let photo: PreparedPhoto;
    try {
      photo = await this.deps.preparePhoto(find.photoUri, model);
    } catch (error) {
      if (error instanceof PhotoPreparationError && error.code !== "invalid-size") {
        throw error;
      }
      return { type: "stop", stop: { reason: "photo-unreadable" } };
    }
    if (!photo.ok) {
      return { type: "find-failed", failure: photo.failure, stop: null };
    }
    const result = await this.deps.analyse({
      apiAddress: this.settings.apiAddress,
      model,
      apiKey: key.key,
      imageBase64: photo.imageBase64,
      timeLimitMs: this.settings.timeLimitMs,
    });
    if (result.ok) {
      return { type: "answered", answer: result.answer, model };
    }
    return outcomeOf(result.error, result.accessResumesAtMs ?? null);
  }

  /** A failed find the user asked to analyse waits again when it meets a pause or a stop. */
  private async backToWaiting(log: QueueLog, find: Find): Promise<void> {
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
          void this.trigger();
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
      return { type: "stop", stop: { reason: "key-refused" } };
    case "no-credit":
      return { type: "stop", stop: { reason: "no-credit" } };
    case "model-unknown":
      return { type: "stop", stop: { reason: "model-unknown" } };
    case "find-failed": {
      // By the class's own fields, not its reasons: an answer's failure has a detail, a refused
      // request a status.
      const failure: FindFailure =
        "detail" in error
          ? { cause: "answer", detail: error.detail }
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
