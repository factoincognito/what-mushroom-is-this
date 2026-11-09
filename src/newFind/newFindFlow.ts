/**
 * What the New find screen does (docs/SPEC.md 3.1, 3.6), kept out of the screen so that it
 * renders nothing: the location permission the first time a find is made, the position asked
 * for from when the camera opens, the camera permission, the camera or the gallery, and the save.
 * The screen shows the `NewFindView` it is given; its tests are those of the screen
 * (`src/__tests__/app/newFind.test.tsx`).
 */

import type { AppConfig } from "../config/config";
import {
  type LocationSource,
  type PositionTracker,
  startPositionTracker,
} from "../position/positionTracker";
import type { FindStore } from "../store/findStore";
import type { PickResult } from "./devicePicker";
import { ensurePermission, type PermissionAsker, type PermissionState } from "./permissions";
import { type GalleryPhoto, saveCameraFind, saveGalleryFind } from "./saveFind";

export type NewFindMessage = "cameraDenied" | "cameraBlocked" | "pickFailed" | "saveFailed";

export interface NewFindView {
  /**
   * starting: asking for the permissions; ready: the camera and gallery buttons; busy: the camera
   * or the gallery is open; saving; saved.
   */
  phase: "starting" | "ready" | "busy" | "saving" | "saved";
  message: NewFindMessage | null;
  /** The location permission, once known. */
  location: PermissionState | null;
  /**
   * Whether a photo whose save failed is kept: it can be saved again or discarded, and no new
   * photo is taken until one of the two.
   */
  canRetrySave: boolean;
  /**
   * The question open on the screen before a kept photo is dropped (docs/SPEC.md 3.1, PBI-1.20):
   * discard: "Discard the photo" was tapped; leave: the screen is being left. Null when none is.
   */
  confirming: "discard" | "leave" | null;
}

export const INITIAL_VIEW: NewFindView = {
  phase: "starting",
  message: null,
  location: null,
  canRetrySave: false,
  confirming: null,
};

export interface NewFindDeps {
  findLog: () => Promise<Pick<FindStore, "add" | "setPosition">>;
  camera: { permission: PermissionAsker; take: () => Promise<PickResult> };
  gallery: { pick: () => Promise<PickResult> };
  location: { permission: PermissionAsker; source: LocationSource };
  appConfig: Pick<AppConfig, "lastKnownPositionMaxAgeMs" | "positionFixWaitMs">;
  now: () => Date;
}

type Pending = { from: "camera"; uri: string } | { from: "gallery"; photo: GalleryPhoto };

export class NewFindFlow {
  private view: NewFindView = INITIAL_VIEW;
  private tracker: PositionTracker | null = null;
  /**
   * Set from the start of a camera save, which then owns the tracker (it may wait for a fix after
   * the screen is gone); cleared when that save fails.
   */
  private trackerHandedOff = false;
  private pending: Pending | null = null;
  private started = false;
  private closed = false;
  /** Whether the screen was left during the save under way, so the leave waits for its end. */
  private leaveWaits = false;

  constructor(
    private readonly deps: NewFindDeps,
    private readonly onChange: (view: NewFindView) => void,
  ) {}

  /** Asks for the location permission the first time, starts asking for a position, opens the camera. */
  async start(): Promise<void> {
    if (this.started || this.closed) {
      return;
    }
    this.started = true;
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
    this.show({ location });
    await this.takePhoto();
  }

  /**
   * Opens the camera. While a photo whose save failed is kept, no new photo is taken: the kept
   * one is saved again or discarded first, so it is never dropped without the user's say.
   */
  async takePhoto(): Promise<void> {
    if (this.pending !== null) {
      return;
    }
    const camera = await ensurePermission(this.deps.camera.permission, {
      askAgainWhenDenied: true,
    });
    if (camera !== "granted") {
      this.show({
        phase: "ready",
        message: camera === "blocked" ? "cameraBlocked" : "cameraDenied",
      });
      return;
    }
    const result = await this.pick(this.deps.camera.take);
    if (result !== null) {
      await this.save({ from: "camera", uri: result.uri });
    }
  }

  /** Opens the gallery; as `takePhoto`, not while a photo whose save failed is kept. */
  async pickFromGallery(): Promise<void> {
    if (this.pending !== null) {
      return;
    }
    const result = await this.pick(this.deps.gallery.pick);
    if (result !== null) {
      await this.save({ from: "gallery", photo: { uri: result.uri, exif: result.exif } });
    }
  }

  async retrySave(): Promise<void> {
    if (this.pending !== null) {
      await this.save(this.pending);
    }
  }

  /** "Discard the photo": asks first, while a photo whose save failed is kept. */
  askToDiscard(): void {
    this.ask("discard");
  }

  /**
   * The screen is about to be left: asks first, while a photo whose save failed is kept. While
   * the photo is being saved, the first save and Save again alike, it asks nothing yet: the leave
   * waits for the save, and is asked once the save fails (Clead's fix 1 on #32). Says whether the
   * leaving waits, for the answer or for the save.
   */
  askToLeave(): boolean {
    if (this.view.phase === "saving") {
      this.leaveWaits = true;
      return true;
    }
    return this.ask("leave");
  }

  /** The user answers the question by keeping the photo. */
  keepPhoto(): void {
    this.show({ confirming: null });
  }

  /**
   * The user confirms the question: the photo whose save failed is dropped, and a new photo can
   * then be taken. Without an open question nothing is dropped. Says whether the photo was.
   */
  discardPending(): boolean {
    if (this.view.confirming === null) {
      return false;
    }
    this.pending = null;
    this.show({ phase: "ready", message: null, canRetrySave: false, confirming: null });
    return true;
  }

  /** The screen is gone: stops asking for a position, unless a saved find still waits for a fix. */
  close(): void {
    this.closed = true;
    if (!this.trackerHandedOff) {
      this.tracker?.stop();
    }
  }

  /** Opens a question, only while a kept photo is offered for Save again. */
  private ask(question: "discard" | "leave"): boolean {
    if (this.pending === null || !this.view.canRetrySave) {
      return false;
    }
    this.show({ confirming: question });
    return true;
  }

  private async pick(
    open: () => Promise<PickResult>,
  ): Promise<{ uri: string; exif: unknown } | null> {
    this.show({ phase: "busy", message: null });
    try {
      const result = await open();
      if (result.kind === "canceled") {
        this.show({ phase: "ready" });
        return null;
      }
      return result;
    } catch {
      this.show({ phase: "ready", message: "pickFailed" });
      return null;
    }
  }

  private async save(pending: Pending): Promise<void> {
    this.pending = pending;
    // A camera save owns the tracker from its start, before anything is awaited, so that closing
    // the screen meanwhile does not stop it: the find may still need its later fix (SPEC 3.6).
    this.trackerHandedOff = pending.from === "camera";
    this.show({ phase: "saving", message: null, canRetrySave: false, confirming: null });
    try {
      const store = await this.deps.findLog();
      const deps = { store, now: this.deps.now };
      if (pending.from === "camera") {
        // saveCameraFind stops the tracker itself unless the find waits for its first fix.
        await saveCameraFind(pending.uri, this.tracker, deps);
      } else {
        await saveGalleryFind(pending.photo, deps);
        this.tracker?.stop();
      }
      this.pending = null;
      this.leaveWaits = false;
      this.show({ phase: "saved" });
    } catch {
      // Nothing waits for a fix: the tracker goes back to the screen, for Save again, or stops
      // if the screen has closed meanwhile.
      this.trackerHandedOff = false;
      if (this.closed) {
        this.tracker?.stop();
      }
      const confirming = this.leaveWaits ? "leave" : null;
      this.leaveWaits = false;
      this.show({ phase: "ready", message: "saveFailed", canRetrySave: true, confirming });
    }
  }

  private show(change: Partial<NewFindView>): void {
    this.view = { ...this.view, ...change };
    if (!this.closed) {
      this.onChange(this.view);
    }
  }
}
