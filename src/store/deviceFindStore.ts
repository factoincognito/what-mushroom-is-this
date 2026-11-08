import { openDatabaseAsync } from "expo-sqlite";

import type { FindDatabase } from "./database";
import { createFindStore, type FindStore } from "./findStore";
import { devicePhotoFiles } from "./photoFiles";

/** The one find-log database (docs/SPEC.md 3.6), in expo-sqlite's default directory. */
const DATABASE_NAME = "finds.db";
/** The photos' directory, in the app's document directory. */
const PHOTO_DIRECTORY = "photos";

/** A photo name: the time in base 36, a hyphen and eight random base-36 digits. */
function newPhotoName(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${Date.now().toString(36)}-${random}`;
}

/** Opens the find log on the phone. Call it once, at start; it removes orphaned photos. */
export async function openFindLog(): Promise<FindStore> {
  const db: FindDatabase = await openDatabaseAsync(DATABASE_NAME);
  return createFindStore(db, devicePhotoFiles(PHOTO_DIRECTORY), { newPhotoName });
}
