/**
 * What opens by itself at a start of the app (docs/SPEC.md 3.10, items 7 and 8): the decision, as
 * a function of what the store holds, and the start that reads the store, decides and writes. It
 * renders nothing.
 */

import type { AcceptanceAtStart } from "../disclaimer/acceptance";
import type { KeyValueStore } from "../storage/keyValueStore";
import type { HistoryEntry } from "./entries";
import { readSeenVersion, type SeenVersion, writeSeenVersion } from "./seenVersion";
import { compareVersions, parseVersion, type Version } from "./version";

export type Decision = {
  /**
   * The entries the history shows when it opens by itself, newest first; null when nothing opens
   * by itself.
   */
  readonly opens: readonly HistoryEntry[] | null;
  /** Whether the build's version is written as the version last seen. */
  readonly writes: boolean;
};

type DecisionInput = {
  /** What the store holds as the version last seen: S. */
  readonly seen: SeenVersion;
  /** The build's version, V. */
  readonly buildVersion: string;
  /** The history's entries. */
  readonly entries: readonly HistoryEntry[];
  /** Whether the disclaimer's acceptance was read or given at this start, as its gate tells. */
  readonly acceptance: AcceptanceAtStart;
  /** Whether the start's first screen is the Library. */
  readonly onLibrary: boolean;
};

const NOTHING: Decision = { opens: null, writes: false };

/** An entry with its version read, or null for an entry whose version is not one. */
function withVersion(entry: HistoryEntry): { entry: HistoryEntry; version: Version } | null {
  const version = parseVersion(entry.version);
  return version === null ? null : { entry, version };
}

/**
 * The entries of the versions higher than `above` (every version, when it is null) and not higher
 * than `upTo`, newest first, whatever the order of the list; null when there is none.
 */
function entriesBetween(
  entries: readonly HistoryEntry[],
  above: Version | null,
  upTo: Version,
): readonly HistoryEntry[] | null {
  const between = entries
    .map(withVersion)
    .filter((each) => each !== null)
    .filter(
      (each) =>
        compareVersions(each.version, upTo) <= 0 &&
        (above === null || compareVersions(each.version, above) > 0),
    )
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((each) => each.entry);
  return between.length === 0 ? null : between;
}

/** The entry of a version, alone; null when the list has none. */
function entryOf(
  entries: readonly HistoryEntry[],
  version: Version,
): readonly HistoryEntry[] | null {
  const found = entries.find((entry) => {
    const own = parseVersion(entry.version);
    return own !== null && compareVersions(own, version) === 0;
  });
  return found === undefined ? null : [found];
}

/**
 * The decision of item 7. At a start whose first screen is not the Library nothing opens and
 * nothing is written, but the build's version on a phone new to the app (item 7's first rule,
 * the exception of item 8). With a build's version that is not a version nothing opens and
 * nothing is written.
 */
export function decideWhatOpens({
  seen,
  buildVersion,
  entries,
  acceptance,
  onLibrary,
}: DecisionInput): Decision {
  const build = parseVersion(buildVersion);
  if (build === null) {
    return NOTHING;
  }
  if (seen.kind === "missing") {
    if (acceptance === "given") {
      // The disclaimer is accepted at this start: the phone is new to the app.
      return { opens: null, writes: true };
    }
    if (!onLibrary) {
      return NOTHING;
    }
    // The acceptance was stored already: the phone has had the app before, in a build from before
    // the history, for which this build is an upgrade. It is shown this version's entry alone.
    return { opens: entryOf(entries, build), writes: true };
  }
  if (!onLibrary) {
    return NOTHING;
  }
  if (seen.kind === "unreadable" || seen.kind === "notVersion") {
    return { opens: null, writes: true };
  }
  const order = compareVersions(seen.version, build);
  if (order === 0) {
    return NOTHING;
  }
  if (order > 0) {
    // A build older than the one this phone saw last.
    return { opens: null, writes: true };
  }
  return { opens: entriesBetween(entries, seen.version, build), writes: true };
}

type StartDeps = Omit<DecisionInput, "seen"> & {
  /** The plain store that holds the version last seen. */
  readonly store: KeyValueStore;
};

export type HistoryStart = {
  /** The entries the history shows when it opens by itself; null when nothing opens by itself. */
  readonly opens: readonly HistoryEntry[] | null;
  /**
   * Whether the build's version was written: false when the decision writes nothing, and when the
   * write failed, which is ignored. It settles when the write is done, after `opens` is given.
   */
  readonly written: Promise<boolean>;
};

const NOT_WRITTEN = Promise.resolve(false);

/**
 * The start: reads the version last seen, decides, and writes the build's version when the
 * decision says so. The decision is given once the read is finished; the write is started and not
 * waited for, and its failure changes nothing of the decision. Nothing is read where no stored
 * version could make the start open or write anything: at a start not on the Library with the
 * acceptance already stored, and with a build's version that is not a version.
 */
export async function startHistory({ store, ...start }: StartDeps): Promise<HistoryStart> {
  const firstRuleCanApply = start.acceptance === "given";
  if (parseVersion(start.buildVersion) === null || !(start.onLibrary || firstRuleCanApply)) {
    return { opens: null, written: NOT_WRITTEN };
  }
  const seen = await readSeenVersion(store);
  const decision = decideWhatOpens({ ...start, seen });
  const written = decision.writes
    ? writeSeenVersion(store, start.buildVersion).then((result) => result.ok)
    : NOT_WRITTEN;
  return { opens: decision.opens, written };
}
