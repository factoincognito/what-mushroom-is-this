import { type AnalysisConfig, analysisConfig, requestSettingsFor } from "./analysis";
import { config } from "./config";

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

  it("is frozen, so no module can change a value at run time", () => {
    expect(Object.isFrozen(analysisConfig)).toBe(true);
    expect(Object.isFrozen(analysisConfig.models)).toBe(true);
    for (const model of analysisConfig.models) {
      expect(Object.isFrozen(model)).toBe(true);
      if (model.thinking !== undefined) {
        expect(Object.isFrozen(model.thinking)).toBe(true);
      }
    }
  });

  it("holds no secret: no API key or token value", () => {
    expect(JSON.stringify(analysisConfig).toLowerCase()).not.toContain("sk-ant");
  });

  it("has request settings only for models the config module lists, each once", () => {
    const listed = config.models.map((model) => model.id);
    const ids = analysisConfig.models.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(listed).toContain(id);
    }
  });
});

describe("requestSettingsFor, the current models", () => {
  it("turns effort down to low for every listed model", () => {
    for (const model of config.models) {
      expect(requestSettingsFor(model.id).effort).toBe("low");
    }
  });

  it("turns thinking off on Claude Haiku 5.5, which accepts disabled at high effort or below", () => {
    expect(requestSettingsFor("claude-haiku-5-5")).toEqual({
      effort: "low",
      thinking: { type: "disabled" },
    });
  });

  it("turns up-front thinking off on Claude Sonnet 5.5 with between_tools", () => {
    expect(requestSettingsFor("claude-sonnet-5-5")).toEqual({
      effort: "low",
      thinking: { type: "between_tools" },
    });
  });

  it.each(["claude-opus-5-5", "claude-fable-5-1"])(
    "sends no thinking setting for %s, which rejects disabled and keeps adaptive",
    (id) => {
      expect(requestSettingsFor(id)).toEqual({ effort: "low" });
    },
  );
});

describe("requestSettingsFor, a model that is not listed", () => {
  it.each([
    ["a model the app does not know", "claude-future-9"],
    ["an empty ID", ""],
    ["an inherited property name", "constructor"],
    ["the prototype key", "__proto__"],
    ["toString", "toString"],
  ])("sends neither effort nor thinking for %s", (_label, id) => {
    expect(requestSettingsFor(id)).toEqual({});
  });

  it("reads the settings of the config it is given", () => {
    const other: AnalysisConfig = {
      ...analysisConfig,
      models: [{ id: "a-model", effort: "high" }],
    };
    expect(requestSettingsFor("a-model", other)).toEqual({ effort: "high" });
    expect(requestSettingsFor("claude-opus-5-5", other)).toEqual({});
  });
});
