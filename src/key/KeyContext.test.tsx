import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import type { KeyValueStore } from "../storage/keyValueStore";
import { API_KEY_STORE_KEY, INSTALL_MARKER_KEY, type SecretStore } from "./apiKey";
import { KeyProvider, type KeyState, useApiKey } from "./KeyContext";

function memorySecrets(initial: Record<string, string> = {}): SecretStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
}

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

const A_KEY = "sk-ant-api03-abc";
const MARKED = { [INSTALL_MARKER_KEY]: "installed" };

let state: KeyState | undefined;

function Probe() {
  state = useApiKey();
  return <Text testID="status">{state.status}</Text>;
}

async function renderProvider(secrets: SecretStore, store: KeyValueStore) {
  await render(
    <KeyProvider secrets={secrets} store={store}>
      <Probe />
    </KeyProvider>,
  );
}

function current(): KeyState {
  if (state === undefined) {
    throw new Error("the probe has not rendered");
  }
  return state;
}

beforeEach(() => {
  state = undefined;
});

describe("KeyProvider", () => {
  it("reports no key when none is saved", async () => {
    await renderProvider(memorySecrets(), memoryStore(MARKED));
    expect(await screen.findByText("none")).toBeOnTheScreen();
  });

  it("reports a saved key at a later start", async () => {
    await renderProvider(memorySecrets({ [API_KEY_STORE_KEY]: A_KEY }), memoryStore(MARKED));
    expect(await screen.findByText("stored")).toBeOnTheScreen();
  });

  it("clears a key left from an earlier install at the first start, before reporting", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    const store = memoryStore();
    await renderProvider(secrets, store);
    expect(await screen.findByText("none")).toBeOnTheScreen();
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    expect(store.values.get(INSTALL_MARKER_KEY)).toBe("installed");
  });

  it("is loading until the first-start check and the read are done", async () => {
    const store: KeyValueStore = {
      getItem: () => new Promise<string | null>(() => undefined),
      setItem: async () => undefined,
    };
    await renderProvider(memorySecrets(), store);
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
  });

  it("reports an unreadable key store", async () => {
    const secrets: SecretStore = {
      getItemAsync: async () => {
        throw new Error("keychain locked");
      },
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    };
    await renderProvider(secrets, memoryStore(MARKED));
    expect(await screen.findByText("unreadable")).toBeOnTheScreen();
  });

  it("reports a saved key once one is saved, trimmed", async () => {
    const secrets = memorySecrets();
    await renderProvider(secrets, memoryStore(MARKED));
    await screen.findByText("none");
    await act(async () => {
      await expect(current().save(` ${A_KEY}\n`)).resolves.toEqual({ ok: true });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("stored");
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it("keeps its report when a key is refused", async () => {
    await renderProvider(memorySecrets(), memoryStore(MARKED));
    await screen.findByText("none");
    await act(async () => {
      await expect(current().save("  ")).resolves.toEqual({ ok: false, reason: "empty" });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });

  it("reports no key once the key is removed", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    await renderProvider(secrets, memoryStore(MARKED));
    await screen.findByText("stored");
    await act(async () => {
      await expect(current().remove()).resolves.toEqual({ ok: true });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("none");
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
  });

  it("keeps its report when removing the key fails", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    secrets.deleteItemAsync = async () => {
      throw new Error("keychain locked");
    };
    await renderProvider(secrets, memoryStore(MARKED));
    await screen.findByText("stored");
    await act(async () => {
      await expect(current().remove()).resolves.toEqual({ ok: false });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("stored");
  });

  it("saves a key given during the first-start check only after the check, so it is kept", async () => {
    const secrets = memorySecrets();
    let releaseMarker: (value: string | null) => void = () => undefined;
    const store: KeyValueStore = {
      getItem: () =>
        new Promise<string | null>((resolve) => {
          releaseMarker = resolve;
        }),
      setItem: async () => undefined,
    };
    await renderProvider(secrets, store);
    let saved: Promise<unknown> = Promise.resolve();
    await act(async () => {
      saved = current().save(A_KEY);
    });
    await act(async () => {
      releaseMarker(null);
      await saved;
    });
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
    expect(screen.getByTestId("status")).toHaveTextContent("stored");
  });

  it("removes a key asked for during the startup read only after the read, so it reports no key", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    let releaseRead: () => void = () => undefined;
    secrets.getItemAsync = (key) => {
      // The value as it is when the read starts, given once the read is released.
      const value = secrets.values.get(key) ?? null;
      return new Promise((resolve) => {
        releaseRead = () => resolve(value);
      });
    };
    await renderProvider(secrets, memoryStore(MARKED));
    let removed: Promise<unknown> = Promise.resolve();
    await act(async () => {
      removed = current().remove();
    });
    await act(async () => {
      releaseRead();
      await expect(removed).resolves.toEqual({ ok: true });
    });
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });

  it("does not update after it is gone", async () => {
    let releaseMarker: (value: string | null) => void = () => undefined;
    const store: KeyValueStore = {
      getItem: () =>
        new Promise<string | null>((resolve) => {
          releaseMarker = resolve;
        }),
      setItem: async () => undefined,
    };
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderProvider(memorySecrets(), store);
    await screen.unmount();
    await act(async () => {
      releaseMarker("installed");
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("KeyProvider, the key for analysis (PBI-1.7)", () => {
  /** Reads the key for analysis in its own mount effect, which React runs before its parent's. */
  function EarlyReader({ onRead }: { onRead: (result: unknown) => void }) {
    const { readForAnalysis } = useApiKey();
    useEffect(() => {
      readForAnalysis().then(onRead);
    }, [readForAnalysis, onRead]);
    return null;
  }

  it("is not read before the first-start clearing has run, even from a child's mount effect", async () => {
    // A key left from an earlier install; no marker, so this is the first start after an install.
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    let releaseMarker: (value: string | null) => void = () => undefined;
    const store: KeyValueStore = {
      getItem: () =>
        new Promise<string | null>((resolve) => {
          releaseMarker = resolve;
        }),
      setItem: async () => undefined,
    };
    const onRead = jest.fn();
    await render(
      <KeyProvider secrets={secrets} store={store}>
        <EarlyReader onRead={onRead} />
      </KeyProvider>,
    );
    expect(onRead).not.toHaveBeenCalled();
    await act(async () => {
      releaseMarker(null);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith({ ok: true, key: null });
  });

  it("gives the saved key once the clearing has run at a later start", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    const onRead = jest.fn();
    await render(
      <KeyProvider secrets={secrets} store={memoryStore(MARKED)}>
        <EarlyReader onRead={onRead} />
      </KeyProvider>,
    );
    expect(onRead).toHaveBeenCalledWith({ ok: true, key: A_KEY });
  });

  it("gives the key saved since the start", async () => {
    const secrets = memorySecrets();
    await renderProvider(secrets, memoryStore(MARKED));
    await act(async () => {
      await current().save(` ${A_KEY}\n`);
    });
    await expect(current().readForAnalysis()).resolves.toEqual({ ok: true, key: A_KEY });
  });

  it("reports a key store that cannot be read", async () => {
    const secrets = memorySecrets();
    await renderProvider(secrets, memoryStore(MARKED));
    secrets.getItemAsync = async () => {
      throw new Error("Keystore unavailable");
    };
    await expect(current().readForAnalysis()).resolves.toEqual({ ok: false });
  });
});

/** A plain store whose marker writes fail while `failWrites` is true. */
function flakyStore(failWrites: {
  value: boolean;
}): KeyValueStore & { values: Map<string, string> } {
  const store = memoryStore();
  return {
    values: store.values,
    getItem: store.getItem,
    setItem: async (key, value) => {
      if (failWrites.value) {
        throw new Error("disk full");
      }
      await store.setItem(key, value);
    },
  };
}

/** Waits until the startup has reported. */
async function startupDone(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("status")).not.toHaveTextContent("loading"));
}

describe("KeyProvider, a first-start clearing that failed (PBI-1.17)", () => {
  it.each([
    ["the marker cannot be written", "write"],
    ["the marker cannot be read", "read"],
    ["the key left from an earlier install cannot be removed", "delete"],
  ] as const)(
    "reports the key store as unreadable when %s, since what it holds cannot be trusted",
    async (_name, failing) => {
      const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
      if (failing === "delete") {
        secrets.deleteItemAsync = async () => {
          throw new Error("keychain locked");
        };
      }
      const store = flakyStore({ value: failing === "write" });
      if (failing === "read") {
        store.getItem = async () => {
          throw new Error("storage unavailable");
        };
      }
      await renderProvider(secrets, store);
      expect(await screen.findByText("unreadable")).toBeOnTheScreen();
    },
  );

  it("does not lose a key saved after the marker could not be written: the save sets the marker first", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: "sk-ant-left-over" });
    const failWrites = { value: true };
    const store = flakyStore(failWrites);
    await renderProvider(secrets, store);
    await startupDone();
    failWrites.value = false;
    await act(async () => {
      await expect(current().save(A_KEY)).resolves.toEqual({ ok: true });
    });
    expect(store.values.get(INSTALL_MARKER_KEY)).toBe("installed");
    await screen.unmount();

    // The next start: the marker is there, so the key saved since is kept.
    await renderProvider(secrets, store);
    expect(await screen.findByText("stored")).toBeOnTheScreen();
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it("does not save a key while the marker still cannot be written, so the next start has none to delete", async () => {
    const secrets = memorySecrets();
    const store = flakyStore({ value: true });
    await renderProvider(secrets, store);
    await startupDone();
    await act(async () => {
      await expect(current().save(A_KEY)).resolves.toEqual({
        ok: false,
        reason: "store-failed",
      });
    });
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    expect(screen.getByTestId("status")).not.toHaveTextContent("stored");
  });

  it("does not give the key left from an earlier install for analysis when it could not be cleared", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: "sk-ant-left-over" });
    secrets.deleteItemAsync = async () => {
      throw new Error("keychain locked");
    };
    await renderProvider(secrets, memoryStore());
    await startupDone();
    await expect(current().readForAnalysis()).resolves.toEqual({ ok: false });
  });

  it("does not give a key for analysis when the marker could not be read", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    const store: KeyValueStore = {
      getItem: async () => {
        throw new Error("storage unavailable");
      },
      setItem: async () => undefined,
    };
    await renderProvider(secrets, store);
    await startupDone();
    await expect(current().readForAnalysis()).resolves.toEqual({ ok: false });
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it("gives the key for analysis once a save has set the marker", async () => {
    const secrets = memorySecrets();
    const failWrites = { value: true };
    await renderProvider(secrets, flakyStore(failWrites));
    await startupDone();
    failWrites.value = false;
    await act(async () => {
      await current().save(A_KEY);
    });
    await expect(current().readForAnalysis()).resolves.toEqual({ ok: true, key: A_KEY });
    expect(screen.getByTestId("status")).toHaveTextContent("stored");
  });

  it("removes a key while the clearing has failed, and reports no key", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: "sk-ant-left-over" });
    secrets.deleteItemAsync = jest
      .fn<Promise<void>, [string]>()
      .mockRejectedValueOnce(new Error("keychain locked"))
      .mockImplementation(async (key) => {
        secrets.values.delete(key);
      });
    await renderProvider(secrets, memoryStore());
    await startupDone();
    await act(async () => {
      await expect(current().remove()).resolves.toEqual({ ok: true });
    });
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });
});

describe("KeyProvider, the order of effects (PBI-1.17)", () => {
  /** Saves a key in its own mount effect, which React runs before its parent's. */
  function EarlySaver({ onSaved }: { onSaved: (result: unknown) => void }) {
    const { save } = useApiKey();
    useEffect(() => {
      save(A_KEY).then(onSaved);
    }, [save, onSaved]);
    return <Probe />;
  }

  it("keeps a key saved from a child's mount effect at the first start: the save waits for the clearing", async () => {
    const secrets = memorySecrets();
    let releaseMarker: (value: string | null) => void = () => undefined;
    const store = memoryStore();
    store.getItem = () =>
      new Promise<string | null>((resolve) => {
        releaseMarker = resolve;
      });
    const onSaved = jest.fn();
    await render(
      <KeyProvider secrets={secrets} store={store}>
        <EarlySaver onSaved={onSaved} />
      </KeyProvider>,
    );
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    await act(async () => {
      releaseMarker(null);
    });
    expect(onSaved).toHaveBeenCalledWith({ ok: true });
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
    expect(screen.getByTestId("status")).toHaveTextContent("stored");
  });
});

describe("useApiKey", () => {
  it("throws outside a KeyProvider", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow("useApiKey must be used inside a KeyProvider");
    spy.mockRestore();
  });
});
