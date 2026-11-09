/**
 * expo-network in every Jest test (Jest uses a mock beside `node_modules` without `jest.mock`): the
 * phone reports an online network and no change. jest-expo's own stand-in for the native module
 * gives no subscription to remove, so a screen test that mounts the app's queue would fail on
 * unmount. A test of the network watch mocks the module itself.
 *
 * Typed against expo-network's own declarations and type-checked (PBI-1.22), so a change of the
 * library's shape fails `npm run typecheck`. Only types are imported: a value imported from
 * "expo-network" here would be this file.
 */
import type * as Network from "expo-network";

/**
 * The network type, written as one of the enum's string values, so that a misspelt one fails the
 * type check; the cast after it is then only from that value to the enum (PBI-1.26).
 */
const WIFI: `${Network.NetworkStateType}` = "WIFI";

export const getNetworkStateAsync: jest.MockedFunction<typeof Network.getNetworkStateAsync> =
  jest.fn(async () => ({
    type: WIFI as Network.NetworkStateType,
    isConnected: true,
    isInternetReachable: true,
  }));

type AddListener = typeof Network.addNetworkStateListener;

export const addNetworkStateListener: jest.MockedFunction<AddListener> = jest.fn<
  ReturnType<AddListener>,
  Parameters<AddListener>
>(() => ({ remove: jest.fn() }));
