/**
 * An entry's date is a calendar day, shown as that day whatever the phone's time zone (SPEC 3.10,
 * item 3). This file's phone is in a zone west of UTC, where a date read as midnight UTC falls on
 * the day before.
 *
 * @jest-environment ./src/testing/westOfUtcEnvironment.js
 */
import { render, screen } from "@testing-library/react-native";
import { getLocales } from "expo-localization";

import { LanguageProvider } from "../i18n/LanguageContext";
import { LANGUAGES } from "../i18n/languages";
import type { KeyValueStore } from "../storage/keyValueStore";
import { formatEntryDate, HISTORY } from "./entries";
import { HistoryView } from "./HistoryView";

jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

const NO_CHOICE: KeyValueStore = {
  getItem: async () => null,
  setItem: async () => undefined,
};

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

const LINES = { sv: ["rad"], en: ["line"], it: ["riga"] };

describe("on a phone in a time zone west of UTC", () => {
  it("is such a phone: midnight UTC is the evening of the day before there", () => {
    expect(new Date(2026, 10, 16).getTimezoneOffset()).toBeGreaterThan(0);
    expect(new Date(Date.UTC(2026, 10, 16)).getDate()).toBe(15);
    expect(
      new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(Date.UTC(2026, 10, 16)),
    ).toBe("Nov 15, 2026");
  });

  it("shows an entry's date as its own day, not the day before", async () => {
    phoneIn("en");
    await render(
      <LanguageProvider store={NO_CHOICE}>
        <HistoryView
          entries={[{ version: "0.2.1", date: "2026-11-16", lines: LINES }]}
          onShowFull={null}
        />
      </LanguageProvider>,
    );
    expect(
      await screen.findByRole("header", { name: "Version 0.2.1 (Nov 16, 2026)" }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Nov 15/)).not.toBeOnTheScreen();
  });

  it("shows the first day of a year and of a month as that day", async () => {
    phoneIn("en");
    await render(
      <LanguageProvider store={NO_CHOICE}>
        <HistoryView
          entries={[
            { version: "0.3.0", date: "2027-01-01", lines: LINES },
            { version: "0.2.2", date: "2026-12-01", lines: LINES },
          ]}
          onShowFull={null}
        />
      </LanguageProvider>,
    );
    expect(
      await screen.findByRole("header", { name: "Version 0.3.0 (Jan 1, 2027)" }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Version 0.2.2 (Dec 1, 2026)" })).toBeOnTheScreen();
  });

  it.each(LANGUAGES)(
    "gives the day as written in %s, for every entry the app is built with",
    (language) => {
      for (const entry of HISTORY) {
        const [year, month, day] = entry.date.split("-").map(Number) as [number, number, number];
        const noonThere = new Date(year, month - 1, day, 12);
        expect(formatEntryDate(entry.date, language)).toBe(
          new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(noonThere),
        );
      }
    },
  );
});
