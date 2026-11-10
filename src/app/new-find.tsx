import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { type NavigationAction, usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { config } from "../config/config";
import { fillIn, parseFindId } from "../find/display";
import { AnswerView, NoticeView } from "../find/FindScreen";
import { useLanguage } from "../i18n/LanguageContext";
import type { Strings } from "../i18n/strings";
import { readPhotoLookupSave } from "../lookup/saveSetting";
import {
  cameraPermission,
  pickFromFiles,
  pickFromGallery,
  removePickedCopy,
  takePhoto,
} from "../newFind/devicePicker";
import {
  INITIAL_VIEW,
  NewFindFlow,
  type NewFindTarget,
  type NewFindView,
} from "../newFind/newFindFlow";
import { deviceLocationSource, locationPermission } from "../position/deviceLocation";
import { formatTimeIn } from "../queue/messages";
import { useQueue } from "../queue/QueueContext";
import { deviceStore } from "../storage/keyValueStore";
import { useFindLog } from "../store/FindLogContext";

/**
 * The New find screen (docs/SPEC.md 3.1, 3.9): opens the camera at once; a photo can also be
 * picked from the gallery or the phone's files (PBI-2.6). With `?find=<id>` (from a find's screen) the photos are added to that
 * find, as a new batch, and "Analyse" goes back to where the screen was opened from.
 *
 * Otherwise it is a new photo lookup, with a "Save" switch from its starting value in Settings
 * (3.9, Lookups; PBI-2.13). With Save on, the find is saved with its first photo before any
 * analysis, its batch open, and each photo after it is saved to it, up to the most a find holds
 * (3.9, Batches); "Analyse" completes the batch, which the queue then analyses, and opens the
 * find's screen; leaving the screen completes it too. Once the lookup is a find, the switch is
 * shown but cannot be turned off. With Save off, the photos are held on this screen only;
 * "Analyse" analyses them here and shows the answer as a find's screen would, with SPEC 3.5's
 * disclaimer and no self-check, or the notice; after a pause or without a key the screen offers to
 * turn Save on. Turning Save on saves the lookup as a find with its photos. The held photos are
 * shown, each with "Remove photo n", which asks first and removes only the app's copy (Clead's
 * decision on #61).
 *
 * Photos whose save failed are kept, and are dropped only after a question on the screen: when
 * "Discard the photo" is tapped, and when the screen is left in any way (the header's back button,
 * Android's back button or gesture), which waits for the answer (PBI-1.20). Leaving with an
 * unsaved lookup asks too (3.9). A leave while a photo is being saved, the first save or Save
 * again, waits for the save: it goes ahead once the save succeeds, and is asked once it fails
 * (Clead's fix 1 on #32).
 */
export default function NewFindScreen() {
  const { language, strings } = useLanguage();
  const t = strings.newFind;
  const findLog = useFindLog();
  const { analysePhotoLookup } = useQueue();
  const formatTime = useMemo(() => formatTimeIn(language), [language]);
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
          files: { pick: () => pickFromFiles() },
          location: { permission: locationPermission, source: deviceLocationSource },
          readSaveSetting: () => readPhotoLookupSave(deviceStore),
          analyseLookup: analysePhotoLookup,
          removeCopy: removePickedCopy,
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
  // The screen holds a leave while photos are kept or being saved (Clead's fix 1 on #32), and
  // while an unsaved lookup holds photos (SPEC 3.9).
  const { holdsLeave } = view;
  usePreventRemove(holdsLeave, ({ data }) => {
    if (flow.askToLeave()) {
      setLeaving(data.action);
    }
  });
  // The held leaving goes on once nothing holds the screen: the photo was saved, or dropped. The
  // hook's `beforeRemove` listener reads `holdsLeave` through a ref that React updates in an
  // insertion effect, before any effect of the same render runs, so the listener lets this
  // dispatch through. The hook's own effect, which tells the navigator that the screen no longer
  // prevents removal, is what lifts the native hold (the native stack's `preventNativeDismiss`).
  useEffect(() => {
    if (leaving !== null && !holdsLeave) {
      setLeaving(null);
      navigation.dispatch(leaving);
    }
  }, [leaving, holdsLeave, navigation]);
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
  const several = view.kept > 1;
  const unsaved = view.save?.on === false;
  // A held photo can be removed while the screen is ready and no question is open.
  const canRemove = view.phase === "ready" && view.confirming === null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {target.kind === "add" && <Stack.Screen options={{ title: t.addTitle }} />}
      {view.phase === "starting" && <Text style={styles.text}>{t.asking}</Text>}
      {view.save !== null && (
        <>
          <View style={styles.row}>
            <Switch
              accessibilityLabel={t.save}
              value={view.save.on}
              disabled={!view.save.changeable}
              onValueChange={(on) => void flow.setSave(on)}
            />
            <Text style={styles.text}>{t.save}</Text>
          </View>
          <Text style={styles.note}>{t.saveHint}</Text>
        </>
      )}
      {locationRefused && <Text style={styles.text}>{t.locationDenied}</Text>}
      {(view.phase === "saving" ||
        view.phase === "busy" ||
        view.phase === "starting" ||
        view.phase === "analysing") && <ActivityIndicator testID="new-find-busy" />}
      {view.phase === "saving" && <Text style={styles.text}>{t.saving}</Text>}
      {view.phase === "analysing" && <Text style={styles.text}>{t.analysing}</Text>}
      {view.message !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {view.message === "saveFailed" && several ? t.savePhotosFailed : t[view.message]}
        </Text>
      )}
      {view.phase === "saved" && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.saved}
        </Text>
      )}
      {view.held > 0 ? (
        <>
          <Text style={styles.text}>
            {fillIn(t.heldCount, {
              count: String(view.held),
              max: String(config.maxPhotosPerFind),
            })}
          </Text>
          {view.heldPhotos.map((uri, index) => {
            const values = { number: String(index + 1), count: String(view.held) };
            return (
              <View key={uri} style={styles.section}>
                <Image
                  source={{ uri }}
                  accessibilityLabel={fillIn(t.heldPhoto, values)}
                  resizeMode="contain"
                  style={styles.photo}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!canRemove}
                  onPress={() => flow.askToRemove(index + 1)}
                  style={[styles.button, !canRemove && styles.disabled]}
                >
                  <Text style={styles.buttonText}>{fillIn(strings.find.removePhoto, values)}</Text>
                </Pressable>
              </View>
            );
          })}
        </>
      ) : (
        view.photoCount > 0 && (
          <Text style={styles.text}>
            {fillIn(t.photoCount, {
              count: String(view.photoCount),
              max: String(config.maxPhotosPerFind),
            })}
          </Text>
        )
      )}
      {view.confirming !== null ? (
        <Question
          question={view.confirming}
          removing={view.removing}
          several={several}
          strings={strings}
          onYes={() => flow.discardPending()}
          onNo={() => {
            flow.keepPhoto();
            setLeaving(null);
          }}
        />
      ) : view.canRetrySave ? (
        // The photos whose save failed are kept until they are saved or discarded (SPEC 3.1: a
        // find is never lost), so no new photo is offered meanwhile.
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
            <Text style={styles.buttonText}>{several ? t.discardPhotos : t.discardPhoto}</Text>
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
              <Pressable
                accessibilityRole="button"
                disabled={!canChoose}
                onPress={() => flow.pickFromFiles()}
                style={[styles.button, !canChoose && styles.disabled]}
              >
                <Text style={styles.buttonText}>{t.pickFromFiles}</Text>
              </Pressable>
            </>
          ) : (
            view.phase !== "starting" &&
            view.message !== "findUnavailable" && (
              <Text style={styles.text}>{unsaved ? t.heldMaxReached : t.maxReached}</Text>
            )
          )}
          {(view.batchOpen || view.held > 0) && (
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
      {view.outcome?.kind === "answer" && (
        // An unsaved photo lookup's answer is from its photos: SPEC 3.5's disclaimer, no
        // self-check (SPEC 3.9).
        <AnswerView
          answer={view.outcome.answer}
          selfCheck={null}
          subject="photo"
          language={language}
          strings={strings}
        />
      )}
      {view.outcome?.kind === "notice" && (
        <View testID="lookup-notice" style={styles.section}>
          <NoticeView
            notice={view.outcome.notice}
            subject="photo"
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
          onPress={() => void flow.turnSaveOn()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{t.turnSaveOn}</Text>
        </Pressable>
      )}
      {(locationRefused || view.message === "cameraBlocked") && (
        <Pressable accessibilityRole="button" onPress={openSettings} style={styles.button}>
          <Text style={styles.buttonText}>{t.openSettings}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

type QuestionProps = {
  readonly question: NonNullable<NewFindView["confirming"]>;
  /** The number of the held photo a "removeHeld" question is about. */
  readonly removing: number | null;
  /** Whether several photos are kept, so the question speaks of the photos. */
  readonly several: boolean;
  readonly strings: Strings;
  readonly onYes: () => void;
  readonly onNo: () => void;
};

/**
 * The question asked on the screen before kept photos, an unsaved lookup, or one of its photos
 * (with the Find screen's answers, Clead's decision on #61) are dropped.
 */
function Question({ question, removing, several, strings, onYes, onNo }: QuestionProps) {
  const [text, yes, no] = questionTexts(question, removing, several, strings);
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

/** A question's text, and its two answers. */
function questionTexts(
  question: QuestionProps["question"],
  removing: number | null,
  several: boolean,
  strings: Strings,
): [string, string, string] {
  const t = strings.newFind;
  switch (question) {
    case "discard":
      return several
        ? [t.discardPhotosConfirm, t.discardYes, t.discardPhotosCancel]
        : [t.discardConfirm, t.discardYes, t.discardCancel];
    case "leave":
      return [several ? t.leavePhotosConfirm : t.leaveConfirm, t.leaveYes, t.leaveCancel];
    case "leaveLookup":
      return [t.leaveLookupConfirm, t.leaveYes, t.leaveCancel];
    case "removeHeld":
      return [
        fillIn(t.removeHeldConfirm, { number: String(removing) }),
        strings.find.removePhotoYes,
        strings.find.removePhotoCancel,
      ];
  }
}

function openSettings(): void {
  Linking.openSettings().catch(() => undefined);
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontSize: 16,
  },
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
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
