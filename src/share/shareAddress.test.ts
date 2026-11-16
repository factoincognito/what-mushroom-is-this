import { routeOfSystemPath, SHARE_ROUTE } from "./shareAddress";

const appJson: { expo: { scheme: string } } = jest.requireActual("../../app.json");

/**
 * The address expo-sharing gives the app for a share on Android (57.0.26,
 * `android/.../ShareIntoUtils.kt`, read): the scheme its config plugin writes into the string
 * `share_into_scheme`, which is the app's own scheme, and the host `expo-sharing`.
 */
const SHARE_ADDRESS = `${appJson.expo.scheme}://expo-sharing`;

describe("routeOfSystemPath: where an address from outside the app leads (SPEC 3.9, Shared photos)", () => {
  it("is written for the scheme app.json sets", () => {
    expect(SHARE_ADDRESS).toBe("what-mushroom-is-this://expo-sharing");
  });

  it("sends the library's share address to the choice", () => {
    expect(routeOfSystemPath(SHARE_ADDRESS)).toBe(SHARE_ROUTE);
    expect(SHARE_ROUTE).toBe("/share");
  });

  it.each([
    `${SHARE_ADDRESS}/`,
    `${SHARE_ADDRESS}?uri=file%3A%2F%2F%2Fdata%2Fphoto.jpg`,
    `${SHARE_ADDRESS}/?find=7&photos=content%3A%2F%2Fa%2F1`,
    `${SHARE_ADDRESS}#x`,
  ])("carries nothing of the address %s on to the choice", (address) => {
    expect(routeOfSystemPath(address)).toBe("/share");
  });

  it.each([
    "what-mushroom-is-this://",
    "what-mushroom-is-this:///",
    "what-mushroom-is-this://settings",
    "what-mushroom-is-this://find/7",
    "what-mushroom-is-this://expo-sharing-other",
    "what-mushroom-is-this://expo-sharing/more",
    "what-mushroom-is-this://new-find?next=expo-sharing",
    "other-app://expo-sharing",
    "https://expo-sharing",
    "/expo-sharing",
    "expo-sharing",
    "",
  ])("leaves the address %p as it is", (address) => {
    expect(routeOfSystemPath(address)).toBe(address);
  });
});

describe("the router's native-intent file", () => {
  const nativeIntent: {
    redirectSystemPath(event: { path: string; initial: boolean }): string;
  } = jest.requireActual("../app/+native-intent");

  it.each([true, false])(
    "sends a share to the choice, when it starts the app (%p) and when the app runs",
    (initial) => {
      expect(nativeIntent.redirectSystemPath({ path: SHARE_ADDRESS, initial })).toBe("/share");
    },
  );

  it("leaves any other address to the router", () => {
    expect(
      nativeIntent.redirectSystemPath({ path: "what-mushroom-is-this://settings", initial: true }),
    ).toBe("what-mushroom-is-this://settings");
  });
});
