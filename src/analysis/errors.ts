import { analysisConfig } from "../config/analysis";
import { type Answer, isRecord, readMessageBody } from "./answer";
import { parseRetryAfter } from "./retryAfter";

/**
 * The error classes of docs/SPEC.md 3.3, each with what the queue needs to act
 * on it. The messages in plain words belong to the queue and the screens.
 */
export type AnalysisError =
  /** No network, the time limit passed, or a fault on Anthropic's side: the find stays waiting. */
  | { kind: "stays-waiting"; cause: "network" | "time-out" | "server"; status: number | null }
  /**
   * 429, or a spend limit the user set (a 400, see `SPEND_LIMIT_MESSAGES`): the queue
   * stops until `retryAt` (ms since the epoch), or, when null, until the user starts it.
   */
  | { kind: "rate-limited"; retryAt: number | null }
  /**
   * 401, 403, a 400 that says the key is not scoped to a workspace (see
   * `NOT_SCOPED_KEY_MESSAGE`), or (`status` null) a key that cannot be sent as a header value,
   * refused before sending: the queue stops; Settings asks for a key. `cause` says which:
   * `not-scoped` for the workspace 400, whose message the queue words apart (PBI-1.21), `refused`
   * for the rest.
   */
  | { kind: "key-refused"; status: number | null; cause: "refused" | "not-scoped" }
  /** 402, or a 400 whose error type is `billing_error`: the queue stops. */
  | { kind: "no-credit"; status: number }
  /**
   * 404, or a model ID that cannot be sent (not printable ASCII), refused before sending: the
   * queue stops; Settings asks for a model.
   */
  | { kind: "model-unknown" }
  /** 400, 413: the find is marked failed; the queue goes on with the next. */
  | {
      kind: "find-failed";
      reason: "request-wrong" | "request-too-large";
      status: number;
      queue: "goes-on";
    }
  /**
   * A 2xx answer that Claude refused (`stop_reason` `refusal`): the find is marked failed; the
   * queue goes on with the next, as for a 400 (Clead's decision for PBI-1.13).
   */
  | {
      kind: "find-failed";
      reason: "refused";
      detail: string;
      status: number;
      queue: "goes-on";
    }
  /** An answer not of the shape, or not from the API: the find is marked failed; the queue stops. */
  | {
      kind: "find-failed";
      reason: "shape" | "not-api";
      detail: string;
      status: number;
      queue: "stops";
    }
  /** Any other status: the queue stops; the message gives the status. */
  | { kind: "other"; status: number };

export type AnalysisResult = { ok: true; answer: Answer } | { ok: false; error: AnalysisError };

/** What came back from sending the request once. */
export type Outcome =
  | { kind: "network" }
  | { kind: "time-out" }
  | { kind: "http"; status: number; body: string; retryAfter: string | null };

const SERVER_FAULTS = [500, 504, 529];

/**
 * Classifies what came back; `receivedAtMs` is when it came, for `retry-after` in seconds, and
 * `retryAfterMaxMs` how far ahead of then a `retry-after` may lie before it counts as missing.
 */
export function classifyOutcome(
  outcome: Outcome,
  receivedAtMs: number,
  retryAfterMaxMs: number = analysisConfig.retryAfterMaxMs,
): AnalysisResult {
  if (outcome.kind !== "http") {
    return failure({ kind: "stays-waiting", cause: outcome.kind, status: null });
  }
  const { status, body } = outcome;
  if (status >= 200 && status <= 299) {
    const read = readMessageBody(body);
    if (read.ok) {
      return read;
    }
    return read.reason === "refused"
      ? failure({
          kind: "find-failed",
          reason: read.reason,
          detail: read.detail,
          status,
          queue: "goes-on",
        })
      : failure({
          kind: "find-failed",
          reason: read.reason,
          detail: read.detail,
          status,
          queue: "stops",
        });
  }
  if (SERVER_FAULTS.includes(status)) {
    return failure({ kind: "stays-waiting", cause: "server", status });
  }
  switch (status) {
    case 429:
      return failure({
        kind: "rate-limited",
        retryAt: parseRetryAfter(outcome.retryAfter, receivedAtMs, retryAfterMaxMs),
      });
    case 401:
    case 403:
      return failure({ kind: "key-refused", status, cause: "refused" });
    case 402:
      return failure({ kind: "no-credit", status });
    case 404:
      return failure({ kind: "model-unknown" });
    case 400:
      return classifyBadRequest(body);
    case 413:
      return failure({
        kind: "find-failed",
        reason: "request-too-large",
        status,
        queue: "goes-on",
      });
    default:
      return failure({ kind: "other", status });
  }
}

function failure(error: AnalysisError): AnalysisResult {
  return { ok: false, error };
}

/**
 * How the message of a 400 `invalid_request_error` starts when usage reaches a spend
 * limit the user set, for the organisation or for a workspace (Claude API docs, "Rate
 * limits", https://platform.claude.com/docs/en/api/rate-limits, read 2026-11-08). It is
 * the spend-limit case of the 429 row of docs/SPEC.md 3.3, without a `retry-after`.
 */
export const SPEND_LIMIT_MESSAGES = [
  "You have reached your specified API usage limits",
  "You have reached your specified workspace API usage limits",
];

/**
 * How the message of a 400 `invalid_request_error` starts when the key is not scoped to a
 * workspace and the request has no `anthropic-workspace-id` header (Claude API docs,
 * "Authentication", https://platform.claude.com/docs/manage-claude/authentication, section
 * "Select a workspace", read 2026-11-09). The app does not send that header (docs/SPEC.md 3.3,
 * Known unknown 8), so the key is handled as refused, as 401, 403.
 */
export const NOT_SCOPED_KEY_MESSAGE = "This API key is not scoped to a workspace";

/**
 * A 400: no credit, a spend limit the user set, a key not scoped to a workspace, or else the
 * request was wrong.
 */
function classifyBadRequest(body: string): AnalysisResult {
  const error = apiError(body);
  if (error?.type === "billing_error") {
    return failure({ kind: "no-credit", status: 400 });
  }
  if (
    error?.type === "invalid_request_error" &&
    SPEND_LIMIT_MESSAGES.some((start) => error.message?.startsWith(start))
  ) {
    return failure({ kind: "rate-limited", retryAt: null });
  }
  if (
    error?.type === "invalid_request_error" &&
    error.message?.startsWith(NOT_SCOPED_KEY_MESSAGE)
  ) {
    return failure({ kind: "key-refused", status: 400, cause: "not-scoped" });
  }
  return failure({ kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" });
}

/** The `error.type` and `error.message` of an API error body, or null when the body is not one. */
function apiError(body: string): { type: string | null; message: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.error)) {
    return null;
  }
  const { type, message } = parsed.error;
  return {
    type: typeof type === "string" ? type : null,
    message: typeof message === "string" ? message : null,
  };
}
