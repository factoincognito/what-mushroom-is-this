import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { KeyValueStore } from "../storage/keyValueStore";
import {
  clearKeyOnFirstStartAfterInstall,
  type ReadKeyResult,
  readKey,
  removeKey,
  type SaveKeyResult,
  type SecretStore,
  saveKey,
} from "./apiKey";

/** Whether a key is saved; the key itself is never handed to a screen. */
export type KeyStatus = "loading" | "stored" | "none" | "unreadable";

export type KeyState = {
  readonly status: KeyStatus;
  /** Saves a key (trimmed; an empty or unsendable key is not saved). */
  readonly save: (raw: string) => Promise<SaveKeyResult>;
  readonly remove: () => Promise<{ readonly ok: boolean }>;
  /**
   * The key, for the analysis queue only: read once the first-start clearing has run, so a key
   * left from an earlier install is never sent (docs/SPEC.md 3.2).
   */
  readonly readForAnalysis: () => Promise<ReadKeyResult>;
};

/** A promise and the function that resolves it. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const KeyContext = createContext<KeyState | null>(null);

type KeyProviderProps = {
  readonly secrets: SecretStore;
  readonly store: KeyValueStore;
  readonly children: ReactNode;
};

/**
 * Runs the first-start-after-install clearing once, at the app's start, then reports whether a
 * key is saved. A save or remove made before that is done waits for it, so the clearing never
 * deletes a key the user has just saved, and the first report never overwrites a later one.
 *
 * When the clearing fails (the marker cannot be read or written, or the key left from an earlier
 * install cannot be removed), what the key store holds cannot be trusted (PBI-1.17): the status is
 * "unreadable", no key is given for analysis, and a save first runs the clearing again, saving
 * only once the marker is set, so the next start cannot delete the key it saves. Remove works as
 * always. A clearing that succeeds, at the start or before a save, settles this for the session.
 */
export function KeyProvider({ secrets, store, children }: KeyProviderProps) {
  const [status, setStatus] = useState<KeyStatus>("loading");
  const mounted = useRef(true);
  // Both made at the first render, before any effect runs: a child's mount effect runs before
  // this provider's, so a promise made in the effect would not yet be there for it to wait on.
  /** Resolves once the clearing has run. */
  const [cleared] = useState(deferred);
  /** Resolves once the startup, the clearing and the read, has reported. */
  const [started] = useState(deferred);
  /** Whether the marker is known to be set: a clearing has given "cleared" or "kept". */
  const settled = useRef(false);

  useEffect(() => {
    mounted.current = true;
    // The read is part of the startup, so a save or remove that waits for it reports last.
    clearKeyOnFirstStartAfterInstall(secrets, store)
      .then(async (outcome) => {
        settled.current = outcome !== "failed";
        cleared.resolve();
        const result: ReadKeyResult = settled.current ? await readKey(secrets) : { ok: false };
        if (mounted.current) {
          setStatus(!result.ok ? "unreadable" : result.key === null ? "none" : "stored");
        }
      })
      .finally(() => started.resolve());
    return () => {
      mounted.current = false;
    };
  }, [secrets, store, cleared, started]);

  const readForAnalysis = useCallback(async (): Promise<ReadKeyResult> => {
    await cleared.promise;
    return settled.current ? readKey(secrets) : { ok: false };
  }, [secrets, cleared]);

  const save = useCallback(
    async (raw: string): Promise<SaveKeyResult> => {
      await started.promise;
      if (!settled.current) {
        if ((await clearKeyOnFirstStartAfterInstall(secrets, store)) === "failed") {
          return { ok: false, reason: "store-failed" };
        }
        settled.current = true;
      }
      const result = await saveKey(secrets, raw);
      if (result.ok && mounted.current) {
        setStatus("stored");
      }
      return result;
    },
    [secrets, store, started],
  );

  const remove = useCallback(async (): Promise<{ readonly ok: boolean }> => {
    await started.promise;
    const result = await removeKey(secrets);
    if (result.ok && mounted.current) {
      setStatus("none");
    }
    return result;
  }, [secrets, started]);

  const state = useMemo<KeyState>(
    () => ({ status, save, remove, readForAnalysis }),
    [status, save, remove, readForAnalysis],
  );
  return <KeyContext.Provider value={state}>{children}</KeyContext.Provider>;
}

export function useApiKey(): KeyState {
  const state = useContext(KeyContext);
  if (state === null) {
    throw new Error("useApiKey must be used inside a KeyProvider");
  }
  return state;
}
