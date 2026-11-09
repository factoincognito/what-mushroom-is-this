import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import { cameraPermission, pickFromGallery, takePhoto } from "../newFind/devicePicker";
import { INITIAL_VIEW, NewFindFlow, type NewFindView } from "../newFind/newFindFlow";
import { useFindLog } from "../store/FindLogContext";

/**
 * The New find screen (docs/SPEC.md 3.1): opens the camera at once; a photo can also be picked
 * from the gallery. The find is saved before any analysis; no analysis is started here.
 */
export default function NewFindScreen() {
  const { strings } = useLanguage();
  const t = strings.newFind;
  const findLog = useFindLog();
  const [view, setView] = useState<NewFindView>(INITIAL_VIEW);
  const [flow] = useState(
    () =>
      new NewFindFlow(
        {
          findLog,
          camera: { permission: cameraPermission, take: takePhoto },
          gallery: { pick: pickFromGallery },
          now: () => new Date(),
        },
        setView,
      ),
  );

  useEffect(() => {
    flow.start();
    return () => flow.close();
  }, [flow]);

  const canChoose = view.phase === "ready";

  return (
    <View style={styles.container}>
      {view.phase === "starting" && <Text style={styles.text}>{t.asking}</Text>}
      {(view.phase === "saving" || view.phase === "busy" || view.phase === "starting") && (
        <ActivityIndicator testID="new-find-busy" />
      )}
      {view.phase === "saving" && <Text style={styles.text}>{t.saving}</Text>}
      {view.message !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t[view.message]}
        </Text>
      )}
      {view.phase === "saved" ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {t.saved}
          </Text>
          <Pressable accessibilityRole="button" onPress={goBack} style={styles.button}>
            <Text style={styles.buttonText}>{t.back}</Text>
          </Pressable>
        </>
      ) : view.canRetrySave ? (
        // The photo whose save failed is kept until it is saved or discarded (SPEC 3.1: a find
        // is never lost), so no new photo is offered meanwhile.
        <>
          <Pressable
            accessibilityRole="button"
            disabled={!canChoose}
            onPress={() => flow.retrySave()}
            style={[styles.button, !canChoose && styles.disabled]}
          >
            <Text style={styles.buttonText}>{t.retrySave}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canChoose}
            onPress={() => flow.discardPending()}
            style={[styles.button, !canChoose && styles.disabled]}
          >
            <Text style={styles.buttonText}>{t.discardPhoto}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={!canChoose}
            onPress={() => flow.takePhoto()}
            style={[styles.button, !canChoose && styles.disabled]}
          >
            <Text style={styles.buttonText}>{t.takePhoto}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canChoose}
            onPress={() => flow.pickFromGallery()}
            style={[styles.button, !canChoose && styles.disabled]}
          >
            <Text style={styles.buttonText}>{t.pickFromGallery}</Text>
          </Pressable>
        </>
      )}
      {view.message === "cameraBlocked" && (
        <Pressable accessibilityRole="button" onPress={openSettings} style={styles.button}>
          <Text style={styles.buttonText}>{t.openSettings}</Text>
        </Pressable>
      )}
    </View>
  );
}

function goBack(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/");
  }
}

function openSettings(): void {
  Linking.openSettings().catch(() => undefined);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  text: {
    fontSize: 16,
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
