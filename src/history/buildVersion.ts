import appJson from "../../app.json";

/**
 * The build's version: the `version` of app.json, read from the imported file, whose content the
 * bundler builds into the app (docs/SPEC.md 3.10, item 5). It does not rest on what a build embeds
 * for `expo-constants`.
 */
export const BUILD_VERSION: string = appJson.expo.version;
