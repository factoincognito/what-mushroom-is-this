import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import type { Notices } from "./notices";

type AboutViewProps = {
  readonly notices: Notices;
};

/**
 * The About view (docs/SPEC.md 3.1): the app's own licence with its required notice, the
 * disclaimer of SPEC 3.5, the map data credits with links to their pages (SPEC 3.9, PBI-2.8),
 * and the licences of the libraries the app ships. A licence text is shown when asked for, as the
 * texts are long.
 */
export function AboutView({ notices }: AboutViewProps) {
  const { strings } = useLanguage();
  const t = strings.about;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.section} testID="licence-app">
        <Text accessibilityRole="header" style={styles.heading}>
          {t.appHeading}
        </Text>
        <Text style={styles.name}>{notices.app.licence}</Text>
        <Text style={styles.text}>{notices.app.requiredNotice}</Text>
        <Text style={styles.text}>{notices.app.url}</Text>
        <LicenceText text={notices.texts[notices.app.textId]} />
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t.disclaimerHeading}
        </Text>
        <Text style={styles.text}>{strings.disclaimer}</Text>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t.mapDataHeading}
        </Text>
        <Text style={styles.text}>{t.mapDataIntro}</Text>
        {notices.mapData.map((entry) => (
          <View key={entry.name} style={styles.library} testID={`map-data-${entry.name}`}>
            <Text style={styles.name}>{entry.credit}</Text>
            <Text style={styles.text}>{entry.licence}</Text>
            <Pressable
              accessibilityRole="link"
              // A page that cannot be opened (no browser) leaves the user on About.
              onPress={() => void Linking.openURL(entry.url).catch(() => undefined)}
            >
              <Text style={[styles.text, styles.link]}>{entry.url}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t.librariesHeading}
        </Text>
        <Text style={styles.text}>{t.librariesIntro}</Text>
        {notices.libraries.map((library) => (
          <View key={library.name} style={styles.library} testID={`licence-${library.name}`}>
            <Text style={styles.name}>{library.name}</Text>
            <Text style={styles.text}>{library.version ?? t.versionNotPinned}</Text>
            <Text style={styles.text}>{library.licence}</Text>
            <Text style={styles.text}>{library.source}</Text>
            <LicenceText
              text={library.textId === null ? undefined : notices.texts[library.textId]}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** A licence text behind a button that shows and hides it, or a note that it is missing. */
function LicenceText({ text }: { readonly text: string | undefined }) {
  const { strings } = useLanguage();
  const t = strings.about;
  const [shown, setShown] = useState(false);
  if (text === undefined) {
    return <Text style={styles.note}>{t.textMissing}</Text>;
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        onPress={() => setShown((was) => !was)}
        style={styles.button}
      >
        <Text style={styles.text}>{shown ? t.hideText : t.showText}</Text>
      </Pressable>
      {shown && <Text style={styles.licence}>{text}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: "bold",
  },
  library: {
    gap: 4,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
  note: {
    fontSize: 14,
    fontStyle: "italic",
  },
  licence: {
    fontSize: 12,
  },
  link: {
    textDecorationLine: "underline",
  },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
});
