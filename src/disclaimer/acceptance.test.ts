import type { KeyValueStore } from "../storage/keyValueStore";
import { acceptDisclaimer, DISCLAIMER_ACCEPTED_KEY, isDisclaimerAccepted } from "./acceptance";

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

describe("isDisclaimerAccepted", () => {
  it("is false at first start, when nothing is stored", async () => {
    await expect(isDisclaimerAccepted(memoryStore())).resolves.toBe(false);
  });

  it("is true once the disclaimer has been accepted", async () => {
    const store = memoryStore();
    await acceptDisclaimer(store);
    await expect(isDisclaimerAccepted(store)).resolves.toBe(true);
  });

  it.each(["true", "yes", "1", ""])(
    "is false for an unexpected stored value %p, so the disclaimer is shown again",
    async (value) => {
      await expect(
        isDisclaimerAccepted(memoryStore({ [DISCLAIMER_ACCEPTED_KEY]: value })),
      ).resolves.toBe(false);
    },
  );

  it("is false for a stored value that is not a string", async () => {
    const store: KeyValueStore = {
      getItem: async () => 1 as unknown as string,
      setItem: async () => undefined,
    };
    await expect(isDisclaimerAccepted(store)).resolves.toBe(false);
  });

  it("is false when reading the store fails, so the disclaimer is shown again", async () => {
    const store: KeyValueStore = {
      getItem: async () => {
        throw new Error("storage unavailable");
      },
      setItem: async () => undefined,
    };
    await expect(isDisclaimerAccepted(store)).resolves.toBe(false);
  });
});

describe("acceptDisclaimer", () => {
  it("stores the acceptance under its key and reports success", async () => {
    const store = memoryStore();
    await expect(acceptDisclaimer(store)).resolves.toEqual({ ok: true });
    expect(store.values.get(DISCLAIMER_ACCEPTED_KEY)).toBe("accepted");
  });

  it("reports a failure when writing the store fails, and does not throw", async () => {
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("disk full");
      },
    };
    await expect(acceptDisclaimer(store)).resolves.toEqual({ ok: false });
  });
});
