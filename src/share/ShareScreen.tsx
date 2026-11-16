import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { config } from "../config/config";
import { fillIn } from "../find/display";
import { useLanguage } from "../i18n/LanguageContext";
import { FindRow, findRowStyle } from "../library/FindRow";
import { useFindLog } from "../store/FindLogContext";
import { useShare } from "./ShareContext";
import { type ChoiceFind, choiceOffers, readChoiceFinds } from "./shareChoice";

/** What the screen has read of the finds a shared photo can be added to. */
type Finds =
  | { kind: "loading" }
  | { kind: "ready"; finds: readonly ChoiceFind[] }
  /** The find log could not be read; the error itself is not shown. */
  | { kind: "unreadable" };

type ShareScreenProps = {
  /** The part of React Native's `AppState` the screen uses; the phone's by default. */
  readonly appState?: {
    addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
  };
  /** The part of React Native's `BackHandler` the screen uses; the phone's by default. */
  readonly backHandler?: {
    addEventListener(type: "hardwareBackPress", listener: () => boolean): { remove(): void };
  };
};

/**
 * The choice a share of photos opens (docs/SPEC.md 3.9, Shared photos; PBI-2.21). It says how
 * many photos were shared and offers, for one photo, "New find" and "Add to an earlier find",
 * and for several only "Add to an earlier find", with the line saying why. "Add to an earlier
 * find" lists the finds as the Library does, newest first and without its filters; a full find
 * is listed as full and cannot be chosen, and a find that could not be read is left out. With no
 * find to choose it is not offered, and the screen says so. "Cancel", and leaving the screen,
 * drop the share: nothing is saved.
 *
 * The photos are those of the share the library hands over (`useShare`), never anything from the
 * address that opened the screen, which is not read here. Before the choice nothing is saved to
 * the find log, loaded or sent; the files are checked as images only once a choice is made.
 *
 * "New find" opens the New find screen with the photo; a find chosen opens its Add photos screen
 * with the photos, or, when that find's batch is open on a screen under this one, gives them to
 * that screen and goes back to it.
 */
export function ShareScreen({ appState = AppState, backHandler = BackHandler }: ShareScreenProps) {
  const { language, strings } = useLanguage();
  const t = strings.share;
  const findLog = useFindLog();
  const { state, refresh, cancel, choose } = useShare();
  const [finds, setFinds] = useState<Finds>({ kind: "loading" });
  /** Whether the list of finds is shown in place of the two choices. */
  const [listing, setListing] = useState(false);

  // An address opened this screen: the share it announces is read from the library, before the
  // first paint, so that the screen does not first say that nothing is shared.
  useLayoutEffect(() => {
    refresh();
  }, [refresh]);
  // While the screen is shown, a share that takes this one's place is looked for when the screen
  // comes into view and when the app comes back to the front, as it does after a share.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const front = appState.addEventListener("change", (next) => {
      if (next === "active") {
        refresh();
      }
    });
    return () => front?.remove?.();
  }, [appState, refresh]);
  // Leaving the screen, in any way, drops a share no choice was made for.
  useEffect(() => cancel, [cancel]);
  // Android's back button on the choice as the app's first screen would close the app with the
  // share still held: it cancels instead, as the Cancel button does. Over another screen, back
  // goes back to it, which leaves this screen.
  useEffect(() => {
    const back = backHandler.addEventListener("hardwareBackPress", () => {
      if (router.canGoBack()) {
        return false;
      }
      cancel();
      router.replace("/");
      return true;
    });
    return () => back?.remove?.();
  }, [backHandler, cancel]);

  // The photos of the share held: the same list while that share is held, whatever is chosen, and
  // another for a share that takes its place.
  const photos = state.kind === "ready" ? state.photos : null;
  // The finds are read for each share, and a share starts at the two choices, also one that takes
  // another's place.
  useEffect(() => {
    setListing(false);
    if (photos === null) {
      return;
    }
    let current = true;
    setFinds({ kind: "loading" });
    (async () => {
      let next: Finds;
      try {
        next = {
          kind: "ready",
          finds: await readChoiceFinds(await findLog(), config.maxPhotosPerFind),
        };
      } catch {
        next = { kind: "unreadable" };
      }
      if (current) {
        setFinds(next);
      }
    })();
    return () => {
      current = false;
    };
  }, [photos, findLog]);

  /** Away from the choice: back to the screen it opened over, or to the Library without one. */
  function leave(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  async function chooseNew(): Promise<void> {
    if ((await choose({ kind: "new" })) === "open") {
      router.replace("/new-find");
    }
  }

  async function chooseFind(findId: number): Promise<void> {
    const chosen = await choose({ kind: "add", findId });
    if (chosen === "joined") {
      // The find's batch is open on a screen under this one, which took the photos.
      leave();
    } else if (chosen === "open") {
      router.replace(`/new-find?find=${findId}`);
    }
  }

  const cancelButton = (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        cancel();
        leave();
      }}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{t.cancel}</Text>
    </Pressable>
  );

  if (state.kind === "none") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.text}>{t.none}</Text>
        <Link href="/" replace accessibilityRole="link" style={styles.link}>
          {strings.notFound.back}
        </Link>
      </ScrollView>
    );
  }
  if (state.kind === "reading") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ActivityIndicator testID="share-reading" />
        <Text style={styles.text}>{t.reading}</Text>
        {cancelButton}
      </ScrollView>
    );
  }
  if (state.kind !== "ready") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {state.kind === "refused"
            ? fillIn(t.refused, { count: String(state.refused) })
            : t.unreadable}
        </Text>
        {cancelButton}
      </ScrollView>
    );
  }

  const count = state.photos.length;
  const offers = choiceOffers(count, finds.kind === "ready" ? finds.finds : []);
  const busy = state.choosing;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.text}>
        {count === 1 ? t.onePhoto : fillIn(t.severalPhotos, { count: String(count) })}
      </Text>
      {state.refused > 0 && (
        <Text style={styles.text}>{fillIn(t.refused, { count: String(state.refused) })}</Text>
      )}
      {count > 1 && <Text style={styles.text}>{t.severalOnlyAdd}</Text>}
      {finds.kind === "loading" && <ActivityIndicator testID="share-finds-loading" />}
      {finds.kind === "unreadable" && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {strings.log.unreadable}
        </Text>
      )}
      {busy && (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={styles.text}>{t.choosing}</Text>
        </View>
      )}
      {listing && finds.kind === "ready" ? (
        <>
          <Text accessibilityRole="header" style={styles.heading}>
            {t.chooseFind}
          </Text>
          {finds.finds.map(({ find, full }) => (
            <FindRow
              key={find.id}
              find={find}
              language={language}
              strings={strings}
              renderRow={(content) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={full || busy}
                  testID={`share-find-${find.id}`}
                  // The choice's promise is not given back: the screen follows the share's state.
                  onPress={() => void chooseFind(find.id)}
                  style={[findRowStyle, (full || busy) && styles.disabled]}
                >
                  {content}
                </Pressable>
              )}
              note={
                full ? (
                  <Text style={styles.note}>
                    {fillIn(t.full, { max: String(config.maxPhotosPerFind) })}
                  </Text>
                ) : null
              }
            />
          ))}
        </>
      ) : (
        <>
          {offers.newFind && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void chooseNew()}
              style={[styles.button, busy && styles.disabled]}
            >
              <Text style={styles.buttonText}>{t.newFind}</Text>
            </Pressable>
          )}
          {offers.add ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setListing(true)}
              style={[styles.button, busy && styles.disabled]}
            >
              <Text style={styles.buttonText}>{t.addToFind}</Text>
            </Pressable>
          ) : (
            finds.kind === "ready" && <Text style={styles.text}>{t.noFindToChoose}</Text>
          )}
        </>
      )}
      {cancelButton}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 16,
    gap: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontSize: 16,
  },
  note: {
    fontSize: 14,
  },
  heading: {
    fontSize: 16,
    fontWeight: "bold",
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
  link: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 8,
  },
});
