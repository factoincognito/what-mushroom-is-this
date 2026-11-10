/**
 * What the text lookup screen does (docs/SPEC.md 3.9, Lookups), kept out of the screen so that it
 * renders nothing: the location permission the first time a lookup screen opens, the position
 * asked for from when it opens, the description, the "Save" switch from its starting value, and
 * then either the save of a find or the analysis of an unsaved lookup on the screen. The screen
 * shows the `TextLookupView` it is given.
 *
 * - A saved lookup (Save on) becomes a find when "Analyse" is tapped or the screen is left with
 *   text entered: its text, the time of saving and the position as for a camera find (3.6). It
 *   then goes through the queue, which the find log's save starts (`QueueProvider`).
 * - An unsaved lookup (Save off) is analysed when "Analyse" is tapped, through the queue's
 *   `analyseLookup`, and nothing of it is stored. A class that leaves a find waiting, and a
 *   missing key, offer to turn Save on. Leaving the screen with an unsaved lookup asks first.
 * - An unsaved lookup's answer that names a species gets its representative picture at once
 *   (docs/SPEC.md 3.9; PBI-2.9), by its Latin name: shown, not stored. A picture that waits, or
 *   whose fetch met an error in the app, offers "Check again". The app's copy is removed when the
 *   answer it belongs to is no longer shown (the text changed, "Analyse" again) or the screen is
 *   left; a picture that comes for an answer no longer shown is removed at once.
 * - Once the picture is shown, its self-check runs at once (docs/SPEC.md 3.9; PBI-2.10), through
 *   the queue's `checkLookupPicture`: shown, not stored. A check that waits (a pause, or a stop of
 *   the queue), or that met an error in the app, offers "Check again", which runs the check alone;
 *   one that failed does not. A check that ends for an answer no longer shown is dropped.
 */

import type { Answer, SpeciesNames } from "../analysis/answer";
import type { AppConfig } from "../config/config";
import {
  ensurePermission,
  type PermissionAsker,
  type PermissionState,
} from "../newFind/permissions";
import { saveTextFind } from "../newFind/saveFind";
import type { FetchedPicture, PictureFetch, PictureWaitCause } from "../picture/fetchPicture";
import {
  type LocationSource,
  type PositionTracker,
  startPositionTracker,
} from "../position/positionTracker";
import type { AnalyseLookupResult, CheckLookupResult, QueueNotice } from "../queue/queue";
import type { SelfCheck, SelfCheckOutcome } from "../store/find";
import type { FindLog } from "../store/findStore";

/** An unsaved lookup's representative picture (docs/SPEC.md 3.9; PBI-2.9). */
export type LookupPicture =
  | { state: "fetching" }
  | { state: "shown"; picture: FetchedPicture }
  /** No picture for the answer: the screen says the edibility could not be checked. */
  | { state: "none" }
  | { state: "waits"; cause: PictureWaitCause }
  /** The fetch met an error in the app, which is not shown. */
  | { state: "error" };

/** An unsaved lookup's self-check on its picture (docs/SPEC.md 3.9; PBI-2.10). */
export type LookupCheck =
  | { state: "checking" }
  | { state: "done"; outcome: SelfCheckOutcome }
  /** It waits: a pause, or the queue stopped; "Check again" runs it again. */
  | { state: "waits"; notice: CheckWaitNotice }
  /** It met an error in the app, which is not shown. */
  | { state: "error" };

/** The notice a self-check waits with. */
export type CheckWaitNotice = Extract<CheckLookupResult, { ok: false }>["notice"];

/**
 * What an unsaved lookup's analysis came to: the answer, with its picture when it names a species
 * (null otherwise) and the check on that picture once it is shown (null before, and without one),
 * a notice, or an error in the app.
 */
export type TextLookupOutcome =
  | { kind: "answer"; answer: Answer; picture: LookupPicture | null; check: LookupCheck | null }
  | { kind: "notice"; notice: QueueNotice }
  | { kind: "error" };

/**
 * The self-check an unsaved lookup's answer is shown with (docs/SPEC.md 3.9): its outcome once it
 * has one; "no picture" when there is none for the answer; waiting while the picture is fetched or
 * waits, and while the check runs, waits or met an error. Null for an outcome that is not an
 * answer naming a species, which has no check.
 */
export function lookupSelfCheck(outcome: TextLookupOutcome | null): SelfCheck | null {
  if (outcome?.kind !== "answer" || outcome.answer.result !== "match") {
    return null;
  }
  if (outcome.picture?.state === "none") {
    return { state: "no-picture" };
  }
  return outcome.check?.state === "done" ? outcome.check.outcome : { state: "waiting" };
}

/**
 * The `maxLength` of the description's text field for a limit of `maxCodePoints` characters. The
 * field counts UTF-16 units, while the counter, `setText` and the store count code points (the
 * configured length; PBI-2.14, note 2), and a code point takes one or two units: so the field gets
 * twice the limit, the most units a text of that length can take, and never stops a text the
 * counter still has room for. What it lets through beyond the limit, `setText` cuts.
 */
export function lookupFieldMaxLength(maxCodePoints: number): number {
  return 2 * maxCodePoints;
}

export interface TextLookupView {
  /**
   * starting: reading the Save setting and asking for the location; ready; analysing: an unsaved
   * lookup is being analysed; saving; saved: the lookup is a find.
   */
  phase: "starting" | "ready" | "analysing" | "saving" | "saved";
  /** The description, at most the configured number of code points. */
  text: string;
  /** The "Save" switch. */
  save: boolean;
  /** The location permission, once known. */
  location: PermissionState | null;
  /** What the last analysis of the unsaved lookup came to; dropped when the text changes. */
  outcome: TextLookupOutcome | null;
  /** Whether the screen offers to turn Save on, so the lookup waits in the queue. */
  offerSave: boolean;
  message: "empty" | "saveFailed" | null;
  /** The question open on the screen before an unsaved lookup is dropped by leaving. */
  confirming: "leave" | null;
  /**
   * The find the lookup became: its ID, and whether "Analyse" saved it (the screen then opens
   * the find) or leaving did (the leave then goes on).
   */
  saved: { id: number; by: "analyse" | "leave" } | null;
  /** Whether leaving the screen is held: text is entered and it is neither saved nor dropped. */
  holdsLeave: boolean;
}

export const INITIAL_TEXT_LOOKUP_VIEW: TextLookupView = {
  phase: "starting",
  text: "",
  save: false,
  location: null,
  outcome: null,
  offerSave: false,
  message: null,
  confirming: null,
  saved: null,
  holdsLeave: false,
};

export interface TextLookupDeps {
  findLog: () => Promise<Pick<FindLog, "addText" | "setPosition">>;
  /** The queue's analysis of an unsaved lookup. */
  analyseLookup: (text: string) => Promise<AnalyseLookupResult>;
  /** The queue's fetch of an unsaved lookup's picture, by the Latin name (`fetchLookupPicture`). */
  fetchPicture: (latinName: string) => Promise<PictureFetch>;
  /** Removes the app's copy of a picture shown. */
  removePictureCopy: (uri: string) => void;
  /** The queue's self-check of the picture shown, against the answer's species. */
  checkPicture: (pictureUri: string, matched: SpeciesNames) => Promise<CheckLookupResult>;
  /** The Save switch's starting value from Settings (`readTextLookupSave`); it never rejects. */
  readSaveSetting: () => Promise<boolean>;
  location: { permission: PermissionAsker; source: LocationSource };
  appConfig: Pick<
    AppConfig,
    "lastKnownPositionMaxAgeMs" | "positionFixWaitMs" | "lookupTextMaxLength"
  >;
  now: () => Date;
}

/**
 * The notices after which a lookup screen offers to turn Save on (docs/SPEC.md 3.9): a class that
 * leaves a find waiting, and a missing key. The photo lookup's flow uses it too (PBI-2.13).
 */
export function offersSave(notice: QueueNotice): boolean {
  return notice.kind === "paused" || (notice.kind === "stopped" && notice.stop.reason === "no-key");
}

export class TextLookupFlow {
  private view: TextLookupView = INITIAL_TEXT_LOOKUP_VIEW;
  private tracker: PositionTracker | null = null;
  /** Set from the start of a save, which then owns the tracker; cleared when the save fails. */
  private trackerHandedOff = false;
  private started = false;
  private closed = false;
  /** The user chose to leave without the unsaved lookup. */
  private discarded = false;
  /** The screen was left during the save under way, so the leave waits for its end. */
  private leaveWaits = false;
  /** Counts the pictures asked for and dropped: a fetch that ends under an older count is stale. */
  private pictureToken = 0;

  constructor(
    private readonly deps: TextLookupDeps,
    private readonly onChange: (view: TextLookupView) => void,
  ) {}

  /** Reads the Save setting, asks for the location the first time, starts asking for a position. */
  async start(): Promise<void> {
    if (this.started || this.closed) {
      return;
    }
    this.started = true;
    const save = await this.deps.readSaveSetting();
    if (this.closed) {
      return;
    }
    const location = await ensurePermission(this.deps.location.permission, {
      askAgainWhenDenied: false,
    });
    if (this.closed) {
      return;
    }
    if (location === "granted") {
      this.tracker = startPositionTracker(this.deps.location.source, {
        lastKnownMaxAgeMs: this.deps.appConfig.lastKnownPositionMaxAgeMs,
        fixWaitMs: this.deps.appConfig.positionFixWaitMs,
        now: () => this.deps.now().getTime(),
      });
    }
    this.show({ phase: "ready", save, location });
  }

  /** The description as typed, cut to the configured number of code points. */
  setText(text: string): void {
    const kept = [...text].slice(0, this.deps.appConfig.lookupTextMaxLength).join("");
    if (kept === this.view.text) {
      return;
    }
    this.dropPicture();
    this.show({ text: kept, outcome: null, offerSave: false, message: null });
  }

  /** The Save switch; it does not change while the lookup is analysed or saved. */
  setSave(on: boolean): void {
    if (this.view.phase !== "ready") {
      return;
    }
    this.show({ save: on, offerSave: on ? false : this.view.offerSave });
  }

  /** The offer after a pause or without a key: turns Save on, so "Analyse" saves the lookup. */
  turnSaveOn(): void {
    this.setSave(true);
  }

  /** "Analyse": saves the lookup as a find when Save is on, and analyses it here when it is off. */
  async analyse(): Promise<void> {
    if (this.view.phase !== "ready") {
      return;
    }
    if (this.view.text.trim().length === 0) {
      this.show({ message: "empty" });
      return;
    }
    if (this.view.save) {
      await this.saveNow("analyse");
      return;
    }
    const { text } = this.view;
    this.dropPicture();
    this.show({ phase: "analysing", outcome: null, offerSave: false, message: null });
    let outcome: TextLookupOutcome;
    try {
      const result = await this.deps.analyseLookup(text);
      outcome = result.ok
        ? {
            kind: "answer",
            answer: result.answer,
            picture: result.answer.result === "match" ? { state: "fetching" } : null,
            check: null,
          }
        : { kind: "notice", notice: result.notice };
    } catch {
      outcome = { kind: "error" };
    }
    // An outcome belongs to the text it was given for.
    const current = this.view.text === text;
    this.show({
      phase: "ready",
      outcome: current ? outcome : null,
      offerSave: current && outcome.kind === "notice" && offersSave(outcome.notice),
    });
    if (current && outcome.kind === "answer" && outcome.picture !== null) {
      await this.fetchPicture();
    }
  }

  /**
   * "Check again" (docs/SPEC.md 3.9): fetches the answer's picture again when it waited, or its
   * fetch met an error in the app, and then checks it; runs the check again on the picture shown
   * when the check waited, or met an error in the app. Does nothing otherwise.
   */
  async checkAgain(): Promise<void> {
    const { outcome } = this.view;
    if (this.view.phase !== "ready" || outcome?.kind !== "answer") {
      return;
    }
    if (outcome.picture?.state === "waits" || outcome.picture?.state === "error") {
      this.show({ outcome: { ...outcome, picture: { state: "fetching" } } });
      await this.fetchPicture();
      return;
    }
    if (
      outcome.answer.result === "match" &&
      outcome.picture?.state === "shown" &&
      (outcome.check?.state === "waits" || outcome.check?.state === "error")
    ) {
      await this.runCheck(outcome.picture.picture.uri, outcome.answer.names);
    }
  }

  /**
   * Fetches the picture of the answer shown, and shows what came of it while it is still shown;
   * a picture shown is then checked at once.
   */
  private async fetchPicture(): Promise<void> {
    const { outcome } = this.view;
    if (outcome?.kind !== "answer" || outcome.answer.result !== "match") {
      return;
    }
    this.pictureToken += 1;
    const token = this.pictureToken;
    let fetched: PictureFetch | null = null;
    let picture: LookupPicture;
    try {
      fetched = await this.deps.fetchPicture(outcome.answer.names.la);
      picture =
        fetched.kind === "picture"
          ? { state: "shown", picture: fetched.picture }
          : fetched.kind === "none"
            ? { state: "none" }
            : { state: "waits", cause: fetched.cause };
    } catch {
      picture = { state: "error" };
    }
    const shown = this.view.outcome;
    if (token !== this.pictureToken || this.closed || shown?.kind !== "answer") {
      // The answer it was for is no longer shown: its copy goes at once.
      if (fetched?.kind === "picture") {
        this.deps.removePictureCopy(fetched.picture.uri);
      }
      return;
    }
    this.show({ outcome: { ...shown, picture } });
    if (picture.state === "shown") {
      await this.runCheck(picture.picture.uri, outcome.answer.names);
    }
  }

  /**
   * Runs the self-check on the picture shown (`pictureUri`), against the species of the answer
   * shown (`matched`; docs/SPEC.md 3.9), and shows what came of it while that answer and picture
   * are still shown.
   */
  private async runCheck(pictureUri: string, matched: SpeciesNames): Promise<void> {
    const token = this.pictureToken;
    this.showCheck({ state: "checking" });
    let check: LookupCheck;
    try {
      const result = await this.deps.checkPicture(pictureUri, matched);
      check = result.ok
        ? { state: "done", outcome: result.outcome }
        : { state: "waits", notice: result.notice };
    } catch {
      check = { state: "error" };
    }
    if (token !== this.pictureToken || this.closed) {
      // The answer and the picture it was for are no longer shown.
      return;
    }
    this.showCheck(check);
  }

  /** Shows the check of the answer shown; an outcome that is not an answer has none. */
  private showCheck(check: LookupCheck): void {
    const { outcome } = this.view;
    if (outcome?.kind === "answer") {
      this.show({ outcome: { ...outcome, check } });
    }
  }

  /** The answer's picture is no longer shown: a fetch under way is stale, and a copy is removed. */
  private dropPicture(): void {
    this.pictureToken += 1;
    const { outcome } = this.view;
    if (outcome?.kind === "answer" && outcome.picture?.state === "shown") {
      this.deps.removePictureCopy(outcome.picture.picture.uri);
    }
  }

  /**
   * The screen is about to be left. With text entered and not yet saved: a saved lookup is saved
   * first and the leave waits for it; an unsaved one asks first. Says whether the leave waits.
   */
  askToLeave(): boolean {
    if (!this.view.holdsLeave) {
      return false;
    }
    if (this.view.phase === "saving") {
      this.leaveWaits = true;
      return true;
    }
    if (this.view.save && this.view.phase === "ready") {
      void this.saveNow("leave");
      return true;
    }
    this.show({ confirming: "leave" });
    return true;
  }

  /** The user answers the leave question by staying. */
  stay(): void {
    this.show({ confirming: null });
  }

  /** The user confirms the leave question: the lookup is dropped, and the leave goes on. */
  discardAndLeave(): boolean {
    if (this.view.confirming !== "leave") {
      return false;
    }
    this.discarded = true;
    this.show({ confirming: null });
    return true;
  }

  /**
   * The screen is gone: stops asking for a position, unless a saved find still waits for a fix,
   * and removes the copy of a picture shown (docs/SPEC.md 3.9).
   */
  close(): void {
    this.closed = true;
    this.dropPicture();
    if (!this.trackerHandedOff) {
      this.tracker?.stop();
    }
  }

  private async saveNow(by: "analyse" | "leave"): Promise<void> {
    // A save owns the tracker from its start, before anything is awaited, so that closing the
    // screen meanwhile does not stop it: the find may still need its later fix (docs/SPEC.md 3.6).
    this.trackerHandedOff = true;
    this.show({ phase: "saving", message: null, confirming: null });
    const leaving = () => {
      const waits = by === "leave" || this.leaveWaits;
      this.leaveWaits = false;
      return waits;
    };
    try {
      const store = await this.deps.findLog();
      const saved = await saveTextFind(this.view.text, this.tracker, {
        store,
        now: this.deps.now,
      });
      this.show({ phase: "saved", saved: { id: saved.id, by: leaving() ? "leave" : "analyse" } });
    } catch {
      this.trackerHandedOff = false;
      if (this.closed) {
        this.tracker?.stop();
      }
      this.show({
        phase: "ready",
        message: "saveFailed",
        confirming: leaving() ? "leave" : null,
      });
    }
  }

  private show(change: Partial<TextLookupView>): void {
    const next = { ...this.view, ...change };
    next.holdsLeave = next.text.trim().length > 0 && next.saved === null && !this.discarded;
    this.view = next;
    if (!this.closed) {
      this.onChange(this.view);
    }
  }
}
