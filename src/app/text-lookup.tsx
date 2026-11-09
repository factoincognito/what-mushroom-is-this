import { router, useNavigation } from "expo-router";
import { type NavigationAction, usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { config } from "../config/config";
import { AnswerView, NoticeView } from "../find/FindScreen";
import { useLanguage } from "../i18n/LanguageContext";
import { readTextLookupSave } from "../lookup/saveSetting";
import {
  INITIAL_TEXT_LOOKUP_VIEW,
  TextLookupFlow,
  type TextLookupView,
} from "../lookup/textLookupFlow";
import { deviceLocationSource, locationPermission } from "../position/deviceLocation";
import { formatTimeIn } from "../queue/messages";
import { useQueue } from "../queue/QueueContext";
import { deviceStore } from "../storage/keyValueStore";
import { useFindLog } from "../store/FindLogContext";

/**
 * The text lookup screen (docs/SPEC.md 3.9, Lookups): a description of up to the configured
 * number of characters, the "Save" switch from its starting value in Settings, and "Analyse".
 * With Save on, "Analyse" saves the lookup as a find and opens its screen, and leaving the screen
 * with text entered saves it too, the leave waiting for the save. With Save off, "Analyse"
 * analyses it here and shows the answer as a find's screen would, with the disclaimer for a
 * lookup without photos; leaving with text entered asks first, on the screen (as SPEC 3.1 does
 * for a photo).
 */
export default function TextLookupScreen() {
  const { language, strings } = useLanguage();
  const t = strings.lookup;
  const findLog = useFindLog();
  const { analyseLookup } = useQueue();
  const formatTime = useMemo(() => formatTimeIn(language), [language]);
  const [view, setView] = useState<TextLookupView>(INITIAL_TEXT_LOOKUP_VIEW);
  const [flow] = useState(
    () =>
      new TextLookupFlow(
        {
          findLog,
          analyseLookup,
          readSaveSetting: () => readTextLookupSave(deviceStore),
          location: { permission: locationPermission, source: deviceLocationSource },
          appConfig: config,
          now: () => new Date(),
        },
        setView,
      ),
  );

  useEffect(() => {
    void flow.start();
    return () => flow.close();
  }, [flow]);

  const navigation = useNavigation();
  /** The leaving that waits, for the answer to "leave" or for the end of the save under way. */
  const [leaving, setLeaving] = useState<NavigationAction | null>(null);
  usePreventRemove(view.holdsLeave, ({ data }) => {
    if (flow.askToLeave()) {
      setLeaving(data.action);
    }
  });
  // The held leaving goes on once nothing holds the screen: the lookup was saved, or dropped. A
  // lookup that "Analyse" saved opens its find's screen in place of this one.
  const savedId = view.saved?.by === "analyse" ? view.saved.id : null;
  useEffect(() => {
    if (view.holdsLeave) {
      return;
    }
    if (leaving !== null) {
      setLeaving(null);
      navigation.dispatch(leaving);
    } else if (savedId !== null) {
      router.replace(`/find/${savedId}`);
    }
  }, [leaving, view.holdsLeave, savedId, navigation]);

  const ready = view.phase === "ready";
  const busy = view.phase === "analysing" || view.phase === "saving";
  const locationRefused = view.location === "denied" || view.location === "blocked";
  const count = [...view.text].length;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {view.phase === "starting" && <Text style={styles.text}>{t.asking}</Text>}
      <TextInput
        accessibilityLabel={t.input}
        placeholder={t.input}
        value={view.text}
        onChangeText={(text) => flow.setText(text)}
        editable={!busy && view.phase !== "saved"}
        maxLength={config.lookupTextMaxLength}
        multiline
        style={styles.input}
      />
      <Text style={styles.note}>
        {t.count
          .replace("{count}", String(count))
          .replace("{max}", String(config.lookupTextMaxLength))}
      </Text>
      <View style={styles.row}>
        <Switch
          accessibilityLabel={t.save}
          value={view.save}
          disabled={!ready}
          onValueChange={(on) => flow.setSave(on)}
        />
        <Text style={styles.text}>{t.save}</Text>
      </View>
      <Text style={styles.note}>{t.saveHint}</Text>
      {locationRefused && (
        <>
          <Text style={styles.text}>{t.locationDenied}</Text>
          <Pressable accessibilityRole="button" onPress={openSettings} style={styles.button}>
            <Text style={styles.buttonText}>{t.openSettings}</Text>
          </Pressable>
        </>
      )}
      {view.confirming === "leave" ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {t.leaveConfirm}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => flow.discardAndLeave()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t.leaveYes}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              flow.stay();
              setLeaving(null);
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t.leaveCancel}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          // The analysis's promise is not given back: the screen follows it through the view it
          // is shown, and React Native Testing Library's `fireEvent.press` would await it.
          onPress={() => void flow.analyse()}
          style={[styles.button, !ready && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t.analyse}</Text>
        </Pressable>
      )}
      {busy && (
        <View style={styles.row}>
          <ActivityIndicator testID="lookup-busy" />
          <Text style={styles.text}>{view.phase === "saving" ? t.saving : t.analysing}</Text>
        </View>
      )}
      {view.message !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t[view.message]}
        </Text>
      )}
      {view.outcome?.kind === "answer" && (
        <AnswerView
          answer={view.outcome.answer}
          subject="described"
          language={language}
          strings={strings}
        />
      )}
      {view.outcome?.kind === "notice" && (
        <View testID="lookup-notice" style={styles.section}>
          <NoticeView
            notice={view.outcome.notice}
            subject="described"
            strings={strings}
            formatTime={formatTime}
          />
        </View>
      )}
      {view.outcome?.kind === "error" && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.analysisError}
        </Text>
      )}
      {view.offerSave && (
        <Pressable
          accessibilityRole="button"
          onPress={() => flow.turnSaveOn()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{t.turnSaveOn}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function openSettings(): void {
  Linking.openSettings().catch(() => undefined);
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  section: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    fontSize: 16,
    minHeight: 120,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    textAlignVertical: "top",
  },
  text: {
    fontSize: 16,
  },
  note: {
    fontSize: 14,
  },
  button: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
  },
});
