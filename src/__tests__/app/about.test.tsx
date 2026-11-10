/**
 * The About view (docs/SPEC.md 3.1, PBI-1.9): the licences of the libraries the app ships, the
 * app's own licence and the disclaimer, in the app's language. It lives here, not next to the
 * route, because expo-router makes every file under src/app a route.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { Linking } from "react-native";

import { NOTICES } from "../../about/notices";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
/* As in routes.test.tsx: these tests open no find log, and expo-sqlite cannot load under Jest. */
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn() }));

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

async function startApp(initialUrl: string): Promise<{ pathname: () => string }> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return { pathname: () => app.getPathname() };
}

/** The library entry named `name`, found by its heading. */
function entryOf(name: string) {
  return within(screen.getByTestId(`licence-${name}`));
}

function library(name: string) {
  const found = NOTICES.libraries.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no library ${name} in the notices`);
  }
  return found;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  phoneIn("en");
});

describe("before the disclaimer is accepted", () => {
  it("shows the disclaimer, not the About view, at the About address", async () => {
    await startApp("/about");
    expect(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.about.librariesHeading)).not.toBeOnTheScreen();
  });
});

describe("the About view", () => {
  const t = STRINGS.en.about;

  beforeEach(async () => {
    await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  });

  it("is reached from Settings", async () => {
    const app = await startApp("/settings");
    await fireEvent.press(await screen.findByRole("link", { name: t.title }));
    expect(await screen.findByText(t.librariesHeading)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/about");
  });

  it("shows the disclaimer", async () => {
    await startApp("/about");
    expect(await screen.findByText(t.disclaimerHeading)).toBeOnTheScreen();
    expect(screen.getByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
  });

  it("shows the app's own licence with its required notice, and its terms on request", async () => {
    await startApp("/about");
    const app = within(await screen.findByTestId("licence-app"));
    expect(app.getByText(NOTICES.app.licence)).toBeOnTheScreen();
    expect(app.getByText(NOTICES.app.requiredNotice)).toBeOnTheScreen();
    expect(app.getByText(NOTICES.app.url)).toBeOnTheScreen();
    expect(app.queryByText(NOTICES.texts[NOTICES.app.textId] ?? "?")).not.toBeOnTheScreen();
    await fireEvent.press(app.getByRole("button", { name: t.showText }));
    expect(app.getByText(NOTICES.texts[NOTICES.app.textId] ?? "?")).toBeOnTheScreen();
  });

  it("lists every library of the notices with its version and licence", async () => {
    await startApp("/about");
    expect(await screen.findByText(t.librariesHeading)).toBeOnTheScreen();
    for (const entry of NOTICES.libraries) {
      const shown = entryOf(entry.name);
      expect(shown.getByText(entry.name)).toBeOnTheScreen();
      expect(shown.getByText(entry.licence)).toBeOnTheScreen();
      expect(shown.getByText(entry.source)).toBeOnTheScreen();
      expect(shown.getByText(entry.version ?? t.versionNotPinned)).toBeOnTheScreen();
    }
  });

  it("shows a library's licence text when asked, and hides it again", async () => {
    await startApp("/about");
    await screen.findByText(t.librariesHeading);
    const expo = library("expo");
    const text = NOTICES.texts[expo.textId ?? ""] ?? "?";
    const shown = entryOf("expo");
    expect(shown.queryByText(text)).not.toBeOnTheScreen();
    await fireEvent.press(shown.getByRole("button", { name: t.showText }));
    expect(shown.getByText(text)).toBeOnTheScreen();
    expect(shown.getByRole("button", { name: t.hideText, expanded: true })).toBeOnTheScreen();
    await fireEvent.press(shown.getByRole("button", { name: t.hideText }));
    expect(shown.queryByText(text)).not.toBeOnTheScreen();
    expect(shown.getByRole("button", { name: t.showText, expanded: false })).toBeOnTheScreen();
  });

  it("opens one library's text without opening the others'", async () => {
    await startApp("/about");
    await screen.findByText(t.librariesHeading);
    await fireEvent.press(entryOf("expo").getByRole("button", { name: t.showText }));
    expect(entryOf("react").queryByRole("button", { name: t.hideText })).not.toBeOnTheScreen();
  });

  it("says so for a library whose licence text is not in the app, and offers no button", async () => {
    await startApp("/about");
    await screen.findByText(t.librariesHeading);
    const missing = NOTICES.libraries.filter((entry) => entry.textId === null);
    expect(missing.length).toBeGreaterThan(0);
    for (const entry of missing) {
      const shown = entryOf(entry.name);
      expect(shown.getByText(t.textMissing)).toBeOnTheScreen();
      expect(shown.queryByRole("button")).not.toBeOnTheScreen();
    }
  });

  it("lists the map data credits, each with its licence and a link that opens its page (SPEC 3.9, PBI-2.8)", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    try {
      await startApp("/about");
      expect(await screen.findByText(t.mapDataHeading)).toBeOnTheScreen();
      expect(NOTICES.mapData.length).toBeGreaterThan(0);
      for (const entry of NOTICES.mapData) {
        const shown = within(screen.getByTestId(`map-data-${entry.name}`));
        expect(shown.getByText(entry.credit)).toBeOnTheScreen();
        expect(shown.getByText(entry.licence)).toBeOnTheScreen();
        await fireEvent.press(shown.getByRole("link", { name: entry.url }));
        expect(openURL).toHaveBeenLastCalledWith(entry.url);
      }
    } finally {
      openURL.mockRestore();
    }
  });

  it("links OpenStreetMap's credit to its copyright page", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    try {
      await startApp("/about");
      const osm = within(await screen.findByTestId("map-data-OpenStreetMap"));
      expect(osm.getByText("© OpenStreetMap contributors")).toBeOnTheScreen();
      await fireEvent.press(osm.getByRole("link"));
      expect(openURL).toHaveBeenCalledWith("https://www.openstreetmap.org/copyright");
    } finally {
      openURL.mockRestore();
    }
  });

  it("stays on the About view when a link cannot be opened", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
    try {
      const app = await startApp("/about");
      const osm = within(await screen.findByTestId("map-data-OpenStreetMap"));
      await fireEvent.press(osm.getByRole("link"));
      expect(app.pathname()).toBe("/about");
      expect(screen.getByText(t.mapDataHeading)).toBeOnTheScreen();
    } finally {
      openURL.mockRestore();
    }
  });

  it.each([
    ["sv", STRINGS.sv],
    ["it", STRINGS.it],
  ] as const)("is in the app's language, %s", async (code, strings) => {
    phoneIn(code);
    await startApp("/about");
    expect(await screen.findByText(strings.about.librariesHeading)).toBeOnTheScreen();
    expect(screen.getByText(strings.about.appHeading)).toBeOnTheScreen();
    expect(screen.getByText(strings.about.mapDataHeading)).toBeOnTheScreen();
    expect(screen.getByText(strings.disclaimer)).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: strings.about.showText }).length).toBeGreaterThan(
      0,
    );
  });
});
