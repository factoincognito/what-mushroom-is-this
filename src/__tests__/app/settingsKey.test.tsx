/**
 * The Settings screen's key while the key store cannot be read (PBI-1.17). It lives here, not next
 * to the route, because expo-router makes every file under src/app a route; the other key tests
 * of the screen are in routes.test.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import * as SecureStore from "expo-secure-store";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
/* The layout gives the screens the find log; these tests open none (see routes.test.tsx). */
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn() }));

/** The phone's secure store, in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockSecrets = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecrets.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecrets.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecrets.delete(key);
  }),
}));

const t = STRINGS.en.settings.key;

async function openSettings(): Promise<void> {
  const app = renderRouter("./src/app", { initialUrl: "/settings" });
  await app;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-api03-abc");
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode: "en", languageTag: "en" } as ReturnType<typeof getLocales>[number],
    ]);
});

describe("the Settings screen while the key store cannot be read (PBI-1.17)", () => {
  it("offers Remove, which removes the key and then says that none is saved", async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("keychain locked"));
    await openSettings();
    expect(await screen.findByText(t.unreadable)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: t.remove }));
    expect(await screen.findByText(t.removed)).toBeOnTheScreen();
    expect(screen.getByText(t.none)).toBeOnTheScreen();
    expect(mockSecrets.has(API_KEY_STORE_KEY)).toBe(false);
    expect(screen.queryByRole("button", { name: t.remove })).not.toBeOnTheScreen();
  });

  it("says so when Remove fails, and still offers it", async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("keychain locked"));
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error("keychain locked"));
    await openSettings();
    await fireEvent.press(await screen.findByRole("button", { name: t.remove }));
    expect(await screen.findByText(t.removeFailed)).toBeOnTheScreen();
    expect(screen.getByText(t.unreadable)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.remove })).toBeOnTheScreen();
  });
});
