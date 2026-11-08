import { act, render, screen } from "@testing-library/react-native";
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

describe("useApiKey", () => {
  it("throws outside a KeyProvider", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow("useApiKey must be used inside a KeyProvider");
    spy.mockRestore();
  });
});
