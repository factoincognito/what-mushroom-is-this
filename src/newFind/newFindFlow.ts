/**
 * What the New find screen does (docs/SPEC.md 3.1), kept out of the screen so that it renders
 * nothing: the camera permission, the camera or the gallery, and the save. The phone's position
 * is not taken yet (`saveFind.ts`). The screen shows the `NewFindView` it is given; its tests are
 * those of the screen (`src/__tests__/app/newFind.test.tsx`).
 */

import type { FindStore } from "../store/findStore";
import type { PickResult } from "./devicePicker";
import { ensurePermission, type PermissionAsker } from "./permissions";
import { type GalleryPhoto, saveCameraFind, saveGalleryFind } from "./saveFind";

export type NewFindMessage = "cameraDenied" | "cameraBlocked" | "pickFailed" | "saveFailed";

export interface NewFindView {
  /**
   * starting: asking for the camera; ready: the camera and gallery buttons; busy: the camera or
   * the gallery is open; saving; saved.
   */
  phase: "starting" | "ready" | "busy" | "saving" | "saved";
  message: NewFindMessage | null;
  /** Whether the photo whose save failed can be saved again. */
  canRetrySave: boolean;
}

export const INITIAL_VIEW: NewFindView = {
  phase: "starting",
  message: null,
  canRetrySave: false,
};

export interface NewFindDeps {
  findLog: () => Promise<Pick<FindStore, "add">>;
  camera: { permission: PermissionAsker; take: () => Promise<PickResult> };
  gallery: { pick: () => Promise<PickResult> };
  now: () => Date;
}

type Pending = { from: "camera"; uri: string } | { from: "gallery"; photo: GalleryPhoto };

export class NewFindFlow {
  private view: NewFindView = INITIAL_VIEW;
  private pending: Pending | null = null;
  private started = false;
  private closed = false;

  constructor(
    private readonly deps: NewFindDeps,
    private readonly onChange: (view: NewFindView) => void,
  ) {}

  /** Opens the camera, once. */
  async start(): Promise<void> {
    if (this.started || this.closed) {
      return;
    }
    this.started = true;
    await this.takePhoto();
  }

  async takePhoto(): Promise<void> {
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

  async pickFromGallery(): Promise<void> {
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

  /** The screen is gone: nothing more is shown. A save under way still completes. */
  close(): void {
    this.closed = true;
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
        await saveCameraFind(pending.uri, deps);
      } else {
        await saveGalleryFind(pending.photo, deps);
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
