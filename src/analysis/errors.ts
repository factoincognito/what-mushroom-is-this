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
  /** 401, 403: the queue stops; Settings asks for a key. */
  | { kind: "key-refused"; status: number }
  /** 402, or a 400 whose error type is `billing_error`: the queue stops. */
  | { kind: "no-credit"; status: number }
  /** 404: the queue stops; Settings asks for a model. */
  | { kind: "model-unknown" }
  /** 400, 413: the find is marked failed; the queue goes on with the next. */
  | {
      kind: "find-failed";
      reason: "request-wrong" | "request-too-large";
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

/** Classifies what came back; `receivedAtMs` is when it came, for `retry-after` in seconds. */
export function classifyOutcome(outcome: Outcome, receivedAtMs: number): AnalysisResult {
  if (outcome.kind !== "http") {
    return failure({ kind: "stays-waiting", cause: outcome.kind, status: null });
  }
  const { status, body } = outcome;
  if (status >= 200 && status <= 299) {
    const read = readMessageBody(body);
    return read.ok
      ? read
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
        retryAt: parseRetryAfter(outcome.retryAfter, receivedAtMs),
      });
    case 401:
    case 403:
      return failure({ kind: "key-refused", status });
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

/** A 400: no credit, a spend limit the user set, or else the request was wrong. */
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
