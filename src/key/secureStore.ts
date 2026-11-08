import * as SecureStore from "expo-secure-store";

import type { SecretStore } from "./apiKey";

/**
 * The phone's secure store (`expo-secure-store`: the Keychain on iOS, the Keystore on Android).
 * A failure is passed on to the caller.
 */
export const deviceSecretStore: SecretStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};
