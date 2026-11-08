import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getLocales } from "expo-localization";
import { Text } from "react-native";

import { LanguageProvider } from "../i18n/LanguageContext";
import { STRINGS } from "../i18n/strings";
import type { KeyValueStore } from "../storage/keyValueStore";
import { DISCLAIMER_ACCEPTED_KEY } from "./acceptance";
import { DisclaimerGate } from "./DisclaimerGate";

jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

/** Renders the gate with its own store, and the language choice with a store of its own. */
async function renderGate(store: KeyValueStore) {
  await render(
    <LanguageProvider store={memoryStore()}>
      <DisclaimerGate store={store}>
        <Text>the app</Text>
      </DisclaimerGate>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode: "en", languageTag: "en-GB" } as ReturnType<typeof getLocales>[number],
    ]);
});

describe("DisclaimerGate", () => {
  it("shows the disclaimer to be accepted at first start, and not the app", async () => {
    await renderGate(memoryStore());
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
    expect(screen.getByText(STRINGS.en.firstStart.title)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS.en.firstStart.accept })).toBeOnTheScreen();
    expect(screen.queryByText("the app")).not.toBeOnTheScreen();
  });

  it("shows the disclaimer in the phone's language", async () => {
    jest
      .mocked(getLocales)
      .mockReturnValue([
        { languageCode: "it", languageTag: "it-IT" } as ReturnType<typeof getLocales>[number],
      ]);
    await renderGate(memoryStore());
    expect(await screen.findByText(STRINGS.it.disclaimer)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS.it.firstStart.accept })).toBeOnTheScreen();
  });

  it("shows the app once the disclaimer is accepted, and stores the acceptance", async () => {
    const store = memoryStore();
    await renderGate(store);
    await fireEvent.press(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    );
    expect(await screen.findByText("the app")).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.disclaimer)).not.toBeOnTheScreen();
    expect(store.values.get(DISCLAIMER_ACCEPTED_KEY)).toBe("accepted");
  });

  it("shows the app at once, without the disclaimer, after it was accepted at an earlier start", async () => {
    await renderGate(memoryStore({ [DISCLAIMER_ACCEPTED_KEY]: "accepted" }));
    expect(await screen.findByText("the app")).toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.disclaimer)).not.toBeOnTheScreen();
  });

  it("shows neither the app nor the disclaimer while the stored state is being read", async () => {
    const store: KeyValueStore = {
      getItem: () => new Promise<string | null>(() => undefined),
      setItem: async () => undefined,
    };
    await renderGate(store);
    expect(screen.getByTestId("disclaimer-loading")).toBeOnTheScreen();
    expect(screen.queryByText("the app")).not.toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.disclaimer)).not.toBeOnTheScreen();
  });

  it("shows the disclaimer when the stored state cannot be read", async () => {
    const store: KeyValueStore = {
      getItem: async () => {
        throw new Error("storage unavailable");
      },
      setItem: async () => undefined,
    };
    await renderGate(store);
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
    expect(screen.queryByText("the app")).not.toBeOnTheScreen();
  });

  it("does not update after it is gone, when the stored state is read too late", async () => {
    let finishRead: (value: string | null) => void = () => undefined;
    const store: KeyValueStore = {
      getItem: () =>
        new Promise<string | null>((resolve) => {
          finishRead = resolve;
        }),
      setItem: async () => undefined,
    };
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderGate(store);
    await screen.unmount();
    await act(async () => {
      finishRead("accepted");
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("does not update after it is gone, when storing the acceptance finishes too late", async () => {
    let finishWrite: () => void = () => undefined;
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    };
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderGate(store);
    await fireEvent.press(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    );
    await screen.unmount();
    await act(async () => {
      finishWrite();
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("still shows the app after acceptance when storing it fails, and asks again at the next start", async () => {
    const failing: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("disk full");
      },
    };
    await renderGate(failing);
    await fireEvent.press(
      await screen.findByRole("button", { name: STRINGS.en.firstStart.accept }),
    );
    expect(await screen.findByText("the app")).toBeOnTheScreen();

    await screen.unmount();
    await renderGate(failing);
    expect(await screen.findByText(STRINGS.en.disclaimer)).toBeOnTheScreen();
  });
});
