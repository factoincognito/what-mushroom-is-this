/**
 * Where the find log keeps its data on the phone. The app's backup rules (app.json and
 * `plugins/withBackupRules.js`) exclude these places, and their tests check them against these
 * names.
 */

/** The one find-log database (docs/SPEC.md 3.6), in expo-sqlite's default directory. */
export const DATABASE_NAME = "finds.db";

/** The photos' directory, in the app's document directory. */
export const PHOTO_DIRECTORY = "photos";
