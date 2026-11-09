import { createContext, type ReactNode, useCallback, useContext, useRef } from "react";

import type { FindLog } from "./findStore";

type OpenFindLog = () => Promise<FindLog>;

const FindLogContext = createContext<OpenFindLog | null>(null);

/**
 * Gives the screens the find log (docs/SPEC.md 3.6), opened when a screen first asks for it and
 * then kept: one store for the app, however often it is asked for. An opening that fails is
 * tried again at the next ask.
 */
export function FindLogProvider({ open, children }: { open: OpenFindLog; children: ReactNode }) {
  const opened = useRef<Promise<FindLog> | null>(null);
  const findLog = useCallback((): Promise<FindLog> => {
    if (opened.current === null) {
      opened.current = open().catch((error: unknown) => {
        opened.current = null;
        throw error;
      });
    }
    return opened.current;
  }, [open]);
  return <FindLogContext.Provider value={findLog}>{children}</FindLogContext.Provider>;
}

/** The find log, opened at the first call. */
export function useFindLog(): OpenFindLog {
  const findLog = useContext(FindLogContext);
  if (findLog === null) {
    throw new Error("useFindLog must be used inside a FindLogProvider");
  }
  return findLog;
}
