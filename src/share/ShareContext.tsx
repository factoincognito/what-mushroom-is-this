import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";

import { loadsAsImage } from "../newFind/devicePicker";
import { deviceShareFiles, deviceShareSource } from "./deviceShare";
import { routeOfSystemPath, SHARE_ROUTE } from "./shareAddress";
import {
  type BatchScreen,
  type Chosen,
  type HandOffTaker,
  type ShareDeps,
  type SharedPhotos,
  ShareSession,
  type ShareState,
  type ShareTarget,
} from "./shareSession";

/** The part of React Native's `Linking` the provider uses. */
export interface ShareLinking {
  addEventListener(type: "url", listener: (event: { url: string }) => void): { remove(): void };
}

export interface ShareContextValue {
  /** The share held, if any, as the choice shows it. */
  readonly state: ShareState;
  /** Looks whether a share arrived; the choice asks when it comes into view. */
  readonly refresh: () => void;
  /** "Cancel", and leaving the choice: drops the share; nothing is saved. */
  readonly cancel: () => void;
  /** The user's choice: a new find, or an earlier one. */
  readonly choose: (target: ShareTarget) => Promise<Chosen>;
  /** The photos a choice handed to the New find screen that opens next, once. */
  readonly takeHandOff: (taker: HandOffTaker) => SharedPhotos | null;
  /** A New find screen makes itself known while it is shown, for a batch open under the choice. */
  readonly register: (screen: BatchScreen) => () => void;
}

const ShareContext = createContext<ShareContextValue | null>(null);

type ShareProviderProps = {
  readonly children: ReactNode;
  /** The library, the files and the image loader; the phone's by default. */
  readonly deps?: ShareDeps;
  readonly linking?: ShareLinking;
};

const DEVICE: ShareDeps = {
  source: deviceShareSource,
  files: deviceShareFiles,
  loadsAsImage: (uri) => loadsAsImage(uri),
};

/**
 * Holds the share another app sent to the app (docs/SPEC.md 3.9, Shared photos; PBI-2.21), above
 * the screens and inside the first-start disclaimer's gate, so that a share is read only once the
 * disclaimer is accepted.
 *
 * The provider itself looks for a share only when the library's share address reaches the app
 * while it runs, which is how the library announces a share then; the router opens the choice
 * for that address (`src/app/+native-intent.ts`), and the choice asks for a look when it comes
 * into view, which is also how the share that started the app is read. It does not look when it
 * is first shown or when the app comes to the front: the library keeps a share until it is
 * cleared or the app's process ends, so a share left from an earlier run of the screens would be
 * read again, with no choice open for it. The share is read from the library, never from an
 * address. The provider starts no analysis and no queue run, and makes no request.
 */
export function ShareProvider({ children, deps = DEVICE, linking = Linking }: ShareProviderProps) {
  const [state, setState] = useState<ShareState>({ kind: "none" });
  // Made once: the library and the files it reads are the phone's.
  const [session] = useState(() => new ShareSession(deps, setState));

  useEffect(() => {
    const address = linking.addEventListener("url", (event) => {
      const url: unknown = event?.url;
      if (typeof url === "string" && routeOfSystemPath(url) === SHARE_ROUTE) {
        void session.refresh();
      }
    });
    return () => address?.remove?.();
  }, [session, linking]);

  const actions = useMemo(
    () => ({
      refresh: () => {
        void session.refresh();
      },
      cancel: () => {
        session.cancel();
        // A share that arrived unseen meanwhile is read now.
        void session.refresh();
      },
      choose: (target: ShareTarget) => session.choose(target),
      takeHandOff: (taker: HandOffTaker) => session.takeHandOff(taker),
      register: (screen: BatchScreen) => session.register(screen),
    }),
    [session],
  );
  const value = useMemo<ShareContextValue>(() => ({ state, ...actions }), [state, actions]);

  return <ShareContext.Provider value={value}>{children}</ShareContext.Provider>;
}

export function useShare(): ShareContextValue {
  const value = useContext(ShareContext);
  if (value === null) {
    throw new Error("useShare must be used inside a ShareProvider");
  }
  return value;
}
