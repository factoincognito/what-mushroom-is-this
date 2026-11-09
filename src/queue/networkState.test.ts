import { isOnline, type NetworkSource, watchNetworkBack } from "./networkState";

type Listener = (state: unknown) => void;

/** Stands in for expo-network at the module's boundary. */
function fakeNetwork(initial: Promise<unknown>) {
  const listeners: Listener[] = [];
  const removed: Listener[] = [];
  const source: NetworkSource = {
    getNetworkStateAsync: () => initial,
    addNetworkStateListener: (listener) => {
      listeners.push(listener);
      return {
        remove: () => {
          removed.push(listener);
        },
      };
    },
  };
  return {
    source,
    removed,
    emit: (state: unknown) => {
      for (const listener of listeners) {
        listener(state);
      }
    },
    listenerCount: () => listeners.length,
  };
}

const ONLINE = { type: "WIFI", isConnected: true, isInternetReachable: true };
const OFFLINE = { type: "NONE", isConnected: false, isInternetReachable: false };

describe("isOnline", () => {
  it.each([
    ["reachable", ONLINE, true],
    ["not connected", OFFLINE, false],
    [
      "connected, but the internet is not reachable (Android: not validated)",
      { type: "WIFI", isConnected: true, isInternetReachable: false },
      false,
    ],
    ["connected, reachability not reported", { type: "WIFI", isConnected: true }, true],
    ["not connected, reachability not reported", { type: "NONE", isConnected: false }, false],
    ["nothing reported", {}, false],
    [
      "a reachability that is not a boolean",
      { isConnected: true, isInternetReachable: "yes" },
      true,
    ],
    ["a connection that is not a boolean", { isConnected: "true" }, false],
    ["null", null, false],
    ["not an object", "online", false],
  ])("%s: %s", (_name, state, expected) => {
    expect(isOnline(state)).toBe(expected);
  });
});

describe("watchNetworkBack", () => {
  it("calls back when the network comes back after it was gone", async () => {
    const network = fakeNetwork(Promise.resolve(OFFLINE));
    const onBack = jest.fn();
    watchNetworkBack(onBack, network.source);
    await Promise.resolve();
    network.emit(ONLINE);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("does not call back for the first state it learns, online or not", async () => {
    const network = fakeNetwork(Promise.resolve(ONLINE));
    const onBack = jest.fn();
    watchNetworkBack(onBack, network.source);
    await Promise.resolve();
    network.emit(ONLINE);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("does not call back while the network stays online or stays gone", async () => {
    const network = fakeNetwork(Promise.resolve(OFFLINE));
    const onBack = jest.fn();
    watchNetworkBack(onBack, network.source);
    await Promise.resolve();
    network.emit(OFFLINE);
    network.emit(ONLINE);
    network.emit({ ...ONLINE, type: "CELLULAR" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("calls back each time the network comes back", async () => {
    const network = fakeNetwork(Promise.resolve(ONLINE));
    const onBack = jest.fn();
    watchNetworkBack(onBack, network.source);
    await Promise.resolve();
    network.emit(OFFLINE);
    network.emit(ONLINE);
    network.emit(OFFLINE);
    network.emit(ONLINE);
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("takes a change reported before the first state arrives over that state", async () => {
    let resolveInitial: (state: unknown) => void = () => undefined;
    const network = fakeNetwork(
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    );
    const onBack = jest.fn();
    watchNetworkBack(onBack, network.source);
    network.emit(OFFLINE);
    resolveInitial(ONLINE);
    await Promise.resolve();
    network.emit(ONLINE);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("learns the state from the first change when the first read fails", async () => {
    const network = fakeNetwork(Promise.reject(new Error("no module")));
    const onBack = jest.fn();
    watchNetworkBack(onBack, network.source);
    await Promise.resolve();
    network.emit(OFFLINE);
    network.emit(ONLINE);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("stops listening when stopped", async () => {
    const network = fakeNetwork(Promise.resolve(OFFLINE));
    const onBack = jest.fn();
    const stop = watchNetworkBack(onBack, network.source);
    stop();
    expect(network.removed).toHaveLength(1);
    network.emit(ONLINE);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("ignores a first state that arrives after it was stopped", async () => {
    let resolveInitial: (state: unknown) => void = () => undefined;
    const network = fakeNetwork(
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    );
    const onBack = jest.fn();
    const stop = watchNetworkBack(onBack, network.source);
    stop();
    resolveInitial(OFFLINE);
    await Promise.resolve();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("the device network source", () => {
  it("is expo-network's state and listener", () => {
    jest.isolateModules(() => {
      const getNetworkStateAsync = jest.fn(() => new Promise(() => undefined));
      const remove = jest.fn();
      const addNetworkStateListener = jest.fn(() => ({ remove }));
      jest.doMock("expo-network", () => ({ getNetworkStateAsync, addNetworkStateListener }));
      const { watchNetworkBack: watch } =
        require("./networkState") as typeof import("./networkState");
      const stop = watch(jest.fn());
      expect(getNetworkStateAsync).toHaveBeenCalledTimes(1);
      expect(addNetworkStateListener).toHaveBeenCalledTimes(1);
      stop();
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
