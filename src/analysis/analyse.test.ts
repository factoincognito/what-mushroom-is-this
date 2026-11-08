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
    const built = buildAnalysisRequest(input);
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
