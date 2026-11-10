import { config } from "../config/config";
import { preparePhotoForAnalysis } from "../image/prepareForAnalysis";
import type { StoredFind } from "../store/find";
import { createDeviceQueue } from "./deviceQueue";
import type { QueueLog } from "./queue";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("./../image/deviceJpegEncoder", () => ({ deviceJpegEncoder: { load: jest.fn() } }));
jest.mock("../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(async () => ({
    ok: true,
    imageBase64: "AAAA",
    width: 1,
    height: 1,
  })),
}));

const FIND: StoredFind = {
  id: 1,
  text: null,
  photos: [{ uri: "file:///photos/1.jpg", batch: 1 }],
  batchOpen: false,
  time: { takenAtMs: 1, utcOffsetMinutes: 0, source: "saved" },
  position: null,
  analysis: { state: "waiting" },
  addedPhotos: null,
  picture: null,
  selfCheck: null,
};

function log(): QueueLog & { waiting: boolean } {
  const store = {
    waiting: true,
    oldestWaiting: async () => (store.waiting ? 1 : null),
    getStored: async () => FIND,
    setAnswer: jest.fn(async () => {
      store.waiting = false;
    }),
    replaceAnswer: jest.fn(),
    markFailed: jest.fn(),
    markWaiting: jest.fn(),
    setAddedPhotos: jest.fn(),
  };
  return store;
}

function answer(status: number, body: string, retryAfter: string | null = null) {
  return {
    status,
    headers: { get: (name: string) => (name === "retry-after" ? retryAfter : null) },
    text: async () => body,
  };
}

const ANSWERED = answer(
  200,
  JSON.stringify({
    type: "message",
    content: [{ type: "text", text: '{"result":"no_mushroom"}' }],
  }),
);

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createDeviceQueue", () => {
  it("sends to the config's API address, with the model setting's default and the photo prepared for it", async () => {
    fetchMock.mockResolvedValue(ANSWERED);
    const store = log();
    const queue = createDeviceQueue({
      findLog: async () => store,
      readKey: async () => ({ ok: true, key: "sk-ant-k" }),
    });
    queue.setInFront(true);
    await queue.trigger();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${config.apiBaseUrl}/v1/messages`);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).model).toBe(config.defaultModelId);
    expect(preparePhotoForAnalysis).toHaveBeenCalledWith(
      "file:///photos/1.jpg",
      config.defaultModelId,
      expect.anything(),
    );
  });

  it("gives each request the config's time limit, no less and no more (PBI-1.21)", async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 9) });
    // A fetch that answers only when its signal is aborted, as the platform fetch does.
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("Aborted")));
        }),
    );
    const queue = createDeviceQueue({
      findLog: async () => log(),
      readKey: async () => ({ ok: true, key: "sk-ant-k" }),
    });
    queue.setInFront(true);
    const run = queue.trigger();
    await jest.advanceTimersByTimeAsync(config.requestTimeoutMs - 1);
    expect(queue.getState()).toMatchObject({ running: true, pause: null });
    await jest.advanceTimersByTimeAsync(1);
    await run;
    expect(queue.getState()).toEqual({ running: false, stop: null, pause: "time-out" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts again by itself when a 429's retry-after has passed, and can cancel that", async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 9) });
    fetchMock.mockResolvedValueOnce(answer(429, "{}", "30")).mockResolvedValue(ANSWERED);
    const store = log();
    const queue = createDeviceQueue({
      findLog: async () => store,
      readKey: async () => ({ ok: true, key: "sk-ant-k" }),
    });
    queue.setInFront(true);
    await queue.trigger();
    expect(queue.getState().stop?.reason).toBe("rate-limited");
    await jest.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.setAnswer).toHaveBeenCalledTimes(1);

    store.waiting = true;
    fetchMock.mockResolvedValueOnce(answer(429, "{}", "30"));
    await queue.analyseNow();
    queue.dispose();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
