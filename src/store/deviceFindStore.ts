import { openDatabaseAsync } from "expo-sqlite";

import type { FindDatabase } from "./database";
import { createFindStore, type FindStore } from "./findStore";
import { DATABASE_NAME, PHOTO_DIRECTORY } from "./locations";
import { devicePhotoFiles } from "./photoFiles";

/** A photo name: the time in base 36, a hyphen and eight random base-36 digits. */
function newPhotoName(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${Date.now().toString(36)}-${random}`;
}

/** The opening of the find log, once it has started; null before it, and after one that failed. */
let opening: Promise<FindStore> | null = null;

/**
 * The find log on the phone: one store, however often it is asked for (PBI-1.16). It is opened at
 * the first call, which removes the photos no find refers to; a later call gets the same store
 * and removes nothing, so it cannot remove the photo of a find being added. An opening that fails
 * is tried again at the next call.
 */
export function openFindLog(): Promise<FindStore> {
  if (opening === null) {
    opening = open().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

async function open(): Promise<FindStore> {
  const db: FindDatabase = await openDatabaseAsync(DATABASE_NAME);
  return createFindStore(db, devicePhotoFiles(PHOTO_DIRECTORY), { newPhotoName });
}
