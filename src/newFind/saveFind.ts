/**
 * Saving a new find (docs/SPEC.md 3.1, 3.6): the photo, the time and the position are saved
 * before any analysis, so a find is never lost. No analysis or queue run is started here.
 */

import type { PositionTracker } from "../position/positionTracker";
import type { FindTime, Position } from "../store/find";
import type { FindStore } from "../store/findStore";
import { phoneTimeAt, readPhotoMetadata } from "./photoMetadata";

export interface SaveDeps {
  store: Pick<FindStore, "add" | "setPosition">;
  /** The phone's clock. */
  now: () => Date;
}

export interface CameraFindSaved {
  id: number;
  /**
   * Set when the find was saved without a position while the tracker goes on asking: the fix
   * added to it, or null when none came in time or it could not be added. It never rejects.
   */
  positionLater: Promise<Position | null> | null;
}

/** A photo picked from the gallery: its address and the EXIF the picker gave, if any. */
export interface GalleryPhoto {
  uri: string;
  exif: unknown;
}

/** The moment of saving, with the phone's UTC offset at that moment. */
export function phoneTimeNow(now: Date): FindTime {
  return { takenAtMs: now.getTime(), utcOffsetMinutes: -now.getTimezoneOffset(), source: "saved" };
}

/**
 * Saves a photo from the camera at once, at the moment of saving, with the position the tracker
 * has now. Without one, it hands the tracker the wait for the first fix and adds that fix to the
 * find when it comes. `tracker` is null without the location permission: the find then has no
 * position. When the save fails, the tracker is left running so the save can be tried again.
 */
export async function saveCameraFind(
  photoUri: string,
  tracker: PositionTracker | null,
  deps: SaveDeps,
): Promise<CameraFindSaved> {
  const position = tracker === null ? null : await positionNow(tracker);
  const id = await deps.store.add({ photoUri, time: phoneTimeNow(deps.now()), position });
  if (tracker === null) {
    return { id, positionLater: null };
  }
  if (position !== null) {
    tracker.stop();
    return { id, positionLater: null };
  }
  return { id, positionLater: addFirstFix(id, tracker, deps) };
}

/**
 * Saves a photo from the gallery with the time and position its own metadata holds. Without a
 * time there, the time is that of saving; without a position there, the find has none: the
 * phone's own position is not where a gallery photo was taken.
 */
export async function saveGalleryFind(photo: GalleryPhoto, deps: SaveDeps): Promise<number> {
  const metadata = readPhotoMetadata(photo.exif, phoneTimeAt);
  return deps.store.add({
    photoUri: photo.uri,
    time: metadata.time ?? phoneTimeNow(deps.now()),
    position: metadata.position,
  });
}

async function positionNow(tracker: PositionTracker): Promise<Position | null> {
  try {
    return await tracker.positionNow();
  } catch {
    return null;
  }
}

async function addFirstFix(
  id: number,
  tracker: PositionTracker,
  deps: SaveDeps,
): Promise<Position | null> {
  try {
    const fix = await tracker.firstFix();
    if (fix === null) {
      return null;
    }
    await deps.store.setPosition(id, fix);
    return fix;
  } catch {
    // The find was deleted meanwhile, or the phone's location service failed: the find stays
    // without a position, which it says (docs/SPEC.md 3.6).
    return null;
  } finally {
    tracker.stop();
  }
}
