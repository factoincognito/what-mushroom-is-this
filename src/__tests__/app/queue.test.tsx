/**
 * The queue as the app wires it (PBI-1.7): the Log screen's message and "analyse now", the
 * restart from Settings, and the run at the app's start. The native modules are mocked at their
 * boundary: the secure store, the plain store, the network state, the find log's database, the
 * photo encoder, and the platform fetch.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { AppState } from "react-native";

import { DISCLAIMER_ACCEPTED_KEY } from "../../disclaimer/acceptance";
import { STRINGS } from "../../i18n/strings";
import { preparePhotoForAnalysis } from "../../image/prepareForAnalysis";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY } from "../../key/apiKey";
import { formatTimeIn } from "../../queue/messages";
import type { Find } from "../../store/find";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-localization", () => ({ getLocales: jest.fn() }));

const mockSecrets = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecrets.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecrets.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecrets.delete(key);
  }),
}));

jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

/** The photo for analysis, as the image module would give it; its own tests check the real one. */
jest.mock("../../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../../image/prepareForAnalysis"),
  preparePhotoForAnalysis: jest.fn(async () => ({
    ok: true,
    imageBase64: "AAAA",
    width: 2212,
    height: 1659,
  })),
}));

/** The find log in memory. (Named `mock…` so that the hoisted factory may use it.) */
const mockFinds = new Map<number, Find>();
const mockLog = {
  oldestWaiting: async () =>
    [...mockFinds.values()]
      .filter((find) => find.analysis.state === "waiting")
      .map((find) => find.id)
      .sort((a, b) => a - b)[0] ?? null,
  get: async (id: number) => mockFinds.get(id) ?? null,
  list: async () => [],
  setAnswer: async (id: number, analysed: object) => {
    const find = mockFinds.get(id);
    if (find !== undefined) {
      mockFinds.set(id, { ...find, analysis: { state: "done", ...analysed } as Find["analysis"] });
    }
  },
  markFailed: async (id: number, failure: { cause: string; detail: string }) => {
    const find = mockFinds.get(id);
    if (find !== undefined) {
      mockFinds.set(id, { ...find, analysis: { state: "failed", failure } as Find["analysis"] });
    }
  },
};
jest.mock("../../store/deviceFindStore", () => ({ openFindLog: jest.fn(async () => mockLog) }));

const A_KEY = "sk-ant-api03-abcDEF_123";
const APP_DIR = "./src/app";
const en = STRINGS.en.queue;

function waitingFind(id: number): Find {
  return {
    id,
    photoUri: `file:///photos/${id}.jpg`,
    time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
    position: null,
    analysis: { state: "waiting" },
  };
}

function answer(status: number, body: string) {
  return { status, headers: { get: () => null }, text: async () => body };
}

const ANSWERED = answer(
  200,
  JSON.stringify({
    type: "message",
    content: [{ type: "text", text: '{"result":"cannot_tell"}' }],
    stop_reason: "end_turn",
  }),
);

const fetchMock = jest.fn();

function phoneIn(languageCode: string): void {
  jest
    .mocked(getLocales)
    .mockReturnValue([
      { languageCode, languageTag: languageCode } as ReturnType<typeof getLocales>[number],
    ]);
}

async function startApp(initialUrl = "/"): Promise<{ pathname: () => string }> {
  const app = renderRouter(APP_DIR, { initialUrl });
  await app;
  return { pathname: () => app.getPathname() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "accepted");
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, "installed");
  mockSecrets.clear();
  mockSecrets.set(API_KEY_STORE_KEY, A_KEY);
  mockFinds.clear();
  mockFinds.set(1, waitingFind(1));
  phoneIn("en");
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
});

afterAll(() => {
  Object.defineProperty(AppState, "currentState", { value: undefined, configurable: true });
});

describe("the queue at the app's start", () => {
  it("analyses the waiting finds when the app starts in front, with the saved key", async () => {
    fetchMock.mockResolvedValue(ANSWERED);
    await startApp();
    expect(await screen.findByText(STRINGS.en.log.empty)).toBeOnTheScreen();
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1].headers.authorization).toBe(`Bearer ${A_KEY}`);
    expect(mockFinds.get(1)?.analysis.state).toBe("done");
    expect(screen.queryByRole("button", { name: en.analyseNow })).not.toBeOnTheScreen();
  });
});

describe("the Log screen when the queue has stopped (SPEC 3.1)", () => {
  it("says why and offers analyse now, which starts the queue again", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        402,
        JSON.stringify({ type: "error", error: { type: "billing_error", message: "x" } }),
      ),
    );
    await startApp();
    expect(await screen.findByText(en.stopped.noCredit)).toBeOnTheScreen();
    fetchMock.mockResolvedValueOnce(ANSWERED);
    await fireEvent.press(screen.getByRole("button", { name: en.analyseNow }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockFinds.get(1)?.analysis.state).toBe("done");
    expect(screen.queryByText(en.stopped.noCredit)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.analyseNow })).not.toBeOnTheScreen();
  });

  it("shows the time access resumes after a spend limit the user set, as the answer gives it", async () => {
    const resumes = Date.UTC(2026, 11, 1, 0, 0);
    fetchMock.mockResolvedValueOnce(
      answer(
        400,
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
          },
        }),
      ),
    );
    await startApp();
    expect(
      await screen.findByText(
        en.stopped.spendLimitUntil.replace("{time}", formatTimeIn("en")(resumes)),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: en.analyseNow })).toBeOnTheScreen();
  });

  it("says it in the app's language", async () => {
    phoneIn("sv");
    fetchMock.mockResolvedValueOnce(answer(418, "{}"));
    await startApp();
    expect(
      await screen.findByText(STRINGS.sv.queue.stopped.other.replace("{status}", "418")),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: STRINGS.sv.queue.analyseNow })).toBeOnTheScreen();
  });

  it("without a key, sends nothing, says a key is needed and links to Settings", async () => {
    mockSecrets.clear();
    const app = await startApp();
    expect(await screen.findByText(en.stopped.noKey)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("link", { name: en.openSettings }));
    expect(app.pathname()).toBe("/settings");
  });

  it("shows no time when a spend limit's message states it in a form the docs do not show", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        400,
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "You have reached your specified API usage limits. Access resumes on December 1, 2026.",
          },
        }),
      ),
    );
    await startApp();
    expect(await screen.findByText(en.stopped.rateLimited)).toBeOnTheScreen();
    expect(screen.queryByText(/2026/)).not.toBeOnTheScreen();
  });
});

describe("the Log screen after an internal error (Clead's decision on #17)", () => {
  it.each(["sv", "en", "it"] as const)(
    "says so in %s, without the error itself, and offers analyse now, which runs the queue again",
    async (language) => {
      phoneIn(language);
      const t = STRINGS[language].queue;
      jest
        .spyOn(mockLog, "oldestWaiting")
        .mockRejectedValueOnce(new RangeError("timeLimitMs must be an integer from 1"));
      fetchMock.mockResolvedValue(ANSWERED);
      await startApp();
      expect(await screen.findByText(t.stopped.internalError)).toBeOnTheScreen();
      expect(screen.queryByText(/timeLimitMs/)).not.toBeOnTheScreen();
      expect(fetchMock).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: t.analyseNow }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mockFinds.get(1)?.analysis.state).toBe("done");
      expect(screen.queryByText(t.stopped.internalError)).not.toBeOnTheScreen();
    },
  );

  it("full storage while the photo is prepared: the internal error, and the find stays waiting (PBI-1.21)", async () => {
    jest
      .mocked(preparePhotoForAnalysis)
      .mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));
    await startApp();
    expect(await screen.findByText(en.stopped.internalError)).toBeOnTheScreen();
    expect(screen.queryByText(/ENOSPC/)).not.toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFinds.get(1)?.analysis).toEqual({ state: "waiting" });
  });
});

describe("a refused answer (PBI-1.21)", () => {
  it("marks the find failed with the cause refused, and the queue goes on", async () => {
    mockFinds.set(2, waitingFind(2));
    fetchMock
      .mockResolvedValueOnce(
        answer(
          200,
          JSON.stringify({ type: "message", content: [], stop_reason: "refusal" }),
        ),
      )
      .mockResolvedValueOnce(ANSWERED);
    await startApp();
    await act(async () => undefined);
    expect(mockFinds.get(1)?.analysis).toEqual({
      state: "failed",
      failure: { cause: "refused", detail: "the answer was refused (stop_reason refusal)" },
    });
    expect(mockFinds.get(2)?.analysis.state).toBe("done");
    expect(screen.queryByRole("button", { name: en.analyseNow })).not.toBeOnTheScreen();
  });
});

describe("the Log screen when the finds wait for a network", () => {
  it("says so, without analyse now, and leaves the find waiting", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await startApp();
    expect(await screen.findByText(en.paused.network)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: en.analyseNow })).not.toBeOnTheScreen();
    expect(mockFinds.get(1)?.analysis.state).toBe("waiting");
  });
});

describe("a change of the setting named starts the queue again (SPEC 3.3)", () => {
  it("saving a key in Settings, after the key was refused", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, "{}"));
    await startApp();
    expect(await screen.findByText(en.stopped.keyRefused)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: en.openSettings }));
    fetchMock.mockResolvedValueOnce(ANSWERED);
    await fireEvent.changeText(
      await screen.findByLabelText(STRINGS.en.settings.key.input),
      "sk-ant-api03-new",
    );
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.settings.key.save }));
    expect(await screen.findByText(STRINGS.en.settings.key.saved)).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1].headers.authorization).toBe("Bearer sk-ant-api03-new");
    expect(mockFinds.get(1)?.analysis.state).toBe("done");
  });

  it("choosing a model in Settings, after the model was not known", async () => {
    fetchMock.mockResolvedValueOnce(answer(404, "{}"));
    await startApp();
    expect(await screen.findByText(en.stopped.modelUnknown)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: en.openSettings }));
    fetchMock.mockResolvedValueOnce(ANSWERED);
    await fireEvent.press(await screen.findByRole("radio", { name: "claude-sonnet-5-5" }));
    expect(await screen.findByText(STRINGS.en.settings.model.saved)).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).model).toBe("claude-sonnet-5-5");
  });
});

describe("a key not scoped to a workspace (Clead's decision on #18, note 4)", () => {
  const notScoped = answer(
    400,
    JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header.",
      },
    }),
  );

  it.each(["sv", "en", "it"] as const)(
    "the Log screen says in %s that the key must be replaced with one in a workspace, and links to Settings",
    async (language) => {
      phoneIn(language);
      const t = STRINGS[language].queue;
      fetchMock.mockResolvedValueOnce(notScoped);
      await startApp();
      expect(await screen.findByText(t.stopped.keyNotScoped)).toBeOnTheScreen();
      expect(screen.queryByText(t.stopped.keyRefused)).not.toBeOnTheScreen();
      expect(screen.getByRole("link", { name: t.openSettings })).toBeOnTheScreen();
      expect(mockFinds.get(1)?.analysis.state).toBe("waiting");
    },
  );

  it("saving another key in Settings starts the queue again", async () => {
    fetchMock.mockResolvedValueOnce(notScoped);
    await startApp();
    expect(await screen.findByText(en.stopped.keyNotScoped)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: en.openSettings }));
    fetchMock.mockResolvedValueOnce(ANSWERED);
    await fireEvent.changeText(
      await screen.findByLabelText(STRINGS.en.settings.key.input),
      "sk-ant-api03-workspace",
    );
    await fireEvent.press(screen.getByRole("button", { name: STRINGS.en.settings.key.save }));
    expect(await screen.findByText(STRINGS.en.settings.key.saved)).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockFinds.get(1)?.analysis.state).toBe("done");
  });
});
