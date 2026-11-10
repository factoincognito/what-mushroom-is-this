import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { type ReactNode, useState } from "react";
import { Pressable, Text } from "react-native";

import { DEFAULT_FILTERS, type LibraryFilters } from "./filters";
import { LibraryFiltersProvider, useLibraryFilters } from "./LibraryFiltersContext";

function wrapper({ children }: { children: ReactNode }) {
  return <LibraryFiltersProvider>{children}</LibraryFiltersProvider>;
}

const CHOSEN: LibraryFilters = { ...DEFAULT_FILTERS, years: new Set([2026]) };

/** Shows the years chosen, and sets the filters to `CHOSEN` when pressed. */
function Consumer() {
  const { filters, setFilters } = useLibraryFilters();
  const years = filters.years === "all" ? "all" : [...filters.years].join(",");
  return (
    <Pressable accessibilityRole="button" onPress={() => setFilters(CHOSEN)}>
      <Text>{years}</Text>
    </Pressable>
  );
}

/** Shows the consumer, or not, so that it can be unmounted and mounted again. */
function Toggled() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <Pressable accessibilityRole="switch" onPress={() => setShown((now) => !now)}>
        <Text>toggle</Text>
      </Pressable>
      {shown && <Consumer />}
    </>
  );
}

describe("LibraryFiltersProvider (SPEC 3.9: held while the app runs, the defaults at its start)", () => {
  it("gives the defaults at first", async () => {
    const { result } = await renderHook(() => useLibraryFilters(), { wrapper });
    expect(result.current.filters).toBe(DEFAULT_FILTERS);
  });

  it("holds a change while the screen that made it is gone and comes back", async () => {
    await render(
      <LibraryFiltersProvider>
        <Toggled />
      </LibraryFiltersProvider>,
    );
    expect(screen.getByText("all")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button"));
    expect(screen.getByText("2026")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("switch"));
    expect(screen.queryByText("2026")).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("switch"));
    expect(screen.getByText("2026")).toBeOnTheScreen();
  });

  it("starts a new provider, as at the app's start, at the defaults", async () => {
    const first = await renderHook(() => useLibraryFilters(), { wrapper });
    await act(async () => first.result.current.setFilters(CHOSEN));
    expect(first.result.current.filters).toBe(CHOSEN);
    await first.unmount();
    const second = await renderHook(() => useLibraryFilters(), { wrapper });
    expect(second.result.current.filters).toBe(DEFAULT_FILTERS);
  });

  it("takes a change given as a function of the filters before it", async () => {
    const { result } = await renderHook(() => useLibraryFilters(), { wrapper });
    await act(async () =>
      result.current.setFilters((before) => ({ ...before, months: new Set([9]) })),
    );
    expect(result.current.filters).toEqual({ ...DEFAULT_FILTERS, months: new Set([9]) });
  });
});

describe("useLibraryFilters", () => {
  it("throws outside a LibraryFiltersProvider", async () => {
    function Outside() {
      useLibraryFilters();
      return null;
    }
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Outside />)).rejects.toThrow(
      "useLibraryFilters must be used inside a LibraryFiltersProvider",
    );
    spy.mockRestore();
  });
});
