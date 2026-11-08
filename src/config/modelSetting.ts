import type { ImageLimits } from "../image/resize";
import type { KeyValueStore } from "../storage/keyValueStore";
import { type AppConfig, config } from "./config";

/**
 * The model setting (docs/SPEC.md 3.3): a model ID, kept in the plain key-value store, with the
 * default of the config module until the user saves another. Any model ID may be saved, listed
 * or not, so a model newer than the app can be used; an empty one is not saved.
 */

/** The store key under which the chosen model ID is kept. */
export const MODEL_SETTING_KEY = "model.id";

/** Printable ASCII, 0x21 to 0x7E: no blanks, no control characters, nothing beyond ASCII. */
const MODEL_ID = /^[\x21-\x7e]+$/;

export type ModelIdCheck =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: "empty" | "invalid" };

export type SaveModelResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: "empty" | "invalid" | "store-failed" };

/** Trims a model ID and checks it. Input that is not a string is invalid; nothing is coerced. */
export function checkModelId(raw: unknown): ModelIdCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: "invalid" };
  }
  const id = raw.trim();
  if (id === "") {
    return { ok: false, reason: "empty" };
  }
  return MODEL_ID.test(id) ? { ok: true, id } : { ok: false, reason: "invalid" };
}

/**
 * The model ID in use: the saved one, or the default when none is saved, the stored value is
 * not a valid model ID, or the store cannot be read.
 */
export async function readModelId(
  store: KeyValueStore,
  appConfig: AppConfig = config,
): Promise<string> {
  try {
    const stored: unknown = await store.getItem(MODEL_SETTING_KEY);
    const checked = checkModelId(stored);
    return checked.ok ? checked.id : appConfig.defaultModelId;
  } catch {
    return appConfig.defaultModelId;
  }
}

/** Saves a model ID, trimmed. An empty or invalid one is not saved; a failed write is reported. */
export async function saveModelId(store: KeyValueStore, raw: unknown): Promise<SaveModelResult> {
  const checked = checkModelId(raw);
  if (!checked.ok) {
    return checked;
  }
  try {
    await store.setItem(MODEL_SETTING_KEY, checked.id);
    return { ok: true, id: checked.id };
  } catch {
    return { ok: false, reason: "store-failed" };
  }
}

/** The image limits for a model ID: its own when it is listed, otherwise the unlisted limits. */
export function imageLimitsFor(modelId: string, appConfig: AppConfig = config): ImageLimits {
  const listed = appConfig.models.find((model) => model.id === modelId);
  return listed?.imageLimits ?? appConfig.unlistedModelImageLimits;
}
