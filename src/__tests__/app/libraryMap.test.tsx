/**
 * The Library's map (docs/SPEC.md 3.9, PBI-2.8), through the router: the switch between the list
 * and the map, the map's opening area from the phone's position or its fallbacks, the pins of the
 * finds that pass the filters and lie in the area shown, following zoom and pan, what tapping a pin
 * shows and opens, the tiles' style, the attribution and the library's logo, and the app's own
 * User-Agent on the map's requests. The map library is the Jest mock beside `node_modules`
 * (`__mocks__/@maplibre/maplibre-react-native.ts`); the phone's location is mocked at expo-location,
 * and the find log is in memory. The 5-second wait for a fix is tested with fake timers in
 * `src/library/mapOpening.test.ts`; here a fix comes at once, or the location is refused.
 */
import { TransformRequestManager } from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { getLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import { AppState } from "react-native";

import type { Answer, Match } from "../../analysis/answer";
import { config } from "../../config/config";
import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { squareAround } from "../../library/mapArea";
import { formatFindDate } from "../../library/mapPins";
import type { Find, Position } from "../../store/find";
import { memoryFindLog } from "../../testing/memoryFindLog";
import { fs, PROJECT_ROOT, path } from "../../testing/projectFiles";
import { warmUpRouter } from "../../testing/warmUpRouter";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

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
jest.mock("expo-location", () => ({
  Accuracy: { Highest: 5 },
  watchPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));

const APP_DIR = "./src/app";
const en = STRINGS.en;

const appJson: { expo: { name: string; version: string } } = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "app.json"), "utf8"),
);

const CHANTERELLE: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "En gul svamp.", en: "A yellow mushroom.", it: "Un fungo giallo." },
  lookAlikes: [],
};
const FLY_AGARIC: Match = {
  ...CHANTERELLE,
  names: { sv: "Röd flugsvamp", en: "Fly agaric", la: "Amanita muscaria", it: "Ovolo malefico" },
  edibility: "poisonous",
};

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 1, 10, 0);

/** Where the phone is, and finds near it and far from it. */
const PHONE = { latitude: 59.64, longitude: 17.08 };
const NEAR: Position = { latitude: 59.65, longitude: 17.1, accuracyM: 5, source: "fix" };
const ALSO_NEAR: Position = { latitude: 59.63, longitude: 17.06, accuracyM: 5, source: "fix" };
const FAR: Position = { latitude: 59.86, longitude: 17.64, accuracyM: 5, source: "fix" };

function done(answer: Answer): Find["analysis"] {
  return { state: "done", answer, model: "claude-opus-5-5", analysedAtMs: BASE };
}

function find(
  id: number,
  daysLater: number,
  position: Position | null,
  analysis: Find["analysis"] = done(CHANTERELLE),
): Find {
  return {
    id,
    photoUri: `file:///photos/${id}.jpg`,
    time: { takenAtMs: BASE + daysLater * DAY, utcOffsetMinutes: 120, source: "saved" },
    position,
    analysis,
  };
}

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

type PermissionAnswer = Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>>;

function permissionAnswer(status: "granted" | "denied" | "undetermined"): PermissionAnswer {
  return { status, canAskAgain: true, granted: status === "granted", expires: "never" } as never;
}

const removeWatch = jest.fn();

/** The location allowed, and a fix at `at` the moment the app starts watching; none with null. */
function phoneAt(at: { latitude: number; longitude: number } | null): void {
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue(permissionAnswer("granted"));
  jest
    .mocked(Location.requestForegroundPermissionsAsync)
    .mockResolvedValue(permissionAnswer("granted"));
  jest.mocked(Location.watchPositionAsync).mockImplementation(async (_options, callback) => {
    if (at !== null) {
      callback({ coords: { ...at, accuracy: 5 }, timestamp: Date.now() } as never);
    }
    return { remove: removeWatch };
  });
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
}

/** The location refused before, so the map opens on its fallbacks at once. */
function locationRefused(): void {
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue(permissionAnswer("denied"));
}

async function startApp(initialUrl = "/"): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl });
  await app;
  return { pathname: () => app.getPathname() };
}

async function resetStandIns(): Promise<void> {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockSecrets.set(API_KEY_STORE_KEY, "sk-ant-api03-abcDEF_123");
  mockLog.finds.clear();
  mockLog.unreadable.clear();
  mockLog.withoutId.length = 0;
  phoneIn("en");
  phoneAt(PHONE);
  removeWatch.mockReset();
  jest.mocked(Location.requestForegroundPermissionsAsync).mockClear();
  jest.mocked(TransformRequestManager.addHeader).mockClear();
  // In the background: no queue run starts by itself.
  Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
}

beforeEach(resetStandIns);

warmUpRouter(async () => {
  await resetStandIns();
  mockLog.finds.set(1, find(1, 0, NEAR));
  await startApp();
  await screen.findByTestId("find-row-1");
});

/** Opens the map from the Library's switch and waits until it shows. */
async function openMap(strings = en) {
  await fireEvent.press(await screen.findByRole("button", { name: strings.log.mapView }));
  return screen.findByTestId("maplibre-map");
}

/** The IDs of the pins on the map, in order. */
function pinIds(): string[] {
  return screen
    .queryAllByTestId(/^maplibre-marker-/)
    .map((marker) => String(marker.props.testID).replace("maplibre-marker-", ""));
}

describe("the switch between the list and the map", () => {
  it("opens the Library on the list, with the switch showing the list as chosen", async () => {
    mockLog.finds.set(1, find(1, 0, NEAR));
    await startApp();
    expect(await screen.findByTestId("find-row-1")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.log.listView, selected: true })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.log.mapView, selected: false })).toBeOnTheScreen();
    expect(screen.queryByTestId("maplibre-map")).not.toBeOnTheScreen();
  });

  it("shows the map in place of the list, and the list again", async () => {
    mockLog.finds.set(1, find(1, 0, NEAR));
    await startApp();
    await openMap();
    expect(screen.queryByTestId("find-row-1")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.log.mapView, selected: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: en.log.listView }));
    expect(await screen.findByTestId("find-row-1")).toBeOnTheScreen();
    expect(screen.queryByTestId("maplibre-map")).not.toBeOnTheScreen();
  });

  it("keeps the new find, text lookup and Settings links with the map", async () => {
    await startApp();
    await openMap();
    expect(screen.getByRole("link", { name: en.log.newFind })).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.log.textLookup })).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: en.log.settings })).toBeOnTheScreen();
  });

  it.each([
    ["sv", STRINGS.sv],
    ["it", STRINGS.it],
  ] as const)("is in the app's language, %s", async (code, strings) => {
    phoneIn(code);
    await startApp();
    expect(await screen.findByRole("button", { name: strings.log.listView })).toBeOnTheScreen();
    await openMap(strings);
  });
});

describe("where the map opens (SPEC 3.9)", () => {
  it("asks for the location permission when the app has not yet asked", async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(permissionAnswer("undetermined"));
    await startApp();
    await openMap();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("says it is finding the position until the map can open", async () => {
    jest.mocked(Location.watchPositionAsync).mockImplementation(async () => ({
      remove: removeWatch,
    }));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.log.mapView }));
    expect(await screen.findByText(en.log.mapOpening)).toBeOnTheScreen();
    expect(screen.queryByTestId("maplibre-map")).not.toBeOnTheScreen();
  });

  it("opens on the phone's fix, the shorter side spanning 10 km", async () => {
    await startApp();
    await openMap();
    expect(screen.getByTestId("maplibre-camera").props.initialViewState).toEqual({
      bounds: squareAround(PHONE, 10_000),
    });
  });

  it("opens on the newest find with a position, at the same scale, without the location", async () => {
    locationRefused();
    mockLog.finds.set(1, find(1, 0, FAR));
    mockLog.finds.set(2, find(2, 1, NEAR));
    mockLog.finds.set(3, find(3, 2, null));
    await startApp();
    await openMap();
    expect(screen.getByTestId("maplibre-camera").props.initialViewState).toEqual({
      bounds: squareAround(NEAR, 10_000),
    });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("opens on the default area without the location and without a find with a position", async () => {
    locationRefused();
    mockLog.finds.set(1, find(1, 0, null));
    await startApp();
    await openMap();
    expect(screen.getByTestId("maplibre-camera").props.initialViewState).toEqual({
      bounds: config.mapDefaultArea,
    });
  });

  it("stops watching the position when the list is chosen again before the map opens", async () => {
    jest.mocked(Location.watchPositionAsync).mockImplementation(async () => ({
      remove: removeWatch,
    }));
    await startApp();
    await fireEvent.press(await screen.findByRole("button", { name: en.log.mapView }));
    await screen.findByText(en.log.mapOpening);
    await fireEvent.press(screen.getByRole("button", { name: en.log.listView }));
    expect(removeWatch).toHaveBeenCalled();
  });
});

describe("the map itself (SPEC 3.9)", () => {
  it("loads OpenFreeMap's style from the configuration", async () => {
    await startApp();
    const map = await openMap();
    expect(map.props.mapStyle).toBe(config.mapStyleUrl);
  });

  it("shows the attribution, which the library's (i) button lists, and the library's own logo", async () => {
    await startApp();
    const map = await openMap();
    expect(map.props.attribution).toBe(true);
    expect(map.props.logo).toBe(true);
  });

  it("gives every request of the map the app's own User-Agent before the map loads", async () => {
    await startApp();
    await openMap();
    expect(TransformRequestManager.addHeader).toHaveBeenCalledWith({
      id: "user-agent",
      name: "User-Agent",
      value: `${appJson.expo.name}/${appJson.expo.version} (https://github.com/factoincognito/what-mushroom-is-this)`,
    });
  });

  it("says so when the map cannot load its style, and keeps the map", async () => {
    await startApp();
    const map = await openMap();
    await act(async () => {
      map.props.onDidFailLoadingMap({ nativeEvent: null });
    });
    expect(screen.getByText(en.log.mapFailed)).toBeOnTheScreen();
    expect(screen.getByTestId("maplibre-map")).toBeOnTheScreen();
  });

  it("clears that message once the map loads", async () => {
    await startApp();
    const map = await openMap();
    await act(async () => {
      map.props.onDidFailLoadingMap({ nativeEvent: null });
    });
    await act(async () => {
      screen.getByTestId("maplibre-map").props.onDidFinishLoadingMap({ nativeEvent: null });
    });
    expect(screen.queryByText(en.log.mapFailed)).not.toBeOnTheScreen();
  });
});

describe("the pins (SPEC 3.9)", () => {
  beforeEach(() => {
    mockLog.finds.set(1, find(1, 0, NEAR));
    mockLog.finds.set(2, find(2, 1, FAR));
    mockLog.finds.set(3, find(3, 2, null));
    mockLog.finds.set(4, find(4, 3, ALSO_NEAR, done(FLY_AGARIC)));
    mockLog.finds.set(5, find(5, 4, ALSO_NEAR));
    mockLog.unreadable.add(5);
  });

  it("show the finds in the area shown, not those outside it, without a position, or unreadable", async () => {
    await startApp();
    await openMap();
    expect(pinIds()).toEqual(["4", "1"]);
  });

  it("follow a zoom or pan to another area", async () => {
    await startApp();
    const map = await openMap();
    await fireEvent(map, "regionDidChange", {
      nativeEvent: { bounds: [17.5, 59.8, 17.8, 59.9] },
    });
    expect(pinIds()).toEqual(["2"]);
    await fireEvent(screen.getByTestId("maplibre-map"), "regionDidChange", {
      nativeEvent: { bounds: [16.9, 59.5, 17.9, 59.95] },
    });
    expect(pinIds()).toEqual(["4", "2", "1"]);
  });

  it("stay as they were after an area event the app cannot read", async () => {
    await startApp();
    const map = await openMap();
    await fireEvent(map, "regionDidChange", { nativeEvent: { bounds: [1, 2, 3] } });
    expect(pinIds()).toEqual(["4", "1"]);
    await fireEvent(screen.getByTestId("maplibre-map"), "regionDidChange", {});
    expect(pinIds()).toEqual(["4", "1"]);
  });

  it("follow the Library's filters", async () => {
    await startApp();
    await openMap();
    await fireEvent.press(screen.getByRole("button", { name: en.log.filters }));
    await fireEvent.press(screen.getByRole("checkbox", { name: FLY_AGARIC.names.en }));
    expect(pinIds()).toEqual(["4"]);
  });

  it("show, when one is tapped, the find's species and date, which open the find", async () => {
    const app = await startApp();
    await openMap();
    await fireEvent.press(screen.getByTestId("maplibre-marker-1"));
    const date = formatFindDate(find(1, 0, NEAR).time, "en");
    const callout = within(screen.getByTestId("map-callout"));
    expect(callout.getByText(CHANTERELLE.names.en)).toBeOnTheScreen();
    expect(callout.getByText(date ?? "?")).toBeOnTheScreen();
    await fireEvent.press(callout.getByRole("link"));
    expect(app.pathname()).toBe("/find/1");
  });

  it("say 'not identified' for a find without an answer naming a species", async () => {
    mockLog.finds.set(1, find(1, 0, NEAR, { state: "waiting" }));
    await startApp();
    await openMap();
    await fireEvent.press(screen.getByTestId("maplibre-marker-1"));
    expect(
      within(screen.getByTestId("map-callout")).getByText(en.log.notIdentified),
    ).toBeOnTheScreen();
  });

  it("show the tapped one's details in the app's language", async () => {
    phoneIn("sv");
    await startApp();
    await openMap(STRINGS.sv);
    await fireEvent.press(screen.getByTestId("maplibre-marker-4"));
    expect(
      within(screen.getByTestId("map-callout")).getByText(FLY_AGARIC.names.sv),
    ).toBeOnTheScreen();
  });

  it("close the details when the map itself is tapped", async () => {
    await startApp();
    const map = await openMap();
    await fireEvent.press(screen.getByTestId("maplibre-marker-1"));
    expect(screen.getByTestId("map-callout")).toBeOnTheScreen();
    await act(async () => {
      map.props.onPress({ nativeEvent: { lngLat: [17, 59], point: [1, 1] } });
    });
    expect(screen.queryByTestId("map-callout")).not.toBeOnTheScreen();
  });

  it("close the details when the tapped find leaves the area shown", async () => {
    await startApp();
    const map = await openMap();
    await fireEvent.press(screen.getByTestId("maplibre-marker-1"));
    await fireEvent(map, "regionDidChange", {
      nativeEvent: { bounds: [17.5, 59.8, 17.8, 59.9] },
    });
    expect(screen.queryByTestId("map-callout")).not.toBeOnTheScreen();
  });
});
