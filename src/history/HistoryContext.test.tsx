import { fireEvent, render, screen } from "@testing-library/react-native";
import { getLocales } from "expo-localization";
import { router } from "expo-router";
import { type ReactNode, StrictMode, useState } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DISCLAIMER_ACCEPTED_KEY } from "../disclaimer/acceptance";
import { DisclaimerGate } from "../disclaimer/DisclaimerGate";
import { LanguageProvider } from "../i18n/LanguageContext";
import { STRINGS } from "../i18n/strings";
import type { KeyValueStore } from "../storage/keyValueStore";
import { BUILD_VERSION } from "./buildVersion";
import { HISTORY } from "./entries";
import { FirstScreenOfStart, HISTORY_ROUTE, HistoryProvider, useHistory } from "./HistoryContext";
import { HISTORY_SEEN_VERSION_KEY } from "./seenVersion";

jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));
/* The router is a stand-in here: only where the app goes is asked of it. */
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
/*
 * Each test is a new run of the app, as in `src/__tests__/app/history.test.tsx`. (Named `mock…`
 * so that the hoisted factory may use it.)
 */
let mockStartTaken = false;
jest.mock("./appStart", () => ({
  takeAppStart: () => {
    if (mockStartTaken) {
      return false;
    }
    mockStartTaken = true;
    return true;
  },
}));

function memoryStore(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const store = {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return store satisfies KeyValueStore;
}

type Store = ReturnType<typeof memoryStore>;

/** A phone that accepted the disclaimer at an earlier start and saw `seen` last. */
function phoneThatSaw(seen: string | null): Store {
  return memoryStore({
    [DISCLAIMER_ACCEPTED_KEY]: "accepted",
    ...(seen === null ? {} : { [HISTORY_SEEN_VERSION_KEY]: seen }),
  });
}

/** What a history screen gets when it takes the decision's entries: asked on each press. */
function Taker() {
  const { takeWhatsNew } = useHistory();
  const [taken, setTaken] = useState<string[]>([]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const entries = takeWhatsNew();
          setTaken((earlier) => [
            ...earlier,
            entries === null ? "nothing" : entries.map((entry) => entry.version).join(" "),
          ]);
        }}
      >
        <Text>take</Text>
      </Pressable>
      <Text>{`taken: ${taken.join(", ")}`}</Text>
    </>
  );
}

type Screen = { readonly key: string; readonly name: string };

const LIBRARY: Screen = { key: "index-1", name: "index" };
const SETTINGS: Screen = { key: "settings-1", name: "settings" };

/** The app's stack as a stand-in: its screens, the last of them shown, each laid out as the app's. */
function Stack({ screens }: { readonly screens: readonly Screen[] }) {
  const navigation = { getState: () => ({ index: screens.length - 1, routes: screens }) };
  return (
    <>
      {screens.map((each) => (
        <FirstScreenOfStart key={each.key} route={each} navigation={navigation}>
          <Text>{`the screen ${each.name}`}</Text>
        </FirstScreenOfStart>
      ))}
    </>
  );
}

/** The app around its stack: the phone's insets, the language, the disclaimer's gate, the start. */
function appAround(store: KeyValueStore, stack: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 412, height: 915 },
        insets: { top: 40, bottom: 48, left: 0, right: 0 },
      }}
    >
      <LanguageProvider store={store}>
        <DisclaimerGate store={store}>
          <HistoryProvider store={store}>
            {stack}
            <Taker />
          </HistoryProvider>
        </DisclaimerGate>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

function app(store: KeyValueStore, screens: readonly Screen[] = [LIBRARY]) {
  return appAround(store, <Stack screens={screens} />);
}

const seenReads = (store: Store) =>
  store.getItem.mock.calls.filter(([key]) => key === HISTORY_SEEN_VERSION_KEY).length;

const seenWrites = (store: Store) =>
  store.setItem.mock.calls.filter(([key]) => key === HISTORY_SEEN_VERSION_KEY);

/** The store reads the version last seen only when the test lets it. */
function holdTheReadOf(store: Store): (value: string | null) => void {
  let finish: (value: string | null) => void = () => undefined;
  store.getItem.mockImplementation((key: string) =>
    key === HISTORY_SEEN_VERSION_KEY
      ? new Promise<string | null>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(store.values.get(key) ?? null),
  );
  return (value) => finish(value);
}

/** Node's own timer, which Jest's stand-in timers do not replace: it is asked for by its module. */
const realTimers: { setImmediate(callback: () => void): unknown } =
  jest.requireActual("node:timers");

/**
 * Waits until every promise that can settle has settled, however many turns its chain takes: the
 * event loop runs a timer's callback only when no promise's continuation is left to run. The stores of
 * this file answer by promises alone, so after it the read's continuation has run to its end.
 */
function everyPromiseSettled(): Promise<void> {
  return new Promise((resolve) => {
    realTimers.setImmediate(resolve);
  });
}

const [, SECOND] = HISTORY;
const LOWER = SECOND?.version ?? "0.0.0";

beforeEach(() => {
  mockStartTaken = false;
  jest.mocked(router.push).mockReset();
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode: "en", languageTag: "en" } as ReturnType<typeof getLocales>[number],
    ]);
});

describe("the version history's start among the screens (SPEC 3.10, items 3, 7 and 8)", () => {
  it("opens the history's route once, when the decision opens it at a start on the Library", async () => {
    await render(app(phoneThatSaw(LOWER)));
    expect(await screen.findByText("the screen index")).toBeOnTheScreen();
    expect(HISTORY_ROUTE).toBe("/history");
    expect(jest.mocked(router.push).mock.calls).toEqual([["/history"]]);
  });

  it("opens no route when the decision opens nothing", async () => {
    await render(app(phoneThatSaw(BUILD_VERSION)));
    expect(await screen.findByText("the screen index")).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("holds the Library back, and nothing else of the app, until the version last seen is read", async () => {
    const store = phoneThatSaw(LOWER);
    const finishRead = holdTheReadOf(store);
    await render(app(store));
    expect(await screen.findByTestId("history-reading")).toBeOnTheScreen();
    expect(screen.queryByText("the screen index")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "take" })).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();

    finishRead(LOWER);
    expect(await screen.findByText("the screen index")).toBeOnTheScreen();
    expect(screen.queryByTestId("history-reading")).not.toBeOnTheScreen();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("shows a screen that is not the Library at once, and reads, writes and opens nothing", async () => {
    const store = phoneThatSaw(LOWER);
    holdTheReadOf(store);
    await render(app(store, [SETTINGS]));
    expect(await screen.findByText("the screen settings")).toBeOnTheScreen();
    expect(screen.queryByTestId("history-reading")).not.toBeOnTheScreen();
    expect(seenReads(store)).toBe(0);
    expect(seenWrites(store)).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("takes the first screen from what the stack shows: the Library under Settings is not the start's", async () => {
    const store = phoneThatSaw(LOWER);
    await render(app(store, [LIBRARY, SETTINGS]));
    expect(await screen.findByText("the screen settings")).toBeOnTheScreen();
    expect(screen.getByText("the screen index")).toBeOnTheScreen();
    expect(seenReads(store)).toBe(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("takes the screen laid out as the one shown when the stack's state names none", async () => {
    const store = phoneThatSaw(LOWER);
    const navigation = { getState: () => ({ index: 3, routes: [] }) };
    await render(
      appAround(
        store,
        <FirstScreenOfStart route={SETTINGS} navigation={navigation}>
          <Text>the screen settings</Text>
        </FirstScreenOfStart>,
      ),
    );
    expect(await screen.findByText("the screen settings")).toBeOnTheScreen();
    expect(seenReads(store)).toBe(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("makes no decision when the Library is shown later in the same run", async () => {
    const store = phoneThatSaw(LOWER);
    const shown = await render(app(store, [SETTINGS]));
    await screen.findByText("the screen settings");
    await shown.rerender(app(store, [SETTINGS, LIBRARY]));
    expect(await screen.findByText("the screen index")).toBeOnTheScreen();
    expect(seenReads(store)).toBe(0);
    expect(seenWrites(store)).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not hold back the screens opened after the first, also while the read goes on", async () => {
    const store = phoneThatSaw(LOWER);
    holdTheReadOf(store);
    const shown = await render(app(store));
    await screen.findByTestId("history-reading");
    await shown.rerender(app(store, [LIBRARY, SETTINGS]));
    expect(await screen.findByText("the screen settings")).toBeOnTheScreen();
    expect(screen.queryByText("the screen index")).not.toBeOnTheScreen();
  });

  it("writes the build's version when the disclaimer is accepted at this start, also at a start not on the Library", async () => {
    const store = memoryStore({});
    await render(app(store, [SETTINGS]));
    await fireEvent.press(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    );
    expect(await screen.findByText("the screen settings")).toBeOnTheScreen();
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe(BUILD_VERSION);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("reads and writes nothing of the history before the disclaimer is accepted", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: LOWER });
    await render(app(store));
    await screen.findByText(STRINGS.en.disclaimer);
    expect(seenReads(store)).toBe(0);
    expect(seenWrites(store)).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("gives the decision's entries to the screen that takes them first, and none to any after it", async () => {
    await render(app(phoneThatSaw(LOWER)));
    await screen.findByText("the screen index");
    await fireEvent.press(screen.getByRole("button", { name: "take" }));
    expect(screen.getByText(`taken: ${BUILD_VERSION}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "take" }));
    expect(screen.getByText(`taken: ${BUILD_VERSION}, nothing`)).toBeOnTheScreen();
  });

  it("gives no entries when nothing opened by itself", async () => {
    await render(app(phoneThatSaw(BUILD_VERSION)));
    await screen.findByText("the screen index");
    await fireEvent.press(screen.getByRole("button", { name: "take" }));
    expect(screen.getByText("taken: nothing")).toBeOnTheScreen();
  });

  it("decides once when React runs its effects twice (StrictMode): one read, one write, one opening", async () => {
    const store = phoneThatSaw(LOWER);
    await render(<StrictMode>{app(store)}</StrictMode>);
    expect(await screen.findByText("the screen index")).toBeOnTheScreen();
    expect(seenReads(store)).toBe(1);
    expect(seenWrites(store)).toEqual([[HISTORY_SEEN_VERSION_KEY, BUILD_VERSION]]);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("leaves the user on the Library when the history cannot be opened", async () => {
    jest.mocked(router.push).mockImplementation(() => {
      throw new Error("Attempted to navigate before mounting the Root Layout component.");
    });
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await render(app(phoneThatSaw(LOWER)));
    expect(await screen.findByText("the screen index")).toBeOnTheScreen();
    expect(router.push).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "take" }));
    expect(screen.getByText("taken: nothing")).toBeOnTheScreen();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("does not update after the screens are gone, when the version last seen is read too late", async () => {
    const store = phoneThatSaw(LOWER);
    const finishRead = holdTheReadOf(store);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await render(app(store));
    await screen.findByTestId("history-reading");
    await screen.unmount();
    finishRead(LOWER);
    await everyPromiseSettled();
    // The decision is made, as its write shows: the read's continuation has run, and with it the
    // place where the history would have been opened.
    expect(seenWrites(store)).toEqual([[HISTORY_SEEN_VERSION_KEY, BUILD_VERSION]]);
    expect(router.push).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("the version history's start outside its provider", () => {
  it("cannot be asked for the decision's entries", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Taker />)).rejects.toThrow(
      "the version history must be used inside a HistoryProvider",
    );
    errors.mockRestore();
  });

  it("cannot be told of a screen", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Stack screens={[LIBRARY]} />)).rejects.toThrow(
      "the version history must be used inside a HistoryProvider",
    );
    errors.mockRestore();
  });
});
