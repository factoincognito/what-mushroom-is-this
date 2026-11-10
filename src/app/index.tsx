import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  checkedEdibility,
  edibilityText,
  fillIn,
  formatFindTime,
  matchBasis,
  selfCheckReason,
} from "../find/display";
import { useLanguage } from "../i18n/LanguageContext";
import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
import {
  ALL,
  applyFilters,
  type Choice,
  type LibraryFilters,
  MONTHS,
  monthName,
  pruneFilters,
  speciesOptions,
  toggle,
  yearOptions,
} from "../library/filters";
import { useLibraryFilters } from "../library/LibraryFiltersContext";
import { formatTimeIn, noticeMessage, stopNeedsSettings } from "../queue/messages";
import { useQueue } from "../queue/QueueContext";
import { useFindLog } from "../store/FindLogContext";
import { type FindSummary, type ListedFind, StoreError } from "../store/find";

/**
 * One entry of the store's list: a find it could read, or the mark of one it could not, in its
 * place (PBI-1.16).
 */
type LogEntry = ListedFind;

/** What the screen has read of the log. */
type ListState =
  | { kind: "loading" }
  | { kind: "ready"; entries: LogEntry[] }
  /** The store could not give the list; the error itself is not shown. */
  | { kind: "unreadable" };

/**
 * The Library, the start screen in place of the Log (docs/SPEC.md 3.9, PBI-2.7). It opens on its
 * list, the only view so far: the map and the switch between the two are PBI-2.8, which shows the
 * same filtered finds, so the filters are applied here, above the list. The filters (species,
 * years, months) are held above the screens while the app runs (`LibraryFiltersProvider`) and are
 * opened and closed by a button; a chosen species or year that no find has any longer is dropped.
 * A find that could not be read is always listed, whatever the filters. A find without photos
 * shows the text mark in place of a photo; a find with photos shows its first (Clead's decision on
 * #63). The rest is the Log's, kept as it was:
 *
 * The finds, newest first as the store lists
 * them, each with its photo, date and time, the species name in the app's language and the
 * edibility of the matched species ("unknown" below the confidence line, SPEC 3.9, or when a Phase 1
 * level is low, SPEC 3.3) with the
 * disclaimer next to it (SPEC 3.5); a find still waiting or failed says so, and each opens its own
 * screen. A find the store cannot read is a row of its own, in its place, saying so; with its ID it
 * opens the find's screen, where it can be deleted (PBI-1.16), and without one the row itself
 * offers Delete (PBI-1.26). A list the store cannot give at all
 * is shown as unreadable, with a way to read it again. The list is read again when the screen
 * comes into view and when a queue run ends. When the queue has stopped, it says why and offers
 * "analyse now", and a link to Settings when the stop names a setting; when the last run left the
 * finds waiting, it says why. "New find" opens the New find screen, and "Describe a mushroom" the
 * text lookup (SPEC 3.9). A text find without photos is listed with no photo, its answer with the
 * disclaimer for a lookup without photos, and "no mushroom" and "cannot tell" in the words of a
 * description (PBI-2.4).
 */
export default function LibraryScreen() {
  const { language, strings } = useLanguage();
  const { state, analyseNow } = useQueue();
  const findLog = useFindLog();
  const { filters, setFilters } = useLibraryFilters();
  const formatTime = useMemo(() => formatTimeIn(language), [language]);
  const { stop, pause, running } = state;
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** The latest read; an earlier one that ends later is dropped. */
  const latestRead = useRef(0);

  const load = useCallback(async () => {
    const read = ++latestRead.current;
    let next: ListState;
    try {
      next = { kind: "ready", entries: await (await findLog()).list() };
    } catch {
      next = { kind: "unreadable" };
    }
    if (read === latestRead.current) {
      setList(next);
    }
  }, [findLog]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // A run changes the log; it is read again when the run ends.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void load();
    }
    wasRunning.current = running;
  }, [running, load]);

  // A choice is among the finds (SPEC 3.9): one no find has any longer is dropped. Unchanged
  // filters come back as they were, so this sets nothing then.
  useEffect(() => {
    if (list.kind === "ready") {
      setFilters((now) => pruneFilters(now, list.entries));
    }
  }, [list, setFilters]);

  const shown = useMemo(
    () => (list.kind === "ready" ? applyFilters(list.entries, filters) : []),
    [list, filters],
  );
  const filtered = filters.species !== ALL || filters.years !== ALL || filters.months !== ALL;

  return (
    <View style={styles.container}>
      {list.kind === "ready" && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          onPress={() => setFiltersOpen((open) => !open)}
          style={styles.filterButton}
        >
          <Text style={styles.buttonText}>
            {filtered ? strings.log.filtersOn : strings.log.filters}
          </Text>
        </Pressable>
      )}
      {list.kind === "ready" && filtersOpen && (
        <FilterPanel
          entries={list.entries}
          filters={filters}
          onChange={setFilters}
          language={language}
          strings={strings}
        />
      )}
      <View style={styles.list}>
        {list.kind === "loading" && <ActivityIndicator testID="log-loading" />}
        {list.kind === "unreadable" && (
          <View style={styles.centred}>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {strings.log.unreadable}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}>
              <Text style={styles.buttonText}>{strings.log.retry}</Text>
            </Pressable>
          </View>
        )}
        {list.kind === "ready" && (
          <FlatList
            data={shown}
            keyExtractor={entryKey}
            renderItem={({ item }) => (
              <LogRow
                entry={item}
                language={language}
                strings={strings}
                onRemoved={() => void load()}
              />
            )}
            ListEmptyComponent={
              <View style={styles.centred}>
                <Text style={styles.empty}>
                  {list.entries.length === 0 ? strings.log.empty : strings.log.noMatch}
                </Text>
              </View>
            }
            contentContainerStyle={styles.rows}
          />
        )}
      </View>
      {running && (
        <View style={styles.row}>
          <ActivityIndicator testID="queue-running" />
          <Text style={styles.text}>{strings.queue.running}</Text>
        </View>
      )}
      {stop !== null ? (
        <View style={styles.notice}>
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {noticeMessage({ kind: "stopped", stop }, strings, formatTime)}
          </Text>
          {stopNeedsSettings(stop) && (
            <Link href="/settings" accessibilityRole="link" style={styles.link}>
              {strings.queue.openSettings}
            </Link>
          )}
          <Pressable accessibilityRole="button" onPress={analyseNow} style={styles.button}>
            <Text style={styles.buttonText}>{strings.queue.analyseNow}</Text>
          </Pressable>
        </View>
      ) : (
        pause !== null &&
        !running && (
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {noticeMessage({ kind: "paused", cause: pause }, strings, formatTime)}
          </Text>
        )
      )}
      <Link href="/new-find" accessibilityRole="link" style={styles.button}>
        {strings.log.newFind}
      </Link>
      <Link href="/text-lookup" accessibilityRole="link" style={styles.button}>
        {strings.log.textLookup}
      </Link>
      <Link href="/settings" accessibilityRole="link" style={styles.link}>
        {strings.log.settings}
      </Link>
    </View>
  );
}

type LogRowProps = {
  readonly entry: LogEntry;
  readonly language: Language;
  readonly strings: Strings;
  /** A find was deleted from its row: the list is read again. */
  readonly onRemoved: () => void;
};

/**
 * The key of an entry's row: its find's ID; for an entry without an ID, its ID as SQLite writes it,
 * so that a row keeps its own state, and no other row takes it over, when a row before it goes
 * (Clead's review of #33, fix 1). Only an entry with neither is keyed by its place in the list,
 * which is the store's order and so the same at every reading of an unchanged log; such a row has
 * no state of its own.
 */
function entryKey(entry: LogEntry, index: number): string {
  if (entry.id !== null) {
    return String(entry.id);
  }
  if (entry.storedId !== null) {
    return `stored-${entry.storedId}`;
  }
  return `no-id-${index}`;
}

/** One entry of the list, by its kind. */
function LogRow({ entry, language, strings, onRemoved }: LogRowProps) {
  if (!entry.readable) {
    return entry.id === null ? (
      <WithoutIdRow storedId={entry.storedId} strings={strings} onRemoved={onRemoved} />
    ) : (
      <UnreadableRow id={entry.id} strings={strings} />
    );
  }
  return <FindRow find={entry} language={language} strings={strings} />;
}

type WithoutIdRowProps = {
  readonly storedId: string | null;
  readonly strings: Strings;
  readonly onRemoved: () => void;
};

/**
 * A find whose ID the store cannot read: there is no screen to open, so the row says the find
 * cannot be read and itself offers Delete, which asks first, as the Find screen's does
 * (PBI-1.26). Without even the ID as SQLite writes it, it is text alone.
 */
function WithoutIdRow({ storedId, strings, onRemoved }: WithoutIdRowProps) {
  const findLog = useFindLog();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = strings.find;

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await (await findLog()).deleteUnreadable(id);
      // Its question is answered: it does not stay open (Clead's review of #33, fix 1).
      setConfirming(false);
      onRemoved();
    } catch (error) {
      if (error instanceof StoreError && error.code === "not-found") {
        onRemoved();
        return;
      }
      setConfirming(false);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID="unreadable-row" style={styles.unreadableRow}>
      <Text style={styles.text}>{t.unreadable}</Text>
      {storedId !== null &&
        (confirming ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {t.deleteConfirm}
            </Text>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void remove(storedId)}
                style={styles.rowButton}
              >
                <Text style={styles.buttonText}>{t.deleteYes}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setConfirming(false)}
                style={styles.rowButton}
              >
                <Text style={styles.buttonText}>{t.deleteCancel}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirming(true)}
            style={styles.rowButton}
          >
            <Text style={styles.buttonText}>{t.delete}</Text>
          </Pressable>
        ))}
      {failed && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.deleteFailed}
        </Text>
      )}
    </View>
  );
}

/**
 * A find the store cannot read, with its ID: it opens the find's own screen, which says the same
 * and offers Delete.
 */
function UnreadableRow({ id, strings }: { readonly id: number; readonly strings: Strings }) {
  const text = <Text style={styles.text}>{strings.find.unreadable}</Text>;
  return (
    <Link href={`/find/${id}`} asChild>
      <Pressable accessibilityRole="link" testID={`find-row-${id}`} style={styles.findRow}>
        {text}
      </Pressable>
    </Link>
  );
}

type FindRowProps = {
  readonly find: FindSummary;
  readonly language: Language;
  readonly strings: Strings;
};

/** One find in the list; it opens the find's own screen. */
function FindRow({ find, language, strings }: FindRowProps) {
  return (
    <Link href={`/find/${find.id}`} asChild>
      <Pressable accessibilityRole="link" testID={`find-row-${find.id}`} style={styles.findRow}>
        {find.photoUri !== null ? (
          <Image
            source={{ uri: find.photoUri }}
            accessibilityLabel={strings.find.photo}
            style={styles.thumbnail}
          />
        ) : (
          // PBI-2.9's representative picture is to take the text mark's place (SPEC 3.9).
          <View
            accessible
            accessibilityLabel={strings.log.textMarkLabel}
            style={[styles.thumbnail, styles.textMark]}
          >
            <Text style={styles.textMarkText}>{strings.log.textMark}</Text>
          </View>
        )}
        <View style={styles.findText}>
          <Text style={styles.note}>{formatFindTime(find.time, language)}</Text>
          <SummaryView find={find} language={language} strings={strings} />
        </View>
      </Pressable>
    </Link>
  );
}

function SummaryView({ find, language, strings }: FindRowProps) {
  const { analysis } = find;
  const described = find.photoUri === null;
  switch (analysis.state) {
    case "waiting":
      return <Text style={styles.text}>{strings.log.waiting}</Text>;
    case "failed":
      return <Text style={styles.text}>{strings.log.failed}</Text>;
    case "done": {
      if (analysis.result !== "match") {
        const t = strings.find;
        const said =
          analysis.result === "no_mushroom"
            ? described
              ? t.noMushroomDescribed
              : t.noMushroom
            : described
              ? t.cannotTellDescribed
              : t.cannotTell;
        return <Text style={styles.text}>{said}</Text>;
      }
      // An answer from the text alone shows "unknown" until its self-check agrees (SPEC 3.9).
      const reason = selfCheckReason(find.selfCheck, analysis.names, language, strings);
      return (
        <>
          <Text style={styles.name}>{analysis.names[language]}</Text>
          <Text style={styles.text}>
            {fillIn(strings.find.edibility, {
              edibility: edibilityText(checkedEdibility(analysis, find.selfCheck), strings),
            })}
          </Text>
          {reason !== null && <Text style={styles.note}>{reason}</Text>}
          {/* The disclaimer follows what the answer was based on (Clead's decision 3 on #57). */}
          <Text style={styles.note}>
            {matchBasis(find.selfCheck) === "described"
              ? strings.disclaimerDescribed
              : strings.disclaimer}
          </Text>
        </>
      );
    }
  }
}

type FilterPanelProps = {
  readonly entries: readonly LogEntry[];
  readonly filters: LibraryFilters;
  readonly onChange: (filters: LibraryFilters) => void;
  readonly language: Language;
  readonly strings: Strings;
};

/**
 * The species, years and months filters, each a row of choices led by its default: the species
 * and the years among the finds (`speciesOptions`, `yearOptions`), the twelve months by name.
 */
function FilterPanel({ entries, filters, onChange, language, strings }: FilterPanelProps) {
  const t = strings.log;
  const species = speciesOptions(entries, language);
  return (
    <ScrollView style={styles.filterPanel} contentContainerStyle={styles.filterGroups}>
      <FilterGroup
        heading={t.species}
        allLabel={t.allSpecies}
        choice={filters.species}
        values={species.map((option) => ({
          value: option.choice,
          label: option.names === null ? t.notIdentified : option.names[language],
        }))}
        onChange={(choice) => onChange({ ...filters, species: choice })}
      />
      <FilterGroup
        heading={t.years}
        allLabel={t.allYears}
        choice={filters.years}
        values={yearOptions(entries).map((year) => ({ value: year, label: String(year) }))}
        onChange={(choice) => onChange({ ...filters, years: choice })}
      />
      <FilterGroup
        heading={t.months}
        allLabel={t.allMonths}
        choice={filters.months}
        values={MONTHS.map((month) => ({ value: month, label: monthName(month, language) }))}
        onChange={(choice) => onChange({ ...filters, months: choice })}
      />
    </ScrollView>
  );
}

type FilterGroupProps<T> = {
  readonly heading: string;
  readonly allLabel: string;
  readonly choice: Choice<T>;
  readonly values: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (choice: Choice<T>) => void;
};

/** One filter: its default, which chooses all again, then its values, each chosen or not. */
function FilterGroup<T>({ heading, allLabel, choice, values, onChange }: FilterGroupProps<T>) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.name}>{heading}</Text>
      <View style={styles.chips}>
        <Chip label={allLabel} checked={choice === ALL} onPress={() => onChange(ALL)} />
        {values.map(({ value, label }) => (
          <Chip
            key={String(value)}
            label={label}
            checked={choice !== ALL && choice.has(value)}
            onPress={() => onChange(toggle(choice, value))}
          />
        ))}
      </View>
    </View>
  );
}

type ChipProps = {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
};

function Chip({ label, checked, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.chip, checked && styles.chipChecked]}
    >
      <Text style={styles.note}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterButton: {
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterPanel: {
    maxHeight: 280,
    flexGrow: 0,
  },
  filterGroups: {
    gap: 12,
  },
  filterGroup: {
    gap: 6,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipChecked: {
    borderWidth: 3,
  },
  textMark: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textMarkText: {
    fontSize: 14,
    fontWeight: "bold",
  },
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  list: {
    flex: 1,
    justifyContent: "center",
  },
  rows: {
    flexGrow: 1,
    gap: 12,
  },
  centred: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  findRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  unreadableRow: {
    gap: 8,
  },
  rowButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 4,
  },
  findText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
  },
  empty: {
    fontSize: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notice: {
    gap: 8,
  },
  text: {
    fontSize: 16,
  },
  note: {
    fontSize: 14,
  },
  button: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    textAlign: "center",
  },
  link: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 8,
  },
});
