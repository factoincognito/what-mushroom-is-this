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
}

export const INITIAL_VIEW: NewFindView = {
  phase: "starting",
  message: null,
  location: null,
  canRetrySave: false,
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
  /** Set once a save has taken the tracker over, to wait for a fix after the screen is gone. */
  private trackerHandedOff = false;
  private pending: Pending | null = null;
  private started = false;
  private closed = false;

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

  /** The user discards the photo whose save failed; a new photo can then be taken. */
  discardPending(): void {
    this.pending = null;
    this.show({ phase: "ready", message: null, canRetrySave: false });
  }

  /** The screen is gone: stops asking for a position, unless a saved find still waits for a fix. */
  close(): void {
    this.closed = true;
    if (!this.trackerHandedOff) {
      this.tracker?.stop();
    }
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
    this.show({ phase: "saving", message: null, canRetrySave: false });
    try {
      const store = await this.deps.findLog();
      const deps = { store, now: this.deps.now };
      if (pending.from === "camera") {
        const saved = await saveCameraFind(pending.uri, this.tracker, deps);
        this.trackerHandedOff = saved.positionLater !== null;
      } else {
        await saveGalleryFind(pending.photo, deps);
        this.tracker?.stop();
      }
      this.pending = null;
      this.show({ phase: "saved" });
    } catch {
      this.show({ phase: "ready", message: "saveFailed", canRetrySave: true });
    }
  }

  private show(change: Partial<NewFindView>): void {
    this.view = { ...this.view, ...change };
    if (!this.closed) {
      this.onChange(this.view);
    }
  }
}
