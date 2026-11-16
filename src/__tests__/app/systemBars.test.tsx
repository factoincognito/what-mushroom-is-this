/**
 * No screen draws what the user needs under the phone's system bars or its display cutout
 * (PBI-2.20: the Library's "Settings" link lay behind Android's navigation buttons). On Android
 * the app's window covers the whole display, the status bar and the navigation bar included
 * (edge-to-edge), and the phone reports how much of each edge the bars and the cutout take: the
 * insets. Here the phone's report is the event that the safe-area provider's native view sends,
 * and the tests read where the screens are laid out. Under Jest nothing is drawn, so what the bars
 * cover on a real phone is not seen here.
 *
 * It lives here, not next to the routes, because expo-router makes every file under src/app a
 * route.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { getLocales } from "expo-localization";
import * as Location from "expo-location";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { AppState } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { INSTALL_MARKER_KEY } from "../../key/apiKey";
import { fetchDevicePicture } from "../../picture/devicePicture";
import { memoryFindLog } from "../../testing/memoryFindLog";
import { appSourceFiles, fs, PROJECT_ROOT, path } from "../../testing/projectFiles";
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
jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-location", () => ({
  Accuracy: { Highest: 5 },
  watchPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("../../image/deviceJpegEncoder", () => ({ deviceJpegEncoder: { load: jest.fn() } }));
jest.mock("../../picture/devicePicture", () => ({
  fetchDevicePicture: jest.fn(),
  removePictureCopy: jest.fn(),
}));

/** The find log in memory, with no finds. (Named `mock…` so that the hoisted factory may use it.) */
const mockLog = memoryFindLog();
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));

const APP_DIR = "./src/app";
const en = STRINGS.en;
const FRAME = { x: 0, y: 0, width: 412, height: 915 };

/** A status bar of 40 and Android's three navigation buttons, 48 high. */
const THREE_BUTTONS: EdgeInsets = { top: 40, bottom: 48, left: 0, right: 0 };
/** The same phone with gesture navigation: a lower bar at the bottom. */
const GESTURES: EdgeInsets = { top: 40, bottom: 24, left: 0, right: 0 };
/** Insets on all four edges, as a cutout that reaches the sides would give. */
const ALL_EDGES: EdgeInsets = { top: 40, bottom: 48, left: 7, right: 9 };

/**
 * Every route file under src/app with an address that opens it. A route file this table does not
 * name stops the file's tests (below), so a new screen cannot go unchecked.
 */
const ROUTES: readonly { readonly file: string; readonly url: string }[] = [
  { file: "index.tsx", url: "/" },
  { file: "new-find.tsx", url: "/new-find" },
  { file: "text-lookup.tsx", url: "/text-lookup" },
  { file: "settings.tsx", url: "/settings" },
  { file: "about.tsx", url: "/about" },
  { file: "find/[id].tsx", url: "/find/1" },
  { file: "+not-found.tsx", url: "/no-such-screen" },
];

const routeFiles = fs
  .readdirSync(path.join(PROJECT_ROOT, "src", "app"), { recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !/(^|[\\/])_layout\.tsx$/.test(file))
  .map((file) => file.replace(/\\/g, "/"))
  .sort();
const tableFiles = ROUTES.map((route) => route.file).sort();
if (JSON.stringify(routeFiles) !== JSON.stringify(tableFiles)) {
  throw new Error(
    `ROUTES names ${tableFiles.join(", ")}, and src/app holds ${routeFiles.join(", ")}`,
  );
}

type Node = (typeof screen)["container"];

/** A value of a type the test does not build in full. */
function wrong<T>(value: unknown): T {
  return value as T;
}

const refused = { status: "denied", granted: false, canAskAgain: false, expires: "never" };

/** Sets the stand-ins each test starts from: nothing is granted, picked or fetched. */
async function resetStandIns(): Promise<void> {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockLog.finds.clear();
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode: "en", languageTag: "en" } as ReturnType<typeof getLocales>[number],
    ]);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(wrong(refused));
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(wrong(refused));
  jest.mocked(Location.watchPositionAsync).mockResolvedValue(wrong({ remove: () => undefined }));
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
  jest.mocked(ImagePicker.getCameraPermissionsAsync).mockResolvedValue(wrong(refused));
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(wrong(refused));
  jest
    .mocked(ImagePicker.launchCameraAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue(wrong({ canceled: true, assets: null }));
  jest
    .mocked(fetchDevicePicture)
    .mockResolvedValue({ kind: "waits", cause: "network", retryAtMs: null });
  // In the background, so that no queue run starts by itself.
  Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
}

beforeEach(resetStandIns);

afterAll(() => {
  Object.defineProperty(AppState, "currentState", { value: undefined, configurable: true });
});

/** Opens the app at an address, on a phone that reports the given insets. */
async function startApp(url: string, insets: EdgeInsets): Promise<void> {
  await renderRouter(APP_DIR, { initialUrl: url });
  await phoneReports(insets);
}

/** The phone reports its insets: the event the safe-area provider's native view sends. */
async function phoneReports(insets: EdgeInsets): Promise<void> {
  const providers = all("RNCSafeAreaProvider");
  expect(providers).toHaveLength(1);
  await fireEvent(wrong(providers[0]), "insetsChange", { nativeEvent: { insets, frame: FRAME } });
}

/** Every native element of a type, below `from`. */
function all(type: string, from: Node = screen.container): Node[] {
  return from.queryAll((node) => node.type === type);
}

/** The screen areas at or above an element, the nearest first. */
function areasAround(element: Node): Node[] {
  const areas: Node[] = [];
  for (let node: Node | null = element; node !== null; node = node.parent) {
    if (node.props.testID === "screen-area") {
      areas.push(node);
    }
  }
  return areas;
}

/** The one screen area that holds an element. */
function areaOf(element: Node): Node {
  const areas = areasAround(element);
  // Two would add the inset twice.
  expect(areas).toHaveLength(1);
  return wrong(areas[0]);
}

/**
 * Checks every screen the stack holds, and gives their count: all that the screen draws below its
 * header is inside one screen area, which keeps clear of the bottom, left and right insets, and
 * the header, shown, takes the top inset, so the area adds none.
 */
function expectScreensClearOf(insets: EdgeInsets): number {
  const screens = all("RNSScreen");
  for (const each of screens) {
    const [content, ...others] = all("RNSScreenContentWrapper", each);
    expect(others).toEqual([]);
    const drawn = wrong<Node>(content).children;
    expect(drawn).toHaveLength(1);
    const area = wrong<Node>(drawn[0]);
    expect(area.props.testID).toBe("screen-area");
    // The screen itself is in it: an area around nothing would say nothing of the screen.
    expect(area.children.length).toBeGreaterThan(0);
    expect(each.queryAll((node) => node.props.testID === "screen-area")).toEqual([area]);
    expect(area).toHaveStyle({
      flex: 1,
      paddingTop: 0,
      paddingBottom: insets.bottom,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    });
    const [header, ...otherHeaders] = all("RNSScreenStackHeaderConfig", each);
    expect(otherHeaders).toEqual([]);
    expect(wrong<Node>(header).props.hidden).toBe(false);
    expect(wrong<Node>(header).props.topInsetEnabled).toBe(insets.top > 0);
  }
  return screens.length;
}

// The router's first load is paid before the tests, not in the first of them (PBI-1.28).
warmUpRouter(async () => {
  await resetStandIns();
  await startApp("/", THREE_BUTTONS);
  await screen.findByText(en.log.empty);
});

describe("the Library, where the Settings link lay behind the navigation buttons (PBI-2.20)", () => {
  it("lays the Settings link, and the links above it, out above the three buttons", async () => {
    await startApp("/", THREE_BUTTONS);
    for (const name of [en.log.settings, en.log.textLookup, en.log.newFind]) {
      const area = areaOf(await screen.findByRole("link", { name }));
      expect(area).toHaveStyle({ paddingBottom: 48 });
    }
  });

  it("follows the phone from the three buttons to gesture navigation", async () => {
    await startApp("/", THREE_BUTTONS);
    const settings = await screen.findByRole("link", { name: en.log.settings });
    expect(areaOf(settings)).toHaveStyle({ paddingBottom: 48 });
    await phoneReports(GESTURES);
    expect(areaOf(screen.getByRole("link", { name: en.log.settings }))).toHaveStyle({
      paddingBottom: 24,
    });
  });
});

describe("every screen of the app", () => {
  it.each(ROUTES)("$file is laid out clear of the bars and the cutout", async ({ url }) => {
    await startApp(url, ALL_EDGES);
    expect(expectScreensClearOf(ALL_EDGES)).toBe(1);
  });

  it("is laid out the same way when it is opened over another screen", async () => {
    await startApp("/", THREE_BUTTONS);
    await fireEvent.press(await screen.findByRole("link", { name: en.log.settings }));
    const about = await screen.findByRole("link", { name: en.about.title });
    expect(areaOf(about)).toHaveStyle({ paddingBottom: 48 });
    expect(expectScreensClearOf(THREE_BUTTONS)).toBe(2);
  });
});

describe("the first-start disclaimer, which has no header above it", () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(DISCLAIMER_ACCEPTED_KEY);
  });

  it("keeps its text and its button clear of all four edges", async () => {
    await startApp("/", ALL_EDGES);
    const accept = await screen.findByRole("button", { name: en.firstStart.accept });
    const area = areaOf(accept);
    expect(areaOf(screen.getByText(en.disclaimer))).toBe(area);
    expect(areaOf(screen.getByText(en.firstStart.title))).toBe(area);
    expect(area).toHaveStyle({
      flex: 1,
      paddingTop: 40,
      paddingBottom: 48,
      paddingLeft: 7,
      paddingRight: 9,
    });
  });

  it("hands the edges over to the screens once it is accepted, so no inset is added twice", async () => {
    await startApp("/", ALL_EDGES);
    await fireEvent.press(await screen.findByRole("button", { name: en.firstStart.accept }));
    await screen.findByText(en.log.empty);
    expect(expectScreensClearOf(ALL_EDGES)).toBe(1);
  });
});

describe("the app's source", () => {
  it("reads the insets in one place, the screen area, so that no screen adds its own", () => {
    const src = path.join(PROJECT_ROOT, "src");
    const readers = appSourceFiles()
      .filter((file) => /from "react-native-safe-area-context"/.test(fs.readFileSync(file, "utf8")))
      .map((file) => file.slice(src.length + 1).replace(/\\/g, "/"));
    expect(readers).toEqual(["screen/ScreenArea.tsx"]);
  });
});
