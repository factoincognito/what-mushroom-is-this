/**
 * Where the Library's map opens (docs/SPEC.md 3.9, The Library). When the map opens, the app asks
 * for the location permission if it has not yet asked, and then uses a position fix if one comes
 * within the wait limit, otherwise the phone's last known position when it is no older than the
 * age limit. Without either, the map opens on the newest find with a position among those that
 * pass the Library's filters, at the same scale; with none, on the default area (Clead, PBI-2.8). The area around a position is a square whose side spans the
 * opening span, so that the view's shorter side spans it. The limits, the span and the default
 * area are configuration. It renders nothing.
 */

import { config } from "../config/config";
import { ensurePermission, type PermissionAsker } from "../newFind/permissions";
import {
  type LocationSource,
  type PositionTracker,
  startPositionTracker,
} from "../position/positionTracker";
import type { ListedFind } from "../store/find";
import { applyFilters, type LibraryFilters } from "./filters";
import { type MapBounds, squareAround } from "./mapArea";
import { newestWithPosition } from "./mapPins";

/** What the opening area was taken from. */
export type OpeningSource = "fix" | "last-known" | "find" | "default";

export interface OpeningArea {
  readonly bounds: MapBounds;
  readonly from: OpeningSource;
}

export interface OpeningLimits {
  /** How long to wait for a fix, in milliseconds. */
  readonly fixWaitMs: number;
  /** How old the last known position may be, in milliseconds. */
  readonly lastKnownMaxAgeMs: number;
  /** The span of the opening area's side, in metres. */
  readonly sideM: number;
  /** The area without a position. */
  readonly defaultArea: MapBounds;
}

export interface OpeningDeps {
  /** The location permission while the app is in use. */
  readonly permission: PermissionAsker;
  /** The phone's location service. */
  readonly location: LocationSource;
  /** The time now, in milliseconds since the epoch. */
  readonly now: () => number;
  /** The Library's finds, newest first, as the store lists them. */
  readonly entries: readonly ListedFind[];
  /** The Library's filters: the fallback takes the newest find that passes them. */
  readonly filters: LibraryFilters;
}

export interface Opening {
  /** The area the map opens on; it always resolves. */
  readonly area: Promise<OpeningArea>;
  /**
   * Stops asking the phone for a position, when the map is left before it opens; the area then
   * resolves to a fallback, which the caller does not use.
   */
  cancel(): void;
}

/** The limits as the configuration gives them. */
export const CONFIGURED_LIMITS: OpeningLimits = Object.freeze({
  fixWaitMs: config.mapPositionFixWaitMs,
  lastKnownMaxAgeMs: config.mapLastKnownPositionMaxAgeMs,
  sideM: config.mapOpeningSideM,
  defaultArea: config.mapDefaultArea,
});

/** Starts finding where the map opens. */
export function startOpening(
  deps: OpeningDeps,
  limits: OpeningLimits = CONFIGURED_LIMITS,
): Opening {
  let cancelled = false;
  let tracker: PositionTracker | null = null;

  const withoutPosition = (): OpeningArea => {
    // Among the finds that pass the filters, so that the map opens where it shows a pin (Clead,
    // PBI-2.8); with none, the default area.
    const newest = newestWithPosition(applyFilters(deps.entries, deps.filters));
    return newest === null
      ? { from: "default", bounds: limits.defaultArea }
      : { from: "find", bounds: squareAround(newest, limits.sideM) };
  };

  const find = async (): Promise<OpeningArea> => {
    // The location is asked for once, as for a new find (SPEC 3.6): not again after a refusal.
    const permission = await ensurePermission(deps.permission, { askAgainWhenDenied: false });
    if (cancelled || permission !== "granted") {
      return withoutPosition();
    }
    const watching = startPositionTracker(deps.location, {
      lastKnownMaxAgeMs: limits.lastKnownMaxAgeMs,
      fixWaitMs: limits.fixWaitMs,
      now: deps.now,
    });
    tracker = watching;
    const fix = await watching.firstFix();
    if (fix !== null) {
      return { from: "fix", bounds: squareAround(fix, limits.sideM) };
    }
    if (cancelled) {
      return withoutPosition();
    }
    const lastKnown = await watching.positionNow();
    return lastKnown === null
      ? withoutPosition()
      : { from: "last-known", bounds: squareAround(lastKnown, limits.sideM) };
  };

  return {
    // A position the area cannot be built around, which only a damaged file gives, opens the
    // default area rather than no map.
    area: find().catch((): OpeningArea => ({ from: "default", bounds: limits.defaultArea })),
    cancel() {
      cancelled = true;
      tracker?.stop();
    },
  };
}
