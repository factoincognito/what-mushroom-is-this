import type { ImageLimits } from "../image/resize";
import { config, HIGH_RESOLUTION_TIER, type ModelConfig, STANDARD_TIER } from "./config";

describe("config", () => {
  it("holds the Claude API address of SPEC 3.3", () => {
    expect(config.apiBaseUrl).toBe("https://api.anthropic.com");
  });

  it("holds the request time limit of SPEC 3.3, 60 seconds", () => {
    expect(config.requestTimeoutMs).toBe(60_000);
  });

  it("holds the last-known-position age limit of SPEC 3.6, two minutes", () => {
    expect(config.lastKnownPositionMaxAgeMs).toBe(120_000);
  });

  it("holds the wait for a first position fix of SPEC 3.6, 30 seconds", () => {
    expect(config.positionFixWaitMs).toBe(30_000);
  });

  it("holds the JPEG quality of the photo for analysis, between 0 and 1 (expo-image-manipulator's compress)", () => {
    expect(config.analysisJpegQuality).toBe(0.9);
  });

  it("holds the most photos a find holds, 5, of SPEC 3.9 (PBI-2.2)", () => {
    expect(config.maxPhotosPerFind).toBe(5);
  });

  it("holds the longest text a lookup takes, 2,000 characters, of SPEC 3.9 (PBI-2.2)", () => {
    expect(config.lookupTextMaxLength).toBe(2000);
  });

  it("holds the confidence below which the edibility shown is unknown, 70, of SPEC 3.9 (PBI-2.3)", () => {
    expect(config.edibilityConfidenceLine).toBe(70);
  });

  it("holds the starting values of the lookups' Save switch of SPEC 3.9: on for a photo lookup, off for a text lookup (PBI-2.13)", () => {
    expect(config.photoLookupSavedAtStart).toBe(true);
    expect(config.textLookupSavedAtStart).toBe(false);
  });

  it("keeps each model's image limits in the image module's ImageLimits type", () => {
    const limits: ImageLimits = { maxEdge: 1568, maxTokens: 1568, patchSize: 28 };
    const model: ModelConfig = { id: "a-model", imageLimits: limits };
    expect(model.imageLimits).toBe(limits);
  });

  it("is frozen, so no module can change a value at run time", () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.models)).toBe(true);
    for (const model of config.models) {
      expect(Object.isFrozen(model)).toBe(true);
      expect(Object.isFrozen(model.imageLimits)).toBe(true);
    }
    expect(Object.isFrozen(config.unlistedModelImageLimits)).toBe(true);
  });

  it("holds no secret: no API key or token", () => {
    const text = JSON.stringify(config).toLowerCase();
    expect(text).not.toContain("sk-ant");
    expect(Object.keys(config).some((key) => /key|token|secret/i.test(key))).toBe(false);
  });
});

describe("the image limits of the two tiers (SPEC 3.3)", () => {
  it("are 1,568 px and 1,568 visual tokens on the standard tier, at 28 px patches", () => {
    expect(STANDARD_TIER).toEqual({ maxEdge: 1568, maxTokens: 1568, patchSize: 28 });
  });

  it("are 2,576 px and 4,784 visual tokens on the high-resolution tier, at 28 px patches", () => {
    expect(HIGH_RESOLUTION_TIER).toEqual({ maxEdge: 2576, maxTokens: 4784, patchSize: 28 });
  });

  it("are frozen", () => {
    expect(Object.isFrozen(STANDARD_TIER)).toBe(true);
    expect(Object.isFrozen(HIGH_RESOLUTION_TIER)).toBe(true);
  });
});

describe("the model list", () => {
  it("holds the current models of the Claude docs' models overview, read 2026-11-08", () => {
    expect(config.models.map((model) => model.id)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("gives every listed model the high-resolution tier (Claude 4.7 and later)", () => {
    for (const model of config.models) {
      expect(model.imageLimits).toEqual(HIGH_RESOLUTION_TIER);
    }
  });

  it("has each model ID once", () => {
    const ids = config.models.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a default model that is one of the listed models", () => {
    expect(config.models.map((model) => model.id)).toContain(config.defaultModelId);
  });

  it("proposes Claude Opus 5.5 as the default", () => {
    expect(config.defaultModelId).toBe("claude-opus-5-5");
  });

  it("gives a model ID that is not listed the standard tier, which fits every model", () => {
    expect(config.unlistedModelImageLimits).toEqual(STANDARD_TIER);
  });
});
