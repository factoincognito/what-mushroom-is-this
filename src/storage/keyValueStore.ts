import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * A plain, non-secret key-value store of strings. Secrets (the API key) do not go here; they
 * go in the secure store.
 */
export type KeyValueStore = {
  /** The value under the key, or null if there is none. */
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/** The phone's own key-value storage for the app. A failure is passed on to the caller. */
export const deviceStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};
