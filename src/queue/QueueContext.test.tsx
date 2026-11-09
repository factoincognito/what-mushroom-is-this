import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import type { ReadKeyResult } from "../key/apiKey";
import { type KeyState, useApiKey } from "../key/KeyContext";
import { FindLogProvider, useFindLog } from "../store/FindLogContext";
import type { NewFind } from "../store/find";
import type { FindStore } from "../store/findStore";
import type { NetworkSource } from "./networkState";
import {
  type AppStateSource,
  type QueueContextValue,
  QueueProvider,
  useQueue,
} from "./QueueContext";
import { AnalysisQueue, type QueueDeps } from "./queue";

jest.mock("../key/KeyContext", () => ({ useApiKey: jest.fn() }));
// The phone's queue is not made here: each test gives the provider its own (deviceQueue.test.ts).
jest.mock("./deviceQueue", () => ({ createDeviceQueue: jest.fn() }));

const NEW_FIND: NewFind = {
  photoUri: "file:///cache/camera.jpg",
  time: { takenAtMs: 1, utcOffsetMinutes: 0, source: "saved" },
  position: null,
};

/** A find log with no finds waiting, whose `add` gives the next ID. */
function emptyLog(): FindStore {
  let ids = 0;
  return {
    add: jest.fn(async () => {
      ids += 1;
      return ids;
    }),
    get: jest.fn(async () => null),
    list: jest.fn(async () => []),
    oldestWaiting: jest.fn(async () => null),
    setAnswer: jest.fn(),
    replaceAnswer: jest.fn(),
    markFailed: jest.fn(),
    markWaiting: jest.fn(),
    setPosition: jest.fn(),
    delete: jest.fn(),
  };
}

function fakeAppState(initial: string) {
  const listeners: ((state: string) => void)[] = [];
  const remove = jest.fn();
  const source: { currentState: string } & AppStateSource = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      return { remove };
    },
  };
  return {
    source,
    remove,
    change: (state: string) => {
      source.currentState = state;
      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}

function fakeNetwork() {
  let listener: (state: unknown) => void = () => undefined;
  const remove = jest.fn();
  const source: NetworkSource = {
    getNetworkStateAsync: async () => ({ isConnected: false, isInternetReachable: false }),
    addNetworkStateListener: (next) => {
      listener = next;
      return { remove };
    },
  };
  return { source, remove, emit: (state: unknown) => listener(state) };
}

const readForAnalysis = jest.fn<Promise<ReadKeyResult>, []>(async () => ({
  ok: true,
  key: "sk-ant-k",
}));

beforeEach(() => {
  jest.mocked(useApiKey).mockReturnValue({
    status: "stored",
    save: jest.fn(),
    remove: jest.fn(),
    readForAnalysis,
  } satisfies KeyState);
});

let context: QueueContextValue | undefined;
let screenLog: (() => Promise<FindStore>) | undefined;

function Probe() {
  context = useQueue();
  screenLog = useFindLog();
  return <Text testID="queue-state">{JSON.stringify(context.state)}</Text>;
}

/** Renders the provider with fakes; gives the queue it made and the deps it made it with. */
async function renderQueue(options: { appState?: string; log?: FindStore } = {}) {
  const log = options.log ?? emptyLog();
  const appState = fakeAppState(options.appState ?? "active");
  const network = fakeNetwork();
  let made: { queue: AnalysisQueue; deps: Pick<QueueDeps, "findLog" | "readKey"> } | undefined;
  const createQueue = jest.fn((deps: Pick<QueueDeps, "findLog" | "readKey">) => {
    const queue = new AnalysisQueue(
      {
        ...deps,
        readModelId: async () => "claude-opus-5-5",
        preparePhoto: async () => ({ ok: true, imageBase64: "AAAA", width: 1, height: 1 }),
        analyse: async () => ({ ok: false, error: { kind: "no-credit", status: 402 } }),
        now: () => 0,
        schedule: () => () => undefined,
      },
      { apiAddress: "https://api.anthropic.com", timeLimitMs: 60_000 },
    );
    jest.spyOn(queue, "trigger");
    jest.spyOn(queue, "dispose");
    made = { queue, deps };
    return queue;
  });
  await render(
    <FindLogProvider open={async () => log}>
      <QueueProvider createQueue={createQueue} appState={appState.source} network={network.source}>
        <Probe />
      </QueueProvider>
    </FindLogProvider>,
  );
  if (made === undefined) {
    throw new Error("the provider made no queue");
  }
  return { ...made, log, appState, network, createQueue };
}

function current(): QueueContextValue {
  if (context === undefined) {
    throw new Error("the probe has not rendered");
  }
  return context;
}

describe("QueueProvider, the triggers (SPEC 3.4)", () => {
  it("runs the queue when the app starts in front", async () => {
    const { queue } = await renderQueue();
    expect(queue.trigger).toHaveBeenCalledTimes(1);
  });

  it("does not run it when the app starts in the background", async () => {
    const { queue, log } = await renderQueue({ appState: "background" });
    expect(queue.trigger).not.toHaveBeenCalled();
    expect(log.oldestWaiting).not.toHaveBeenCalled();
  });

  it("runs it when the app comes to the front", async () => {
    const { queue, appState } = await renderQueue({ appState: "background" });
    await act(async () => {
      appState.change("active");
    });
    expect(queue.trigger).toHaveBeenCalledTimes(1);
  });

  it("does not run it for a change between states that are not the front", async () => {
    const { queue, appState } = await renderQueue({ appState: "background" });
    await act(async () => {
      appState.change("inactive");
      appState.change("background");
    });
    expect(queue.trigger).not.toHaveBeenCalled();
  });

  it("tells the queue when the app leaves the front, so a trigger then runs nothing", async () => {
    const { queue, log, appState, network } = await renderQueue();
    jest.mocked(log.oldestWaiting).mockClear();
    await act(async () => {
      appState.change("background");
      network.emit({ isConnected: true, isInternetReachable: true });
    });
    expect(queue.trigger).toHaveBeenCalledTimes(2);
    expect(log.oldestWaiting).not.toHaveBeenCalled();
  });

  it("runs it when the phone reports that the network is back", async () => {
    const { queue, network } = await renderQueue();
    await act(async () => {
      network.emit({ isConnected: false, isInternetReachable: false });
      network.emit({ isConnected: true, isInternetReachable: true });
    });
    expect(queue.trigger).toHaveBeenCalledTimes(2);
  });

  it("runs it when a new find is saved through the find log the screens get, after the save", async () => {
    const { queue, log } = await renderQueue();
    let id = 0;
    await act(async () => {
      const store = await screenLog?.();
      id = (await store?.add(NEW_FIND)) ?? 0;
    });
    expect(id).toBe(1);
    expect(log.add).toHaveBeenCalledWith(NEW_FIND);
    expect(queue.trigger).toHaveBeenCalledTimes(2);
  });

  it("does not run it when saving a find fails", async () => {
    const log = emptyLog();
    jest.mocked(log.add).mockRejectedValue(new Error("disk full"));
    const { queue } = await renderQueue({ log });
    await act(async () => {
      const store = await screenLog?.();
      await expect(store?.add(NEW_FIND)).rejects.toThrow("disk full");
    });
    expect(queue.trigger).toHaveBeenCalledTimes(1);
  });

  it("gives the screens the rest of the find log unchanged", async () => {
    const { log } = await renderQueue();
    const store = await screenLog?.();
    await store?.list();
    await store?.delete(3);
    expect(log.list).toHaveBeenCalled();
    expect(log.delete).toHaveBeenCalledWith(3);
  });
});

describe("QueueProvider, the queue's parts", () => {
  it("makes the queue once, with the find log and the key for analysis", async () => {
    const { deps, log, createQueue } = await renderQueue();
    await expect(deps.findLog()).resolves.toBe(log);
    await expect(deps.readKey()).resolves.toEqual({ ok: true, key: "sk-ant-k" });
    expect(readForAnalysis).toHaveBeenCalled();
    await act(async () => {
      current().analyseNow();
    });
    expect(createQueue).toHaveBeenCalledTimes(1);
  });
});

describe("QueueProvider, what it gives the screens", () => {
  it("gives the queue's state, and its changes", async () => {
    const log = emptyLog();
    jest.mocked(log.oldestWaiting).mockResolvedValueOnce(1);
    jest.mocked(log.get).mockResolvedValue({
      id: 1,
      photoUri: "file:///p/1.jpg",
      time: NEW_FIND.time,
      position: null,
      analysis: { state: "waiting" },
    });
    await renderQueue({ log });
    expect(JSON.parse(String(screen.getByTestId("queue-state").props.children))).toEqual({
      running: false,
      stop: { reason: "no-credit" },
      pause: null,
    });
  });

  it("analyse now starts the queue again", async () => {
    const { queue } = await renderQueue();
    const analyseNow = jest.spyOn(queue, "analyseNow");
    await act(async () => {
      current().analyseNow();
    });
    expect(analyseNow).toHaveBeenCalledTimes(1);
  });

  it("passes a setting's change on", async () => {
    const { queue } = await renderQueue();
    const settingChanged = jest.spyOn(queue, "settingChanged");
    await act(async () => {
      current().settingChanged("model");
    });
    expect(settingChanged).toHaveBeenCalledWith("model");
  });

  it("analyses one find on asking", async () => {
    const { queue } = await renderQueue();
    const analyseFind = jest.spyOn(queue, "analyseFind").mockResolvedValue({ ok: true });
    await expect(current().analyseFind(4)).resolves.toEqual({ ok: true });
    expect(analyseFind).toHaveBeenCalledWith(4);
  });
});

describe("QueueProvider, once it is gone", () => {
  it("stops listening and disposes of the queue", async () => {
    const { queue, appState, network } = await renderQueue();
    await screen.unmount();
    expect(appState.remove).toHaveBeenCalled();
    expect(network.remove).toHaveBeenCalled();
    expect(queue.dispose).toHaveBeenCalled();
  });
});

describe("QueueProvider, a run that rejects (Clead's decision on #17)", () => {
  /** The state the probe shows. */
  function shownState(): unknown {
    return JSON.parse(String(screen.getByTestId("queue-state").props.children));
  }

  const INTERNAL = { running: false, stop: { reason: "internal-error" }, pause: null };

  /** A log whose search for a waiting find rejects, as a programming or store error would. */
  function failingLog(): FindStore {
    const log = emptyLog();
    jest.mocked(log.oldestWaiting).mockRejectedValue(new RangeError("timeLimitMs must be…"));
    return log;
  }

  it("at the start: is caught, and the queue stops with an internal error", async () => {
    await renderQueue({ log: failingLog() });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("when the app comes to the front: is caught, and the queue stops", async () => {
    const { appState } = await renderQueue({ appState: "background", log: failingLog() });
    await act(async () => {
      appState.change("active");
    });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("when the network is back: is caught, and the queue stops", async () => {
    const log = emptyLog();
    const { network } = await renderQueue({ log });
    jest.mocked(log.oldestWaiting).mockRejectedValue(new RangeError("bad"));
    await act(async () => {
      network.emit({ isConnected: false });
      network.emit({ isConnected: true });
    });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("after a find is saved: is caught, the find is saved, and the queue stops", async () => {
    const log = emptyLog();
    await renderQueue({ log });
    jest.mocked(log.oldestWaiting).mockRejectedValue(new RangeError("bad"));
    await act(async () => {
      const store = await screenLog?.();
      await expect(store?.add(NEW_FIND)).resolves.toBe(1);
    });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("on analyse now: is caught, and the queue stops again", async () => {
    const { queue } = await renderQueue();
    jest.spyOn(queue, "analyseNow").mockRejectedValue(new RangeError("bad"));
    await act(async () => {
      current().analyseNow();
    });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("on a setting's change: is caught, and the queue stops", async () => {
    const { queue } = await renderQueue();
    jest.spyOn(queue, "settingChanged").mockRejectedValue(new RangeError("bad"));
    await act(async () => {
      current().settingChanged("key");
    });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("analysing one find: stops the queue, and the screen still gets the rejection", async () => {
    const { queue } = await renderQueue();
    jest.spyOn(queue, "analyseFind").mockRejectedValue(new RangeError("bad"));
    await act(async () => {
      await expect(current().analyseFind(4)).rejects.toBeInstanceOf(RangeError);
    });
    expect(shownState()).toEqual(INTERNAL);
  });

  it("analyse now after it starts the queue again", async () => {
    const log = failingLog();
    await renderQueue({ log });
    jest.mocked(log.oldestWaiting).mockResolvedValue(null);
    await act(async () => {
      current().analyseNow();
    });
    expect(shownState()).toEqual({ running: false, stop: null, pause: null });
  });
});

describe("useQueue", () => {
  it("throws outside a QueueProvider", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    function Outside() {
      useQueue();
      return null;
    }
    await expect(render(<Outside />)).rejects.toThrow(
      "useQueue must be used inside a QueueProvider",
    );
    spy.mockRestore();
  });
});
