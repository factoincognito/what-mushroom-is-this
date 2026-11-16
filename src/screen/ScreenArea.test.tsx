import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { type EdgeInsets, SafeAreaProvider } from "react-native-safe-area-context";

import { ScreenArea } from "./ScreenArea";

const FRAME = { x: 0, y: 0, width: 412, height: 915 };

/** A status bar, the three navigation buttons, and a cutout that takes a little of each side. */
const INSETS: EdgeInsets = { top: 40, bottom: 48, left: 7, right: 9 };

/** Renders the area inside a provider that starts from the given insets, as the phone's would. */
async function renderArea(top: boolean, insets: EdgeInsets = INSETS) {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets }}>
      <ScreenArea top={top}>
        <Text>content</Text>
      </ScreenArea>
    </SafeAreaProvider>,
  );
}

/** The phone reports new insets: the event the provider's native view sends. */
async function phoneReports(insets: EdgeInsets): Promise<void> {
  const [provider] = screen.container.queryAll((node) => node.type === "RNCSafeAreaProvider");
  if (provider === undefined) {
    throw new Error("no safe-area provider is rendered");
  }
  await fireEvent(provider, "insetsChange", { nativeEvent: { insets, frame: FRAME } });
}

describe("ScreenArea", () => {
  it("keeps what it holds clear of the bottom, left and right insets", async () => {
    await renderArea(false);
    expect(screen.getByTestId("screen-area")).toHaveStyle({
      paddingBottom: 48,
      paddingLeft: 7,
      paddingRight: 9,
    });
  });

  it("leaves the top inset to the header above it unless told to take it", async () => {
    await renderArea(false);
    expect(screen.getByTestId("screen-area")).toHaveStyle({ paddingTop: 0 });
  });

  it("keeps clear of the top inset too where nothing above it does", async () => {
    await renderArea(true);
    expect(screen.getByTestId("screen-area")).toHaveStyle({
      paddingTop: 40,
      paddingBottom: 48,
      paddingLeft: 7,
      paddingRight: 9,
    });
  });

  it("fills the space it is given and holds its content", async () => {
    await renderArea(false);
    const area = screen.getByTestId("screen-area");
    expect(area).toHaveStyle({ flex: 1 });
    expect(screen.getByText("content").parent).toBe(area);
  });

  it("adds nothing on a phone that reports no insets", async () => {
    await renderArea(true, { top: 0, bottom: 0, left: 0, right: 0 });
    expect(screen.getByTestId("screen-area")).toHaveStyle({
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
    });
  });

  it("follows the insets when the phone changes them", async () => {
    await renderArea(true);
    // From the three buttons to gesture navigation, and a status bar of another height.
    await phoneReports({ top: 32, bottom: 24, left: 0, right: 0 });
    expect(screen.getByTestId("screen-area")).toHaveStyle({
      paddingTop: 32,
      paddingBottom: 24,
      paddingLeft: 0,
      paddingRight: 0,
    });
  });

  it("fails, rather than draw under the bars, where nothing gives it the insets", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        render(
          <ScreenArea top={false}>
            <Text>content</Text>
          </ScreenArea>,
        ),
      ).rejects.toThrow("No safe area value available");
    } finally {
      errors.mockRestore();
    }
  });
});
