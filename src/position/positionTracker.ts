/**
 * Taking the position for a new find (docs/SPEC.md 3.6). When the camera opens, the tracker
 * starts asking the phone for a position. When the photo is taken, the find is saved at once
 * with the best fix that has come; without one, with the phone's last known position when it
 * is no older than the limit, marked as such; with neither, the find is saved without a position
 * and the tracker goes on asking for up to the wait limit, and the first fix that comes is added.
 *
 * The best fix is the most accurate one (the smallest accuracy radius); a fix without an accuracy
 * ranks below every fix with one, and of two equally accurate fixes the later one wins.
 * Every reading from the phone is checked; one that is not a valid fix is ignored.
 */

import type { Position } from "../store/find";

/** The phone's location service, as the tracker uses it. Readings come in unchecked. */
export interface LocationSource {
  /** Starts watching the position, calling `onFix` with each reading; gives a function that stops. */
  watch(onFix: (reading: unknown) => void): Promise<() => void>;
  /** The phone's last known position, if it has one no older than `maxAgeMs`. */
  lastKnown(maxAgeMs: number): Promise<unknown>;
}

export interface TrackerOptions {
  /** How old the last known position may be, in milliseconds. */
  lastKnownMaxAgeMs: number;
  /** How long `firstFix` waits for a fix, in milliseconds. */
  fixWaitMs: number;
  /** The time now, in milliseconds since the epoch. */
  now: () => number;
}

export interface PositionTracker {
  /** For saving now: the best fix so far; else the recent last known position; else null. */
  positionNow(): Promise<Position | null>;
  /**
   * The best fix so far, or else the first that comes within the wait limit, or null when none
   * comes, watching cannot start, or the tracker is stopped. The tracker stops once it settles.
   */
  firstFix(): Promise<Position | null>;
  /** Stops watching. Stopping again changes nothing. */
  stop(): void;
}

/** A reading checked as a fix: a position and, for the last known position, its time. */
interface Reading {
  position: Position;
  timestampMs: number | null;
}

export function startPositionTracker(
  source: LocationSource,
  options: TrackerOptions,
): PositionTracker {
  let best: Position | null = null;
  let stopped = false;
  let stopWatching: (() => void) | null = null;
  let watchFailed = false;
  const waiters = new Set<(position: Position | null) => void>();

  const settleWaiters = (position: Position | null) => {
    for (const settle of waiters) {
      settle(position);
    }
    waiters.clear();
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    stopWatching?.();
    stopWatching = null;
    settleWaiters(null);
  };

  const onReading = (raw: unknown) => {
    if (stopped) {
      return;
    }
    const reading = readReading(raw, "fix");
    if (reading === null) {
      return;
    }
    if (best === null || isAtLeastAsAccurate(reading.position, best)) {
      best = reading.position;
    }
    if (waiters.size > 0) {
      settleWaiters(best);
      stop();
    }
  };

  source.watch(onReading).then(
    (stopIt) => {
      if (stopped) {
        stopIt();
      } else {
        stopWatching = stopIt;
      }
    },
    () => {
      watchFailed = true;
      settleWaiters(null);
    },
  );

  return {
    async positionNow() {
      if (best !== null) {
        return best;
      }
      try {
        const reading = readReading(
          await source.lastKnown(options.lastKnownMaxAgeMs),
          "last-known",
        );
        if (reading === null || reading.timestampMs === null) {
          return null;
        }
        return options.now() - reading.timestampMs <= options.lastKnownMaxAgeMs
          ? reading.position
          : null;
      } catch {
        return null;
      }
    },

    firstFix() {
      if (best !== null) {
        const found = best;
        stop();
        return Promise.resolve(found);
      }
      if (stopped || watchFailed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(settle);
          resolve(null);
          stop();
        }, options.fixWaitMs);
        const settle = (position: Position | null) => {
          clearTimeout(timer);
          resolve(position);
        };
        waiters.add(settle);
      });
    },

    stop,
  };
}

/** Whether `a` is as accurate as `b` or more; a later fix wins a tie. */
function isAtLeastAsAccurate(a: Position, b: Position): boolean {
  if (a.accuracyM === null) {
    return b.accuracyM === null;
  }
  return b.accuracyM === null || a.accuracyM <= b.accuracyM;
}

/** A reading as expo-location gives it (`coords` and `timestamp`), checked; null if it is not one. */
function readReading(raw: unknown, source: "fix" | "last-known"): Reading | null {
  if (typeof raw !== "object" || raw === null || !("coords" in raw)) {
    return null;
  }
  const coords: unknown = raw.coords;
  if (typeof coords !== "object" || coords === null) {
    return null;
  }
  const latitude = "latitude" in coords ? coords.latitude : undefined;
  const longitude = "longitude" in coords ? coords.longitude : undefined;
  const accuracy = "accuracy" in coords ? coords.accuracy : null;
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) {
    return null;
  }
  if (accuracy !== null && !isMetres(accuracy)) {
    return null;
  }
  const timestamp = "timestamp" in raw ? raw.timestamp : undefined;
  return {
    position: { latitude, longitude, accuracyM: accuracy, source },
    timestampMs: typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null,
  };
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

function isMetres(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
