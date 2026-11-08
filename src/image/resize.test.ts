import { countImageTokens, type ImageLimits, resizedSize, roundHalfToEven } from "./resize";
import { HIGH_RESOLUTION_TIER, STANDARD_TIER } from "./tiers";

describe("roundHalfToEven", () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [952.5, 952],
    [953.5, 954],
    [-1.5, -2],
    [-2.5, -2],
  ])("rounds the exact half %d to the even neighbour %d", (value, expected) => {
    expect(roundHalfToEven(value)).toBe(expected);
  });

  it.each([
    [2.4, 2],
    [2.6, 3],
    [924.358552631579, 924],
    [951.75, 952],
    [7, 7],
    [0, 0],
  ])("rounds %d, which is not a half, to the nearest integer %d", (value, expected) => {
    expect(roundHalfToEven(value)).toBe(expected);
  });

  it("does not round as Math.round does at 952.5", () => {
    expect(Math.round(952.5)).toBe(953);
    expect(roundHalfToEven(952.5)).toBe(952);
  });

  it.each([NaN, Infinity, -Infinity])(
    "throws a RangeError for the non-finite value %d",
    (value) => {
      expect(() => roundHalfToEven(value)).toThrow(RangeError);
    },
  );
});

describe("countImageTokens", () => {
  it("counts one token per started patch on each edge", () => {
    expect(countImageTokens(1075, 1520, 28)).toBe(39 * 55);
    expect(countImageTokens(28, 28, 28)).toBe(1);
    expect(countImageTokens(29, 28, 28)).toBe(2);
  });
});

describe("resizedSize: the docs example and the 4:3 sizes", () => {
  it("resizes the docs example 1075 x 1520 to 924 x 1307 on the standard tier", () => {
    expect(resizedSize(1075, 1520, STANDARD_TIER)).toEqual({ ok: true, width: 924, height: 1307 });
    expect(countImageTokens(924, 1307, 28)).toBe(1551);
  });

  it("leaves the docs example 1075 x 1520 unchanged on the high-resolution tier", () => {
    expect(resizedSize(1075, 1520, HIGH_RESOLUTION_TIER)).toEqual({
      ok: true,
      width: 1075,
      height: 1520,
    });
  });

  it("resizes a 4:3 photo, 4032 x 3024, to 1270 x 952 (1,564 tokens) on the standard tier", () => {
    expect(resizedSize(4032, 3024, STANDARD_TIER)).toEqual({ ok: true, width: 1270, height: 952 });
    expect(countImageTokens(1270, 952, 28)).toBe(1564);
  });

  it("keeps 1270 at the 952.5 tie, which Math.round would round to 953 (1,610 tokens, too many)", () => {
    expect(1270 / (4032 / 3024)).toBe(952.5);
    expect(countImageTokens(1270, 953, 28)).toBe(1610);
    expect(countImageTokens(1270, 953, 28)).toBeGreaterThan(STANDARD_TIER.maxTokens);
  });

  it("resizes a 4:3 photo, 4032 x 3024, to 2212 x 1659 (4,740 tokens) on the high-resolution tier", () => {
    expect(resizedSize(4032, 3024, HIGH_RESOLUTION_TIER)).toEqual({
      ok: true,
      width: 2212,
      height: 1659,
    });
    expect(countImageTokens(2212, 1659, 28)).toBe(4740);
  });

  it("resizes a portrait 3:4 photo, 3024 x 4032, to 952 x 1270 on the standard tier", () => {
    expect(resizedSize(3024, 4032, STANDARD_TIER)).toEqual({ ok: true, width: 952, height: 1270 });
  });

  it("resizes a portrait 3:4 photo, 3024 x 4032, to 1659 x 2212 on the high-resolution tier", () => {
    expect(resizedSize(3024, 4032, HIGH_RESOLUTION_TIER)).toEqual({
      ok: true,
      width: 1659,
      height: 2212,
    });
  });
});

describe("resizedSize: other sizes", () => {
  it("resizes 1920 x 1080 to 1456 x 819 on the standard tier, limited by tokens", () => {
    expect(resizedSize(1920, 1080, STANDARD_TIER)).toEqual({ ok: true, width: 1456, height: 819 });
  });

  it("resizes 4000 x 1800 to 1568 x 706 on the standard tier, limited by the long edge", () => {
    expect(resizedSize(4000, 1800, STANDARD_TIER)).toEqual({ ok: true, width: 1568, height: 706 });
    expect(countImageTokens(1568, 706, 28)).toBeLessThan(STANDARD_TIER.maxTokens);
  });

  it("resizes a square 2000 x 2000 to 1092 x 1092 on the standard tier", () => {
    expect(resizedSize(2000, 2000, STANDARD_TIER)).toEqual({ ok: true, width: 1092, height: 1092 });
  });

  it("keeps the short edge at least 1 px for an extreme panorama, 100000 x 1", () => {
    expect(resizedSize(100000, 1, STANDARD_TIER)).toEqual({ ok: true, width: 1568, height: 1 });
  });

  it("resizes extreme strips, 10000 x 10 and 10 x 10000, to 1568 x 2 and 2 x 1568", () => {
    expect(resizedSize(10000, 10, STANDARD_TIER)).toEqual({ ok: true, width: 1568, height: 2 });
    expect(resizedSize(10, 10000, STANDARD_TIER)).toEqual({ ok: true, width: 2, height: 1568 });
  });

  it.each([
    [800, 600],
    [1, 1],
    [1568, 28],
  ])("leaves %i x %i, which already fits the standard tier, unchanged", (width, height) => {
    expect(resizedSize(width, height, STANDARD_TIER)).toEqual({ ok: true, width, height });
  });

  it("fits each edge rounded up to whole patches within the edge limit the limits give", () => {
    const limits: ImageLimits = { maxEdge: 1000, maxTokens: 1_000_000, patchSize: 28 };
    // 990 is under 1000, but 36 patches of 28 px make 1008, so the long edge goes down to 980.
    expect(resizedSize(990, 10, limits)).toEqual({ ok: true, width: 980, height: 10 });
  });

  it.each([
    [4032, 3024],
    [3024, 4032],
    [1075, 1520],
    [1920, 1080],
    [5000, 37],
    [6000, 4000],
    [1601, 1599],
  ])(
    "gives for %i x %i a size that fits both tiers, and one more pixel on the long edge does not",
    (width, height) => {
      for (const limits of [STANDARD_TIER, HIGH_RESOLUTION_TIER]) {
        const result = resizedSize(width, height, limits);
        if (!result.ok) {
          throw new Error(`expected a size for ${width} x ${height}`);
        }
        const p = limits.patchSize;
        expect(Math.ceil(result.width / p) * p).toBeLessThanOrEqual(limits.maxEdge);
        expect(Math.ceil(result.height / p) * p).toBeLessThanOrEqual(limits.maxEdge);
        expect(countImageTokens(result.width, result.height, p)).toBeLessThanOrEqual(
          limits.maxTokens,
        );
        if (result.width !== width || result.height !== height) {
          const long = Math.max(result.width, result.height) + 1;
          const short = Math.max(
            roundHalfToEven(long / (Math.max(width, height) / Math.min(width, height))),
            1,
          );
          const grownFits =
            Math.ceil(long / p) * p <= limits.maxEdge &&
            Math.ceil(short / p) * p <= limits.maxEdge &&
            countImageTokens(long, short, p) <= limits.maxTokens;
          expect(grownFits).toBe(false);
        }
      }
    },
  );
});

describe("resizedSize: invalid input", () => {
  it.each<[string, number, number]>([
    ["a zero width", 0, 100],
    ["a zero height", 100, 0],
    ["a negative width", -4032, 3024],
    ["a fractional height", 4032, 3024.5],
    ["a NaN width", Number.NaN, 3024],
    ["an infinite height", 4032, Number.POSITIVE_INFINITY],
    ["a width beyond the safe integers", 2 ** 53, 3024],
  ])("rejects %s as an invalid size", (_label, width, height) => {
    expect(resizedSize(width, height, STANDARD_TIER)).toEqual({
      ok: false,
      reason: "invalid-size",
    });
  });

  it.each<[string, ImageLimits]>([
    ["a zero edge limit", { maxEdge: 0, maxTokens: 1568, patchSize: 28 }],
    [
      "an infinite edge limit",
      { maxEdge: Number.POSITIVE_INFINITY, maxTokens: 1568, patchSize: 28 },
    ],
    ["a fractional token limit", { maxEdge: 1568, maxTokens: 1568.5, patchSize: 28 }],
    ["a zero token limit", { maxEdge: 1568, maxTokens: 0, patchSize: 28 }],
    ["a NaN patch size", { maxEdge: 1568, maxTokens: 1568, patchSize: Number.NaN }],
    ["a negative patch size", { maxEdge: 1568, maxTokens: 1568, patchSize: -28 }],
    ["an edge limit below one patch", { maxEdge: 27, maxTokens: 1568, patchSize: 28 }],
  ])("rejects %s as invalid limits", (_label, limits) => {
    expect(resizedSize(4032, 3024, limits)).toEqual({ ok: false, reason: "invalid-limits" });
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", "1568"],
    ["limits given as strings", { maxEdge: "1568", maxTokens: "1568", patchSize: "28" }],
    ["limits with a field missing", { maxEdge: 1568, maxTokens: 1568 }],
  ])("rejects %s in place of the limits, without coercing it", (_label, limits) => {
    expect(resizedSize(4032, 3024, limits as ImageLimits)).toEqual({
      ok: false,
      reason: "invalid-limits",
    });
  });

  it("rejects a size given as a string, without coercing it", () => {
    expect(resizedSize("4032" as unknown as number, 3024, STANDARD_TIER)).toEqual({
      ok: false,
      reason: "invalid-size",
    });
  });
});
