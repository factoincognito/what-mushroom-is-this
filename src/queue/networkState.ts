import * as Network from "expo-network";

/**
 * The queue's "network is back" trigger (docs/SPEC.md 3.4, Known unknown 6), through expo-network
 * (its SDK 57 reference, "Network - Expo documentation",
 * https://docs.expo.dev/versions/v57.0.0/sdk/network.md, read 2026-11-09):
 * `getNetworkStateAsync` gives the current state and `addNetworkStateListener` calls back
 * "whenever the network state changes". Of a state, `isConnected` "does not guarantee internet
 * access"; `isInternetReachable` needs, on Android, "validated access" (a Wi-Fi sign-in page that
 * is not passed yet is not), and on iOS "always matches `isConnected`".
 */

/** The part of expo-network the watch uses. */
export interface NetworkSource {
  getNetworkStateAsync(): Promise<unknown>;
  addNetworkStateListener(listener: (state: unknown) => void): { remove(): void };
}

const deviceNetwork: NetworkSource = {
  getNetworkStateAsync: () => Network.getNetworkStateAsync(),
  addNetworkStateListener: (listener) => Network.addNetworkStateListener(listener),
};

/**
 * Whether a reported state is online: the internet reachable when the phone says, otherwise
 * connected. Anything that is not such a state counts as not online; nothing is coerced.
 */
export function isOnline(state: unknown): boolean {
  if (typeof state !== "object" || state === null) {
    return false;
  }
  const reachable: unknown = "isInternetReachable" in state ? state.isInternetReachable : undefined;
  if (typeof reachable === "boolean") {
    return reachable;
  }
  const connected: unknown = "isConnected" in state ? state.isConnected : undefined;
  return connected === true;
}

/**
 * Calls `onBack` each time the network comes back: a change from not online to online. The
 * first state learnt, from the first read or the first change, is only noted. Gives a function
 * that stops the watch.
 */
export function watchNetworkBack(
  onBack: () => void,
  source: NetworkSource = deviceNetwork,
): () => void {
  let online: boolean | null = null;
  let stopped = false;
  const subscription = source.addNetworkStateListener((state) => {
    const now = isOnline(state);
    if (online === false && now && !stopped) {
      onBack();
    }
    online = now;
  });
  source.getNetworkStateAsync().then(
    (state) => {
      if (online === null && !stopped) {
        online = isOnline(state);
      }
    },
    () => undefined,
  );
  return () => {
    stopped = true;
    subscription.remove();
  };
}
