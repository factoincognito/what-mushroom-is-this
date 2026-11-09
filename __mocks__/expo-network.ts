/**
 * expo-network in every Jest test (Jest uses a mock beside `node_modules` without `jest.mock`): the
 * phone reports an online network and no change. jest-expo's own stand-in for the native module
 * gives no subscription to remove, so a screen test that mounts the app's queue would fail on
 * unmount. A test of the network watch mocks the module itself.
 */
export const getNetworkStateAsync = jest.fn(async () => ({
  type: "WIFI",
  isConnected: true,
  isInternetReachable: true,
}));

export const addNetworkStateListener = jest.fn(() => ({ remove: jest.fn() }));
