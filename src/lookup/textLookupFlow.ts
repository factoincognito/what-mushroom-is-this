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
 */

import type { Answer } from "../analysis/answer";
import type { AppConfig } from "../config/config";
import {
  ensurePermission,
  type PermissionAsker,
  type PermissionState,
} from "../newFind/permissions";
import { saveTextFind } from "../newFind/saveFind";
import {
  type LocationSource,
  type PositionTracker,
  startPositionTracker,
} from "../position/positionTracker";
import type { AnalyseLookupResult, QueueNotice } from "../queue/queue";
import type { FindLog } from "../store/findStore";

/** What an unsaved lookup's analysis came to: the answer, a notice, or an error in the app. */
export type TextLookupOutcome =
  | { kind: "answer"; answer: Answer }
  | { kind: "notice"; notice: QueueNotice }
  | { kind: "error" };

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
    this.show({ phase: "analysing", outcome: null, offerSave: false, message: null });
    let outcome: TextLookupOutcome;
    try {
      const result = await this.deps.analyseLookup(text);
      outcome = result.ok
        ? { kind: "answer", answer: result.answer }
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

  /** The screen is gone: stops asking for a position, unless a saved find still waits for a fix. */
  close(): void {
    this.closed = true;
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
