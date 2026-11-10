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
 * An analysis sends all of the find's photos, in the order added, prepared one at a time, in one
 * request, with the find's text when it has one; a text find without photos is sent by its text
 * (docs/SPEC.md 3.9, Batches; PBI-2.4, PBI-2.5). When a photo cannot be loaded, decoded or sized,
 * or fails the segment check, nothing is sent and the find fails, its failure naming the photo
 * when the find holds more than one (`photo <n>: <detail>`, which `messages.ts` reads). For the
 * count above, a find counts as one whose photos do not load when any of them does not, and a
 * find whose photos all load, or a text find without photos, ends it: in a run, the photos after
 * one that loaded but failed are still prepared, until one does not load, so that the count knows.
 *
 * A run also takes an analysed find whose photos added since its answer wait (its batch complete:
 * the store's pick). It keeps its answer whatever comes of the new analysis. An error class that
 * leaves a find waiting leaves the photos waiting; so does a missing key (a find waits without
 * one, SPEC 3.2) and the stop of two failed loads in a row (3.3's row: "stays waiting"). Any other
 * class marks them not yet analysed, and they are analysed only when the user asks; from the
 * find's screen, then, a pause or a stop that leaves them waiting puts them back to waiting.
 *
 * An unsaved lookup is sent from its screen, a text (`analyseLookup`) or photos
 * (`analysePhotoLookup`, PBI-2.13): nothing of it is stored, and each error class has the outcome
 * it has for a find analysed from its screen.
 *
 * A text answer's representative picture (docs/SPEC.md 3.9; PBI-2.9): when an answer stored, in a
 * run or from the find's screen, is from the text alone and names a species (the store then starts
 * its self-check, waiting), the picture is fetched at once, before the next find, by the answer's
 * Latin name and for the model in use, and stored with its credit, apart from the photos; with no
 * picture for the answer, the check is stored as having none. A picture that waits (no network,
 * the time limit, a 429 or a 5xx from Wikimedia) is left to the next run, which the store's pick
 * takes the find for (after its photos added since, which come first); in a run it ends the run, as
 * a find that waits does (3.4, and 3.9: "a check that waits for want of a network or a fault on …
 * Wikimedia's side ends the run"), with its pause, and no request goes to Wikimedia before its
 * `Retry-After` (3.9, Fetching it). A run asks a find's picture once at most, so a store that
 * still gives the find ends the run rather than looping (review of #71). From the find's screen, a
 * picture that waits sets no pause.
 * The fetch's copy is removed once the store has its own. An unsaved lookup's picture is fetched
 * on its screen's asking (`fetchLookupPicture`), and not stored; the screen removes its copy. A
 * picture that cannot be loaded counts neither toward the count of failed loads nor ends it.
 *
 * The self-check (docs/SPEC.md 3.9, "The self-check of a text lookup"; PBI-2.10): once the picture
 * is stored, the check runs at once, before the next find, in the run and from the find's screen
 * alike: a photo lookup on the picture, without the text, through the request of a photo find (the
 * picture prepared for the model in use as a photo is, then sent as "Image 1:"), and the species it
 * names compared with the text answer's (`selfCheckOutcome`). Its answer is stored only as the
 * check's outcome, never as the find's answer. Its error classes fall in the three groups of an
 * unsaved lookup: one that leaves a find waiting leaves the check waiting, and in a run ends the
 * run with its pause, as a find that waits does; one that stops the queue stops it, and the check
 * waits; any other, or a picture that cannot be loaded, decoded or sized or fails the segment
 * check, fails the check. A check picture that cannot be loaded neither counts toward the count of
 * failed loads nor ends it. The store's pick takes a find whose check waits, oldest first among the
 * waiting finds; a run asks a find's picture and check once at most, as for the picture alone. A
 * check still waiting on a find that got photos since its answer is not run: the analysis of those
 * photos with the text is to replace the answer, and the check with it (the backlog note on
 * PBI-2.10). An unsaved lookup's check runs on its screen's asking (`checkLookupPicture`), on the
 * picture shown, and nothing of it is stored.
 */

import type { AnalysisCallResult, AnalysisInput } from "../analysis/analyse";
import type { Answer, SpeciesNames } from "../analysis/answer";
import type { AnalysisError } from "../analysis/errors";
import { selfCheckOutcome } from "../analysis/selfCheck";
import { config } from "../config/config";
import type { PreparedPhoto } from "../image/prepareForAnalysis";
import type { ReadKeyResult } from "../key/apiKey";
import type { PictureFetch } from "../picture/fetchPicture";
import {
  type AnalysisSent,
  type FindFailure,
  type SelfCheckOutcome,
  type StoredFind,
  StoreError,
} from "../store/find";
import type { FindStore, LookupStore } from "../store/findStore";

/**
 * Why the finds wait after a run: no network, the time limit passed, a fault on Anthropic's side,
 * or a representative picture that waits for Wikimedia (a 429, a 5xx, its time limit; PBI-2.9).
 */
export type PauseCause = "network" | "time-out" | "server" | "picture-source";

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
 * What an unsaved lookup's self-check came to on its screen (docs/SPEC.md 3.9): its outcome
 * (agreed, disagreed, no species, or failed), or the notice it waits with: a pause, or the stop
 * of the queue, a missing key's too.
 */
export type CheckLookupResult =
  | { ok: true; outcome: SelfCheckOutcome }
  | { ok: false; notice: Extract<QueueNotice, { kind: "paused" | "stopped" }> };

/**
 * The part of the find log the queue uses. It reads a find as `getStored` does, so that a text
 * find without photos, which Phase 1's `get` cannot show, is analysed (PBI-2.4).
 */
export type QueueLog = Pick<
  FindStore,
  "oldestWaiting" | "setAnswer" | "replaceAnswer" | "markFailed" | "markWaiting"
> &
  Pick<LookupStore, "getStored" | "setAddedPhotos" | "setPicture" | "setSelfCheck">;

export interface QueueDeps {
  findLog: () => Promise<QueueLog>;
  /** The key, read only once the first-start clearing has run. */
  readKey: () => Promise<ReadKeyResult>;
  /** The model ID in use. */
  readModelId: () => Promise<string>;
  /** A photo for analysis, prepared for the model in use (`preparePhotoForAnalysis`). */
  preparePhoto: (photoUri: string, modelId: string) => Promise<PreparedPhoto>;
  /** Sends the photos or the text once (`analysePhoto`). */
  analyse: (input: AnalysisInput) => Promise<AnalysisCallResult>;
  /** The current time in ms since the epoch. */
  now: () => number;
  /** Runs `task` after `delayMs`; gives a function that cancels it. */
  schedule: (task: () => void, delayMs: number) => () => void;
  /**
   * A species' representative picture, by its Latin name, for the model in use (`fetchPicture`,
   * docs/SPEC.md 3.9); a picture fetched is in a copy of its own.
   */
  fetchPicture: (latinName: string, modelId: string) => Promise<PictureFetch>;
  /** Removes the copy a fetched picture came in. */
  removePictureCopy: (uri: string) => void;
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
  /**
   * `photosWait`: the photos added since an answer stay waiting, as for a missing key or the stop
   * of two failed loads in a row; otherwise they are marked not yet analysed.
   */
  | { type: "stop"; stop: QueueStop; photosWait: boolean };

/**
 * What a self-check came to (docs/SPEC.md 3.9), by the three groups of its error classes: an
 * outcome to store, a wait, or a stop of the queue; the check waits for either of the last two.
 */
type CheckAttempt =
  | { type: "outcome"; outcome: SelfCheckOutcome }
  | { type: "waits"; cause: PauseCause }
  | { type: "stop"; stop: QueueStop };

/** What preparing a find's photos came to (docs/SPEC.md 3.9, Batches). */
type PreparedPhotos = {
  /** Whether every photo prepared loaded; false once one did not. */
  allLoaded: boolean;
} & ({ ok: true; imagesBase64: string[] } | { ok: false; failure: FindFailure });

/** What one step of a run came to: the next find, none left, or the end of the run. */
type Step = "next" | "none" | "end";

/** The finds in a row in one run whose photos did not load, at which the run stops (PBI-1.25). */
const FAILED_LOADS_THAT_STOP = 2;

/** What a run carries from one find to the next. */
interface RunCount {
  /** The finds in a row, in this run, whose photo did not load. */
  failedLoads: number;
  /**
   * The finds whose picture or check this run has asked for already. The store's pick gives the
   * same find again while its picture or check still waits, so taking one twice ends the run
   * (review of #71).
   */
  selfChecksTried: Set<number>;
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
  /** No request goes to Wikimedia before this time, from its last `Retry-After` (PBI-2.9). */
  private pictureNotBeforeMs: number | null = null;

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
          await this.storeAnswer(log, find, attempt);
          // A picture or a check that waits is left to the queue's next run, and the screen sets
          // no pause; a check that meets a class that stops the queue stops it (docs/SPEC.md 3.9).
          if ((await this.pictureAfterAnswer(log, id)) === null) {
            const check = await this.checkAfterPicture(log, id);
            if (check?.type === "stop") {
              this.setStop(check.stop);
            }
          }
          return { ok: true };
        }
        case "find-failed":
          if (analysed) {
            await this.addedNotAnalysed(log, find);
          } else {
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
          if (attempt.photosWait || !analysed) {
            await this.backToWaiting(log, find);
          } else {
            await this.addedNotAnalysed(log, find);
          }
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
      return lookupResult(attempt, (stop) => this.setStop(stop));
    });
  }

  /**
   * Analyses an unsaved photo lookup at once, from its screen (docs/SPEC.md 3.9, PBI-2.13), as
   * `analyseLookup` does a text: all its photos, given as the app's copies in the order added, are
   * prepared one at a time and sent in one request, and nothing is stored. A photo that cannot be
   * prepared fails the lookup, naming the photo when there are several, as for a find analysed
   * from its screen, which the count of failed loads (PBI-1.25) does not count. No photo, or more
   * than a find holds, is a programming error and rejects with a `RangeError`.
   */
  analysePhotoLookup(photoUris: readonly string[]): Promise<AnalyseLookupResult> {
    if (photoUris.length === 0 || photoUris.length > config.maxPhotosPerFind) {
      return Promise.reject(
        new RangeError(`a photo lookup holds 1 to ${config.maxPhotosPerFind} photos`),
      );
    }
    return this.exclusive(async () => {
      const access = await this.access();
      if (!access.ok) {
        return lookupResult(access.attempt, (stop) => this.setStop(stop));
      }
      const prepared = await this.preparePhotos(photoUris, access.model, false);
      const attempt: Attempt = prepared.ok
        ? await this.send({ imagesBase64: prepared.imagesBase64 }, access)
        : { type: "find-failed", failure: prepared.failure, stop: null };
      return lookupResult(attempt, (stop) => this.setStop(stop));
    });
  }

  /**
   * Fetches an unsaved text lookup's representative picture at once, from its screen (docs/SPEC.md
   * 3.9), also while the queue is stopped, and stores nothing: the screen shows it and removes its
   * copy (`removePictureCopy`). Before Wikimedia's last `Retry-After` it waits without a request.
   * An error that is not Wikimedia's rejects.
   */
  fetchLookupPicture(latinName: string): Promise<PictureFetch> {
    return this.exclusive(() => this.picture(latinName));
  }

  /**
   * Runs an unsaved text lookup's self-check at once, from its screen (docs/SPEC.md 3.9), on the
   * picture shown (`pictureUri`, the app's copy), against the species the answer named
   * (`matched`), also while the queue is stopped, and stores nothing. A class that leaves a find
   * waiting gives its pause and sets none on the queue; one that stops the queue stops it, as does
   * a missing key; either way the check waits, for "Check again". Any other class, or a picture
   * that cannot be prepared, fails the check. An error the queue does not handle rejects.
   */
  checkLookupPicture(pictureUri: string, matched: SpeciesNames): Promise<CheckLookupResult> {
    return this.exclusive(async () => {
      const check = await this.checkPicture(pictureUri, matched);
      switch (check.type) {
        case "outcome":
          return { ok: true, outcome: check.outcome };
        case "waits":
          return { ok: false, notice: { kind: "paused", cause: check.cause } };
        case "stop":
          this.setStop(check.stop);
          return { ok: false, notice: { kind: "stopped", stop: check.stop } };
      }
    });
  }

  /** Removes a copy of a fetched picture, for a screen that showed it. */
  removePictureCopy(uri: string): void {
    this.deps.removePictureCopy(uri);
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
    const count: RunCount = { failedLoads: 0, selfChecksTried: new Set() };
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
    if (find === null) {
      // Deleted since; take the next.
      return "next";
    }
    if (!waitsForTheQueue(find)) {
      // Its picture or its check waits (PBI-2.9, PBI-2.10), or it was analysed from its screen
      // since: take the next. A waiting check the queue would not run, which only a store that
      // judges otherwise gives, goes through the same step, so the run takes it once at most.
      return selfCheckWaits(find) ? this.selfCheckStep(log, find, count) : "next";
    }
    const analysed = find.analysis.state === "done";
    const attempt = await this.attempt(find, count);
    switch (attempt.type) {
      case "answered":
        await this.storeAnswer(log, find, attempt);
        // The run that brings a text answer fetches its picture and runs the check at once,
        // before it takes the next find (docs/SPEC.md 3.9).
        count.selfChecksTried.add(id);
        return this.selfCheckSteps(log, id);
      case "find-failed":
        if (analysed) {
          await this.addedNotAnalysed(log, find);
        } else {
          await log.markFailed(id, attempt.failure);
        }
        if (attempt.stop === null) {
          return "next";
        }
        this.setStop(attempt.stop);
        return "end";
      case "stays-waiting":
        this.setState({ pause: attempt.cause });
        return "end";
      case "stop":
        if (analysed && !attempt.photosWait) {
          await this.addedNotAnalysed(log, find);
        }
        this.setStop(attempt.stop);
        return "end";
    }
  }

  /**
   * Prepares the find's photos and sends them once, with its text when it has one; a text find
   * without photos is sent by its text. Stores nothing. `count` is the run's, or null for a find
   * analysed from its screen.
   */
  private async attempt(find: StoredFind, count: RunCount | null): Promise<Attempt> {
    const access = await this.access();
    if (!access.ok) {
      return access.attempt;
    }
    if (find.photos.length === 0) {
      // A text find without photos ends the count of failed loads (docs/SPEC.md 3.9, Batches).
      if (count !== null) {
        count.failedLoads = 0;
      }
      if (find.text === null) {
        throw new StoreError("corrupt", `find ${find.id} has neither text nor a photo`);
      }
      return this.send({ text: find.text }, access);
    }
    const prepared = await this.preparePhotos(
      find.photos.map((photo) => photo.uri),
      access.model,
      count !== null,
    );
    if (count !== null) {
      count.failedLoads = prepared.allLoaded ? 0 : count.failedLoads + 1;
      if (count.failedLoads >= FAILED_LOADS_THAT_STOP) {
        // Not this photo's fault, most likely: the find stays waiting (PBI-1.25).
        return { type: "stop", stop: { reason: "internal-error" }, photosWait: true };
      }
    }
    if (!prepared.ok) {
      return { type: "find-failed", failure: prepared.failure, stop: null };
    }
    const { imagesBase64 } = prepared;
    return this.send(
      find.text === null ? { imagesBase64 } : { imagesBase64, text: find.text },
      access,
    );
  }

  /**
   * Prepares a find's photos, or an unsaved lookup's, one at a time, in the order added
   * (docs/SPEC.md 3.9, Batches). A photo that cannot be loaded, decoded or sized, or fails the
   * segment check, comes back as a failure naming it; any other error while preparing one is not
   * the photo's and passes through (Clead's decision for PBI-1.21). After a failure nothing is
   * sent, so no more bytes are kept; with `settleLoads` (in a run) the photos after one that loaded
   * are still prepared, until one does not load, so that the count of failed loads knows whether
   * all of them load.
   */
  private async preparePhotos(
    photoUris: readonly string[],
    model: string,
    settleLoads: boolean,
  ): Promise<PreparedPhotos> {
    const imagesBase64: string[] = [];
    let failure: FindFailure | null = null;
    let allLoaded = true;
    for (const [index, uri] of photoUris.entries()) {
      const prepared = await this.deps.preparePhoto(uri, model);
      if (prepared.ok) {
        if (failure === null) {
          imagesBase64.push(prepared.imageBase64);
        }
        continue;
      }
      allLoaded = allLoaded && prepared.loaded;
      failure ??= naming(prepared.failure, index + 1, photoUris.length);
      if (!settleLoads || !allLoaded) {
        break;
      }
    }
    return failure === null
      ? { ok: true, imagesBase64, allLoaded }
      : { ok: false, failure, allLoaded };
  }

  /**
   * A run's step for a find whose picture or check waits: the picture, then the check
   * (`selfCheckSteps`). A find this run has asked a picture or a check for already, which the store
   * still gives, ends the run, so that the run never takes the same find without end; the next run
   * asks again.
   */
  private async selfCheckStep(log: QueueLog, find: StoredFind, count: RunCount): Promise<Step> {
    if (count.selfChecksTried.has(find.id)) {
      return "end";
    }
    count.selfChecksTried.add(find.id);
    return this.selfCheckSteps(log, find.id);
  }

  /**
   * In a run, after a text answer is stored, or for a find whose picture or check waits: fetches
   * and stores the picture when it waits, then runs and stores the check when it waits, at once.
   * A picture or a check that waits ends the run with its pause; a check that stops the queue ends
   * it with the stop (docs/SPEC.md 3.9).
   */
  private async selfCheckSteps(log: QueueLog, id: number): Promise<Step> {
    const pause = await this.pictureAfterAnswer(log, id);
    if (pause !== null) {
      this.setState({ pause });
      return "end";
    }
    const check = await this.checkAfterPicture(log, id);
    switch (check?.type) {
      case undefined:
      case "outcome":
        return "next";
      case "waits":
        this.setState({ pause: check.cause });
        return "end";
      case "stop":
        this.setStop(check.stop);
        return "end";
    }
  }

  /**
   * After the picture is stored: when the find's check waits on it (`pendingCheck`), runs the check
   * and stores its outcome. Gives what the check came to, or null when no check was due. A find
   * deleted or changed meanwhile keeps nothing of it.
   */
  private async checkAfterPicture(log: QueueLog, id: number): Promise<CheckAttempt | null> {
    const find = await log.getStored(id);
    const pending = find === null ? null : pendingCheck(find);
    if (pending === null) {
      return null;
    }
    const check = await this.checkPicture(pending.pictureUri, pending.matched);
    if (check.type === "outcome") {
      try {
        await log.setSelfCheck(id, check.outcome);
      } catch (error) {
        if (!isGone(error)) {
          throw error;
        }
      }
    }
    return check;
  }

  /**
   * The self-check on a picture (docs/SPEC.md 3.9): the picture prepared for the model in use as a
   * photo is for analysis (3.3) and sent alone, as a photo lookup without the text, then the
   * species its answer names compared with `matched`. Stores nothing. A picture that cannot be
   * prepared fails the check without a request, and plays no part in the count of failed loads.
   */
  private async checkPicture(pictureUri: string, matched: SpeciesNames): Promise<CheckAttempt> {
    const access = await this.access();
    if (!access.ok) {
      return checkOf(access.attempt, matched);
    }
    const prepared = await this.deps.preparePhoto(pictureUri, access.model);
    if (!prepared.ok) {
      return { type: "outcome", outcome: { state: "failed" } };
    }
    return checkOf(await this.send({ imagesBase64: [prepared.imageBase64] }, access), matched);
  }

  /**
   * After an answer is stored, or for a find whose picture waits: when the store started a
   * self-check with no picture (an answer from the text alone naming a species), fetches and
   * stores the picture. Gives the pause when the picture waits, or null.
   */
  private async pictureAfterAnswer(log: QueueLog, id: number): Promise<PauseCause | null> {
    const stored = await log.getStored(id);
    return stored !== null && picturePending(stored) ? this.storePicture(log, stored) : null;
  }

  /**
   * Fetches the picture of a find whose check waits for one, and stores it, or that it has none.
   * Gives the pause when it waits, or null. A find deleted or changed meanwhile keeps nothing of
   * it, and the copy is removed all the same.
   */
  private async storePicture(log: QueueLog, find: StoredFind): Promise<PauseCause | null> {
    const { analysis } = find;
    // A waiting check beside an answer that names no species, which only a damaged file holds,
    // has no species to fetch a picture of: it is stored as having none (review of #71, note 2).
    const fetched: PictureFetch =
      analysis.state === "done" && analysis.answer.result === "match"
        ? await this.picture(analysis.answer.names.la)
        : { kind: "none", reason: "answer" };
    switch (fetched.kind) {
      case "picture": {
        const { uri, author, licence, page } = fetched.picture;
        try {
          await log.setPicture(find.id, { sourceUri: uri, author, licence, page });
        } catch (error) {
          if (!isGone(error)) {
            throw error;
          }
        } finally {
          this.deps.removePictureCopy(uri);
        }
        return null;
      }
      case "none":
        try {
          await log.setSelfCheck(find.id, { state: "no-picture" });
        } catch (error) {
          if (!isGone(error)) {
            throw error;
          }
        }
        return null;
      case "waits":
        return fetched.cause;
    }
  }

  /**
   * Fetches a species' picture for the model in use, unless Wikimedia's last `Retry-After` has not
   * passed: then it waits without a request. A wait with a time keeps it for the next fetch.
   */
  private async picture(latinName: string): Promise<PictureFetch> {
    const notBefore = this.pictureNotBeforeMs;
    if (notBefore !== null && this.deps.now() < notBefore) {
      return { kind: "waits", cause: "picture-source", retryAtMs: notBefore };
    }
    const fetched = await this.deps.fetchPicture(latinName, await this.deps.readModelId());
    if (fetched.kind === "waits" && fetched.retryAtMs !== null) {
      this.pictureNotBeforeMs = fetched.retryAtMs;
    }
    return fetched;
  }

  /** Stores an answer, with every photo the analysis sent; a find that had one has it replaced. */
  private async storeAnswer(
    log: QueueLog,
    find: StoredFind,
    attempt: Extract<Attempt, { type: "answered" }>,
  ): Promise<void> {
    const answer = { answer: attempt.answer, model: attempt.model, analysedAtMs: this.deps.now() };
    const sent = sentOf(find);
    await (find.analysis.state === "done"
      ? log.replaceAnswer(find.id, answer, sent)
      : log.setAnswer(find.id, answer, sent));
  }

  /** The key and the model in use, or the stop a missing key brings. */
  private async access(): Promise<
    { ok: true; apiKey: string; model: string } | { ok: false; attempt: Attempt }
  > {
    const key = await this.deps.readKey();
    if (!key.ok || key.key === null) {
      // Nothing was sent: a find, and the photos added since an answer, wait (SPEC 3.2).
      return {
        ok: false,
        attempt: { type: "stop", stop: { reason: "no-key" }, photosWait: true },
      };
    }
    return { ok: true, apiKey: key.key, model: await this.deps.readModelId() };
  }

  /** Sends photos, with or without a text, or a text alone, once; gives what came of it by SPEC 3.3's table. */
  private async send(
    content: { imagesBase64: string[]; text?: string } | { text: string },
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

  /**
   * A failed find the user asked to analyse waits again when it meets a pause or a stop; so do
   * the photos added since an answer that were not yet analysed (docs/SPEC.md 3.9, Batches).
   */
  private async backToWaiting(log: QueueLog, find: StoredFind): Promise<void> {
    if (find.analysis.state === "failed") {
      await log.markWaiting(find.id);
    } else if (find.analysis.state === "done" && find.addedPhotos === "not-analysed") {
      await log.setAddedPhotos(find.id, "waiting");
    }
  }

  /**
   * The photos added since an answer that waited are marked not yet analysed after a failure
   * whose class does not leave a find waiting; they are then analysed only when the user asks.
   */
  private async addedNotAnalysed(log: QueueLog, find: StoredFind): Promise<void> {
    if (find.addedPhotos === "waiting") {
      await log.setAddedPhotos(find.id, "not-analysed");
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

/**
 * Whether the queue's pick of the find still holds when it is read (docs/SPEC.md 3.4, 3.9): a
 * waiting find, or an analysed one whose photos added since its answer wait, its batch complete.
 */
function waitsForTheQueue(find: StoredFind): boolean {
  if (find.batchOpen) {
    return false;
  }
  return (
    find.analysis.state === "waiting" ||
    (find.analysis.state === "done" && find.addedPhotos === "waiting")
  );
}

/**
 * Whether the find's picture waits for the queue (docs/SPEC.md 3.9; PBI-2.9), as the store's pick
 * judges it: an answer with a self-check that waits and no picture, its batch complete. Its photos
 * added since, when they wait, come first (`waitsForTheQueue`).
 */
function picturePending(find: StoredFind): boolean {
  return (
    !find.batchOpen &&
    find.analysis.state === "done" &&
    find.selfCheck?.state === "waiting" &&
    find.picture === null
  );
}

/** An analysed find, its batch complete, whose self-check waits, for its picture or on it. */
function selfCheckWaits(find: StoredFind): boolean {
  return !find.batchOpen && find.analysis.state === "done" && find.selfCheck?.state === "waiting";
}

/**
 * The picture and the species of a find whose self-check waits for the queue (docs/SPEC.md 3.9;
 * PBI-2.10), as the store's pick judges it, or null: an answer naming a species, a check that
 * waits and its picture stored, its batch complete, and no photo on the find. A text find's photos
 * all came after its answer from the text alone, so a check still waiting on a find that holds one
 * is skipped: the analysis of its photos with the text is to replace that answer, and the check
 * with it (the backlog note on PBI-2.10).
 */
function pendingCheck(find: StoredFind): { pictureUri: string; matched: SpeciesNames } | null {
  const { analysis, picture } = find;
  if (
    find.batchOpen ||
    find.photos.length > 0 ||
    analysis.state !== "done" ||
    analysis.answer.result !== "match" ||
    find.selfCheck?.state !== "waiting" ||
    picture === null
  ) {
    return null;
  }
  return { pictureUri: picture.uri, matched: analysis.answer.names };
}

/**
 * What an attempt with the picture comes to for the self-check (docs/SPEC.md 3.9), by the three
 * groups of an unsaved lookup: an answer gives the outcome of its comparison; a class that leaves
 * a find waiting leaves the check waiting; a class that stops the queue (a missing key, and an
 * answer not of the shape, too) stops it; any other fails the check.
 */
function checkOf(attempt: Attempt, matched: SpeciesNames): CheckAttempt {
  switch (attempt.type) {
    case "answered":
      return { type: "outcome", outcome: selfCheckOutcome(matched, attempt.answer) };
    case "find-failed":
      return attempt.stop === null
        ? { type: "outcome", outcome: { state: "failed" } }
        : { type: "stop", stop: attempt.stop };
    case "stays-waiting":
      return { type: "waits", cause: attempt.cause };
    case "stop":
      return { type: "stop", stop: attempt.stop };
  }
}

/** A change that applied to no find: the find was deleted, or its state changed meanwhile. */
function isGone(error: unknown): boolean {
  return (
    error instanceof StoreError && (error.code === "not-found" || error.code === "wrong-state")
  );
}

/**
 * What an analysis of the find sends, so the store knows what the answer saw: all its photos, in
 * the order added, or none for a text find without photos (`attempt`).
 */
function sentOf(find: StoredFind): AnalysisSent {
  return { photoUris: find.photos.map((photo) => photo.uri) };
}

/**
 * What an unsaved lookup's attempt comes to on its screen (docs/SPEC.md 3.9, Lookups), with the
 * screen in the find's place: the answer; or the notice, with the queue stopped (`setStop`) for a
 * class that stops it, a missing key too. A class that leaves a find waiting sets no pause.
 */
function lookupResult(attempt: Attempt, setStop: (stop: QueueStop) => void): AnalyseLookupResult {
  switch (attempt.type) {
    case "answered":
      return { ok: true, answer: attempt.answer, model: attempt.model };
    case "find-failed":
      if (attempt.stop !== null) {
        setStop(attempt.stop);
      }
      return { ok: false, notice: { kind: "find-failed", failure: attempt.failure } };
    case "stays-waiting":
      return { ok: false, notice: { kind: "paused", cause: attempt.cause } };
    case "stop":
      setStop(attempt.stop);
      return { ok: false, notice: { kind: "stopped", stop: attempt.stop } };
  }
}

/**
 * A photo's failure, naming the photo by its number when the find holds more than one
 * (docs/SPEC.md 3.9, Batches): `photo <n>: <detail>`, the form `messages.ts` reads.
 */
function naming(failure: FindFailure, number: number, count: number): FindFailure {
  return count > 1 ? { ...failure, detail: `photo ${number}: ${failure.detail}` } : failure;
}

/** The outcome of SPEC 3.3's table for an error class. */
function outcomeOf(error: AnalysisError, accessResumesAtMs: number | null): Attempt {
  const stop = (reason: QueueStop): Attempt => ({ type: "stop", stop: reason, photosWait: false });
  switch (error.kind) {
    case "stays-waiting":
      return { type: "stays-waiting", cause: error.cause };
    case "rate-limited":
      return stop({ reason: "rate-limited", retryAtMs: error.retryAt, accessResumesAtMs });
    case "key-refused":
      return stop({ reason: error.cause === "not-scoped" ? "key-not-scoped" : "key-refused" });
    case "no-credit":
      return stop({ reason: "no-credit" });
    case "model-unknown":
      return stop({ reason: "model-unknown" });
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
      return stop({ reason: "other", status: error.status });
  }
}
