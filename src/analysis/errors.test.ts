import { classifyOutcome } from "./errors";

const receivedAt = Date.UTC(2026, 10, 8, 12, 0, 0);

function http(status: number, body = "", retryAfter: string | null = null) {
  return { kind: "http" as const, status, body, retryAfter };
}

function apiError(type: string, message = "x"): string {
  return JSON.stringify({ type: "error", error: { type, message }, request_id: "req_1" });
}

function messageWithText(text: string): string {
  return JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text }] });
}

describe("classifyOutcome, the find stays waiting", () => {
  it("keeps the find waiting without a network", () => {
    expect(classifyOutcome({ kind: "network" }, receivedAt)).toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "network", status: null },
    });
  });

  it("keeps the find waiting when the time limit passed", () => {
    expect(classifyOutcome({ kind: "time-out" }, receivedAt)).toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "time-out", status: null },
    });
  });

  it.each([500, 504, 529])(
    "keeps the find waiting on a fault on Anthropic's side, %i",
    (status) => {
      expect(classifyOutcome(http(status, apiError("api_error")), receivedAt)).toEqual({
        ok: false,
        error: { kind: "stays-waiting", cause: "server", status },
      });
    },
  );
});

describe("classifyOutcome, rate limited", () => {
  it("stops until the seconds of retry-after have passed", () => {
    expect(classifyOutcome(http(429, apiError("rate_limit_error"), "120"), receivedAt)).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: receivedAt + 120_000 },
    });
  });

  it("stops until the date of retry-after", () => {
    const result = classifyOutcome(
      http(429, apiError("rate_limit_error"), "Sun, 08 Nov 2026 13:00:00 GMT"),
      receivedAt,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: Date.UTC(2026, 10, 8, 13, 0, 0) },
    });
  });

  it.each([
    ["without retry-after", null],
    ["with a retry-after that is neither seconds nor a date", "later"],
    ["with a retry-after beyond the one-day bound", "86401"],
    ["with a retry-after beyond what a Date holds", "9".repeat(20)],
  ])("stops until the user starts it again %s", (_label, retryAfter) => {
    expect(
      classifyOutcome(http(429, apiError("rate_limit_error"), retryAfter), receivedAt),
    ).toEqual({ ok: false, error: { kind: "rate-limited", retryAt: null } });
  });

  it("bounds retry-after by the bound it is given", () => {
    const answer = http(429, apiError("rate_limit_error"), "120");
    expect(classifyOutcome(answer, receivedAt, 60_000)).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: null },
    });
    expect(classifyOutcome(answer, receivedAt, 120_000)).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: receivedAt + 120_000 },
    });
  });
});

describe("classifyOutcome, a spend limit the user set", () => {
  it.each([
    [
      "an organisation spend limit",
      "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
    ],
    [
      "a workspace spend limit",
      "You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
    ],
  ])("stops the queue until the user starts it again on 400 for %s", (_label, message) => {
    expect(
      classifyOutcome(http(400, apiError("invalid_request_error", message)), receivedAt),
    ).toEqual({ ok: false, error: { kind: "rate-limited", retryAt: null } });
  });

  it("gives no time to stop until, even with a retry-after header", () => {
    const body = apiError(
      "invalid_request_error",
      "You have reached your specified API usage limits",
    );
    expect(classifyOutcome(http(400, body, "30"), receivedAt)).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: null },
    });
  });
});

describe("classifyOutcome, the queue stops for a setting", () => {
  it.each([401, 403])("asks for a key on %i", (status) => {
    expect(classifyOutcome(http(status, apiError("authentication_error")), receivedAt)).toEqual({
      ok: false,
      error: { kind: "key-refused", status, cause: "refused" },
    });
  });

  it("asks for a key on a 400 that says the key is not scoped to a workspace, and says so", () => {
    // The message as the API's "Authentication" page gives it.
    const message =
      "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.";
    expect(
      classifyOutcome(http(400, apiError("invalid_request_error", message)), receivedAt),
    ).toEqual({ ok: false, error: { kind: "key-refused", status: 400, cause: "not-scoped" } });
  });

  it("asks for a key on a 400 whose message only starts with the workspace text", () => {
    const body = apiError("invalid_request_error", "This API key is not scoped to a workspace");
    expect(classifyOutcome(http(400, body), receivedAt)).toEqual({
      ok: false,
      error: { kind: "key-refused", status: 400, cause: "not-scoped" },
    });
  });

  it("says there is no credit on 402", () => {
    expect(classifyOutcome(http(402, apiError("billing_error")), receivedAt)).toEqual({
      ok: false,
      error: { kind: "no-credit", status: 402 },
    });
  });

  it("says there is no credit on 402 whatever the body", () => {
    expect(classifyOutcome(http(402, "<html></html>"), receivedAt)).toEqual({
      ok: false,
      error: { kind: "no-credit", status: 402 },
    });
  });

  it("says there is no credit on a 400 whose error type is billing_error", () => {
    expect(classifyOutcome(http(400, apiError("billing_error")), receivedAt)).toEqual({
      ok: false,
      error: { kind: "no-credit", status: 400 },
    });
  });

  it("asks for a model on 404", () => {
    expect(classifyOutcome(http(404, apiError("not_found_error")), receivedAt)).toEqual({
      ok: false,
      error: { kind: "model-unknown" },
    });
  });
});

describe("classifyOutcome, the find fails and the queue goes on", () => {
  it.each([
    ["an API error", apiError("invalid_request_error")],
    [
      "the spend-limit text not at the start of the message",
      apiError("invalid_request_error", "Note: You have reached your specified API usage limits"),
    ],
    [
      "the spend-limit text under another error type",
      apiError("api_error", "You have reached your specified API usage limits"),
    ],
    [
      "the spend-limit text in another case",
      apiError("invalid_request_error", "you have reached your specified API usage limits"),
    ],
    [
      "the workspace text not at the start of the message",
      apiError("invalid_request_error", "Note: This API key is not scoped to a workspace"),
    ],
    [
      "the workspace text under another error type",
      apiError("authentication_error", "This API key is not scoped to a workspace"),
    ],
    [
      "the workspace text in another case",
      apiError("invalid_request_error", "this API key is not scoped to a workspace"),
    ],
    [
      "a message that shares only a shorter start with the workspace text (PBI-1.22)",
      apiError("invalid_request_error", "This API key is invalid"),
    ],
    [
      "the workspace text without its last letter (PBI-1.22: the whole text must match)",
      apiError("invalid_request_error", "This API key is not scoped to a workspac"),
    ],
    [
      "a message that is not a string",
      '{"type":"error","error":{"type":"invalid_request_error","message":5}}',
    ],
    ["a body that is not JSON", "Bad Request"],
    ["an error body without a type", '{"type":"error","error":{}}'],
    ["JSON without an error object", '{"type":"error","error":"billing_error"}'],
    ["JSON that is not an object", '"billing_error"'],
  ])("marks the find failed on 400 with %s", (_label, body) => {
    expect(classifyOutcome(http(400, body), receivedAt)).toEqual({
      ok: false,
      error: { kind: "find-failed", reason: "request-wrong", status: 400, queue: "goes-on" },
    });
  });

  it("marks the find failed on 413, also with a body not from the API", () => {
    expect(
      classifyOutcome(http(413, "<html>413 Request Entity Too Large</html>"), receivedAt),
    ).toEqual({
      ok: false,
      error: { kind: "find-failed", reason: "request-too-large", status: 413, queue: "goes-on" },
    });
  });
});

describe("classifyOutcome, a success answer", () => {
  it("gives the validated answer", () => {
    expect(
      classifyOutcome(http(200, messageWithText('{"result":"no_mushroom"}')), receivedAt),
    ).toEqual({ ok: true, answer: { result: "no_mushroom" } });
  });

  it("fails the find and stops the queue on an answer that does not fit the shape", () => {
    expect(
      classifyOutcome(http(200, messageWithText('{"result":"mushroom"}')), receivedAt),
    ).toEqual({
      ok: false,
      error: {
        kind: "find-failed",
        reason: "shape",
        detail: "result is not one of match, no_mushroom, cannot_tell",
        status: 200,
        queue: "stops",
      },
    });
  });

  it("fails the find and stops the queue on a cut-off answer, saying it was cut off", () => {
    const body = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "thinking", thinking: "", signature: "x" }],
      stop_reason: "max_tokens",
    });
    expect(classifyOutcome(http(200, body), receivedAt)).toEqual({
      ok: false,
      error: {
        kind: "find-failed",
        reason: "shape",
        detail: "the answer was cut off (stop_reason max_tokens)",
        status: 200,
        queue: "stops",
      },
    });
  });

  it("fails the find and lets the queue go on after a refusal, saying it was refused", () => {
    const body = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "x" },
    });
    expect(classifyOutcome(http(200, body), receivedAt)).toEqual({
      ok: false,
      error: {
        kind: "find-failed",
        reason: "refused",
        detail: "the answer was refused (stop_reason refusal)",
        status: 200,
        queue: "goes-on",
      },
    });
  });

  it("reads an answer split over several text blocks", () => {
    const body = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: '{"result":' },
        { type: "text", text: '"no_mushroom"}' },
      ],
      stop_reason: "end_turn",
    });
    expect(classifyOutcome(http(200, body), receivedAt)).toEqual({
      ok: true,
      answer: { result: "no_mushroom" },
    });
  });

  it.each([
    [200, "<html><body>Sign in to the Wi-Fi</body></html>"],
    [204, ""],
  ])("fails the find and stops the queue on %i with a body not from the API", (status, body) => {
    expect(classifyOutcome(http(status, body), receivedAt)).toEqual({
      ok: false,
      error: {
        kind: "find-failed",
        reason: "not-api",
        detail: "the body is not a Messages API message",
        status,
        queue: "stops",
      },
    });
  });
});

describe("classifyOutcome, any other status", () => {
  it.each([100, 302, 304, 405, 409, 418, 422, 501, 502, 503, 511, 599])(
    "stops the queue and gives the status %i",
    (status) => {
      expect(classifyOutcome(http(status, apiError("api_error"), "30"), receivedAt)).toEqual({
        ok: false,
        error: { kind: "other", status },
      });
    },
  );

  it("ignores retry-after on a status other than 429", () => {
    expect(classifyOutcome(http(529, apiError("overloaded_error"), "30"), receivedAt)).toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "server", status: 529 },
    });
  });
});
