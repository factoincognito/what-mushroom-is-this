/**
 * Tests of the routes under src/app. They live here, not next to the routes, because
 * expo-router makes every file under src/app a route.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

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

  it("has a New find placeholder that is disabled and goes nowhere", async () => {
    const app = await startApp();
    const newFind = await screen.findByRole("button", { name: STRINGS.en.log.newFind });
    expect(newFind).toBeDisabled();
    await fireEvent.press(newFind);
    expect(app.pathname()).toBe("/");
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
