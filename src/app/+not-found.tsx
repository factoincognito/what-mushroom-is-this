import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";

/**
 * The screen for an address that matches no route, in the app's language, with a way back to
 * Log. As a route of `src/app`, it renders inside the root layout, so the first-start
 * disclaimer comes before it, as it comes before every other screen.
 */
export default function NotFoundScreen() {
  const { strings } = useLanguage();
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{strings.notFound.message}</Text>
      <Link href="/" replace accessibilityRole="link" style={styles.link}>
        {strings.notFound.back}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  message: {
    fontSize: 16,
  },
  link: {
    fontSize: 16,
    paddingVertical: 8,
  },
});
