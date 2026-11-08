import type { ImageLimits } from "./resize";

/**
 * Configuration: the image limits of the two model tiers (docs/SPEC.md 3.3; the Claude
 * docs page "Coordinates and bounding boxes"). They belong with the model's ID and move
 * to the config module when it is added; the resize rule takes them as a parameter and
 * holds none of them itself.
 */

/** Standard-tier models: 1,568 px on the long edge and 1,568 visual tokens. */
export const STANDARD_TIER: ImageLimits = { maxEdge: 1568, maxTokens: 1568, patchSize: 28 };

/** High-resolution-tier models (Claude 4.7 and later): 2,576 px and 4,784 visual tokens. */
export const HIGH_RESOLUTION_TIER: ImageLimits = {
  maxEdge: 2576,
  maxTokens: 4784,
  patchSize: 28,
};
