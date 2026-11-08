import { act, render, screen } from "@testing-library/react-native";
import { getLocales } from "expo-localization";
import { Text } from "react-native";

import type { KeyValueStore } from "../storage/keyValueStore";
import { LanguageProvider, useLanguage } from "./LanguageContext";
import { LANGUAGE_CHOICE_KEY } from "./languageChoice";
import type { Language } from "./languages";

jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

const mockedGetLocales = jest.mocked(getLocales);

function phoneIn(languageCode: string | null): void {
  mockedGetLocales.mockReturnValue([
    { languageCode, languageTag: languageCode ?? "und" } as ReturnType<typeof getLocales>[number],
  ]);
}

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

let choose: ((language: Language) => void) | undefined;

function Probe() {
  const { language, strings, chooseLanguage } = useLanguage();
  choose = chooseLanguage;
  return (
    <Text testID="probe">
      {language}:{strings.languageName}
    </Text>
  );
}

async function renderProvider(store: KeyValueStore = memoryStore()) {
  await render(
    <LanguageProvider store={store}>
      <Probe />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  choose = undefined;
  mockedGetLocales.mockReset();
});

describe("LanguageProvider", () => {
  it("starts in the phone's language when it is one of the three", async () => {
    phoneIn("sv");
    await renderProvider();
    expect(await screen.findByTestId("probe")).toHaveTextContent("sv:Svenska");
  });

  it("starts in English when the phone's language is another", async () => {
    phoneIn("fi");
    await renderProvider();
    expect(await screen.findByTestId("probe")).toHaveTextContent("en:English");
  });

  it("starts in English when reading the phone's locales throws", async () => {
    mockedGetLocales.mockImplementation(() => {
      throw new Error("native module missing");
    });
    await renderProvider();
    expect(await screen.findByTestId("probe")).toHaveTextContent("en:English");
  });

  it("switches to a chosen language, which overrides the phone's", async () => {
    phoneIn("sv");
    await renderProvider();
    await screen.findByTestId("probe");
    await act(async () => {
      choose?.("it");
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("it:Italiano");
  });

  it("saves the chosen language in the store", async () => {
    phoneIn("sv");
    const store = memoryStore();
    await renderProvider(store);
    await screen.findByTestId("probe");
    await act(async () => {
      choose?.("en");
    });
    expect(store.values.get(LANGUAGE_CHOICE_KEY)).toBe("en");
  });

  it("starts in the language chosen at an earlier start, over the phone's", async () => {
    phoneIn("sv");
    await renderProvider(memoryStore({ [LANGUAGE_CHOICE_KEY]: "it" }));
    expect(await screen.findByTestId("probe")).toHaveTextContent("it:Italiano");
  });

  it("shows nothing in the phone's language before the earlier choice is read", async () => {
    phoneIn("sv");
    let release: (value: string | null) => void = () => undefined;
    const slowStore: KeyValueStore = {
      getItem: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      setItem: async () => undefined,
    };
    await renderProvider(slowStore);
    expect(screen.queryByTestId("probe")).not.toBeOnTheScreen();
    await act(async () => {
      release("it");
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("it:Italiano");
  });

  it("starts in the phone's language when the stored choice cannot be read", async () => {
    phoneIn("sv");
    const store: KeyValueStore = {
      getItem: async () => {
        throw new Error("storage unavailable");
      },
      setItem: async () => undefined,
    };
    await renderProvider(store);
    expect(await screen.findByTestId("probe")).toHaveTextContent("sv:Svenska");
  });

  it("still switches to the chosen language when saving it fails", async () => {
    phoneIn("sv");
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("disk full");
      },
    };
    await renderProvider(store);
    await screen.findByTestId("probe");
    await act(async () => {
      choose?.("en");
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("en:English");
  });
});

describe("useLanguage", () => {
  it("throws outside a LanguageProvider", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow(
      "useLanguage must be used inside a LanguageProvider",
    );
    spy.mockRestore();
  });
});
