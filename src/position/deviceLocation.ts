import * as Location from "expo-location";

import type { PermissionAsker } from "../newFind/permissions";
import type { LocationSource } from "./positionTracker";

/**
 * The phone's location service, through expo-location (its SDK 57 reference, "Location - Expo
 * documentation", https://docs.expo.dev/versions/v57.0.0/sdk/location/, read 2026-11-09):
 * `watchPositionAsync` gives updates only while the app is in the foreground, and
 * `getLastKnownPositionAsync` gives null for a position older than `maxAge`.
 */
export const deviceLocationSource: LocationSource = {
  async watch(onFix) {
    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Highest },
      onFix,
    );
    return () => subscription.remove();
  },

  lastKnown: (maxAgeMs) => Location.getLastKnownPositionAsync({ maxAge: maxAgeMs }),
};

/** The location permission while the app is in use; never the background one. */
export const locationPermission: PermissionAsker = {
  get: () => Location.getForegroundPermissionsAsync(),
  request: () => Location.requestForegroundPermissionsAsync(),
};
