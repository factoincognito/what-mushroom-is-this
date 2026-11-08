import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import { LANGUAGES } from "../i18n/languages";
import { STRINGS } from "../i18n/strings";

/**
 * The Settings screen (docs/SPEC.md 3.1). For now only the app's language; the API key and the
 * model come in PBI-1.2.
 */
export default function SettingsScreen() {
  const { language, strings, chooseLanguage } = useLanguage();
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        {strings.settings.languageHeading}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {LANGUAGES.map((code) => (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ checked: code === language }}
            onPress={() => chooseLanguage(code)}
            style={[styles.option, code === language && styles.chosen]}
          >
            <Text style={styles.optionText}>{STRINGS[code].languageName}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: "bold",
  },
  options: {
    gap: 8,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  chosen: {
    borderWidth: 3,
  },
  optionText: {
    fontSize: 16,
  },
});
