/**
 * Saving a new find (docs/SPEC.md 3.1, 3.6): the photo, the time and the position are saved
 * before any analysis, so a find is never lost. No analysis or queue run is started here.
 *
 * The phone's own position is not taken yet: expo-location builds in Google Play services on
 * Android, a vendor SDK that waits for its escalation under the third-party IP policy (the parked
 * PR on feat/pbi-1.6-position). A photo from the camera is saved without a position until then.
 */

import type { FindTime } from "../store/find";
import type { FindStore } from "../store/findStore";
import { phoneTimeAt, readPhotoMetadata } from "./photoMetadata";

export interface SaveDeps {
  store: Pick<FindStore, "add">;
  /** The phone's clock. */
  now: () => Date;
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

/** Saves a photo from the camera at once, at the moment of saving; gives the find's ID. */
export async function saveCameraFind(photoUri: string, deps: SaveDeps): Promise<number> {
  return deps.store.add({ photoUri, time: phoneTimeNow(deps.now()), position: null });
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
