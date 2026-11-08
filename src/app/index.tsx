import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";

/**
 * The Log screen, the start screen (docs/SPEC.md 3.1). "New find" opens the New find screen;
 * the list of finds comes in PBI-1.8 and is empty for now.
 */
export default function LogScreen() {
  const { strings } = useLanguage();
  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <Text style={styles.empty}>{strings.log.empty}</Text>
      </View>
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
  button: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  link: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 8,
  },
});
