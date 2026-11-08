import AsyncStorage from "@react-native-async-storage/async-storage";

import { deviceStore } from "./keyValueStore";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("deviceStore", () => {
  it("gives null for a key never written", async () => {
    await expect(deviceStore.getItem("nothing.here")).resolves.toBeNull();
  });

  it("gives back the value written under a key", async () => {
    await deviceStore.setItem("a.key", "a value");
    await expect(deviceStore.getItem("a.key")).resolves.toBe("a value");
  });

  it("writes through to the phone's key-value storage", async () => {
    await deviceStore.setItem("a.key", "a value");
    await expect(AsyncStorage.getItem("a.key")).resolves.toBe("a value");
  });

  it("passes a storage failure on to the caller", async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error("disk full"));
    await expect(deviceStore.getItem("a.key")).rejects.toThrow("disk full");
  });
});
