/**
 * The app's configuration values (docs/SPEC.md 2, 3.3, 3.6). Every such value lives here and
 * nowhere else (Process P-11 § 5 (2)). Nothing secret belongs here: the API key is the user's
 * own and is kept in the secure store, never in configuration.
 */

import type { ImageLimits } from "../image/resize";

/** A model the app can use, with its image limits (docs/SPEC.md 3.3) kept with its ID. */
export type ModelConfig = {
  readonly id: string;
  readonly imageLimits: ImageLimits;
};

export type AppConfig = {
  /** The Claude API address. */
  readonly apiBaseUrl: string;
  /** The time limit of one analysis request, in milliseconds. */
  readonly requestTimeoutMs: number;
  /** How old the phone's last known position may be to be used for a find, in milliseconds. */
  readonly lastKnownPositionMaxAgeMs: number;
  /** How long the app goes on asking for a first position fix after the photo, in milliseconds. */
  readonly positionFixWaitMs: number;
  /** The models the app offers; filled in PBI-1.2. */
  readonly models: readonly ModelConfig[];
};

export const config: AppConfig = Object.freeze({
  apiBaseUrl: "https://api.anthropic.com",
  requestTimeoutMs: 60_000,
  lastKnownPositionMaxAgeMs: 2 * 60_000,
  positionFixWaitMs: 30_000,
  models: Object.freeze([]),
});
