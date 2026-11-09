import * as Location from "expo-location";

import { deviceLocationSource, locationPermission } from "./deviceLocation";

jest.mock("expo-location", () => ({
  Accuracy: { Highest: 5 },
  watchPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deviceLocationSource", () => {
  it("watches the position at the highest accuracy, and stops through the subscription", async () => {
    const remove = jest.fn();
    jest.mocked(Location.watchPositionAsync).mockResolvedValue({ remove });
    const onFix = jest.fn();
    const stop = await deviceLocationSource.watch(onFix);
    expect(Location.watchPositionAsync).toHaveBeenCalledWith({ accuracy: 5 }, onFix);
    expect(remove).not.toHaveBeenCalled();
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("passes on a watch that cannot start", async () => {
    jest.mocked(Location.watchPositionAsync).mockRejectedValue(new Error("services off"));
    await expect(deviceLocationSource.watch(jest.fn())).rejects.toThrow("services off");
  });

  it("asks for the last known position no older than the age given", async () => {
    const last = { coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 4 };
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(wrong(last));
    await expect(deviceLocationSource.lastKnown(120_000)).resolves.toBe(last);
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 120_000 });
  });
});

describe("locationPermission", () => {
  it("reads and asks for the foreground location permission only", async () => {
    const granted = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(wrong(granted));
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(wrong(granted));
    await expect(locationPermission.get()).resolves.toBe(granted);
    await expect(locationPermission.request()).resolves.toBe(granted);
  });
});

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}
