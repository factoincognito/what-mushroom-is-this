import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { getLocales } from "expo-localization";

import { LanguageProvider } from "../i18n/LanguageContext";
import { LANGUAGES, type Language } from "../i18n/languages";
import { STRINGS } from "../i18n/strings";
import type { KeyValueStore } from "../storage/keyValueStore";
import { formatEntryDate, HISTORY, type HistoryEntry } from "./entries";
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

const ENTRIES: readonly HistoryEntry[] = [
  {
    version: "1.10.0",
    date: "2027-01-01",
    lines: {
      sv: ["En svensk rad.", "En andra svensk rad."],
      en: ["An English line.", "A second English line."],
      it: ["Una riga italiana.", "Una seconda riga italiana."],
    },
  },
  {
    version: "0.9.0",
    date: "2026-11-16",
    lines: {
      sv: ["Den äldre versionens rad."],
      en: ["The older version's line."],
      it: ["La riga della versione precedente."],
    },
  },
];

async function renderView(
  entries: readonly HistoryEntry[],
  onShowFull: (() => void) | null = null,
): Promise<void> {
  await render(
    <LanguageProvider store={NO_CHOICE}>
      <HistoryView entries={entries} onShowFull={onShowFull} />
    </LanguageProvider>,
  );
  await screen.findByTestId("history");
}

/** The text of an entry's heading: the word for "Version", the version and the date. */
function headingOf(entry: HistoryEntry, language: Language): string {
  return `${STRINGS[language].history.version} ${entry.version} (${formatEntryDate(entry.date, language)})`;
}

/** The texts the screen shows, in the order it shows them. */
function textsShown(): string[] {
  return screen
    .getAllByText(/\S/)
    .map((node) => node.props.children)
    .filter((text): text is string => typeof text === "string");
}

beforeEach(() => {
  phoneIn("en");
});

describe("the history's entries on the screen (SPEC 3.10, item 3)", () => {
  it("shows each entry as a heading with the word Version, the version and its date", async () => {
    await renderView(ENTRIES);
    expect(screen.getByRole("header", { name: "Version 1.10.0 (Jan 1, 2027)" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Version 0.9.0 (Nov 16, 2026)" })).toBeOnTheScreen();
  });

  it("has a heading for each entry and no other, as headings to a screen reader", async () => {
    await renderView(ENTRIES);
    expect(screen.getAllByRole("header")).toHaveLength(2);
  });

  it("shows the entries in the order given, each heading followed by its lines in the order of the data", async () => {
    await renderView(ENTRIES);
    expect(textsShown()).toEqual([
      "Version 1.10.0 (Jan 1, 2027)",
      "An English line.",
      "A second English line.",
      "Version 0.9.0 (Nov 16, 2026)",
      "The older version's line.",
    ]);
  });

  it("keeps each entry's lines with their own entry", async () => {
    await renderView(ENTRIES);
    const newer = within(screen.getByTestId("history-entry-1.10.0"));
    expect(newer.getByText("An English line.")).toBeOnTheScreen();
    expect(newer.getByText("A second English line.")).toBeOnTheScreen();
    expect(newer.queryByText("The older version's line.")).not.toBeOnTheScreen();
    const older = within(screen.getByTestId("history-entry-0.9.0"));
    expect(older.getByText("The older version's line.")).toBeOnTheScreen();
  });

  it.each(LANGUAGES)(
    "shows the headings and the lines of the app's language, %s, and no other's",
    async (language) => {
      phoneIn(language);
      await renderView(ENTRIES);
      for (const entry of ENTRIES) {
        expect(screen.getByRole("header", { name: headingOf(entry, language) })).toBeOnTheScreen();
        for (const line of entry.lines[language]) {
          expect(screen.getByText(line)).toBeOnTheScreen();
        }
        for (const other of LANGUAGES.filter((each) => each !== language)) {
          for (const line of entry.lines[other]) {
            expect(screen.queryByText(line)).not.toBeOnTheScreen();
          }
        }
      }
    },
  );

  it("names the version and writes the date in each language's own way", async () => {
    const [newer] = ENTRIES as [HistoryEntry, HistoryEntry];
    expect(headingOf(newer, "en")).toBe("Version 1.10.0 (Jan 1, 2027)");
    expect(headingOf(newer, "sv")).toMatch(/^Version 1\.10\.0 \(1 jan\.? 2027\)$/);
    expect(headingOf(newer, "it")).toMatch(/^Versione 1\.10\.0 \(1 gen 2027\)$/);
  });

  it("shows a line with < and & in it as the text it is", async () => {
    const line = 'Use <b>bold</b> & <script>alert("x")</script> as text, 1 < 2 > 0.';
    await renderView([
      { version: "0.3.0", date: "2026-12-01", lines: { sv: [line], en: [line], it: [line] } },
    ]);
    expect(screen.getByText(line)).toBeOnTheScreen();
    expect(textsShown()).toEqual(["Version 0.3.0 (Dec 1, 2026)", line]);
  });

  it("shows the heading without a date for an entry whose date is no calendar date (the list as built has none)", async () => {
    await renderView([
      { version: "0.3.0", date: "2026-02-30", lines: { sv: ["rad"], en: ["line"], it: ["riga"] } },
    ]);
    expect(screen.getByRole("header", { name: "Version 0.3.0" })).toBeOnTheScreen();
    expect(screen.getByText("line")).toBeOnTheScreen();
  });

  it("shows no entry, and still the screen, for an empty list (the list as built has entries)", async () => {
    await renderView([]);
    expect(screen.queryByRole("header")).not.toBeOnTheScreen();
  });

  it("scrolls down, never sideways", async () => {
    await renderView(ENTRIES);
    expect(screen.getByTestId("history").props.horizontal ?? false).toBe(false);
  });

  it("shows every entry the app is built with, each with its heading and its lines", async () => {
    await renderView(HISTORY);
    expect(screen.getAllByRole("header")).toHaveLength(HISTORY.length);
    for (const entry of HISTORY) {
      expect(screen.getByRole("header", { name: headingOf(entry, "en") })).toBeOnTheScreen();
      const shown = within(screen.getByTestId(`history-entry-${entry.version}`));
      for (const line of entry.lines.en) {
        expect(shown.getByText(line)).toBeOnTheScreen();
      }
    }
  });
});

describe('the button "Show full history" (SPEC 3.10, item 3)', () => {
  it("is not there when the screen shows every entry", async () => {
    await renderView(ENTRIES);
    expect(screen.queryByRole("button")).not.toBeOnTheScreen();
    expect(screen.queryByText(STRINGS.en.history.showFull)).not.toBeOnTheScreen();
  });

  it("is a button to a screen reader, below the entries, when the screen shows what is new", async () => {
    await renderView(ENTRIES, () => undefined);
    expect(screen.getByRole("button", { name: "Show full history" })).toBeOnTheScreen();
    expect(textsShown().at(-1)).toBe("Show full history");
  });

  it("asks for the full history when it is pressed, once", async () => {
    const onShowFull = jest.fn();
    await renderView(ENTRIES, onShowFull);
    await fireEvent.press(screen.getByRole("button", { name: "Show full history" }));
    expect(onShowFull).toHaveBeenCalledTimes(1);
  });

  it.each(LANGUAGES)("is named in the app's language, %s", async (language) => {
    phoneIn(language);
    await renderView(ENTRIES, () => undefined);
    expect(
      screen.getByRole("button", { name: STRINGS[language].history.showFull }),
    ).toBeOnTheScreen();
  });
});
