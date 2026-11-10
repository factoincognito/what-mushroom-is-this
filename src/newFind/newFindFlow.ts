/**
 * What the New find screen does (docs/SPEC.md 3.1, 3.6, 3.9), kept out of the screen so that it
 * renders nothing: the location permission the first time a find is made, the position asked
 * for from when the camera opens, the camera permission, the camera or the gallery, and the save.
 * The screen shows the `NewFindView` it is given; its tests are those of the screen
 * (`src/__tests__/app/newFind.test.tsx`).
 *
 * The photos are added in a batch (docs/SPEC.md 3.9, Batches; PBI-2.5). On a new photo lookup the
 * first photo saves the find with its batch open, with that photo's time and position, and each
 * photo after it is saved to the find as it is taken or picked, up to `maxPhotosPerFind` in all.
 * Opened for a find (`target` "add", from the find's screen), each photo is saved to that find,
 * with no location asked for: the find keeps its time and position. "Analyse" completes the
 * batch, and so does leaving the screen; the queue does not take the find before. A photo lookup
 * here is always saved (the Save switch of 3.9 is a later item, PBI-2.13).
 */

import type { AppConfig } from "../config/config";
import {
  type LocationSource,
  type PositionTracker,
  startPositionTracker,
} from "../position/positionTracker";
import type { FindLog } from "../store/findStore";
import type { PickResult } from "./devicePicker";
import { ensurePermission, type PermissionAsker, type PermissionState } from "./permissions";
import { type GalleryPhoto, type SaveDeps, saveCameraFind, saveGalleryFind } from "./saveFind";

export type NewFindMessage =
  | "cameraDenied"
  | "cameraBlocked"
  | "pickFailed"
  | "saveFailed"
  | "findUnavailable"
  | "analyseFailed";

export interface NewFindView {
  /**
   * starting: asking for the permissions, or reading the find photos are added to; ready: the
   * camera and gallery buttons; busy: the camera or the gallery is open; saving; saved: a photo
   * was saved to the find.
   */
  phase: "starting" | "ready" | "busy" | "saving" | "saved";
  message: NewFindMessage | null;
  /** The location permission, once known; null when photos are added to a find. */
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
  /** The photos the find holds, this batch's included; 0 before the find has one. */
  photoCount: number;
  /** Whether more photos can be added: the find is known and holds fewer than the most. */
  canAddMore: boolean;
  /** Whether a photo was saved in this batch and the batch is not yet complete. */
  batchOpen: boolean;
  /** Set once "Analyse" completed the batch: the find's ID, whose screen comes next. */
  analysed: number | null;
}

export const INITIAL_VIEW: NewFindView = {
  phase: "starting",
  message: null,
  location: null,
  canRetrySave: false,
  confirming: null,
  photoCount: 0,
  canAddMore: false,
  batchOpen: false,
  analysed: null,
};

/** A new photo lookup, or photos added to a find; `findId` null when the address names none. */
export type NewFindTarget = { kind: "new" } | { kind: "add"; findId: number | null };

export interface NewFindDeps {
  findLog: () => Promise<
    Pick<FindLog, "addWithOpenBatch" | "addPhoto" | "completeBatch" | "getStored" | "setPosition">
  >;
  camera: { permission: PermissionAsker; take: () => Promise<PickResult> };
  gallery: { pick: () => Promise<PickResult> };
  location: { permission: PermissionAsker; source: LocationSource };
  appConfig: Pick<
    AppConfig,
    "lastKnownPositionMaxAgeMs" | "positionFixWaitMs" | "maxPhotosPerFind"
  >;
  now: () => Date;
}

type Pending = { from: "camera"; uri: string } | { from: "gallery"; photo: GalleryPhoto };

export class NewFindFlow {
  private view: NewFindView = INITIAL_VIEW;
  private tracker: PositionTracker | null = null;
  /**
   * Set from the start of the first save of a camera photo, which then owns the tracker (it may
   * wait for a fix after the screen is gone); cleared when that save fails.
   */
  private trackerHandedOff = false;
  private pending: Pending | null = null;
  /** The find the photos are saved to: known from the start when adding, else from the first save. */
  private findId: number | null;
  private started = false;
  private closed = false;
  /** Whether the screen was left during the save under way, so the leave waits for its end. */
  private leaveWaits = false;

  constructor(
    private readonly deps: NewFindDeps,
    private readonly onChange: (view: NewFindView) => void,
    private readonly target: NewFindTarget = { kind: "new" },
  ) {
    this.findId = target.kind === "add" ? target.findId : null;
  }

  /**
   * For a new lookup: asks for the location permission the first time, starts asking for a
   * position, opens the camera. For photos added to a find: reads how many it holds, and opens
   * the camera while it holds fewer than the most.
   */
  async start(): Promise<void> {
    if (this.started || this.closed) {
      return;
    }
    this.started = true;
    if (this.target.kind === "add") {
      await this.startAdding();
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
    this.show({ location, canAddMore: true });
    await this.takePhoto();
  }

  /**
   * Opens the camera. While a photo whose save failed is kept, no new photo is taken: the kept
   * one is saved again or discarded first, so it is never dropped without the user's say. Nor is
   * one taken once the find holds the most photos.
   */
  async takePhoto(): Promise<void> {
    if (this.pending !== null || !this.view.canAddMore) {
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
    if (this.pending !== null || !this.view.canAddMore) {
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

  /**
   * "Analyse": completes the batch, a trigger of the queue (docs/SPEC.md 3.9, Batches); the
   * screen then goes to the find. Only while a batch is open and no photo is kept or being saved.
   */
  async analyse(): Promise<void> {
    const id = this.findId;
    if (id === null || !this.view.batchOpen || this.pending !== null) {
      return;
    }
    this.show({ phase: "saving", message: null });
    try {
      await (await this.deps.findLog()).completeBatch(id);
      this.show({ phase: "ready", batchOpen: false, analysed: id });
    } catch {
      this.show({ phase: "ready", message: "analyseFailed" });
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

  /**
   * The screen is gone: completes the batch still open (leaving the screen completes it, SPEC 3.9;
   * if that fails, the store completes it at the next start), and stops asking for a position,
   * unless a saved find still waits for a fix.
   */
  close(): void {
    this.closed = true;
    if (!this.trackerHandedOff) {
      this.tracker?.stop();
    }
    const id = this.findId;
    if (id !== null && this.view.batchOpen) {
      this.view = { ...this.view, batchOpen: false };
      void this.deps
        .findLog()
        .then((log) => log.completeBatch(id))
        .catch(() => undefined);
    }
  }

  /** Reads the find photos are added to, and opens the camera while it can take more. */
  private async startAdding(): Promise<void> {
    const id = this.findId;
    let count: number | null = null;
    if (id !== null) {
      try {
        const find = await (await this.deps.findLog()).getStored(id);
        count = find === null ? null : find.photos.length;
      } catch {
        // The find cannot be read; no photo is added to it. The error is not shown.
      }
    }
    if (this.closed) {
      return;
    }
    if (count === null) {
      this.show({ phase: "ready", message: "findUnavailable", canAddMore: false });
      return;
    }
    const canAddMore = count < this.deps.appConfig.maxPhotosPerFind;
    this.show({ phase: "ready", photoCount: count, canAddMore });
    if (canAddMore) {
      await this.takePhoto();
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
    const first = this.findId === null;
    // A camera save owns the tracker from its start, before anything is awaited, so that closing
    // the screen meanwhile does not stop it: the find may still need its later fix (SPEC 3.6).
    // Only the first photo of a new find has a position.
    if (first) {
      this.trackerHandedOff = pending.from === "camera";
    }
    this.show({ phase: "saving", message: null, canRetrySave: false, confirming: null });
    try {
      const log = await this.deps.findLog();
      if (first) {
        this.findId = await this.saveFirst(pending, log);
      } else if (this.findId !== null) {
        await log.addPhoto(
          this.findId,
          pending.from === "camera" ? pending.uri : pending.photo.uri,
        );
      }
      this.pending = null;
      this.leaveWaits = false;
      const photoCount = this.view.photoCount + 1;
      this.show({
        phase: "saved",
        photoCount,
        batchOpen: true,
        canAddMore: photoCount < this.deps.appConfig.maxPhotosPerFind,
      });
    } catch {
      // Nothing waits for a fix: the tracker goes back to the screen, for Save again, or stops
      // if the screen has closed meanwhile.
      if (first) {
        this.trackerHandedOff = false;
        if (this.closed) {
          this.tracker?.stop();
        }
      }
      const confirming = this.leaveWaits ? "leave" : null;
      this.leaveWaits = false;
      this.show({ phase: "ready", message: "saveFailed", canRetrySave: true, confirming });
    }
  }

  /** Saves a new find with its first photo, its batch open; gives its ID. */
  private async saveFirst(
    pending: Pending,
    log: Pick<FindLog, "addWithOpenBatch" | "setPosition">,
  ): Promise<number> {
    const deps: SaveDeps = {
      store: {
        add: (find) => log.addWithOpenBatch(find),
        setPosition: (id, position) => log.setPosition(id, position),
      },
      now: this.deps.now,
    };
    if (pending.from === "camera") {
      // saveCameraFind stops the tracker itself unless the find waits for its first fix.
      return (await saveCameraFind(pending.uri, this.tracker, deps)).id;
    }
    const id = await saveGalleryFind(pending.photo, deps);
    this.tracker?.stop();
    return id;
  }

  private show(change: Partial<NewFindView>): void {
    this.view = { ...this.view, ...change };
    if (!this.closed) {
      this.onChange(this.view);
    }
  }
}
