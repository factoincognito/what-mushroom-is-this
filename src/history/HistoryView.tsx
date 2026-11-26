import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import { formatEntryDate, type HistoryEntry } from "./entries";

type HistoryViewProps = {
  /** The entries to show, in this order. */
  readonly entries: readonly HistoryEntry[];
  /**
   * Shows the full history, when the screen shows only what is new; null when it shows every
   * entry, and then there is no button.
   */
  readonly onShowFull: (() => void) | null;
};

/**
 * What the version history screen shows (docs/SPEC.md 3.10, item 3): each entry as a heading with
 * the word for "Version", the version and the entry's date, and under it the entry's lines in the
 * app's language, in the order of the data, as plain text; and below the entries the button "Show
 * full history", when there is more to show. It scrolls down when its text does not fit, and
 * never sideways. It shows only what it is given, which is text built into the app.
 */
export function HistoryView({ entries, onShowFull }: HistoryViewProps) {
  const { language, strings } = useLanguage();
  const t = strings.history;
  return (
    <ScrollView contentContainerStyle={styles.container} testID="history">
      {entries.map((entry) => {
        const date = formatEntryDate(entry.date, language);
        const named = `${t.version} ${entry.version}`;
        return (
          <View key={entry.version} style={styles.entry} testID={`history-entry-${entry.version}`}>
            <Text accessibilityRole="header" style={styles.heading}>
              {date === null ? named : `${named} (${date})`}
            </Text>
            {entry.lines[language].map((line) => (
              <Text key={line} style={styles.text}>
                {line}
              </Text>
            ))}
          </View>
        );
      })}
      {onShowFull !== null && (
        <Pressable accessibilityRole="button" onPress={onShowFull} style={styles.button}>
          <Text style={styles.text}>{t.showFull}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 24,
  },
  entry: {
    gap: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
});
