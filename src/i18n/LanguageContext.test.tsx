import { act, render, screen } from "@testing-library/react-native";
import { getLocales } from "expo-localization";
import { Text } from "react-native";

import { LanguageProvider, useLanguage } from "./LanguageContext";
import type { Language } from "./languages";

jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

const mockedGetLocales = jest.mocked(getLocales);

function phoneIn(languageCode: string | null): void {
  mockedGetLocales.mockReturnValue([
    { languageCode, languageTag: languageCode ?? "und" } as ReturnType<typeof getLocales>[number],
  ]);
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

beforeEach(() => {
  choose = undefined;
  mockedGetLocales.mockReset();
});

describe("LanguageProvider", () => {
  it("starts in the phone's language when it is one of the three", async () => {
    phoneIn("sv");
    await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("sv:Svenska");
  });

  it("starts in English when the phone's language is another", async () => {
    phoneIn("fi");
    await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("en:English");
  });

  it("starts in English when reading the phone's locales throws", async () => {
    mockedGetLocales.mockImplementation(() => {
      throw new Error("native module missing");
    });
    await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("en:English");
  });

  it("switches to a chosen language, which overrides the phone's", async () => {
    phoneIn("sv");
    await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await act(async () => {
      choose?.("it");
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("it:Italiano");
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
