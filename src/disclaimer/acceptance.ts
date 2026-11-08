import type { KeyValueStore } from "../storage/keyValueStore";

/** The store key under which the first-start acceptance of the disclaimer is kept. */
export const DISCLAIMER_ACCEPTED_KEY = "disclaimer.accepted";

const ACCEPTED = "accepted";

/**
 * Whether the disclaimer was accepted at an earlier start (docs/SPEC.md 3.1). Anything but the
 * exact stored value, and a store that cannot be read, count as not accepted, so the
 * disclaimer is shown again rather than skipped.
 */
export async function isDisclaimerAccepted(store: KeyValueStore): Promise<boolean> {
  try {
    const value: unknown = await store.getItem(DISCLAIMER_ACCEPTED_KEY);
    return value === ACCEPTED;
  } catch {
    return false;
  }
}

/** Stores the acceptance. A failed write is reported, not thrown. */
export async function acceptDisclaimer(store: KeyValueStore): Promise<{ readonly ok: boolean }> {
  try {
    await store.setItem(DISCLAIMER_ACCEPTED_KEY, ACCEPTED);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
