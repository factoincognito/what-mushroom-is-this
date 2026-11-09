/**
 * The resize rule of the image module (docs/SPEC.md 3.3): the largest size, at the
 * photo's own aspect ratio, that fits both image limits of the model in use. It is the
 * reference rule of the Claude docs page "Coordinates and bounding boxes": a binary
 * search along the long edge, the short edge rounded half to even as the page's Python
 * code rounds it. The limits come in as a parameter; the rule holds none of them.
 */

export type ImageLimits = {
  /** The most pixels either edge may have, after rounding up to whole patches. */
  maxEdge: number;
  /** The most visual tokens the image may cost. */
  maxTokens: number;
  /** The edge, in pixels, of the square patch that costs one visual token. */
  patchSize: number;
};

export type ResizeResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: "invalid-size" | "invalid-limits" };

/**
 * Rounds to the nearest integer, and an exact half to the even neighbour (952.5 to 952),
 * as Python's round() does. Math.round would round 952.5 up to 953.
 * Throws a RangeError for a value that is not finite: that is a programming error.
 */
export function roundHalfToEven(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundHalfToEven needs a finite number, got ${value}`);
  }
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) {
    return floor;
  }
  if (fraction > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

export type TokenCountResult =
  | { ok: true; tokens: number }
  | { ok: false; reason: "invalid-size" | "invalid-patch-size" };

/**
 * The visual tokens an image costs: one per patch started on each edge. A size or a patch
 * size that is not a positive integer gives a failing result, as in `resizedSize`; nothing is
 * coerced. The size is checked first.
 */
export function countImageTokens(
  width: number,
  height: number,
  patchSize: number,
): TokenCountResult {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    return { ok: false, reason: "invalid-size" };
  }
  if (!isPositiveInteger(patchSize)) {
    return { ok: false, reason: "invalid-patch-size" };
  }
  return { ok: true, tokens: tokensFor(width, height, patchSize) };
}

/** The token count, for input already checked. */
function tokensFor(width: number, height: number, patchSize: number): number {
  return Math.ceil(width / patchSize) * Math.ceil(height / patchSize);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validLimits(limits: unknown): limits is ImageLimits {
  if (typeof limits !== "object" || limits === null) {
    return false;
  }
  const { maxEdge, maxTokens, patchSize } = limits as Record<string, unknown>;
  return (
    isPositiveInteger(maxEdge) &&
    isPositiveInteger(maxTokens) &&
    isPositiveInteger(patchSize) &&
    // With at least one patch on each edge, a 1 x 1 image fits, so the search has a start.
    maxEdge >= patchSize
  );
}

function fits(width: number, height: number, limits: ImageLimits): boolean {
  const { maxEdge, maxTokens, patchSize } = limits;
  return (
    Math.ceil(width / patchSize) * patchSize <= maxEdge &&
    Math.ceil(height / patchSize) * patchSize <= maxEdge &&
    tokensFor(width, height, patchSize) <= maxTokens
  );
}

/** Solves the rule for an image whose first edge is the long one. */
function resizeLandscape(long: number, short: number, limits: ImageLimits): [number, number] {
  const aspectRatio = long / short;
  const shortFor = (edge: number): number => Math.max(roundHalfToEven(edge / aspectRatio), 1);
  let lo = 1; // always fits
  let hi = long; // never fits, or the image would have been returned unchanged
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, shortFor(mid), limits)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lo, shortFor(lo)];
}

/**
 * The size to resize a photo to before it is sent. A photo that already fits is
 * returned unchanged. A size or limits that are not positive integers give a failing
 * result; nothing is coerced.
 */
export function resizedSize(width: number, height: number, limits: ImageLimits): ResizeResult {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    return { ok: false, reason: "invalid-size" };
  }
  if (!validLimits(limits)) {
    return { ok: false, reason: "invalid-limits" };
  }
  if (fits(width, height, limits)) {
    return { ok: true, width, height };
  }
  if (height > width) {
    const [newHeight, newWidth] = resizeLandscape(height, width, limits);
    return { ok: true, width: newWidth, height: newHeight };
  }
  const [newWidth, newHeight] = resizeLandscape(width, height, limits);
  return { ok: true, width: newWidth, height: newHeight };
}
