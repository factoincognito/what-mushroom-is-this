/**
 * One start of the app, as the version history sees it (docs/SPEC.md 3.10, items 7 and 8): which
 * screen the start opens on, the Library held back until the version last seen is read, the
 * decision, and the decision's entries, kept for the history screen that opens by itself. It
 * renders nothing.
 *
 * The first screen is the one the app's stack shows first, as the stack itself tells it when that
 * screen is first laid out. It is not read from the router's own record of the address: on
 * Android the router learns the address the app was started with only after it has begun, and
 * until its first screen is shown that record says the Library, whatever opened the app
 * (expo-router 57.0.30, `link/linking.js`, `global-state/useStore.js` and `useScreens.js`, read, not
 * run on a phone).
 */

import type { AcceptanceAtStart } from "../disclaimer/acceptance";
import type { KeyValueStore } from "../storage/keyValueStore";
import type { HistoryEntry } from "./entries";
import { startHistory } from "./whatOpens";

/** The name the stack gives the Library's route, the file `src/app/index.tsx`. */
export const LIBRARY_ROUTE_NAME = "index";

/** A screen of the app's stack: its key, which is its own, and the name of its route. */
export type StackScreen = {
  readonly key: string;
  readonly name: string;
};

export type HistoryStartDeps = {
  /** The plain store that holds the version last seen. */
  readonly store: KeyValueStore;
  /** The build's version. */
  readonly buildVersion: string;
  /** The history's entries. */
  readonly entries: readonly HistoryEntry[];
  /** Whether the disclaimer's acceptance was read or given at this start, as its gate tells. */
  readonly acceptance: AcceptanceAtStart;
  /**
   * Takes the start of the app's process: true once in a process, and false when the screens are
   * shown anew while it lives, which is no start.
   */
  readonly takeAppStart: () => boolean;
  /** Opens the history screen over the screen shown. */
  readonly openHistory: () => void;
};

export class HistoryStart {
  /** The screen the stack showed first, once a screen is shown. */
  private first: StackScreen | null = null;
  private onLibrary = false;
  private begun = false;
  private reading = false;
  /** Whether the app's screens are there to show the decision to. */
  private shown = true;
  private whatsNew: readonly HistoryEntry[] | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: HistoryStartDeps) {}

  /**
   * A screen of the stack is laid out for the first time: `own` is that screen, and `focused`
   * the screen the stack shows at that moment. The first call tells where the start opens.
   * Answers whether `own` is the Library the start opens on, which is held back while the version
   * last seen is read (`isReading`).
   */
  readonly screenShown = (own: StackScreen, focused: StackScreen): boolean => {
    if (this.first === null) {
      this.first = focused;
      // Taken whatever the first screen is: a start that opens elsewhere is the process's start
      // too, and the Library shown anew later in the same process is no start.
      const isStart = this.deps.takeAppStart();
      this.onLibrary = isStart && focused.name === LIBRARY_ROUTE_NAME;
      this.reading = this.onLibrary;
    }
    return this.onLibrary && own.key === this.first.key;
  };

  /** Whether the Library the start opens on is still held back for the read. */
  readonly isReading = (): boolean => this.reading;

  /** Tells `listener` when `isReading` changes; the answer ends the telling. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Makes the start's decision, once, after its first screen is known: reads the version last
   * seen where the decision needs it, lets the Library be shown when the read is finished, opens
   * the history when the decision says so, and writes the build's version when it says so. A
   * history that cannot be opened is not opened, and its entries are dropped.
   */
  readonly begin = (): void => {
    if (this.begun || this.first === null) {
      return;
    }
    this.begun = true;
    const { store, buildVersion, entries, acceptance } = this.deps;
    void startHistory({
      store,
      buildVersion,
      entries,
      acceptance,
      onLibrary: this.onLibrary,
    }).then(({ opens }) => {
      if (!this.shown) {
        return;
      }
      this.whatsNew = opens;
      this.reading = false;
      for (const listener of this.listeners) {
        listener();
      }
      if (opens !== null) {
        try {
          this.deps.openHistory();
        } catch {
          this.whatsNew = null;
        }
      }
    });
  };

  /**
   * The entries of the decision, for the history screen that opens by itself: given once, to the
   * screen that asks first, and null to every screen after it, which then shows the full history.
   */
  readonly takeWhatsNew = (): readonly HistoryEntry[] | null => {
    const entries = this.whatsNew;
    this.whatsNew = null;
    return entries;
  };

  /**
   * The app's screens are there, or are gone. A decision that is made when they are gone is shown
   * to nobody and opens nothing; the build's version is written all the same.
   */
  readonly setShown = (shown: boolean): void => {
    this.shown = shown;
  };
}
