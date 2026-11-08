import * as SecureStore from "expo-secure-store";

import { deviceSecretStore } from "./secureStore";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = jest.mocked(SecureStore);

beforeEach(() => {
  jest.resetAllMocks();
});

describe("deviceSecretStore", () => {
  it("reads from the phone's secure store", async () => {
    mocked.getItemAsync.mockResolvedValueOnce("a value");
    await expect(deviceSecretStore.getItemAsync("a_key")).resolves.toBe("a value");
    expect(mocked.getItemAsync).toHaveBeenCalledWith("a_key");
  });

  it("writes to the phone's secure store", async () => {
    mocked.setItemAsync.mockResolvedValueOnce(undefined);
    await deviceSecretStore.setItemAsync("a_key", "a value");
    expect(mocked.setItemAsync).toHaveBeenCalledWith("a_key", "a value");
  });

  it("deletes from the phone's secure store", async () => {
    mocked.deleteItemAsync.mockResolvedValueOnce(undefined);
    await deviceSecretStore.deleteItemAsync("a_key");
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith("a_key");
  });

  it("passes a failure of the secure store on to the caller", async () => {
    mocked.getItemAsync.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(deviceSecretStore.getItemAsync("a_key")).rejects.toThrow("keychain locked");
  });
});
