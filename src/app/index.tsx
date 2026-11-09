import { Link } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import { formatTimeIn, noticeMessage, stopNeedsSettings } from "../queue/messages";
import { useQueue } from "../queue/QueueContext";

/**
 * The Log screen, the start screen (docs/SPEC.md 3.1). "New find" opens the New find screen;
 * the list of finds comes in PBI-1.8 and is empty for now. When the queue has stopped, it says why
 * and offers "analyse now", and a link to Settings when the stop names a setting; when the last
 * run left the finds waiting, it says why.
 */
export default function LogScreen() {
  const { language, strings } = useLanguage();
  const { state, analyseNow } = useQueue();
  const formatTime = useMemo(() => formatTimeIn(language), [language]);
  const { stop, pause, running } = state;
  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <Text style={styles.empty}>{strings.log.empty}</Text>
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
      <Link href="/settings" accessibilityRole="link" style={styles.link}>
        {strings.log.settings}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  list: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
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
