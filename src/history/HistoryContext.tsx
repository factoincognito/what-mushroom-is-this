import { router } from "expo-router";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAcceptanceAtStart } from "../disclaimer/DisclaimerGate";
import type { KeyValueStore } from "../storage/keyValueStore";
import { takeAppStart } from "./appStart";
import { BUILD_VERSION } from "./buildVersion";
import { HISTORY, type HistoryEntry } from "./entries";
import { HistoryStart, type StackScreen } from "./historyStart";

/** The route of the history screen. */
export const HISTORY_ROUTE = "/history";

const HistoryContext = createContext<HistoryStart | null>(null);

type HistoryProviderProps = {
  /** The plain store that holds the version last seen. */
  readonly store: KeyValueStore;
  readonly children: ReactNode;
};

/**
 * Holds the version history's start while the app runs (docs/SPEC.md 3.10, items 3, 7 and 8):
 * what opens by itself is decided once, at the start, and the history screen that opens by itself
 * gets the decision's entries from here. It stands inside the first-start disclaimer's gate, so
 * nothing is decided, read or written before the disclaimer is accepted, and above the screens.
 * The screens tell it where the start opens (`FirstScreenOfStart`).
 */
export function HistoryProvider({ store, children }: HistoryProviderProps) {
  const acceptance = useAcceptanceAtStart();
  // Made once: the start is the app's, not a screen's.
  const [start] = useState(
    () =>
      new HistoryStart({
        store,
        buildVersion: BUILD_VERSION,
        entries: HISTORY,
        acceptance,
        takeAppStart,
        // Pushed over the Library, so that back shows the Library.
        openHistory: () => router.push(HISTORY_ROUTE),
      }),
  );
  useEffect(() => {
    start.setShown(true);
    return () => start.setShown(false);
  }, [start]);
  return <HistoryContext.Provider value={start}>{children}</HistoryContext.Provider>;
}

function useHistoryStart(): HistoryStart {
  const start = useContext(HistoryContext);
  if (start === null) {
    throw new Error("the version history must be used inside a HistoryProvider");
  }
  return start;
}

/** What the history screen needs of the start. */
export interface HistoryContextValue {
  /**
   * The entries of the decision made at this start, for the history screen that opens by itself:
   * given once, and null to every screen after it, which then shows the full history.
   */
  readonly takeWhatsNew: () => readonly HistoryEntry[] | null;
}

export function useHistory(): HistoryContextValue {
  return useHistoryStart();
}

/** The part of a stack's state the start reads: its screens, and which of them it shows. */
type StackState = {
  readonly index: number;
  readonly routes: readonly StackScreen[];
};

type FirstScreenOfStartProps = {
  /** The screen this is laid around. */
  readonly route: StackScreen;
  /** That screen's own way to the stack, for the stack's state. */
  readonly navigation: { getState(): StackState };
  readonly children: ReactNode;
};

/**
 * Laid around every screen of the stack (`screenLayout`, `src/app/_layout.tsx`), inside the
 * screen's area. The screen that is laid out first tells the start which screen the stack shows,
 * and with that whether the start's first screen is the Library; the decision is then made. When
 * it is the Library, that screen is held back until the version last seen is read, as the
 * disclaimer's gate holds the app back for the acceptance, with no time limit of its own: the
 * Library is not shown, and does nothing, before then. Every other screen is shown at once.
 */
export function FirstScreenOfStart({ route, navigation, children }: FirstScreenOfStartProps) {
  const start = useHistoryStart();
  // Asked once, when the screen is first laid out: later the stack shows other screens.
  const [held] = useState(() => {
    const state = navigation.getState();
    return start.screenShown(route, state.routes[state.index] ?? route);
  });
  const reading = useSyncExternalStore(start.subscribe, start.isReading, start.isReading);
  useEffect(() => {
    start.begin();
  }, [start]);

  if (held && reading) {
    return (
      <View style={styles.reading} testID="history-reading">
        <ActivityIndicator />
      </View>
    );
  }
  return children;
}

const styles = StyleSheet.create({
  reading: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
});
