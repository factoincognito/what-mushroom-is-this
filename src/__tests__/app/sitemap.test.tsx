/**
 * The generated sitemap of expo-router (`/_sitemap`) is turned off by app.json. expo-router 57
 * reads the option at run time from `Constants.expoConfig.extra.router`, which its config plugin
 * fills from the plugin's options in app.json. Under Jest, `Constants.expoConfig` is empty, so
 * these tests give it what the real plugin makes of this project's app.json.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";

type ExpoConfig = { plugins?: unknown[]; extra?: { router?: Record<string, unknown> } };

/**
 * This project's Expo config after expo-router's own config plugin has run over it. (Named
 * `mock…` so that `jest.mock`'s factory, which Jest hoists, may use it.)
 */
function mockConfigAfterRouterPlugin(): ExpoConfig {
  const appJson: { expo: ExpoConfig } = jest.requireActual("../../../app.json");
  const entry = appJson.expo.plugins?.find(
    (plugin) => plugin === "expo-router" || (Array.isArray(plugin) && plugin[0] === "expo-router"),
  );
  const options: unknown = Array.isArray(entry) ? entry[1] : undefined;
  const withRouter: { default: (config: ExpoConfig, props: unknown) => ExpoConfig } =
    jest.requireActual("expo-router/app.plugin");
  return withRouter.default(structuredClone(appJson.expo), options);
}

jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    __esModule: true,
    ...actual,
    default: { ...actual.default, expoConfig: mockConfigAfterRouterPlugin() },
  };
});
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
/*
 * The layout gives the screens the find log, which opens through expo-sqlite. expo-sqlite imports
 * expo-asset, which npm keeps under expo/node_modules: Metro finds it there (checked with
 * `npx expo export --platform android`), Jest does not. The Log screen lists the finds, so the
 * stand-in gives an empty log.
 */
jest.mock("../../store/deviceFindStore", () => ({
  openFindLog: jest.fn(async () => ({ list: async () => [] })),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode: "en", languageTag: "en" } as ReturnType<typeof getLocales>[number],
    ]);
});

describe("the generated sitemap", () => {
  it("is turned off by the expo-router plugin options in app.json", () => {
    expect(mockConfigAfterRouterPlugin().extra?.router?.sitemap).toBe(false);
  });

  it("is not reachable before acceptance: /_sitemap shows the disclaimer", async () => {
    const app = renderRouter("./src/app", { initialUrl: "/_sitemap" });
    await app;
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
  });

  it("is not reachable after acceptance: /_sitemap is the app's own not-found screen", async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
    const app = renderRouter("./src/app", { initialUrl: "/_sitemap" });
    await app;
    expect(await screen.findByText(STRINGS.en.notFound.message)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: STRINGS.en.notFound.back }));
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
  });
});
