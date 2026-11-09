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
  /**
   * The JPEG quality of the photo re-encoded for analysis, above 0 and at most 1: the `compress`
   * of expo-image-manipulator's `saveAsync`, where 1 is the highest quality.
   */
  readonly analysisJpegQuality: number;
  /** The models the app offers, each with its image limits. */
  readonly models: readonly ModelConfig[];
  /** The model used until the user chooses another; one of `models`. */
  readonly defaultModelId: string;
  /**
   * The image limits for a model ID the user typed that is not in `models`: the standard tier,
   * whose limits are within those of every model, so a photo sized to them is never downscaled.
   */
  readonly unlistedModelImageLimits: ImageLimits;
  /** The most photos a find holds (docs/SPEC.md 3.9, Batches). */
  readonly maxPhotosPerFind: number;
  /**
   * The longest text a lookup takes, in characters (docs/SPEC.md 3.9, Lookups), each counted as
   * one Unicode code point.
   */
  readonly lookupTextMaxLength: number;
  /**
   * The confidence, from 1 to 100, below which the edibility shown is "unknown", whatever the
   * answer said (docs/SPEC.md 3.9, Answers). A Phase 1 find's level keeps the rule of 3.3.
   */
  readonly edibilityConfidenceLine: number;
  /**
   * Whether a text lookup's "Save" switch is on when the lookup starts, until the user saves
   * another starting value in Settings (docs/SPEC.md 3.9, Lookups).
   */
  readonly textLookupSavedAtStart: boolean;
};

/**
 * The image limits of the two model tiers, from the Claude docs page "Vision",
 * https://platform.claude.com/docs/en/build-with-claude/vision, read 2026-11-08: one visual token
 * per 28 x 28 px patch; high-resolution tier, "Claude 4.7 and later models", 2,576 px on the long
 * edge and 4,784 visual tokens; standard tier, "All other models", 1,568 px and 1,568 tokens.
 */
export const STANDARD_TIER: ImageLimits = Object.freeze({
  maxEdge: 1568,
  maxTokens: 1568,
  patchSize: 28,
});

export const HIGH_RESOLUTION_TIER: ImageLimits = Object.freeze({
  maxEdge: 2576,
  maxTokens: 4784,
  patchSize: 28,
});

function model(id: string, imageLimits: ImageLimits): ModelConfig {
  return Object.freeze({ id, imageLimits });
}

export const config: AppConfig = Object.freeze({
  apiBaseUrl: "https://api.anthropic.com",
  requestTimeoutMs: 60_000,
  lastKnownPositionMaxAgeMs: 2 * 60_000,
  positionFixWaitMs: 30_000,
  // Proposed by Crog in PBI-1.6: the docs give no value; 0.9 keeps the detail a species is told by.
  analysisJpegQuality: 0.9,
  // The current models, in the order of the Claude docs page "Models overview",
  // https://platform.claude.com/docs/en/about-claude/models/overview, read 2026-11-08. All four
  // are Claude 5 models, so later than Claude 4.7: the high-resolution tier of the "Vision" page.
  models: Object.freeze([
    model("claude-fable-5-1", HIGH_RESOLUTION_TIER),
    model("claude-opus-5-5", HIGH_RESOLUTION_TIER),
    model("claude-sonnet-5-5", HIGH_RESOLUTION_TIER),
    model("claude-haiku-5-5", HIGH_RESOLUTION_TIER),
  ]),
  // Proposed by Crog in PBI-1.2; the "Models overview" page: "If you're unsure which model to
  // use, start with Claude Opus 5.5 for most workloads."
  defaultModelId: "claude-opus-5-5",
  unlistedModelImageLimits: STANDARD_TIER,
  // Both docs/SPEC.md 3.9, Clead's limits, kept as configuration as the spec says.
  maxPhotosPerFind: 5,
  lookupTextMaxLength: 2000,
  // docs/SPEC.md 3.9: Adam's line, kept as configuration as the spec says.
  edibilityConfidenceLine: 70,
  // docs/SPEC.md 3.9: Adam's starting value, "off for a text lookup unless the user changes it".
  textLookupSavedAtStart: false,
});
