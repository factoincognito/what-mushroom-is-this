/**
 * What the New find screen does (docs/SPEC.md 3.1, 3.6, 3.9), kept out of the screen so that it
 * renders nothing: the location permission the first time a find is made, the position asked
 * for from when the camera opens, the camera permission, the camera or the gallery, and the save.
 * The screen shows the `NewFindView` it is given; its tests are those of the screen
 * (`src/__tests__/app/newFind.test.tsx`, `src/__tests__/app/photoLookup.test.tsx`) and this
 * module's own.
 *
 * The photos are added in a batch (docs/SPEC.md 3.9, Batches; PBI-2.5). On a new photo lookup with
 * Save on, the first photo saves the find with its batch open, with that photo's time and
 * position, and each photo after it is saved to the find as it is taken or picked, up to
 * `maxPhotosPerFind` in all. Opened for a find (`target` "add", from the find's screen), each photo
 * is saved to that find, with no location asked for and no Save switch: the find keeps its time
 * and position. "Analyse" completes the batch, and so does leaving the screen; the queue does not
 * take the find before.
 *
 * The "Save" switch of a new photo lookup (docs/SPEC.md 3.9, Lookups; PBI-2.13) starts from its
 * starting value in Settings. With Save off, the lookup is unsaved: its photos are held on the
 * screen only, the first with its time and position (`Taken`), and "Analyse" sends them through the
 * queue's `analysePhotoLookup`, the answer or the notice shown here; a class that leaves a find
 * waiting, and a missing key, offer to turn Save on. Turning Save on saves the lookup as one find
 * with its photos, in one open batch, with the first photo's time and position. Once the lookup is
 * a find, the switch cannot change. Leaving the screen with an unsaved lookup asks first; the
 * app's copies of its photos are removed when the screen is left without a find made.
 */

import type { Answer } from "../analysis/answer";
import type { AppConfig } from "../config/config";
import { offersSave } from "../lookup/textLookupFlow";
import {
  type LocationSource,
  type PositionTracker,
  startPositionTracker,
} from "../position/positionTracker";
import type { AnalyseLookupResult, QueueNotice } from "../queue/queue";
import type { FindLog } from "../store/findStore";
import type { PickResult } from "./devicePicker";
import { ensurePermission, type PermissionAsker, type PermissionState } from "./permissions";
import {
  type GalleryPhoto,
  type SaveDeps,
  saveCameraFind,
  saveGalleryFind,
  saveTakenFind,
  type Taken,
  takenByCamera,
  takenFromGallery,
} from "./saveFind";

export type NewFindMessage =
  | "cameraDenied"
  | "cameraBlocked"
  | "pickFailed"
  | "saveFailed"
  | "findUnavailable"
  | "analyseFailed";

/** What an unsaved lookup's analysis came to: the answer, a notice, or an error in the app. */
export type PhotoLookupOutcome =
  | { kind: "answer"; answer: Answer }
  | { kind: "notice"; notice: QueueNotice }
  | { kind: "error" };

export interface NewFindView {
  /**
   * starting: asking for the permissions, or reading the find photos are added to; ready: the
   * camera and gallery buttons; busy: the camera or the gallery is open; saving; saved: a photo
   * was saved to the find; analysing: an unsaved lookup is being analysed.
   */
  phase: "starting" | "ready" | "busy" | "saving" | "saved" | "analysing";
  message: NewFindMessage | null;
  /** The location permission, once known; null when photos are added to a find. */
  location: PermissionState | null;
  /**
   * Whether photos whose save failed are kept (`kept`): they can be saved again or discarded, and
   * no new photo is taken until one of the two.
   */
  canRetrySave: boolean;
  /**
   * The question open on the screen (docs/SPEC.md 3.1, 3.9, PBI-1.20): discard: "Discard the
   * photo" was tapped; leave: the screen is being left while photos are kept; leaveLookup: it is
   * being left with an unsaved lookup. Null when none is.
   */
  confirming: "discard" | "leave" | "leaveLookup" | null;
  /** The photos the find holds, this batch's included; 0 before the find has one. */
  photoCount: number;
  /** Whether more photos can be added: the find is known and holds fewer than the most. */
  canAddMore: boolean;
  /** Whether a photo was saved in this batch and the batch is not yet complete. */
  batchOpen: boolean;
  /** Set once "Analyse" completed the batch: the find's ID, whose screen comes next. */
  analysed: number | null;
  /**
   * The "Save" switch of a new photo lookup: whether it is on, and whether it can change now (not
   * once the lookup is a find, nor while photos are kept, the lookup is busy or a question is
   * open). Null when photos are added to a find.
   */
  save: { on: boolean; changeable: boolean } | null;
  /** The photos an unsaved lookup holds on the screen. */
  held: number;
  /** The photos whose save failed and that are kept, for Save again or Discard. */
  kept: number;
  /** What the last analysis of the unsaved lookup came to; dropped when its photos change. */
  outcome: PhotoLookupOutcome | null;
  /** Whether the screen offers to turn Save on, so the lookup waits in the queue. */
  offerSave: boolean;
  /**
   * Whether leaving the screen is held: photos are kept or being saved, or an unsaved lookup holds
   * photos and the user has not chosen to drop it.
   */
  holdsLeave: boolean;
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
  save: null,
  held: 0,
  kept: 0,
  outcome: null,
  offerSave: false,
  holdsLeave: false,
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
  /** The Save switch's starting value from Settings (`readPhotoLookupSave`); it never rejects. */
  readSaveSetting: () => Promise<boolean>;
  /** The queue's analysis of an unsaved photo lookup (`analysePhotoLookup`). */
  analyseLookup: (photoUris: readonly string[]) => Promise<AnalyseLookupResult>;
  /** Removes the app's copy of a photo the camera or the gallery gave (`removePickedCopy`). */
  removeCopy: (uri: string) => void;
  appConfig: Pick<
    AppConfig,
    "lastKnownPositionMaxAgeMs" | "positionFixWaitMs" | "maxPhotosPerFind"
  >;
  now: () => Date;
}

/**
 * A photo to save: from the camera or the gallery, or held by an unsaved lookup when Save was
 * turned on, the first with its time and position (`taken`), the others without.
 */
type Pending =
  | { from: "camera"; uri: string }
  | { from: "gallery"; photo: GalleryPhoto }
  | { from: "held"; uri: string; taken: Taken | null };

/** A photo an unsaved lookup holds: the first with its time and position, the others without. */
interface Held {
  uri: string;
  taken: Taken | null;
}

export class NewFindFlow {
  private view: NewFindView = INITIAL_VIEW;
  private tracker: PositionTracker | null = null;
  /**
   * Set from the start of the first save of a photo that may wait for its fix, which then owns the
   * tracker (it may wait for a fix after the screen is gone); cleared when that save fails.
   */
  private trackerHandedOff = false;
  /** The photos being saved, or kept after a failed save, in order. */
  private pending: Pending[] = [];
  /** The photos an unsaved lookup holds, in order. */
  private held: Held[] = [];
  /** Counts the changes of `held`, so that an analysis's outcome is shown only for its photos. */
  private heldVersion = 0;
  /** The app's copies of the photos taken or picked while the lookup was unsaved. */
  private readonly unsavedCopies: string[] = [];
  /** Whether Save is on; read from Settings when a new lookup starts. */
  private saveOn = true;
  /** The find the photos are saved to: known from the start when adding, else from the first save. */
  private findId: number | null;
  private started = false;
  private closed = false;
  /** Whether the screen was left during the save under way, so the leave waits for its end. */
  private leaveWaits = false;
  /** The user chose to leave without the unsaved lookup. */
  private discarded = false;

  constructor(
    private readonly deps: NewFindDeps,
    private readonly onChange: (view: NewFindView) => void,
    private readonly target: NewFindTarget = { kind: "new" },
  ) {
    this.findId = target.kind === "add" ? target.findId : null;
  }

  /**
   * For a new lookup: reads the Save switch's starting value, asks for the location permission
   * the first time, starts asking for a position (with Save on or off, SPEC 3.9), opens the
   * camera. For photos added to a find: reads how many it holds, and opens the camera while it
   * holds fewer than the most.
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
    this.saveOn = await this.deps.readSaveSetting();
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
    this.show({ location, canAddMore: true });
    await this.takePhoto();
  }

  /**
   * Opens the camera. While photos whose save failed are kept, no new photo is taken: the kept
   * ones are saved again or discarded first, so they are never dropped without the user's say.
   * Nor is one taken once the find, or the unsaved lookup, holds the most photos, or while the
   * unsaved lookup is analysed.
   */
  async takePhoto(): Promise<void> {
    if (!this.canTake()) {
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
      await this.receive({ from: "camera", uri: result.uri });
    }
  }

  /** Opens the gallery; as `takePhoto`, not while photos whose save failed are kept. */
  async pickFromGallery(): Promise<void> {
    if (!this.canTake()) {
      return;
    }
    const result = await this.pick(this.deps.gallery.pick);
    if (result !== null) {
      await this.receive({ from: "gallery", photo: { uri: result.uri, exif: result.exif } });
    }
  }

  async retrySave(): Promise<void> {
    if (this.pending.length > 0) {
      await this.save();
    }
  }

  /**
   * The "Save" switch (docs/SPEC.md 3.9, Lookups), only while it can change. Turned on while the
   * unsaved lookup holds photos, it saves the lookup as one find with them, in one open batch,
   * with the first photo's time and position; photos whose save fails are kept, as any photo's.
   */
  async setSave(on: boolean): Promise<void> {
    if (this.view.save?.changeable !== true || on === this.saveOn) {
      return;
    }
    this.saveOn = on;
    if (!on || this.held.length === 0) {
      this.show({ offerSave: false });
      return;
    }
    this.pending = this.held.map((photo) => ({ from: "held", uri: photo.uri, taken: photo.taken }));
    this.held = [];
    this.heldVersion += 1;
    this.show({ outcome: null, offerSave: false });
    await this.save();
  }

  /** The offer after a pause or without a key: turns Save on, which saves the lookup as a find. */
  turnSaveOn(): Promise<void> {
    return this.setSave(true);
  }

  /**
   * "Analyse". On an unsaved lookup: sends its photos for analysis here, and shows what came of
   * it. On a saved one: completes the batch, a trigger of the queue (docs/SPEC.md 3.9, Batches);
   * the screen then goes to the find. Only while a batch is open and no photo is kept or being
   * saved.
   */
  async analyse(): Promise<void> {
    if (this.unsaved()) {
      await this.analyseHeld();
      return;
    }
    const id = this.findId;
    if (id === null || !this.view.batchOpen || this.pending.length > 0) {
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

  /** "Discard the photo": asks first, while photos whose save failed are kept. */
  askToDiscard(): void {
    this.ask("discard");
  }

  /**
   * The screen is about to be left: asks first, while photos whose save failed are kept, or while
   * an unsaved lookup holds photos (docs/SPEC.md 3.9). While a photo is being saved, the first save
   * and Save again alike, it asks nothing yet: the leave waits for the save, and is asked once the
   * save fails (Clead's fix 1 on #32). Says whether the leaving waits, for the answer or the save.
   */
  askToLeave(): boolean {
    if (this.view.phase === "saving") {
      this.leaveWaits = true;
      return true;
    }
    if (this.ask("leave")) {
      return true;
    }
    if (this.held.length > 0 && !this.discarded) {
      this.show({ confirming: "leaveLookup" });
      return true;
    }
    return false;
  }

  /** The user answers the question by keeping the photos, or the lookup. */
  keepPhoto(): void {
    this.show({ confirming: null });
  }

  /**
   * The user confirms the question: the photos whose save failed are dropped, and a new photo can
   * then be taken; or, leaving an unsaved lookup, the lookup is dropped and the leave goes on.
   * Without an open question nothing is dropped. Says whether anything was.
   */
  discardPending(): boolean {
    if (this.view.confirming === null) {
      return false;
    }
    if (this.view.confirming === "leaveLookup") {
      this.discarded = true;
      this.show({ confirming: null });
      return true;
    }
    this.pending = [];
    this.show({ phase: "ready", message: null, canRetrySave: false, confirming: null });
    return true;
  }

  /**
   * The screen is gone: completes the batch still open (leaving the screen completes it, SPEC 3.9;
   * if that fails, the store completes it at the next start), and stops asking for a position,
   * unless a saved find still waits for a fix. With no find made, the app's copies of the photos
   * taken or picked while the lookup was unsaved are removed (SPEC 3.9, Lookups).
   */
  close(): void {
    this.closed = true;
    if (!this.trackerHandedOff) {
      this.tracker?.stop();
    }
    const id = this.findId;
    if (id === null) {
      for (const uri of this.unsavedCopies) {
        this.deps.removeCopy(uri);
      }
    }
    if (id !== null && this.view.batchOpen) {
      this.view = { ...this.view, batchOpen: false };
      void this.deps
        .findLog()
        .then((log) => log.completeBatch(id))
        .catch(() => undefined);
    }
  }

  /** Whether the lookup is unsaved: a new photo lookup with Save off. */
  private unsaved(): boolean {
    return this.target.kind === "new" && !this.saveOn;
  }

  /** Whether a photo can be taken or picked now. */
  private canTake(): boolean {
    return this.pending.length === 0 && this.view.canAddMore && this.view.phase !== "analysing";
  }

  /** A photo from the camera or the gallery: held by an unsaved lookup, else saved to the find. */
  private async receive(photo: Pending): Promise<void> {
    if (this.unsaved()) {
      await this.hold(photo);
      return;
    }
    this.pending = [photo];
    await this.save();
  }

  /**
   * Holds a photo on the screen for the unsaved lookup, the first with its time and position, as
   * the find the lookup may become would have them (docs/SPEC.md 3.9). An answer shown is
   * dropped, as it is not of the photos the lookup now holds.
   */
  private async hold(photo: Pending): Promise<void> {
    const uri = uriOf(photo);
    let taken: Taken | null = null;
    if (this.held.length === 0) {
      taken =
        photo.from === "gallery"
          ? takenFromGallery(photo.photo, this.deps.now)
          : await takenByCamera(this.tracker, this.deps.now);
    }
    if (this.closed) {
      // The screen was left while the photo came: nothing holds it.
      this.deps.removeCopy(uri);
      return;
    }
    this.unsavedCopies.push(uri);
    this.held.push({ uri, taken });
    this.heldVersion += 1;
    this.show({
      phase: "ready",
      message: null,
      outcome: null,
      offerSave: false,
      canAddMore: this.held.length < this.deps.appConfig.maxPhotosPerFind,
    });
  }

  /** Sends the unsaved lookup's photos for analysis, and shows what came of it. */
  private async analyseHeld(): Promise<void> {
    if (this.held.length === 0 || this.view.phase !== "ready" || this.view.confirming !== null) {
      return;
    }
    const version = this.heldVersion;
    this.show({ phase: "analysing", outcome: null, offerSave: false, message: null });
    let outcome: PhotoLookupOutcome;
    try {
      const result = await this.deps.analyseLookup(this.held.map((photo) => photo.uri));
      outcome = result.ok
        ? { kind: "answer", answer: result.answer }
        : { kind: "notice", notice: result.notice };
    } catch {
      outcome = { kind: "error" };
    }
    // An outcome belongs to the photos it was given for.
    const current = version === this.heldVersion;
    this.show({
      phase: "ready",
      outcome: current ? outcome : null,
      offerSave: current && outcome.kind === "notice" && offersSave(outcome.notice),
    });
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

  /** Opens a question, only while kept photos are offered for Save again. */
  private ask(question: "discard" | "leave"): boolean {
    if (this.pending.length === 0 || !this.view.canRetrySave) {
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

  /**
   * Saves the pending photos in order: the first of a new find saves the find, the others are
   * added to it. Those not saved when one fails are kept, for Save again or Discard.
   */
  private async save(): Promise<void> {
    const [head] = this.pending;
    if (head === undefined) {
      return;
    }
    const first = this.findId === null;
    // A save that may leave the find waiting for its fix owns the tracker from its start, before
    // anything is awaited, so that closing the screen meanwhile does not stop it (SPEC 3.6). Only
    // the first photo of a new find has a position.
    if (first) {
      this.trackerHandedOff =
        head.from === "camera" || (head.from === "held" && head.taken?.later != null);
    }
    this.show({ phase: "saving", message: null, canRetrySave: false, confirming: null });
    let photoCount = this.view.photoCount;
    try {
      const log = await this.deps.findLog();
      for (let next = this.pending[0]; next !== undefined; next = this.pending[0]) {
        if (this.findId === null) {
          this.findId = await this.saveFirst(next, log);
        } else {
          await log.addPhoto(this.findId, uriOf(next));
        }
        this.pending.shift();
        photoCount += 1;
      }
      this.leaveWaits = false;
      this.show({
        phase: "saved",
        photoCount,
        batchOpen: true,
        canAddMore: photoCount < this.deps.appConfig.maxPhotosPerFind,
      });
    } catch {
      // No find was made, so nothing waits for a fix: the tracker goes back to the screen, for
      // Save again, or stops if the screen has closed meanwhile.
      if (this.findId === null) {
        this.trackerHandedOff = false;
        if (this.closed) {
          this.tracker?.stop();
        }
      }
      const confirming = this.leaveWaits ? "leave" : null;
      this.leaveWaits = false;
      this.show({
        phase: "ready",
        photoCount,
        batchOpen: this.findId !== null,
        message: "saveFailed",
        canRetrySave: true,
        confirming,
      });
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
    switch (pending.from) {
      case "camera":
        // saveCameraFind stops the tracker itself unless the find waits for its first fix.
        return (await saveCameraFind(pending.uri, this.tracker, deps)).id;
      case "gallery": {
        const id = await saveGalleryFind(pending.photo, deps);
        this.tracker?.stop();
        return id;
      }
      case "held": {
        if (pending.taken === null) {
          // Only a lookup's first photo carries its time and position, and it is saved first.
          throw new Error("a lookup's later photo cannot save its find");
        }
        const saved = await saveTakenFind(pending.uri, pending.taken, deps);
        // A fix still awaited stops the tracker when it settles.
        if (saved.positionLater === null) {
          this.tracker?.stop();
        }
        return saved.id;
      }
    }
  }

  private show(change: Partial<NewFindView>): void {
    const next = { ...this.view, ...change };
    next.held = this.held.length;
    next.kept = this.pending.length;
    next.save =
      this.target.kind === "add"
        ? null
        : {
            on: this.saveOn,
            changeable:
              this.findId === null &&
              this.pending.length === 0 &&
              next.phase === "ready" &&
              next.confirming === null,
          };
    next.holdsLeave =
      next.canRetrySave || next.phase === "saving" || (this.held.length > 0 && !this.discarded);
    this.view = next;
    if (!this.closed) {
      this.onChange(this.view);
    }
  }
}

/** The address of a photo to save. */
function uriOf(photo: Pending): string {
  return photo.from === "gallery" ? photo.photo.uri : photo.uri;
}
