import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";

/**
 * The Log screen, the start screen (docs/SPEC.md 3.1). For now the list of finds is empty and
 * "New find" is a disabled placeholder; later items fill both.
 */
export default function LogScreen() {
  const { strings } = useLanguage();
  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <Text style={styles.empty}>{strings.log.empty}</Text>
      </View>
      <Pressable accessibilityRole="button" disabled style={styles.button}>
        <Text style={styles.disabledText}>{strings.log.newFind}</Text>
      </Pressable>
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
  button: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    opacity: 0.5,
  },
  disabledText: {
    fontSize: 16,
  },
  link: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 8,
  },
});
