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
 */
export function KeyProvider({ secrets, store, children }: KeyProviderProps) {
  const [status, setStatus] = useState<KeyStatus>("loading");
  const mounted = useRef(true);
  const started = useRef<Promise<unknown> | null>(null);
  // Made at the first render, before any effect runs: a child's mount effect runs before this
  // provider's, so a promise made in the effect would not yet be there for it to wait on.
  const [cleared] = useState(deferred);

  useEffect(() => {
    mounted.current = true;
    // The read is part of the startup, so a save or remove that waits for it reports last.
    started.current = clearKeyOnFirstStartAfterInstall(secrets, store)
      .then(() => cleared.resolve())
      .then(() => readKey(secrets))
      .then((result) => {
        if (mounted.current) {
          setStatus(!result.ok ? "unreadable" : result.key === null ? "none" : "stored");
        }
      });
    return () => {
      mounted.current = false;
    };
  }, [secrets, store, cleared]);

  const readForAnalysis = useCallback(async (): Promise<ReadKeyResult> => {
    await cleared.promise;
    return readKey(secrets);
  }, [secrets, cleared]);

  const save = useCallback(
    async (raw: string): Promise<SaveKeyResult> => {
      await started.current;
      const result = await saveKey(secrets, raw);
      if (result.ok && mounted.current) {
        setStatus("stored");
      }
      return result;
    },
    [secrets],
  );

  const remove = useCallback(async (): Promise<{ readonly ok: boolean }> => {
    await started.current;
    const result = await removeKey(secrets);
    if (result.ok && mounted.current) {
      setStatus("none");
    }
    return result;
  }, [secrets]);

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
