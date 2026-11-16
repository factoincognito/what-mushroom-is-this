/**
 * The share another app sent to the app, from its arrival to the user's choice (docs/SPEC.md 3.9,
 * Shared photos; Known unknown 16; PBI-2.21), kept out of the screens so that it renders nothing.
 *
 * - A share is read from the library's raw payloads. The library is asked to resolve it, which
 *   copies its files into the cache, only when every item of it is a file on the phone
 *   (`mayResolve`): a share that holds a web address or a text is refused whole, without a
 *   request. Before the choice, all the app holds of a share is those copies; nothing is saved
 *   to the find log, loaded or sent.
 * - A share that arrives while one is held takes its place; the earlier one is dropped as if
 *   cancelled, its copies removed.
 * - "Cancel", and leaving the choice, drop the share and its copies.
 * - A choice checks that each photo's file loads as an image, refuses those that do not, moves
 *   the others into the app's own folder in the cache, drops the share from the library, and
 *   hands the photos on: to a screen under the choice that holds the chosen find's open batch,
 *   or else to the New find screen that opens next (`takeHandOff`). "New find" is made of a share
 *   of one photo only.
 *
 * The library drops a share only whole (`clear`): its intent and every copy under its folder. So
 * the photos to keep are moved out before it is cleared, and the library is not cleared while it
 * already holds another share than the one being dropped; that one's copies are then removed
 * one by one.
 */

import { mayResolve, readShare, takeResolved } from "./sharedPayloads";

/** The library's hold of a share (`deviceShareSource`); what it gives is unchecked. */
export interface ShareSource {
  /** The raw payloads of the share the library holds; no request is made for them. */
  read(): unknown;
  /** The resolved payloads of the share the library holds: its files copied into the cache. */
  resolve(): Promise<unknown>;
  /** Drops the share the library holds, and every copy it made. */
  clear(): void;
}

/** The files of a share in the app's cache (`deviceShareFiles`). */
export interface ShareFiles {
  /** The address of a copy the library made, when it is a file in the library's folder; else null. */
  libraryCopy(contentUri: string): string | null;
  /** Moves a library copy into the app's own folder; gives its new address, or null if it cannot. */
  keep(uri: string): string | null;
  /** Removes a copy in the cache; anything else is left. */
  remove(uri: string): void;
}

export interface ShareDeps {
  source: ShareSource;
  files: ShareFiles;
  /** Whether the phone's image loader loads the file as an image (`loadsAsImage`). */
  loadsAsImage: (uri: string) => Promise<boolean>;
}

export type ShareState =
  /** No share is held. */
  | { readonly kind: "none" }
  /** A share is being read: the library copies its files. */
  | { readonly kind: "reading" }
  /** The choice: the photos shared, how many items were refused, and whether a choice runs. */
  | {
      readonly kind: "ready";
      readonly photos: readonly string[];
      readonly refused: number;
      readonly choosing: boolean;
    }
  /** Nothing of the share is taken: every item of it was refused. Nothing was saved. */
  | { readonly kind: "refused"; readonly refused: number }
  /** The share could not be read. Nothing was saved. */
  | { readonly kind: "unreadable" };

/** What the user chose: a new find, or an earlier one. */
export type ShareTarget =
  | { readonly kind: "new" }
  | { readonly kind: "add"; readonly findId: number };

/** The screen that asks for a hand-off: New find, or Add photos for the find its address names. */
export type HandOffTaker =
  | { readonly kind: "new" }
  | { readonly kind: "add"; readonly findId: number | null };

/** The photos handed on, as the app's own copies in the order shared, and how many were refused. */
export interface SharedPhotos {
  readonly photos: readonly string[];
  readonly refused: number;
}

/** A New find screen, which may hold a find's open batch that shared photos can join. */
export interface BatchScreen {
  canJoin(findId: number): boolean;
  join(shared: SharedPhotos): void;
}

/**
 * What a choice came to: the photos joined a batch open on a screen under the choice; they wait
 * for the New find screen to open; or nothing was handed on.
 */
export type Chosen = "joined" | "open" | "none";

const NONE: ShareState = { kind: "none" };

export class ShareSession {
  private state: ShareState = NONE;
  /** The key of the share held or being read; null when the library's share is not this one's. */
  private key: string | null = null;
  /** The library's copies of the share held, taken or not, for removal one by one. */
  private copies: string[] = [];
  /** Counts the shares read, so that work for an earlier one is dropped when it ends. */
  private reads = 0;
  private pending: { target: ShareTarget; shared: SharedPhotos } | null = null;
  private readonly screens = new Set<BatchScreen>();

  constructor(
    private readonly deps: ShareDeps,
    private readonly onChange: (state: ShareState) => void,
  ) {}

  getState(): ShareState {
    return this.state;
  }

  /**
   * Looks at what the library holds. A share not seen before is read, and takes the place of the
   * one held. It never rejects.
   */
  async refresh(): Promise<void> {
    const share = this.readNow();
    if (share === null || share.key === this.key) {
      return;
    }
    this.removeCopies();
    this.key = share.key;
    this.reads += 1;
    const read = this.reads;
    if (!mayResolve(share)) {
      // Nothing of it can be taken, and resolving it could make a request: dropped as it is.
      this.end({ kind: "refused", refused: share.items.length });
      return;
    }
    this.set({ kind: "reading" });
    // The library resolves whatever share it holds when it is called, which may no longer be the
    // one read above: it is read once more, last, so that nothing of the app's own runs between
    // the check and the call.
    if (this.readNow()?.key !== share.key) {
      this.key = null;
      this.set(NONE);
      await this.refresh();
      return;
    }
    let resolved: unknown;
    try {
      resolved = await this.deps.source.resolve();
    } catch {
      if (read === this.reads) {
        this.end({ kind: "unreadable" });
      }
      return;
    }
    const taken = takeResolved(share, resolved);
    if (read !== this.reads) {
      // Replaced or cancelled meanwhile: what the library copied for it is removed.
      this.remove([...taken.photos, ...taken.others]);
      return;
    }
    if (!taken.same) {
      // The library resolved another share than the one read: none of it is taken here.
      this.remove(taken.others);
      this.end({ kind: "unreadable" });
      await this.refresh();
      return;
    }
    const photos: string[] = [];
    for (const address of taken.photos) {
      const copy = this.deps.files.libraryCopy(address);
      if (copy !== null) {
        photos.push(copy);
      }
    }
    this.copies = [...photos, ...taken.others];
    if (photos.length === 0) {
      this.end({ kind: "unreadable" });
      return;
    }
    this.set({
      kind: "ready",
      photos,
      refused: share.items.length - photos.length,
      choosing: false,
    });
  }

  /** "Cancel", and leaving the choice: the share is dropped with its copies; nothing is saved. */
  cancel(): void {
    if (this.state.kind === "none") {
      return;
    }
    this.reads += 1;
    this.end(NONE);
  }

  /**
   * The user's choice. Each photo's file is checked as an image first; those that are, are moved
   * into the app's own folder and handed on, and the share is dropped from the library. A new
   * find is made of a share of one photo only. It never rejects.
   */
  async choose(target: ShareTarget): Promise<Chosen> {
    const { state } = this;
    if (state.kind !== "ready" || state.choosing) {
      return "none";
    }
    if (target.kind === "new" && state.photos.length !== 1) {
      return "none";
    }
    const read = this.reads;
    this.set({ ...state, choosing: true });
    const images: string[] = [];
    for (const photo of state.photos) {
      if (await this.isImage(photo)) {
        images.push(photo);
      }
      if (read !== this.reads) {
        // Another share took this one's place, or it was cancelled, while its files were checked.
        return "none";
      }
    }
    const kept: string[] = [];
    for (const photo of images) {
      const own = this.deps.files.keep(photo);
      if (own !== null) {
        kept.push(own);
      }
    }
    const refused = state.photos.length - kept.length;
    this.reads += 1;
    if (kept.length === 0) {
      this.end({ kind: "refused", refused: state.refused + refused });
      return "none";
    }
    this.end(NONE);
    const shared: SharedPhotos = { photos: kept, refused };
    if (target.kind === "add") {
      for (const screen of this.screens) {
        if (screen.canJoin(target.findId)) {
          screen.join(shared);
          return "joined";
        }
      }
    }
    this.dropPending();
    this.pending = { target, shared };
    return "open";
  }

  /**
   * The photos handed on to the screen that opens after a choice, once: to the New find screen
   * for "New find", and to the Add photos screen of the find chosen.
   */
  takeHandOff(taker: HandOffTaker): SharedPhotos | null {
    const { pending } = this;
    if (pending === null || pending.target.kind !== taker.kind) {
      return null;
    }
    if (
      pending.target.kind === "add" &&
      (taker.kind !== "add" || taker.findId !== pending.target.findId)
    ) {
      return null;
    }
    this.pending = null;
    return pending.shared;
  }

  /** A New find screen makes itself known while it is shown; the function given takes it off. */
  register(screen: BatchScreen): () => void {
    this.screens.add(screen);
    return () => {
      this.screens.delete(screen);
    };
  }

  /** A hand-off no screen took: its copies are removed. */
  private dropPending(): void {
    if (this.pending !== null) {
      this.remove(this.pending.shared.photos);
      this.pending = null;
    }
  }

  /** The share the library holds now; null without one, or when the library cannot be read. */
  private readNow(): ReturnType<typeof readShare> {
    try {
      return readShare(this.deps.source.read());
    } catch {
      return null;
    }
  }

  private async isImage(uri: string): Promise<boolean> {
    try {
      return (await this.deps.loadsAsImage(uri)) === true;
    } catch {
      return false;
    }
  }

  /**
   * Ends the share held: it is dropped from the library with every copy of it, unless the
   * library already holds another share, which clearing would drop; then this one's copies are
   * removed one by one.
   */
  private end(next: ShareState): void {
    if (this.key !== null) {
      if (this.readNow()?.key === this.key) {
        try {
          this.deps.source.clear();
        } catch {
          this.removeCopies();
        }
      } else {
        this.removeCopies();
      }
    }
    this.key = null;
    this.copies = [];
    this.set(next);
  }

  /** Removes the library's copies of the share held, one by one. */
  private removeCopies(): void {
    this.remove(this.copies);
    this.copies = [];
  }

  private remove(uris: readonly string[]): void {
    for (const uri of uris) {
      try {
        this.deps.files.remove(uri);
      } catch {
        // A copy that cannot be removed is left to the system, which clears the cache.
      }
    }
  }

  private set(next: ShareState): void {
    this.state = next;
    this.onChange(next);
  }
}
