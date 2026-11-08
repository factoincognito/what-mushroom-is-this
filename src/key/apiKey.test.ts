import type { KeyValueStore } from "../storage/keyValueStore";
import {
  API_KEY_STORE_KEY,
  clearKeyOnFirstStartAfterInstall,
  INSTALL_MARKER_KEY,
  readKey,
  removeKey,
  type SecretStore,
  saveKey,
} from "./apiKey";

/** An in-memory secure store; each of its calls can be made to fail. */
function memorySecrets(initial: Record<string, string> = {}): SecretStore & {
  values: Map<string, string>;
  fail: { get: boolean; set: boolean; delete: boolean };
} {
  const values = new Map(Object.entries(initial));
  const fail = { get: false, set: false, delete: false };
  return {
    values,
    fail,
    getItemAsync: async (key) => {
      if (fail.get) {
        throw new Error("keychain locked");
      }
      return values.get(key) ?? null;
    },
    setItemAsync: async (key, value) => {
      if (fail.set) {
        throw new Error("keychain locked");
      }
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      if (fail.delete) {
        throw new Error("keychain locked");
      }
      values.delete(key);
    },
  };
}

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  values: Map<string, string>;
  fail: { get: boolean; set: boolean };
} {
  const values = new Map(Object.entries(initial));
  const fail = { get: false, set: false };
  return {
    values,
    fail,
    getItem: async (key) => {
      if (fail.get) {
        throw new Error("storage unavailable");
      }
      return values.get(key) ?? null;
    },
    setItem: async (key, value) => {
      if (fail.set) {
        throw new Error("disk full");
      }
      values.set(key, value);
    },
  };
}

const A_KEY = "sk-ant-api03-abcDEF_123-xyz";

describe("saveKey", () => {
  it("saves a key in the secure store", async () => {
    const secrets = memorySecrets();
    await expect(saveKey(secrets, A_KEY)).resolves.toEqual({ ok: true });
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it.each([
    ["spaces", `  ${A_KEY}  `],
    ["a line break after it, as a paste can bring", `${A_KEY}\n`],
    ["line breaks and spaces on both sides", `\r\n ${A_KEY} \r\n`],
  ])("trims %s before saving (SPEC 3.2)", async (_label, raw) => {
    const secrets = memorySecrets();
    await expect(saveKey(secrets, raw)).resolves.toEqual({ ok: true });
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it.each(["", "   ", "\n", " \r\n\t "])(
    "does not save the empty key %p, and keeps the key saved before",
    async (raw) => {
      const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
      await expect(saveKey(secrets, raw)).resolves.toEqual({ ok: false, reason: "empty" });
      expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
    },
  );

  it.each([
    ["an inner space", "sk-ant api03"],
    ["a zero-width space", "sk-ant-​api03"],
    ["a smart quote", "sk-ant-api03”"],
    ["a non-ASCII letter", "sk-ant-äpi03"],
    ["a control character", "sk-ant-\u0007api03"],
  ])(
    "does not save a key with %s, which the analysis module would refuse to send",
    async (_label, raw) => {
      const secrets = memorySecrets();
      await expect(saveKey(secrets, raw)).resolves.toEqual({
        ok: false,
        reason: "not-sendable",
      });
      expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    },
  );

  it.each([42, null, undefined, { key: A_KEY }])(
    "does not save %p, which is not a string",
    async (raw) => {
      const secrets = memorySecrets();
      await expect(saveKey(secrets, raw)).resolves.toEqual({
        ok: false,
        reason: "not-sendable",
      });
      expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    },
  );

  it("reports a failed write to the secure store, and does not throw", async () => {
    const secrets = memorySecrets();
    secrets.fail.set = true;
    await expect(saveKey(secrets, A_KEY)).resolves.toEqual({
      ok: false,
      reason: "store-failed",
    });
  });
});

describe("readKey", () => {
  it("gives no key when none is saved", async () => {
    await expect(readKey(memorySecrets())).resolves.toEqual({ ok: true, key: null });
  });

  it("gives the saved key", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    await expect(readKey(secrets)).resolves.toEqual({ ok: true, key: A_KEY });
  });

  it("gives no key for an empty stored value", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: "" });
    await expect(readKey(secrets)).resolves.toEqual({ ok: true, key: null });
  });

  it("gives no key for a stored value that is not a string", async () => {
    const secrets: SecretStore = {
      getItemAsync: async () => 5 as unknown as string,
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    };
    await expect(readKey(secrets)).resolves.toEqual({ ok: true, key: null });
  });

  it("reports a failed read, and does not throw", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    secrets.fail.get = true;
    await expect(readKey(secrets)).resolves.toEqual({ ok: false });
  });
});

describe("removeKey", () => {
  it("removes the saved key", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    await expect(removeKey(secrets)).resolves.toEqual({ ok: true });
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
  });

  it("succeeds when no key is saved", async () => {
    await expect(removeKey(memorySecrets())).resolves.toEqual({ ok: true });
  });

  it("reports a failed delete, and does not throw", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    secrets.fail.delete = true;
    await expect(removeKey(secrets)).resolves.toEqual({ ok: false });
  });
});

describe("clearKeyOnFirstStartAfterInstall (SPEC 3.2)", () => {
  it("clears a key left from an earlier install at the first start, and sets the marker", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    const store = memoryStore();
    await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("cleared");
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    expect(store.values.get(INSTALL_MARKER_KEY)).toBe("installed");
  });

  it("keeps the key at a later start, once the marker is set", async () => {
    const secrets = memorySecrets();
    const store = memoryStore();
    await clearKeyOnFirstStartAfterInstall(secrets, store);
    await saveKey(secrets, A_KEY);
    await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("kept");
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
  });

  it.each(["", "true", "Installed"])(
    "treats an unexpected marker value %p as a first start, and clears the key",
    async (value) => {
      const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
      const store = memoryStore({ [INSTALL_MARKER_KEY]: value });
      await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("cleared");
      expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
    },
  );

  it("keeps the key and sets no marker when the marker cannot be read", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    const store = memoryStore();
    store.fail.get = true;
    await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("failed");
    expect(secrets.values.get(API_KEY_STORE_KEY)).toBe(A_KEY);
    expect(store.values.has(INSTALL_MARKER_KEY)).toBe(false);
  });

  it("sets no marker when the key cannot be cleared, so the next start tries again", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    secrets.fail.delete = true;
    const store = memoryStore();
    await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("failed");
    expect(store.values.has(INSTALL_MARKER_KEY)).toBe(false);
    secrets.fail.delete = false;
    await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("cleared");
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
  });

  it("reports a failure when the marker cannot be written, with the key already cleared", async () => {
    const secrets = memorySecrets({ [API_KEY_STORE_KEY]: A_KEY });
    const store = memoryStore();
    store.fail.set = true;
    await expect(clearKeyOnFirstStartAfterInstall(secrets, store)).resolves.toBe("failed");
    expect(secrets.values.has(API_KEY_STORE_KEY)).toBe(false);
  });
});
