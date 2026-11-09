import { type AnalysisConfig, analysisConfig } from "../config/analysis";
import { accessResumesAt } from "./accessResumes";
import { type AnalysisResult, classifyOutcome, type Outcome } from "./errors";
import { buildAnalysisRequest, type RequestInput } from "./request";

/**
 * The call (docs/SPEC.md 3.3): sends the request once, within the time limit,
 * and gives the validated answer or the error class. It never retries; the
 * queue decides what happens next. Nothing here logs, and no result carries
 * the key or the raw text of a failure.
 */

/**
 * The result of the call. A rate limit without `retry-after` (a spend limit) also carries the time
 * access resumes, in ms since the epoch, when the answer's message states one: for the message
 * only (`accessResumes.ts`).
 */
export type AnalysisCallResult = AnalysisResult & { readonly accessResumesAtMs?: number };

export interface AnalysisInput extends RequestInput {
  /** The request's time limit from the config module, in milliseconds. */
  timeLimitMs: number;
}

/** The part of a fetch Response the call reads. */
export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<HttpResponse>;

export interface AnalysisDeps {
  fetch: Fetcher;
  /** The current time in milliseconds since the epoch. */
  now: () => number;
}

const platformDeps: AnalysisDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
};

/** The longest delay a timer holds; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Sends the photo for analysis. A time limit that is not an integer from 1 to
 * 2^31 − 1 ms, or an API address that is not valid, is a programming error (it
 * is configuration) and rejects with a RangeError. A key or a model ID that
 * cannot be sent is refused without sending anything (`buildAnalysisRequest`).
 */
export async function analysePhoto(
  input: AnalysisInput,
  deps: AnalysisDeps = platformDeps,
  config: AnalysisConfig = analysisConfig,
): Promise<AnalysisCallResult> {
  const { timeLimitMs } = input;
  if (!Number.isInteger(timeLimitMs) || timeLimitMs < 1 || timeLimitMs > MAX_TIMER_MS) {
    throw new RangeError(`timeLimitMs must be an integer from 1 to ${MAX_TIMER_MS}`);
  }
  const built = buildAnalysisRequest(input, config);
  if (!built.ok) {
    return built;
  }
  const { request } = built;
  const controller = new AbortController();
  let timedOut = false;
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("time limit passed")));
  });
  // The races below handle the rejection; this keeps it from counting as unhandled
  // when the time limit never passes.
  aborted.catch(() => undefined);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeLimitMs);

  let outcome: Outcome;
  try {
    const response = await Promise.race([
      deps.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      }),
      aborted,
    ]);
    // The body is read under the same time limit as the answer's head.
    const body = await Promise.race([response.text(), aborted]);
    outcome = {
      kind: "http",
      status: response.status,
      body,
      retryAfter: response.headers.get("retry-after"),
    };
  } catch {
    outcome = timedOut ? { kind: "time-out" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
  const result = classifyOutcome(outcome, deps.now(), config.retryAfterMaxMs);
  if (outcome.kind === "http" && !result.ok && result.error.kind === "rate-limited") {
    const resumes = result.error.retryAt === null ? accessResumesAt(outcome.body) : null;
    if (resumes !== null) {
      return { ...result, accessResumesAtMs: resumes };
    }
  }
  return result;
}
