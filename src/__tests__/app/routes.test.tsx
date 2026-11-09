/**
 * Tests of the routes under src/app. They live here, not next to the routes, because
 * expo-router makes every file under src/app a route.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import * as SecureStore from "expo-secure-store";

import { config } from "../../config/config";
import { MODEL_SETTING_KEY } from "../../config/modelSetting";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { LANGUAGE_CHOICE_KEY } from "../../i18n/languageChoice";
import { STRINGS } from "../../i18n/strings";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
/*
 * The layout gives the screens the find log, which opens through expo-sqlite. expo-sqlite imports
 * expo-asset, which npm keeps under expo/node_modules: Metro finds it there (checked with
 * `npx expo export --platform android`), Jest does not. These tests open no find log.
 */
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

const APP_DIR = "./src/app";

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

/** Renders the app at an address, and gives a way to read the current address. */
async function startApp(initialUrl = "/"): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl });
  await app;
  return { pathname: () => app.getPathname() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecrets.clear();
  phoneIn("en");
});

describe("first start", () => {
  it("shows the disclaimer before the Log screen", async () => {
    await startApp();
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.log.empty)).not.toBeOnTheScreen();
  });

  it("shows the disclaimer first even when the app is opened at the Settings address", async () => {
    await startApp("/settings");
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.settings.languageHeading)).not.toBeOnTheScreen();
  });

  it("opens the Log screen once the disclaimer is accepted", async () => {
    const app = await startApp();
    await fireEvent.press(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    );
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    await expect(AsyncStorage.getItem(DISCLAIMER_ACCEPTED_KEY)).resolves.toBe("accepted");
  });
});

describe("the Log screen", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  });

  it("is the start screen, without the disclaimer once it was accepted", async () => {
    const app = await startApp();
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.disclaimer)).not.toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
  });

  it("shows the empty list in the phone's language", async () => {
    phoneIn("sv");
    await startApp();
    expect(await screen.findByText(STRINGS.sv.log.empty)).toBeOnTheScreen();
  });

  it("has New find as an enabled link (where it leads: newFind.test.tsx)", async () => {
    await startApp();
    const newFind = await screen.findByRole("link", { name: STRINGS.en.log.newFind });
    expect(newFind).toBeEnabled();
    expect(screen.queryByRole("button", { name: STRINGS.en.log.newFind })).not.toBeOnTheScreen();
  });

  it("links to the Settings screen", async () => {
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: STRINGS.en.log.settings }));
    expect(await screen.findByText(STRINGS.en.settings.languageHeading)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/settings");
  });
});

describe("the Settings screen", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  });

  it("offers the three languages, each named in itself, with the phone's language chosen", async () => {
    phoneIn("sv");
    await startApp("/settings");
    expect(await screen.findByRole("radio", { name: "Svenska", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "English", checked: false })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "Italiano", checked: false })).toBeOnTheScreen();
  });

  it("chooses English when the phone's language is not one of the three", async () => {
    phoneIn("de");
    await startApp("/settings");
    expect(await screen.findByRole("radio", { name: "English", checked: true })).toBeOnTheScreen();
  });

  it("switches the app to the chosen language, over the phone's", async () => {
    phoneIn("sv");
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("radio", { name: "Italiano" }));
    expect(await screen.findByText(STRINGS.it.settings.languageHeading)).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "Italiano", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "Svenska", checked: false })).toBeOnTheScreen();
  });

  it("keeps the chosen language on the Log screen", async () => {
    phoneIn("sv");
    const app = await startApp();
    await fireEvent.press(await screen.findByRole("link", { name: STRINGS.sv.log.settings }));
    await fireEvent.press(await screen.findByRole("radio", { name: "English" }));
    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe("/");
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
  });

  it("keeps the chosen language across a restart", async () => {
    phoneIn("sv");
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("radio", { name: "Italiano" }));
    await expect(AsyncStorage.getItem(LANGUAGE_CHOICE_KEY)).resolves.toBe("it");
    await screen.unmount();

    await startApp("/settings");
    expect(await screen.findByRole("radio", { name: "Italiano", checked: true })).toBeOnTheScreen();
    expect(screen.getByText(STRINGS.it.settings.languageHeading)).toBeOnTheScreen();
  });
});

describe("the Settings screen: the API key (SPEC 3.2)", () => {
  const A_KEY = "sk-ant-api03-abcDEF_123";
  const t = STRINGS.en.settings.key;

  beforeEach(async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
    await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  });

  async function typeAndSave(raw: string): Promise<void> {
    await fireEvent.changeText(await screen.findByLabelText(t.input), raw);
    await fireEvent.press(screen.getByRole("button", { name: t.save }));
  }

  it("says that no key is saved, and offers no Remove", async () => {
    await startApp("/settings");
    expect(await screen.findByText(t.none)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.remove })).not.toBeOnTheScreen();
  });

  it("saves a pasted key trimmed in the secure store, and never shows it again", async () => {
    await startApp("/settings");
    await typeAndSave(`  ${A_KEY}\n`);
    expect(await screen.findByText(t.saved)).toBeOnTheScreen();
    expect(screen.getByText(t.stored)).toBeOnTheScreen();
    expect(mockSecrets.get(API_KEY_STORE_KEY)).toBe(A_KEY);
    expect(screen.getByLabelText(t.input)).toHaveDisplayValue("");
    expect(screen.queryByText(A_KEY, { exact: false })).not.toBeOnTheScreen();
    expect(await AsyncStorage.getAllKeys()).not.toContain(API_KEY_STORE_KEY);
  });

  it("never writes the key's value to the plain store, under any name", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-old-key");
    const plain = jest.mocked(AsyncStorage);
    for (const write of [plain.setItem, plain.mergeItem, plain.multiSet, plain.multiMerge]) {
      write.mockClear();
    }
    await startApp("/settings");
    await typeAndSave(`  ${A_KEY}\n`);
    expect(await screen.findByText(t.saved)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: t.remove }));
    expect(await screen.findByText(t.removed)).toBeOnTheScreen();

    const written = JSON.stringify([
      plain.setItem.mock.calls,
      plain.mergeItem.mock.calls,
      plain.multiSet.mock.calls,
      plain.multiMerge.mock.calls,
    ]);
    const held = JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()));
    for (const text of [written, held]) {
      expect(text).not.toContain(A_KEY);
      expect(text).not.toContain("sk-ant-old-key");
    }
  });

  it("hides the key as it is typed", async () => {
    await startApp("/settings");
    expect(await screen.findByLabelText(t.input)).toHaveProp("secureTextEntry", true);
  });

  it("does not save an empty key, and says so", async () => {
    await startApp("/settings");
    await typeAndSave(" \n ");
    expect(await screen.findByText(t.empty)).toBeOnTheScreen();
    expect(mockSecrets.has(API_KEY_STORE_KEY)).toBe(false);
    expect(screen.getByText(t.none)).toBeOnTheScreen();
  });

  it("does not save a key the analysis module would refuse to send, and says so", async () => {
    await startApp("/settings");
    await typeAndSave("sk-ant-​api03");
    expect(await screen.findByText(t.notSendable)).toBeOnTheScreen();
    expect(mockSecrets.has(API_KEY_STORE_KEY)).toBe(false);
  });

  it("says so when the secure store cannot save the key", async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("keychain locked"));
    await startApp("/settings");
    await typeAndSave(A_KEY);
    expect(await screen.findByText(t.saveFailed)).toBeOnTheScreen();
    expect(screen.getByText(t.none)).toBeOnTheScreen();
  });

  it("replaces a saved key", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-old");
    await startApp("/settings");
    expect(await screen.findByText(t.stored)).toBeOnTheScreen();
    await typeAndSave(A_KEY);
    expect(await screen.findByText(t.saved)).toBeOnTheScreen();
    expect(mockSecrets.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it("removes a saved key", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, A_KEY);
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("button", { name: t.remove }));
    expect(await screen.findByText(t.removed)).toBeOnTheScreen();
    expect(screen.getByText(t.none)).toBeOnTheScreen();
    expect(mockSecrets.has(API_KEY_STORE_KEY)).toBe(false);
  });

  it("says so when the key cannot be removed", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, A_KEY);
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error("keychain locked"));
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("button", { name: t.remove }));
    expect(await screen.findByText(t.removeFailed)).toBeOnTheScreen();
    expect(screen.getByText(t.stored)).toBeOnTheScreen();
  });

  it("says so when the secure store cannot be read", async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("keychain locked"));
    await startApp("/settings");
    expect(await screen.findByText(t.unreadable)).toBeOnTheScreen();
  });

  it("shows the key's texts in the chosen language", async () => {
    phoneIn("sv");
    await startApp("/settings");
    expect(await screen.findByText(STRINGS.sv.settings.key.none)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Italiano" }));
    expect(await screen.findByText(STRINGS.it.settings.key.none)).toBeOnTheScreen();
  });
});

describe("the first start after an install (SPEC 3.2)", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  });

  it("clears a key the secure store kept from an earlier install", async () => {
    mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-from-before");
    await startApp("/settings");
    expect(await screen.findByText(STRINGS.en.settings.key.none)).toBeOnTheScreen();
    expect(mockSecrets.has(API_KEY_STORE_KEY)).toBe(false);
    await expect(AsyncStorage.getItem(INSTALL_MARKER_KEY)).resolves.toBe("installed");
  });

  it("keeps the key at the next start", async () => {
    await startApp("/settings");
    await fireEvent.changeText(
      await screen.findByLabelText(STRINGS.en.settings.key.input),
      "sk-ant-kept",
    );
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.settings.key.save }));
    expect(await screen.findByText(STRINGS.en.settings.key.saved)).toBeOnTheScreen();
    await screen.unmount();

    await startApp("/settings");
    expect(await screen.findByText(STRINGS.en.settings.key.stored)).toBeOnTheScreen();
    expect(mockSecrets.get(API_KEY_STORE_KEY)).toBe("sk-ant-kept");
  });
});

describe("the Settings screen: the model (SPEC 3.3)", () => {
  const t = STRINGS.en.settings.model;

  beforeEach(async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
    await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  });

  it("offers the listed models, with the default in use and marked", async () => {
    await startApp("/settings");
    expect(
      await screen.findByRole("radio", { name: config.defaultModelId, checked: true }),
    ).toBeOnTheScreen();
    for (const model of config.models) {
      expect(screen.getByRole("radio", { name: model.id })).toBeOnTheScreen();
    }
    expect(screen.getByTestId("model-in-use")).toHaveTextContent(config.defaultModelId);
    expect(screen.getByText(t.default)).toBeOnTheScreen();
  });

  it("saves a listed model when it is chosen", async () => {
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("radio", { name: "claude-haiku-5-5" }));
    expect(await screen.findByText(t.saved)).toBeOnTheScreen();
    expect(
      screen.getByRole("radio", { name: "claude-haiku-5-5", checked: true }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("model-in-use")).toHaveTextContent("claude-haiku-5-5");
    await expect(AsyncStorage.getItem(MODEL_SETTING_KEY)).resolves.toBe("claude-haiku-5-5");
  });

  it("saves another model ID, trimmed, typed in", async () => {
    await startApp("/settings");
    await fireEvent.changeText(await screen.findByLabelText(t.input), " claude-future-9 ");
    await fireEvent.press(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.saved)).toBeOnTheScreen();
    expect(screen.getByTestId("model-in-use")).toHaveTextContent("claude-future-9");
    expect(screen.queryByRole("radio", { name: config.defaultModelId, checked: true })).toBeNull();
    await expect(AsyncStorage.getItem(MODEL_SETTING_KEY)).resolves.toBe("claude-future-9");
  });

  it("does not save an empty model ID, and says so", async () => {
    await startApp("/settings");
    await fireEvent.changeText(await screen.findByLabelText(t.input), "  ");
    await fireEvent.press(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.empty)).toBeOnTheScreen();
    await expect(AsyncStorage.getItem(MODEL_SETTING_KEY)).resolves.toBeNull();
    expect(screen.getByTestId("model-in-use")).toHaveTextContent(config.defaultModelId);
  });

  it("does not save a model ID with a blank inside, and says so", async () => {
    await startApp("/settings");
    await fireEvent.changeText(await screen.findByLabelText(t.input), "claude opus");
    await fireEvent.press(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.invalid)).toBeOnTheScreen();
    await expect(AsyncStorage.getItem(MODEL_SETTING_KEY)).resolves.toBeNull();
  });

  it("says so when the model cannot be saved", async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("radio", { name: "claude-haiku-5-5" }));
    expect(await screen.findByText(t.saveFailed)).toBeOnTheScreen();
    expect(screen.getByTestId("model-in-use")).toHaveTextContent(config.defaultModelId);
  });

  it("keeps the chosen model across a restart", async () => {
    await AsyncStorage.setItem(MODEL_SETTING_KEY, "claude-sonnet-5-5");
    await startApp("/settings");
    expect(
      await screen.findByRole("radio", { name: "claude-sonnet-5-5", checked: true }),
    ).toBeOnTheScreen();
  });
});

describe("an address that matches no route", () => {
  const UNKNOWN = "/no/such/route";

  it("shows the disclaimer first, not a not-found screen, before acceptance", async () => {
    await startApp(UNKNOWN);
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.notFound.message)).not.toBeOnTheScreen();
    expect(screen.queryByTestId("expo-router-unmatched")).not.toBeOnTheScreen();
  });

  it("shows the app's own not-found screen once the disclaimer is accepted", async () => {
    await startApp(UNKNOWN);
    await fireEvent.press(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    );
    expect(await screen.findByText(STRINGS.en.notFound.message)).toBeOnTheScreen();
    expect(screen.queryByTestId("expo-router-unmatched")).not.toBeOnTheScreen();
  });

  describe("after acceptance", () => {
    beforeEach(async () => {
      await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
    });

    it.each([
      ["sv", STRINGS.sv],
      ["en", STRINGS.en],
      ["it", STRINGS.it],
    ] as const)("shows the not-found screen in the phone's language, %s", async (code, strings) => {
      phoneIn(code);
      await startApp(UNKNOWN);
      expect(await screen.findByText(strings.notFound.message)).toBeOnTheScreen();
      expect(screen.getByRole("link", { name: strings.notFound.back })).toBeOnTheScreen();
      expect(screen.queryByTestId("expo-router-unmatched")).not.toBeOnTheScreen();
    });

    it("shows the not-found screen in the chosen language, over the phone's", async () => {
      phoneIn("sv");
      await startApp("/settings");
      await fireEvent.press(await screen.findByRole("radio", { name: "Italiano" }));
      await act(async () => {
        router.push(UNKNOWN);
      });
      expect(await screen.findByText(STRINGS.it.notFound.message)).toBeOnTheScreen();
      expect(screen.getByRole("link", { name: STRINGS.it.notFound.back })).toBeOnTheScreen();
    });

    it("links back to the Log screen", async () => {
      const app = await startApp(UNKNOWN);
      await fireEvent.press(await screen.findByRole("link", { name: STRINGS.en.notFound.back }));
      expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
      expect(app.pathname()).toBe("/");
    });
  });
});
