/**
 * The configuration values of the analysis request (docs/SPEC.md 3.3): the API version,
 * `max_tokens`, the bound for a far-future `retry-after`, and the thinking and effort settings
 * of each listed model. They are configuration under Process P-11 § 5 (2), kept in the config
 * module beside `config.ts`. Nothing secret belongs here.
 */

/** The effort levels of the Claude docs page "Effort" (`output_config.effort`). */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The `thinking` settings the app sends to turn thinking off on the models that allow it. */
export type Thinking = { readonly type: "disabled" } | { readonly type: "between_tools" };

/** What the request sends for a model beyond the model ID, both optional. */
export type ModelRequestSettings = {
  readonly effort?: Effort;
  readonly thinking?: Thinking;
};

export type ModelRequestConfig = { readonly id: string } & ModelRequestSettings;

export type AnalysisConfig = {
  /** The `anthropic-version` header. The request is built for this version's rules. */
  readonly apiVersion: string;
  /** The request's `max_tokens`: the thinking and the answer's text together. */
  readonly maxTokens: number;
  /** How far ahead of the answer a `retry-after` may lie, in milliseconds; beyond it, missing. */
  readonly retryAfterMaxMs: number;
  /** The request settings of the listed models. A model not here gets none. */
  readonly models: readonly ModelRequestConfig[];
};

function model(id: string, settings: ModelRequestSettings): ModelRequestConfig {
  return Object.freeze({ id, ...settings });
}

const THINKING_OFF: Thinking = Object.freeze({ type: "disabled" });
const UP_FRONT_THINKING_OFF: Thinking = Object.freeze({ type: "between_tools" });
const NO_SETTINGS: ModelRequestSettings = Object.freeze({});

export const analysisConfig: AnalysisConfig = Object.freeze({
  // The Claude docs page "Versions", https://platform.claude.com/docs/en/api/versioning, read
  // 2026-11-08: the latest version, which Anthropic recommends.
  apiVersion: "2026-10-21",
  // The Claude docs page "Thinking", https://platform.claude.com/docs/en/build-with-claude/thinking,
  // read 2026-11-09: on Claude 5 models thinking is on by default ("Adaptive thinking" with no
  // `thinking` field), it cannot be turned off on Opus 5.5 and Fable 5.1, budget_tokens is a 400
  // on all four, and "Thinking tokens count toward `max_tokens`, so set it high enough to leave
  // room for both the thinking and the response text". Effort is "soft guidance", so max_tokens
  // is the only hard limit. 16,000 is the page's own Opus 5.5 example; it stays under the 21,333
  // above which "The SDK requires streaming" (this call does not stream), and it keeps the 4,096
  // the answer's JSON had before thinking was counted, with about 12,000 more for the thinking.
  maxTokens: 16_000,
  // Proposed by Crog in PBI-1.14: a wait of more than a day is the user's to start, not the queue's.
  retryAfterMaxMs: 24 * 60 * 60 * 1_000,
  // From the "Thinking" page's "Configuring thinking" table and the "Effort" page,
  // https://platform.claude.com/docs/en/build-with-claude/effort, both read 2026-11-09. Every
  // listed model supports all five effort levels; at low, "Claude can skip thinking entirely for
  // simpler problems". Haiku 5.5 accepts `disabled` and Sonnet 5.5 `between_tools` ("Up-front
  // thinking off"), each only at high effort or below. Opus 5.5 and Fable 5.1 reject both, so they
  // keep the default adaptive thinking.
  models: Object.freeze([
    model("claude-fable-5-1", { effort: "low" }),
    model("claude-opus-5-5", { effort: "low" }),
    model("claude-sonnet-5-5", { effort: "low", thinking: UP_FRONT_THINKING_OFF }),
    model("claude-haiku-5-5", { effort: "low", thinking: THINKING_OFF }),
  ]),
});

/**
 * The request settings for a model ID: its own when it is listed, otherwise none, so a model
 * newer or older than the app is sent no setting it may refuse.
 */
export function requestSettingsFor(
  modelId: string,
  config: AnalysisConfig = analysisConfig,
): ModelRequestSettings {
  const listed = config.models.find((entry) => entry.id === modelId);
  if (listed === undefined) {
    return NO_SETTINGS;
  }
  const { id: _id, ...settings } = listed;
  return settings;
}
