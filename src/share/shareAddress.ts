/**
 * The address a share reaches the app by, and where the router sends it (docs/SPEC.md 3.9, Shared
 * photos; Known unknown 16; PBI-2.21).
 *
 * On Android, expo-sharing (57.0.26, `ShareIntoUtils.kt` and
 * `SharingReactActivityLifecycleListener.kt`, read, not run) keeps the share itself and gives the
 * app's navigation the address `<scheme>://expo-sharing` in its place: as the address the app
 * starts with, when the share starts it, and as a new address when the app runs. The scheme is
 * the one the library's config plugin writes into the string `share_into_scheme`, which is the
 * app's own (`app.json`, `expo.scheme`; `src/__tests__/app/shareConfig.test.ts` checks both).
 *
 * The address only says that there is a share. The photos are read from the library
 * (`ShareSession`), never from the address: nothing of it is carried on to the choice.
 */

/** The route of the choice a share opens. */
export const SHARE_ROUTE = "/share";

const SHARE_ADDRESS = /^what-mushroom-is-this:\/\/expo-sharing\/?(?:[?#].*)?$/;

/**
 * The route for an address from outside the app: the choice for the library's share address,
 * and the address itself, for the router to read, for any other.
 */
export function routeOfSystemPath(path: string): string {
  return SHARE_ADDRESS.test(path) ? SHARE_ROUTE : path;
}
