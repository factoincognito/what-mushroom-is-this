import { analysisConfig } from "../config/analysis";
import { type AnalysisInput, analysePhoto, type Fetcher, type HttpResponse } from "./analyse";
import { buildAnalysisRequest } from "./request";

const apiKey = "sk-ant-secret-key-1234567890";

const input: AnalysisInput = {
  apiAddress: "https://api.example.test",
  model: "claude-test-model",
  apiKey,
  imageBase64: "/9j/4AAQSkZJRg==",
  timeLimitMs: 60_000,
};

const now = Date.UTC(2026, 10, 8, 12, 0, 0);
const clock = () => now;

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HttpResponse {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  };
}

function message(text: string): string {
  return JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text }] });
}

/** A fetch that answers only when its signal is aborted, as the platform fetch does. */
function hangingFetch(): jest.Mock<ReturnType<Fetcher>, Parameters<Fetcher>> {
  return jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("Aborted")));
      }),
  );
}

afterEach(() => {
  jest.useRealTimers();
});

describe("analysePhoto, the request", () => {
  it("sends the built request once, with a signal", async () => {
    const fetch = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await analysePhoto(input, { fetch, now: clock });
    const result = buildAnalysisRequest(input);
    if (!result.ok) {
      throw new Error("the test input must build a request");
    }
    const built = result.request;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
      signal: expect.any(AbortSignal),
    });
  });
});

describe("analysePhoto, the outcome", () => {
  it("gives the validated answer", async () => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"cannot_tell"}'))),
    );
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: true,
      answer: { result: "cannot_tell" },
    });
  });

  it("gives the error class of a failure status, and does not retry it", async () => {
    const fetch = jest.fn(() => Promise.resolve(response(529, '{"type":"error"}')));
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "server", status: 529 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads retry-after against the time the answer came", async () => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(429, '{"type":"error"}', { "retry-after": "30" })),
    );
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: now + 30_000 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a retry-after beyond the bound of the analysis config as missing", async () => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(429, '{"type":"error"}', { "retry-after": "86401" })),
    );
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: null },
    });
  });

  it("bounds retry-after by the config it is given", async () => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(429, '{"type":"error"}', { "retry-after": "30" })),
    );
    const config = { ...analysisConfig, retryAfterMaxMs: 10_000 };
    await expect(analysePhoto(input, { fetch, now: clock }, config)).resolves.toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAt: null },
    });
  });

  it("sends the request with the config it is given", async () => {
    const fetch = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    const config = { ...analysisConfig, apiVersion: "2099-01-01", maxTokens: 99 };
    await analysePhoto(input, { fetch, now: clock }, config);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers["anthropic-version"]).toBe("2099-01-01");
    expect(JSON.parse(init?.body ?? "{}")).toHaveProperty("max_tokens", 99);
  });

  it("fails the find with its own detail when the answer was cut off", async () => {
    const body = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "thinking", thinking: "", signature: "x" }],
      stop_reason: "max_tokens",
    });
    const fetch = jest.fn(() => Promise.resolve(response(200, body)));
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
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

  it("gives a network error when fetch fails, and does not retry it", async () => {
    const fetch = jest.fn(() => Promise.reject(new TypeError("Network request failed")));
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "network", status: null },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives a network error when fetch rejects with something that is not an Error", async () => {
    const fetch = jest.fn(() => Promise.reject("offline"));
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "network", status: null },
    });
  });

  it("gives a network error when the body cannot be read", async () => {
    const fetch = jest.fn(() =>
      Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.reject(new TypeError("connection reset")),
      }),
    );
    await expect(analysePhoto(input, { fetch, now: clock })).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "network", status: null },
    });
  });
});

describe("analysePhoto, the time limit", () => {
  it("aborts the request when the time limit passes, and does not retry it", async () => {
    jest.useFakeTimers();
    const fetch = hangingFetch();
    const pending = analysePhoto(input, { fetch, now: clock });
    jest.advanceTimersByTime(59_999);
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "time-out", status: null },
    });
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("counts reading the body within the time limit", async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(() =>
      Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () => new Promise<string>(() => undefined),
      }),
    );
    const pending = analysePhoto(input, { fetch, now: clock });
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "time-out", status: null },
    });
  });

  it("uses the time limit it is given", async () => {
    jest.useFakeTimers();
    const fetch = hangingFetch();
    const pending = analysePhoto({ ...input, timeLimitMs: 5_000 }, { fetch, now: clock });
    jest.advanceTimersByTime(5_000);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: "stays-waiting", cause: "time-out", status: null },
    });
  });

  it("leaves no timer behind once the answer has come", async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await analysePhoto(input, { fetch, now: clock });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind after a network error", async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(() => Promise.reject(new TypeError("Network request failed")));
    await analysePhoto(input, { fetch, now: clock });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("analysePhoto, the key", () => {
  const leakyBody = JSON.stringify({
    type: "error",
    error: { type: "authentication_error", message: `invalid x-api-key ${apiKey}` },
  });

  const cases: [string, () => ReturnType<Fetcher>][] = [
    ["a fetch error that names the key", () => Promise.reject(new Error(`failed for ${apiKey}`))],
    ["a 401 whose body names the key", () => Promise.resolve(response(401, leakyBody))],
    ["a 400 whose body names the key", () => Promise.resolve(response(400, leakyBody))],
    ["a 418 whose body names the key", () => Promise.resolve(response(418, leakyBody))],
    ["a 200 that is not from the API", () => Promise.resolve(response(200, `<p>${apiKey}</p>`))],
    [
      "a 200 whose answer names the key",
      () => Promise.resolve(response(200, message(`{"result":"${apiKey}"}`))),
    ],
    [
      "a 200 with an answer",
      () => Promise.resolve(response(200, message('{"result":"cannot_tell"}'))),
    ],
  ];

  it.each(cases)("appears nowhere in the result of %s", async (_label, answer) => {
    const fetch = jest.fn(answer);
    const result = await analysePhoto(input, { fetch, now: clock });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(String(result)).not.toContain(apiKey);
  });

  it("appears nowhere in the result of a time-out", async () => {
    jest.useFakeTimers();
    const pending = analysePhoto(input, { fetch: hangingFetch(), now: clock });
    jest.advanceTimersByTime(60_000);
    expect(JSON.stringify(await pending)).not.toContain(apiKey);
  });

  it("is never written to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    for (const [, answer] of cases) {
      await analysePhoto(input, { fetch: jest.fn(answer), now: clock });
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("analysePhoto, the default fetch and clock", () => {
  it("uses the platform fetch when none is given", async () => {
    const platformFetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(message('{"result":"no_mushroom"}'), { status: 200 }));
    await expect(analysePhoto(input)).resolves.toEqual({
      ok: true,
      answer: { result: "no_mushroom" },
    });
    expect(platformFetch).toHaveBeenCalledTimes(1);
    platformFetch.mockRestore();
  });
});

describe("analysePhoto, a key that cannot be sent as a header value", () => {
  it.each([
    ["a zero-width space", "sk-ant-​key"],
    ["a smart quote", "sk-ant-’key"],
    ["a non-ASCII letter", "sk-ant-nyckelå"],
    ["an inner space", "sk-ant- key"],
    ["an inner tab", "sk-ant-\tkey"],
    ["a control character", "sk-ant-\u0007key"],
    ["DEL", "sk-ant-\u007Fkey"],
    ["nothing", ""],
    ["blanks only", " \n\t "],
  ])("is never sent when it holds %s, and Settings asks for a key", async (_label, key) => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    const result = await analysePhoto({ ...input, apiKey: key }, { fetch, now: clock });
    expect(result).toEqual({ ok: false, error: { kind: "key-refused", status: null } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not put the refused key in the result", async () => {
    const key = "sk-ant-​secret-key-1234567890";
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    const result = await analysePhoto({ ...input, apiKey: key }, { fetch, now: clock });
    expect(result).toEqual({ ok: false, error: { kind: "key-refused", status: null } });
    expect(JSON.stringify(result)).not.toContain("secret-key-1234567890");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a key of every printable ASCII character", async () => {
    let key = "";
    for (let code = 0x21; code <= 0x7e; code += 1) {
      key += String.fromCharCode(code);
    }
    const fetch = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await analysePhoto({ ...input, apiKey: key }, { fetch, now: clock });
    expect(fetch.mock.calls[0]?.[1].headers.authorization).toBe(`Bearer ${key}`);
  });

  it("sends the key trimmed of the blanks around it", async () => {
    const fetch = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await analysePhoto({ ...input, apiKey: `  ${apiKey}\n` }, { fetch, now: clock });
    expect(fetch.mock.calls[0]?.[1].headers.authorization).toBe(`Bearer ${apiKey}`);
  });
});

describe("analysePhoto, a model ID that cannot be sent", () => {
  it.each([
    ["an empty ID", ""],
    ["an inner space", "claude opus"],
    ["a zero-width space", "claude-​opus"],
  ])("is never sent when it is %s, and Settings asks for a model", async (_label, model) => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    const result = await analysePhoto({ ...input, model }, { fetch, now: clock });
    expect(result).toEqual({ ok: false, error: { kind: "model-unknown" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("analysePhoto, an API address that is not valid configuration", () => {
  it.each([
    ["plain http", "http://api.example.test"],
    ["a path", "https://api.example.test/v1"],
    ["an empty address", ""],
  ])("throws a programming error for %s, and sends nothing", async (_label, apiAddress) => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await expect(analysePhoto({ ...input, apiAddress }, { fetch, now: clock })).rejects.toThrow(
      RangeError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("analysePhoto, a time limit that is not valid configuration", () => {
  it.each([
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["one more than a timer can hold", 2 ** 31],
  ])("throws a programming error for %s, and sends nothing", async (_label, timeLimitMs) => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await expect(analysePhoto({ ...input, timeLimitMs }, { fetch, now: clock })).rejects.toThrow(
      RangeError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["the smallest", 1],
    ["the largest a timer can hold", 2 ** 31 - 1],
  ])("accepts %s time limit", async (_label, timeLimitMs) => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await expect(analysePhoto({ ...input, timeLimitMs }, { fetch, now: clock })).resolves.toEqual({
      ok: true,
      answer: { result: "no_mushroom" },
    });
  });

  it("checks the time limit before the key", async () => {
    const fetch = jest.fn(() =>
      Promise.resolve(response(200, message('{"result":"no_mushroom"}'))),
    );
    await expect(
      analysePhoto({ ...input, apiKey: "", timeLimitMs: 0 }, { fetch, now: clock }),
    ).rejects.toThrow("timeLimitMs");
  });
});
