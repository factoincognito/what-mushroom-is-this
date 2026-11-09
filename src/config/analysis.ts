/**
 * The configuration values of the analysis request (docs/SPEC.md 3.3): the API version,
 * `max_tokens` and the bound for a far-future `retry-after`. They are configuration under
 * Process P-11 § 5 (2), kept in the config module beside `config.ts`. Nothing secret belongs
 * here. The request sends no `thinking` or `effort` setting, so each model runs with its own
 * default: for an edibility identification, accuracy outweighs cost and latency (Clead, #15).
 */

export type AnalysisConfig = {
  /** The `anthropic-version` header. The request is built for this version's rules. */
  readonly apiVersion: string;
  /** The request's `max_tokens`: the thinking and the answer's text together. */
  readonly maxTokens: number;
  /** How far ahead of the answer a `retry-after` may lie, in milliseconds; beyond it, missing. */
  readonly retryAfterMaxMs: number;
};

export const analysisConfig: AnalysisConfig = Object.freeze({
  // The Claude docs page "Versions", https://platform.claude.com/docs/en/api/versioning, read
  // 2026-11-08: the latest version, which Anthropic recommends.
  apiVersion: "2026-10-21",
  // The Claude docs page "Thinking", https://platform.claude.com/docs/en/build-with-claude/thinking,
  // read 2026-11-09: on Claude 5 models thinking is on by default ("Adaptive thinking" with no
  // `thinking` field), and "Thinking tokens count toward `max_tokens`, so set it high enough to
  // leave room for both the thinking and the response text". 16,000 is the page's own Opus 5.5
  // example; it stays under the 21,333 above which "The SDK requires streaming" (this call does
  // not stream), and it keeps the 4,096 the answer's JSON had before thinking was counted, with
  // about 12,000 more for the thinking.
  maxTokens: 16_000,
  // Proposed by Crog in PBI-1.14, accepted by Clead on #15: a wait of more than a day is the
  // user's to start, not the queue's.
  retryAfterMaxMs: 24 * 60 * 60 * 1_000,
});
