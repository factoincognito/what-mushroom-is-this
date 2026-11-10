import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { type NavigationAction, usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { config } from "../config/config";
import { fillIn, parseFindId } from "../find/display";
import { useLanguage } from "../i18n/LanguageContext";
import type { Strings } from "../i18n/strings";
import { cameraPermission, pickFromGallery, takePhoto } from "../newFind/devicePicker";
import {
  INITIAL_VIEW,
  NewFindFlow,
  type NewFindTarget,
  type NewFindView,
} from "../newFind/newFindFlow";
import { deviceLocationSource, locationPermission } from "../position/deviceLocation";
import { useFindLog } from "../store/FindLogContext";

/**
 * The New find screen (docs/SPEC.md 3.1, 3.9): opens the camera at once; a photo can also be
 * picked from the gallery. The find is saved with its first photo before any analysis, its batch
 * open, and each photo after it is saved to it, up to the most a find holds (3.9, Batches).
 * "Analyse" completes the batch, which the queue then analyses, and opens the find's screen;
 * leaving the screen completes it too. With `?find=<id>` (from a find's screen) the photos are
 * added to that find, as a new batch, and "Analyse" goes back to where the screen was opened from.
 *
 * A photo whose save failed is kept, and is dropped only after a question on the screen: when
 * "Discard the photo" is tapped, and when the screen is left in any way (the header's back
 * button, Android's back button or gesture), which waits for the answer (PBI-1.20). A leave while
 * the photo is being saved, the first save or Save again, waits for the save: it goes ahead once
 * the save succeeds, and is asked once it fails (Clead's fix 1 on #32).
 */
export default function NewFindScreen() {
  const { strings } = useLanguage();
  const t = strings.newFind;
  const findLog = useFindLog();
  const { find } = useLocalSearchParams();
  const [target] = useState<NewFindTarget>(() =>
    find === undefined ? { kind: "new" } : { kind: "add", findId: parseFindId(find) },
  );
  const [view, setView] = useState<NewFindView>(INITIAL_VIEW);
  const [flow] = useState(
    () =>
      new NewFindFlow(
        {
          findLog,
          camera: { permission: cameraPermission, take: takePhoto },
          gallery: { pick: pickFromGallery },
          location: { permission: locationPermission, source: deviceLocationSource },
          appConfig: config,
          now: () => new Date(),
        },
        setView,
        target,
      ),
  );

  useEffect(() => {
    flow.start();
    return () => flow.close();
  }, [flow]);

  const locationRefused = view.location === "denied" || view.location === "blocked";
  const navigation = useNavigation();
  /**
   * The leaving that waits, for the answer to "leave" or for the end of the save under way (null
   * when none waits).
   */
  const [leaving, setLeaving] = useState<NavigationAction | null>(null);
  // The screen holds a leave while a photo is kept or being saved (Clead's fix 1 on #32).
  const holdsPhoto = view.canRetrySave || view.phase === "saving";
  usePreventRemove(holdsPhoto, ({ data }) => {
    if (flow.askToLeave()) {
      setLeaving(data.action);
    }
  });
  // The held leaving goes on once nothing holds the screen: the photo was saved, or dropped. The
  // hook's `beforeRemove` listener reads `holdsPhoto` through a ref that React updates in an
  // insertion effect, before any effect of the same render runs, so the listener lets this
  // dispatch through. The hook's own effect, which tells the navigator that the screen no longer
  // prevents removal, is what lifts the native hold (the native stack's `preventNativeDismiss`).
  useEffect(() => {
    if (leaving !== null && !holdsPhoto) {
      setLeaving(null);
      navigation.dispatch(leaving);
    }
  }, [leaving, holdsPhoto, navigation]);
  // "Analyse" completed the batch: on to the find (a new one), or back to where photos were added.
  const { analysed } = view;
  useEffect(() => {
    if (analysed === null) {
      return;
    }
    if (target.kind === "add" && router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/find/${analysed}`);
    }
  }, [analysed, target]);

  const canChoose = view.phase === "ready" || view.phase === "saved";

  return (
    <View style={styles.container}>
      {target.kind === "add" && <Stack.Screen options={{ title: t.addTitle }} />}
      {view.phase === "starting" && <Text style={styles.text}>{t.asking}</Text>}
      {locationRefused && <Text style={styles.text}>{t.locationDenied}</Text>}
      {(view.phase === "saving" || view.phase === "busy" || view.phase === "starting") && (
        <ActivityIndicator testID="new-find-busy" />
      )}
      {view.phase === "saving" && <Text style={styles.text}>{t.saving}</Text>}
      {view.message !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t[view.message]}
        </Text>
      )}
      {view.phase === "saved" && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.saved}
        </Text>
      )}
      {view.photoCount > 0 && (
        <Text style={styles.text}>
          {fillIn(t.photoCount, {
            count: String(view.photoCount),
            max: String(config.maxPhotosPerFind),
          })}
        </Text>
      )}
      {view.confirming !== null ? (
        <Question
          question={view.confirming}
          strings={strings}
          onYes={() => flow.discardPending()}
          onNo={() => {
            flow.keepPhoto();
            setLeaving(null);
          }}
        />
      ) : view.canRetrySave ? (
        // The photo whose save failed is kept until it is saved or discarded (SPEC 3.1: a find
        // is never lost), so no new photo is offered meanwhile.
        <>
          <Pressable
            accessibilityRole="button"
            disabled={!canChoose}
            // The save's promise is not given back. In the app, a press does nothing with it, and
            // the screen follows the save through the view it is shown. In the tests, React Native
            // Testing Library's `fireEvent.press` awaits what the handler gives back, so a test
            // that holds the save open could not get past the press (Clead's fix 1 on #32).
            onPress={() => void flow.retrySave()}
            style={[styles.button, !canChoose && styles.disabled]}
          >
            <Text style={styles.buttonText}>{t.retrySave}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canChoose}
            onPress={() => flow.askToDiscard()}
            style={[styles.button, !canChoose && styles.disabled]}
          >
            <Text style={styles.buttonText}>{t.discardPhoto}</Text>
          </Pressable>
        </>
      ) : (
        <>
          {view.canAddMore ? (
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
          ) : (
            view.phase !== "starting" &&
            view.message !== "findUnavailable" && <Text style={styles.text}>{t.maxReached}</Text>
          )}
          {view.batchOpen && (
            <Pressable
              accessibilityRole="button"
              disabled={!canChoose}
              // As for Save again, the promise is not given back: the screen follows the view.
              onPress={() => void flow.analyse()}
              style={[styles.button, !canChoose && styles.disabled]}
            >
              <Text style={styles.buttonText}>{t.analyse}</Text>
            </Pressable>
          )}
        </>
      )}
      {(locationRefused || view.message === "cameraBlocked") && (
        <Pressable accessibilityRole="button" onPress={openSettings} style={styles.button}>
          <Text style={styles.buttonText}>{t.openSettings}</Text>
        </Pressable>
      )}
    </View>
  );
}

type QuestionProps = {
  readonly question: "discard" | "leave";
  readonly strings: Strings;
  readonly onYes: () => void;
  readonly onNo: () => void;
};

/** The question asked on the screen before a kept photo is dropped, with its two answers. */
function Question({ question, strings, onYes, onNo }: QuestionProps) {
  const t = strings.newFind;
  const [text, yes, no] =
    question === "discard"
      ? [t.discardConfirm, t.discardYes, t.discardCancel]
      : [t.leaveConfirm, t.leaveYes, t.leaveCancel];
  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {text}
      </Text>
      <Pressable accessibilityRole="button" onPress={onYes} style={styles.button}>
        <Text style={styles.buttonText}>{yes}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onNo} style={styles.button}>
        <Text style={styles.buttonText}>{no}</Text>
      </Pressable>
    </>
  );
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
