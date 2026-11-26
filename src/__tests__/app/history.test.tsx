/**
 * The version history (docs/SPEC.md 3.10; PBI-2.24), through the router: what opens by itself at
 * a start, after the first-start disclaimer and only at a start whose first screen is the
 * Library; the screen's two forms; and the screen opened by an address. The entries are the ones
 * the app is built with, and the build's version is app.json's, so a version PR changes no
 * expectation here. The plain store is in memory.
 *
 * It lives here, not next to the route, because expo-router makes every file under src/app a
 * route.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { BUILD_VERSION } from "../../history/buildVersion";
import { formatEntryDate, HISTORY, type HistoryEntry } from "../../history/entries";
import { HISTORY_SEEN_VERSION_KEY } from "../../history/seenVersion";
import type { Language } from "../../i18n/languages";
import { STRINGS } from "../../i18n/strings";
import { INSTALL_MARKER_KEY } from "../../key/apiKey";
import { warmUpRouter } from "../../testing/warmUpRouter";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
/* As in routes.test.tsx: these tests open an empty find log, and expo-sqlite cannot load under Jest. */
jest.mock("../../store/deviceFindStore", () => ({
  openFindLog: jest.fn(async () => ({ list: async () => [] })),
}));
/* The share's choice is opened with nothing shared: the library holds no share. */
jest.mock("expo-sharing", () => ({
  getSharedPayloads: jest.fn(() => []),
  getResolvedSharedPayloadsAsync: jest.fn(async () => []),
  clearSharedPayloads: jest.fn(),
}));

/**
 * Whether this run of the app has had its start (`src/history/appStart.ts`, which holds it for the
 * app's process; its own test is beside it). Jest runs every test of this file in one process, so
 * the stand-in lets a test begin a new run. (Named `mock…` so that the hoisted factory may use it.)
 */
let mockStartTaken = false;
jest.mock("../../history/appStart", () => ({
  takeAppStart: () => {
    if (mockStartTaken) {
      return false;
    }
    mockStartTaken = true;
    return true;
  },
}));

const APP_DIR = "./src/app";
const en = STRINGS.en;
const KEY = HISTORY_SEEN_VERSION_KEY;
const V = BUILD_VERSION;

const [NEWEST, SECOND] = HISTORY as readonly [HistoryEntry, HistoryEntry];
const OLDEST = HISTORY.at(-1) as HistoryEntry;

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

/**
 * Starts the app at an address: a new run of the app, as after its process ended, unless the test
 * says that the app's process lived on. The store is kept between runs, as on a phone.
 */
async function startApp(
  initialUrl = "/",
  run: "new run" | "same run" = "new run",
): Promise<{ pathname: () => string }> {
  if (run === "new run") {
    mockStartTaken = false;
  }
  const app = renderRouter(APP_DIR, { initialUrl });
  await app;
  return { pathname: () => app.getPathname() };
}

/** The titles of the screens in the stack, the lowest first, as their headers hold them. */
function headerTitles(): string[] {
  return screen.container
    .queryAll((node) => node.type === "RNSScreenStackHeaderConfig")
    .map((node) => String(node.props.title));
}

/** The text of an entry's heading: the word for "Version", the version and the date. */
function headingOf(entry: HistoryEntry, language: Language = "en"): string {
  return `${STRINGS[language].history.version} ${entry.version} (${formatEntryDate(entry.date, language)})`;
}

/** The versions whose entries the history screen shows, in the order shown. */
function versionsShown(): string[] {
  return screen
    .queryAllByTestId(/^history-entry-/)
    .map((node) => String(node.props.testID).slice("history-entry-".length));
}

/** The headings the history screen shows, in the order shown. */
function headingsShown(): unknown[] {
  return within(screen.getByTestId("history"))
    .getAllByRole("header")
    .map((node) => node.props.children);
}

/** The buttons of the history screen; the screens under it have their own. */
function buttonsShown(): number {
  return within(screen.getByTestId("history")).queryAllByRole("button").length;
}

const versionsOf = (entries: readonly HistoryEntry[]) => entries.map((entry) => entry.version);

async function accept(): Promise<void> {
  await fireEvent.press(await screen.findByRole("button", { name: en.firstStart.accept }));
}

async function goBack(): Promise<void> {
  await act(async () => {
    router.back();
  });
}

/** The phone has had the app before: the disclaimer's acceptance is stored. */
async function acceptedEarlier(): Promise<void> {
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
}

const seenVersion = () => AsyncStorage.getItem(KEY);

/** How often the app read and wrote the version last seen. */
function storeCalls(): { reads: number; writes: string[] } {
  return {
    reads: jest.mocked(AsyncStorage.getItem).mock.calls.filter(([key]) => key === KEY).length,
    writes: jest
      .mocked(AsyncStorage.setItem)
      .mock.calls.filter(([key]) => key === KEY)
      .map(([, value]) => value),
  };
}

const realGetItem = jest.mocked(AsyncStorage.getItem).getMockImplementation();
const realSetItem = jest.mocked(AsyncStorage.setItem).getMockImplementation();
if (realGetItem === undefined || realSetItem === undefined) {
  throw new Error("the storage stand-in has no implementation to keep");
}

/** The store gives `answer()` when the version last seen is read; every other key is as it is. */
function readOfSeenVersionGives(answer: () => Promise<string | null>): void {
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation((key, ...rest) => (key === KEY ? answer() : realGetItem(key, ...rest)));
}

/** The store fails every write of the version last seen; every other key is written. */
function writeOfSeenVersionFails(): void {
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementation((key, ...rest) =>
      key === KEY ? Promise.reject(new Error("disk full")) : realSetItem(key, ...rest),
    );
}

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockImplementation(realGetItem);
  jest.mocked(AsyncStorage.setItem).mockImplementation(realSetItem);
  await AsyncStorage.clear();
  // Not a first start after an install for the key, so that nothing but the history is at work.
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  jest.mocked(AsyncStorage.getItem).mockClear();
  jest.mocked(AsyncStorage.setItem).mockClear();
  phoneIn("en");
});

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(KEY, V);
  phoneIn("en");
  await startApp("/");
  await screen.findByText(en.log.empty);
});

describe("the list these tests are run with", () => {
  it("has the build's version first and at least two older versions, so that an upgrade can skip one", () => {
    expect(NEWEST.version).toBe(V);
    expect(HISTORY.length).toBeGreaterThanOrEqual(3);
    expect(OLDEST).not.toBe(SECOND);
  });
});

describe("a new install: the disclaimer is accepted at this start, and no version is stored (SPEC 3.10, items 7 and 8)", () => {
  it("decides, shows, reads and writes nothing of the history before the disclaimer is accepted", async () => {
    await startApp("/");
    expect(await screen.findByText(en.disclaimer)).toBeOnTheScreen();
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
    await expect(seenVersion()).resolves.toBeNull();
  });

  it("shows the Library after the acceptance, opens nothing by itself, and writes the build's version", async () => {
    const app = await startApp("/");
    await accept();
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
    await expect(seenVersion()).resolves.toBe(V);
    expect(storeCalls().writes).toEqual([V]);
  });

  it("opens nothing at the next start either: the version is the one this phone saw", async () => {
    await startApp("/");
    await accept();
    await screen.findByText(en.log.empty);
    await screen.unmount();

    const app = await startApp("/");
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
  });

  it.each([
    ["a share opens, whose first screen is the choice", "/share", en.share.none],
    ["an address opens on Settings", "/settings", en.settings.languageHeading],
    ["an address opens on About", "/about", en.about.librariesHeading],
    ["an address opens on no screen of the app", "/no/such/screen", en.notFound.message],
  ])(
    "writes the build's version when it is accepted also at a start that %s, and opens nothing",
    async (_what, url, shown) => {
      const app = await startApp(url);
      await accept();
      expect(await screen.findByText(shown)).toBeOnTheScreen();
      expect(app.pathname()).toBe(url);
      expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
      await expect(seenVersion()).resolves.toBe(V);
    },
  );

  it("writes it also at a start on the history's own address, which shows the full history", async () => {
    await startApp("/history");
    await accept();
    expect(await screen.findByTestId("history")).toBeOnTheScreen();
    expect(headerTitles()).toEqual([en.history.title]);
    await expect(seenVersion()).resolves.toBe(V);
  });
});

describe("an upgrade: a lower version is stored, and the acceptance was stored earlier (SPEC 3.10, items 3 and 7)", () => {
  beforeEach(acceptedEarlier);

  it("opens the history by itself over the Library, titled What's new, with the entry of the one newer version and the button", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    const app = await startApp("/");
    expect(await screen.findByTestId("history")).toBeOnTheScreen();
    expect(app.pathname()).toBe("/history");
    expect(headerTitles()).toEqual([en.log.title, "What's new"]);
    expect(versionsShown()).toEqual([NEWEST.version]);
    expect(screen.getByRole("header", { name: headingOf(NEWEST) })).toBeOnTheScreen();
    for (const line of NEWEST.lines.en) {
      expect(screen.getByText(line)).toBeOnTheScreen();
    }
    expect(screen.queryByRole("header", { name: headingOf(SECOND) })).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Show full history" })).toBeOnTheScreen();
  });

  it("writes the build's version when the decision is made, whatever the user then does with the screen", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    await startApp("/");
    await screen.findByTestId("history");
    await expect(seenVersion()).resolves.toBe(V);
    expect(storeCalls()).toEqual({ reads: 1, writes: [V] });
  });

  it("shows the entries of every version an upgrade skipped, newest first, each under its heading", async () => {
    await AsyncStorage.setItem(KEY, OLDEST.version);
    await startApp("/");
    await screen.findByTestId("history");
    const skipped = HISTORY.slice(0, -1);
    expect(versionsShown()).toEqual(versionsOf(skipped));
    expect(headingsShown()).toEqual(skipped.map((entry) => headingOf(entry)));
    expect(screen.queryByRole("header", { name: headingOf(OLDEST) })).not.toBeOnTheScreen();
  });

  it("shows every entry after an upgrade from a version older than the list's oldest", async () => {
    await AsyncStorage.setItem(KEY, "0.0.0");
    await startApp("/");
    await screen.findByTestId("history");
    expect(versionsShown()).toEqual(versionsOf(HISTORY));
    expect(screen.getByRole("button", { name: en.history.showFull })).toBeOnTheScreen();
  });

  it("shows the Library when the header's back control or the phone's back closes it", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    const app = await startApp("/");
    await screen.findByTestId("history");
    expect(router.canGoBack()).toBe(true);
    await goBack();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
    expect(screen.getByText(en.log.empty)).toBeOnTheScreen();
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
  });

  it("opens a version's news once: nothing opens at the next start", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    await startApp("/");
    await screen.findByTestId("history");
    await screen.unmount();

    const app = await startApp("/");
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
  });

  describe('the button "Show full history"', () => {
    it("shows every entry under the title Version history and removes the button", async () => {
      await AsyncStorage.setItem(KEY, SECOND.version);
      await startApp("/");
      await fireEvent.press(await screen.findByRole("button", { name: "Show full history" }));
      expect(headerTitles()).toEqual([en.log.title, "Version history"]);
      expect(versionsShown()).toEqual(versionsOf(HISTORY));
      for (const entry of HISTORY) {
        expect(screen.getByRole("header", { name: headingOf(entry) })).toBeOnTheScreen();
      }
      expect(screen.queryByRole("button", { name: "Show full history" })).not.toBeOnTheScreen();
      expect(buttonsShown()).toBe(0);
    });

    it("stays the same screen: back still shows the Library", async () => {
      await AsyncStorage.setItem(KEY, SECOND.version);
      const app = await startApp("/");
      await fireEvent.press(await screen.findByRole("button", { name: "Show full history" }));
      expect(app.pathname()).toBe("/history");
      await goBack();
      expect(app.pathname()).toBe("/");
      expect(headerTitles()).toEqual([en.log.title]);
    });

    it("writes nothing more", async () => {
      await AsyncStorage.setItem(KEY, SECOND.version);
      await startApp("/");
      await fireEvent.press(await screen.findByRole("button", { name: "Show full history" }));
      expect(storeCalls()).toEqual({ reads: 1, writes: [V] });
    });
  });

  it("is the full history, not What's new, when the link on About opens it later in the same run", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    await startApp("/");
    await screen.findByTestId("history");
    await goBack();
    await fireEvent.press(screen.getByRole("link", { name: en.log.settings }));
    await fireEvent.press(await screen.findByRole("link", { name: en.about.title }));
    await fireEvent.press(await screen.findByRole("link", { name: en.history.title }));
    await screen.findByTestId("history");
    expect(headerTitles()).toEqual([
      en.log.title,
      en.settings.title,
      en.about.title,
      "Version history",
    ]);
    expect(versionsShown()).toEqual(versionsOf(HISTORY));
    expect(screen.queryByRole("button", { name: en.history.showFull })).not.toBeOnTheScreen();
  });

  it.each([
    ["sv", STRINGS.sv],
    ["it", STRINGS.it],
  ] as const)(
    "is in the app's language, %s: the title, the headings, the lines and the button",
    async (code, strings) => {
      phoneIn(code);
      await AsyncStorage.setItem(KEY, SECOND.version);
      await startApp("/");
      await screen.findByTestId("history");
      expect(headerTitles()).toEqual([strings.log.title, strings.history.whatsNewTitle]);
      expect(screen.getByRole("header", { name: headingOf(NEWEST, code) })).toBeOnTheScreen();
      for (const line of NEWEST.lines[code]) {
        expect(screen.getByText(line)).toBeOnTheScreen();
      }
      await fireEvent.press(screen.getByRole("button", { name: strings.history.showFull }));
      expect(headerTitles()).toEqual([strings.log.title, strings.history.title]);
      for (const entry of HISTORY) {
        expect(screen.getByRole("header", { name: headingOf(entry, code) })).toBeOnTheScreen();
      }
    },
  );

  it("follows a change of the language in Settings", async () => {
    await AsyncStorage.setItem(KEY, V);
    await startApp("/settings");
    await fireEvent.press(await screen.findByRole("radio", { name: "Italiano" }));
    await fireEvent.press(await screen.findByRole("link", { name: STRINGS.it.about.title }));
    await fireEvent.press(await screen.findByRole("link", { name: STRINGS.it.history.title }));
    await screen.findByTestId("history");
    expect(headerTitles().at(-1)).toBe(STRINGS.it.history.title);
    expect(screen.getByRole("header", { name: headingOf(NEWEST, "it") })).toBeOnTheScreen();
    for (const line of NEWEST.lines.it) {
      expect(screen.getByText(line)).toBeOnTheScreen();
    }
  });
});

describe("the disclaimer asked for again after an upgrade: a lower version is stored, the acceptance is not (SPEC 3.10, item 8)", () => {
  it("shows the disclaimer first, with nothing of the history read or written, and What's new once it is accepted", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    jest.mocked(AsyncStorage.setItem).mockClear();
    const app = await startApp("/");
    expect(await screen.findByText(en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    await expect(seenVersion()).resolves.toBe(SECOND.version);

    await accept();
    expect(await screen.findByTestId("history")).toBeOnTheScreen();
    expect(app.pathname()).toBe("/history");
    expect(headerTitles()).toEqual([en.log.title, en.history.whatsNewTitle]);
    expect(versionsShown()).toEqual([NEWEST.version]);
    await expect(seenVersion()).resolves.toBe(V);
  });

  it("writes nothing when it is accepted at a start not on the Library: the stored version is not missing", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    jest.mocked(AsyncStorage.setItem).mockClear();
    await startApp("/settings");
    await accept();
    expect(await screen.findByText(en.settings.languageHeading)).toBeOnTheScreen();
    expect(storeCalls().writes).toEqual([]);
    await expect(seenVersion()).resolves.toBe(SECOND.version);
  });
});

describe("a phone with a build from before the history: the acceptance is stored, no version is (SPEC 3.10, item 7, the second rule)", () => {
  beforeEach(acceptedEarlier);

  it("opens the history by itself over the Library with the entry of the build's version alone and the button, and writes the version", async () => {
    const app = await startApp("/");
    expect(await screen.findByTestId("history")).toBeOnTheScreen();
    expect(app.pathname()).toBe("/history");
    expect(headerTitles()).toEqual([en.log.title, en.history.whatsNewTitle]);
    expect(versionsShown()).toEqual([V]);
    expect(screen.getByRole("button", { name: en.history.showFull })).toBeOnTheScreen();
    await expect(seenVersion()).resolves.toBe(V);
  });

  it.each([
    ["a share opens", "/share", en.share.none],
    ["an address opens on Settings", "/settings", en.settings.languageHeading],
  ])("opens, reads and writes nothing at a start that %s", async (_what, url, shown) => {
    const app = await startApp(url);
    expect(await screen.findByText(shown)).toBeOnTheScreen();
    expect(app.pathname()).toBe(url);
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    await expect(seenVersion()).resolves.toBeNull();
  });
});

describe("a start whose first screen is not the Library, with a lower version stored (SPEC 3.10, item 8)", () => {
  beforeEach(async () => {
    await acceptedEarlier();
    await AsyncStorage.setItem(KEY, SECOND.version);
    jest.mocked(AsyncStorage.setItem).mockClear();
  });

  it.each([
    ["a share opens, whose first screen is the choice", "/share", en.share.none],
    ["an address opens on Settings", "/settings", en.settings.languageHeading],
    ["an address opens on About", "/about", en.about.librariesHeading],
    ["an address opens on no screen of the app", "/no/such/screen", en.notFound.message],
  ])("opens nothing and writes nothing at a start that %s", async (_what, url, shown) => {
    const app = await startApp(url);
    expect(await screen.findByText(shown)).toBeOnTheScreen();
    expect(app.pathname()).toBe(url);
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    await expect(seenVersion()).resolves.toBe(SECOND.version);
  });

  it("opens nothing either when the Library is shown later in the same run", async () => {
    const app = await startApp("/settings");
    await screen.findByText(en.settings.languageHeading);
    await act(async () => {
      router.replace("/");
    });
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    await expect(seenVersion()).resolves.toBe(SECOND.version);
  });

  it.each([
    ["a share opened", "/share", en.share.none],
    ["an address opened on Settings", "/settings", en.settings.languageHeading],
  ])(
    "leaves the decision to the next start on the Library, which opens the screen, after a start that %s",
    async (_what, url, shown) => {
      await startApp(url);
      await screen.findByText(shown);
      await screen.unmount();

      const app = await startApp("/");
      expect(await screen.findByTestId("history")).toBeOnTheScreen();
      expect(app.pathname()).toBe("/history");
      expect(headerTitles()).toEqual([en.log.title, en.history.whatsNewTitle]);
      expect(versionsShown()).toEqual([NEWEST.version]);
      await expect(seenVersion()).resolves.toBe(V);
    },
  );

  it("makes no decision when the app's screens are shown anew on the Library while its process lives: that is no start", async () => {
    await startApp("/settings");
    await screen.findByText(en.settings.languageHeading);
    await screen.unmount();

    const app = await startApp("/", "same run");
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    await expect(seenVersion()).resolves.toBe(SECOND.version);
  });
});

describe("the history opened by an address from outside the app (SPEC 3.10, items 3 and 8)", () => {
  beforeEach(async () => {
    await acceptedEarlier();
    await AsyncStorage.setItem(KEY, SECOND.version);
    jest.mocked(AsyncStorage.setItem).mockClear();
  });

  it.each([
    ["nothing", "/history"],
    ["a form", "/history?form=whatsNew&whatsNew=true&new=1"],
    ["versions", `/history?since=${OLDEST.version}&seen=0.0.0&version=9.9.9&from=0.0.1`],
    ["entries", "/history?entries=%5B%7B%22version%22%3A%229.9.9%22%7D%5D&lines=hello"],
    ["a fragment", "/history#whatsNew"],
  ])(
    "is the screen opened from the link, with a lower version stored, when the address carries %s",
    async (_what, url) => {
      const app = await startApp(url);
      expect(await screen.findByTestId("history")).toBeOnTheScreen();
      expect(app.pathname()).toBe("/history");
      expect(headerTitles()).toEqual(["Version history"]);
      expect(versionsShown()).toEqual(versionsOf(HISTORY));
      expect(headingsShown()).toEqual(HISTORY.map((entry) => headingOf(entry)));
      expect(buttonsShown()).toBe(0);
      expect(screen.queryByText("hello")).not.toBeOnTheScreen();
      expect(screen.queryByText(/9\.9\.9/)).not.toBeOnTheScreen();
    },
  );

  it("decides and writes nothing: the stored version is as it was, and was not read", async () => {
    await startApp("/history?form=whatsNew&since=0.0.0");
    await screen.findByTestId("history");
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
    await expect(seenVersion()).resolves.toBe(SECOND.version);
  });

  it("leaves What's new to the next start on the Library", async () => {
    await startApp("/history");
    await screen.findByTestId("history");
    await screen.unmount();

    await startApp("/");
    await screen.findByTestId("history");
    expect(headerTitles()).toEqual([en.log.title, en.history.whatsNewTitle]);
    expect(versionsShown()).toEqual([NEWEST.version]);
  });

  it("shows the disclaimer first, not the history, before the disclaimer is accepted", async () => {
    await AsyncStorage.removeItem(DISCLAIMER_ACCEPTED_KEY);
    await startApp("/history");
    expect(await screen.findByText(en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
  });
});

describe("the other stored versions, at a start on the Library (SPEC 3.10, item 7)", () => {
  beforeEach(acceptedEarlier);

  /** The Library is shown with nothing over it. */
  async function expectTheLibraryAlone(app: { pathname: () => string }): Promise<void> {
    expect(await screen.findByText(en.log.empty)).toBeOnTheScreen();
    expect(app.pathname()).toBe("/");
    expect(headerTitles()).toEqual([en.log.title]);
    expect(screen.queryByTestId("history")).not.toBeOnTheScreen();
  }

  it("opens nothing and writes nothing when the stored version is the build's", async () => {
    await AsyncStorage.setItem(KEY, V);
    jest.mocked(AsyncStorage.setItem).mockClear();
    await expectTheLibraryAlone(await startApp("/"));
    expect(storeCalls()).toEqual({ reads: 1, writes: [] });
  });

  it("opens nothing and writes the build's version when the stored version is higher", async () => {
    await AsyncStorage.setItem(KEY, "999.0.0");
    await expectTheLibraryAlone(await startApp("/"));
    await expect(seenVersion()).resolves.toBe(V);
  });

  it.each(["", "v0.1.0", "0.1", "0.1.0-beta", "accepted", `${V} `])(
    "opens nothing and writes the build's version when the stored text is %p, which is not a version",
    async (text) => {
      await AsyncStorage.setItem(KEY, text);
      await expectTheLibraryAlone(await startApp("/"));
      await expect(seenVersion()).resolves.toBe(V);
    },
  );

  it("opens nothing and still tries the write when reading the stored version fails", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    jest.mocked(AsyncStorage.setItem).mockClear();
    readOfSeenVersionGives(() => Promise.reject(new Error("storage unavailable")));
    await expectTheLibraryAlone(await startApp("/"));
    expect(storeCalls().writes).toEqual([V]);
  });

  it("still opens the screen when the write fails, and opens it again at the next start", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    writeOfSeenVersionFails();
    await startApp("/");
    await screen.findByTestId("history");
    expect(headerTitles()).toEqual([en.log.title, en.history.whatsNewTitle]);
    expect(versionsShown()).toEqual([NEWEST.version]);
    await expect(seenVersion()).resolves.toBe(SECOND.version);
    await screen.unmount();

    await startApp("/");
    await screen.findByTestId("history");
    expect(headerTitles()).toEqual([en.log.title, en.history.whatsNewTitle]);
  });

  it("shows the Library only when the read of the stored version is finished", async () => {
    await AsyncStorage.setItem(KEY, V);
    let finishRead: (value: string | null) => void = () => undefined;
    readOfSeenVersionGives(
      () =>
        new Promise<string | null>((resolve) => {
          finishRead = resolve;
        }),
    );
    const app = await startApp("/");
    expect(await screen.findByTestId("history-reading")).toBeOnTheScreen();
    expect(screen.queryByText(en.log.empty)).not.toBeOnTheScreen();
    expect(headerTitles()).toEqual([]);

    await act(async () => {
      finishRead(V);
    });
    await expectTheLibraryAlone(app);
    expect(screen.queryByTestId("history-reading")).not.toBeOnTheScreen();
  });

  it("does not wait for that read at a start not on the Library", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    readOfSeenVersionGives(() => new Promise<string | null>(() => undefined));
    await startApp("/settings");
    expect(await screen.findByText(en.settings.languageHeading)).toBeOnTheScreen();
  });

  it("does not hold the screens back for the read on a new install opened at another address", async () => {
    await AsyncStorage.removeItem(DISCLAIMER_ACCEPTED_KEY);
    readOfSeenVersionGives(() => new Promise<string | null>(() => undefined));
    await startApp("/settings");
    await accept();
    expect(await screen.findByText(en.settings.languageHeading)).toBeOnTheScreen();
  });

  it("does not update after it is gone, when the stored version is read too late", async () => {
    await AsyncStorage.setItem(KEY, SECOND.version);
    let finishRead: (value: string | null) => void = () => undefined;
    readOfSeenVersionGives(
      () =>
        new Promise<string | null>((resolve) => {
          finishRead = resolve;
        }),
    );
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await startApp("/");
    await screen.findByTestId("history-reading");
    await screen.unmount();
    await act(async () => {
      finishRead(SECOND.version);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("the history opened from the link on About (SPEC 3.10, items 2 and 3)", () => {
  beforeEach(async () => {
    await acceptedEarlier();
    await AsyncStorage.setItem(KEY, V);
  });

  async function openFromAbout(): Promise<{ pathname: () => string }> {
    const app = await startApp("/about");
    await fireEvent.press(await screen.findByRole("link", { name: en.history.title }));
    await screen.findByTestId("history");
    return app;
  }

  it("is titled Version history and shows every entry, newest first, without the button", async () => {
    const app = await openFromAbout();
    expect(app.pathname()).toBe("/history");
    expect(headerTitles()).toEqual([en.about.title, "Version history"]);
    expect(versionsShown()).toEqual(versionsOf(HISTORY));
    expect(headingsShown()).toEqual(HISTORY.map((entry) => headingOf(entry)));
    for (const entry of HISTORY) {
      for (const line of entry.lines.en) {
        expect(screen.getByText(line)).toBeOnTheScreen();
      }
    }
    expect(buttonsShown()).toBe(0);
  });

  it("shows About again when it is closed", async () => {
    const app = await openFromAbout();
    await goBack();
    expect(app.pathname()).toBe("/about");
    expect(headerTitles()).toEqual([en.about.title]);
    expect(screen.getByText(en.about.librariesHeading)).toBeOnTheScreen();
  });

  it("reads and writes nothing of the version last seen", async () => {
    jest.mocked(AsyncStorage.setItem).mockClear();
    await openFromAbout();
    expect(storeCalls()).toEqual({ reads: 0, writes: [] });
  });
});
