import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";

import { useApiKey } from "../key/KeyContext";
import { FindLogProvider, useFindLog } from "../store/FindLogContext";
import type { FindStore } from "../store/findStore";
import { createDeviceQueue } from "./deviceQueue";
import { type NetworkSource, watchNetworkBack } from "./networkState";
import type { AnalyseFindResult, AnalysisQueue, QueueDeps, QueueState } from "./queue";

/** The part of React Native's `AppState` the provider uses. */
export interface AppStateSource {
  readonly currentState: string;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
}

export interface QueueContextValue {
  readonly state: QueueState;
  /** "Analyse now" (docs/SPEC.md 3.1). */
  readonly analyseNow: () => void;
  /** Tells the queue that a setting was saved, which starts it again if it stopped for it. */
  readonly settingChanged: (setting: "key" | "model") => void;
  /** Analyses one find at once, from its screen. */
  readonly analyseFind: (id: number) => Promise<AnalyseFindResult>;
}

const QueueContext = createContext<QueueContextValue | null>(null);

type QueueProviderProps = {
  readonly children: ReactNode;
  /** Makes the queue; the phone's by default. */
  readonly createQueue?: (parts: Pick<QueueDeps, "findLog" | "readKey">) => AnalysisQueue;
  readonly appState?: AppStateSource;
  /** The network state; expo-network by default. */
  readonly network?: NetworkSource;
};

/**
 * Runs the analysis queue (docs/SPEC.md 3.4) on its triggers: when the app comes to the front (and
 * at the start, when it starts in front), when a find is saved through the find log it gives the
 * screens, and when the phone reports that the network is back. The key is the one KeyProvider
 * reads only after the first-start clearing. A run's error that the queue does not handle is not
 * caught here: its promise rejects (a programming error passes through).
 */
export function QueueProvider({
  children,
  createQueue = createDeviceQueue,
  appState = AppState,
  network,
}: QueueProviderProps) {
  const findLog = useFindLog();
  const { readForAnalysis } = useApiKey();
  // Made once: the find log and the key reader the providers above give are stable.
  const [queue] = useState(() => createQueue({ findLog, readKey: readForAnalysis }));
  const [state, setState] = useState<QueueState>(() => queue.getState());

  useEffect(() => {
    const unsubscribe = queue.subscribe(setState);
    setState(queue.getState());
    return unsubscribe;
  }, [queue]);

  useEffect(() => {
    let inFront = appState.currentState === "active";
    queue.setInFront(inFront);
    if (inFront) {
      void queue.trigger();
    }
    const subscription = appState.addEventListener("change", (next) => {
      const comesToFront = next === "active" && !inFront;
      inFront = next === "active";
      queue.setInFront(inFront);
      if (comesToFront) {
        void queue.trigger();
      }
    });
    return () => subscription.remove();
  }, [queue, appState]);

  useEffect(() => watchNetworkBack(() => void queue.trigger(), network), [queue, network]);

  useEffect(() => () => queue.dispose(), [queue]);

  const screensLog = useCallback(async (): Promise<FindStore> => {
    const store = await findLog();
    return {
      ...store,
      async add(find) {
        const id = await store.add(find);
        void queue.trigger();
        return id;
      },
    };
  }, [findLog, queue]);

  const value = useMemo<QueueContextValue>(
    () => ({
      state,
      analyseNow: () => void queue.analyseNow(),
      settingChanged: (setting) => void queue.settingChanged(setting),
      analyseFind: (id) => queue.analyseFind(id),
    }),
    [state, queue],
  );

  return (
    <QueueContext.Provider value={value}>
      <FindLogProvider open={screensLog}>{children}</FindLogProvider>
    </QueueContext.Provider>
  );
}

export function useQueue(): QueueContextValue {
  const value = useContext(QueueContext);
  if (value === null) {
    throw new Error("useQueue must be used inside a QueueProvider");
  }
  return value;
}
