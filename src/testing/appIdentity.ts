/**
 * The app's identity in app.json, as the tests that check it name it, in one place (PBI-1.29,
 * note 2 on #41): `appName.test.ts` checks that the name decision left it as it was, and
 * `easBuild.test.ts` that the Android build uses it. The app does not import this module.
 */

/**
 * The Android application ID of this app, independent of its name: Clead's decision, left to
 * Clead by Adam, recorded in the product office on 2026-11-09 (#40).
 */
export const APPLICATION_ID = "com.factoincognito.mushroomlog";
