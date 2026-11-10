/**
 * Saving a new find (docs/SPEC.md 3.1, 3.6): the photo, the time and the position are saved
 * before any analysis, so a find is never lost. No analysis or queue run is started here.
 */

import type { PositionTracker } from "../position/positionTracker";
import type { FindTime, Position } from "../store/find";
import type { FindLog, FindStore } from "../store/findStore";
import { phoneTimeAt, readPhotoMetadata } from "./photoMetadata";

export interface SaveDeps {
  store: Pick<FindStore, "add" | "setPosition">;
  /** The phone's clock. */
  now: () => Date;
}

/** What saving a text find uses (docs/SPEC.md 3.9). */
export interface TextSaveDeps {
  store: Pick<FindLog, "addText" | "setPosition">;
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
 * Saves a text lookup as a find (docs/SPEC.md 3.9): its text, at the moment of saving, with the
 * position taken as for a camera find (`saveCameraFind`), so the first fix after the save is
 * added to it when the tracker had none. When the save fails, the tracker is left running so the
 * save can be tried again.
 */
export async function saveTextFind(
  text: string,
  tracker: PositionTracker | null,
  deps: TextSaveDeps,
): Promise<CameraFindSaved> {
  const position = tracker === null ? null : await positionNow(tracker);
  const id = await deps.store.addText({ text, time: phoneTimeNow(deps.now()), position });
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

/**
 * When and where the first photo of an unsaved photo lookup was taken, kept for the find the
 * lookup becomes if Save is turned on later (docs/SPEC.md 3.9, Lookups: "A lookup saved after its
 * first photo was taken keeps that photo's time and position by the rules of 3.1 and 3.6").
 */
export interface Taken {
  readonly time: FindTime;
  /** The position known when the photo was taken, or the first fix that came since; else null. */
  position(): Position | null;
  /**
   * Set for a camera photo taken without a position, while the tracker goes on asking (3.6): the
   * first fix within the wait, or null. It never rejects.
   */
  readonly later: Promise<Position | null> | null;
}

/**
 * A camera photo taken now, with the position the tracker has now, as `saveCameraFind` saves a
 * find; without one, the tracker's wait for its first fix starts. The tracker is not stopped here:
 * the wait stops it when it settles, and whoever holds the lookup otherwise.
 */
export async function takenByCamera(
  tracker: PositionTracker | null,
  now: () => Date,
): Promise<Taken> {
  const time = phoneTimeNow(now());
  const position = tracker === null ? null : await positionNow(tracker);
  if (tracker === null || position !== null) {
    return { time, position: () => position, later: null };
  }
  let fix: Position | null = null;
  const later = tracker.firstFix().then(
    (first) => {
      fix = first;
      return first;
    },
    () => null,
  );
  return { time, position: () => fix, later };
}

/** A gallery photo, with the time and position its metadata holds, as `saveGalleryFind` saves it. */
export function takenFromGallery(photo: GalleryPhoto, now: () => Date): Taken {
  const metadata = readPhotoMetadata(photo.exif, phoneTimeAt);
  const position = metadata.position;
  return { time: metadata.time ?? phoneTimeNow(now()), position: () => position, later: null };
}

/**
 * Saves a lookup's find with its first photo at that photo's time and position (`Taken`), not the
 * moment of saving. A fix still awaited is added to the find when it comes, as for a camera find.
 */
export async function saveTakenFind(
  photoUri: string,
  taken: Taken,
  deps: SaveDeps,
): Promise<CameraFindSaved> {
  const position = taken.position();
  const id = await deps.store.add({ photoUri, time: taken.time, position });
  if (position !== null || taken.later === null) {
    return { id, positionLater: null };
  }
  const positionLater = taken.later.then(async (fix) => {
    if (fix === null) {
      return null;
    }
    try {
      await deps.store.setPosition(id, fix);
      return fix;
    } catch {
      // The find was deleted meanwhile: it stays without a position (docs/SPEC.md 3.6).
      return null;
    }
  });
  return { id, positionLater };
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
  deps: { store: Pick<FindStore, "setPosition"> },
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
