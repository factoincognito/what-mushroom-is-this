import { analysisConfig } from "./analysis";

describe("analysisConfig", () => {
  it("holds the API version of SPEC 3.3", () => {
    expect(analysisConfig.apiVersion).toBe("2026-10-21");
  });

  it("holds a max_tokens with room for adaptive thinking before the answer", () => {
    expect(analysisConfig.maxTokens).toBe(16_000);
  });

  it("keeps max_tokens under the SDK's streaming threshold, as the call does not stream", () => {
    expect(analysisConfig.maxTokens).toBeLessThanOrEqual(21_333);
  });

  it("bounds a retry-after at one day ahead", () => {
    expect(analysisConfig.retryAfterMaxMs).toBe(24 * 60 * 60 * 1_000);
  });

  it("holds no per-model thinking or effort setting, so each model runs with its own default", () => {
    expect(Object.keys(analysisConfig).sort()).toEqual([
      "apiVersion",
      "maxTokens",
      "retryAfterMaxMs",
    ]);
  });

  it("is frozen, so no module can change a value at run time", () => {
    expect(Object.isFrozen(analysisConfig)).toBe(true);
  });

  it("holds no secret: no API key or token value", () => {
    expect(JSON.stringify(analysisConfig).toLowerCase()).not.toContain("sk-ant");
  });
});
