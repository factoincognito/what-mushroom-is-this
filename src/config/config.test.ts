import { config } from "./config";

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

  it("has a model list, each model with its image limits, empty until PBI-1.2 fills it", () => {
    expect(Array.isArray(config.models)).toBe(true);
    expect(config.models).toHaveLength(0);
  });

  it("is frozen, so no module can change a value at run time", () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.models)).toBe(true);
  });

  it("holds no secret: no API key or token", () => {
    const text = JSON.stringify(config).toLowerCase();
    expect(text).not.toContain("sk-ant");
    expect(Object.keys(config).some((key) => /key|token|secret/i.test(key))).toBe(false);
  });
});
