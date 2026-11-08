import { type AnalysisResult, classifyOutcome, type Outcome } from "./errors";
import { buildAnalysisRequest, type RequestInput } from "./request";

/**
 * The call (docs/SPEC.md 3.3): sends the request once, within the time limit,
 * and gives the validated answer or the error class. It never retries; the
 * queue decides what happens next. Nothing here logs, and no result carries
 * the key or the raw text of a failure.
 */

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

export async function analysePhoto(
  input: AnalysisInput,
  deps: AnalysisDeps = platformDeps,
): Promise<AnalysisResult> {
  const request = buildAnalysisRequest(input);
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
  }, input.timeLimitMs);

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
  return classifyOutcome(outcome, deps.now());
}
