/**
 * Asking for a permission the new find needs: the camera, or the location. The answers come
 * from the Expo libraries' permission functions and are checked; an answer that cannot be read
 * counts as not granted, so nothing is used without a clear yes.
 */

/** A library's permission functions, as the Expo libraries (`expo-image-picker`) give them. */
export interface PermissionAsker {
  get(): Promise<unknown>;
  request(): Promise<unknown>;
}

/** Granted; denied, but the phone lets the app ask again; or denied for good, until Settings. */
export type PermissionState = "granted" | "denied" | "blocked";

export interface AskOptions {
  /**
   * Whether to ask again when the user has said no before. The location is asked for only the
   * first time (docs/SPEC.md 3.6); the camera each time the user chooses to take a photo.
   */
  askAgainWhenDenied: boolean;
}

type Answer = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

export async function ensurePermission(
  permission: PermissionAsker,
  options: AskOptions,
): Promise<PermissionState> {
  try {
    const current = readAnswer(await permission.get());
    if (current === null) {
      return "denied";
    }
    if (current.status === "granted") {
      return "granted";
    }
    if (!current.canAskAgain) {
      return "blocked";
    }
    if (current.status === "denied" && !options.askAgainWhenDenied) {
      return "denied";
    }
    const asked = readAnswer(await permission.request());
    if (asked === null) {
      return "denied";
    }
    if (asked.status === "granted") {
      return "granted";
    }
    return asked.canAskAgain ? "denied" : "blocked";
  } catch {
    return "denied";
  }
}

function readAnswer(raw: unknown): Answer | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const status = "status" in raw ? raw.status : undefined;
  const canAskAgain = "canAskAgain" in raw ? raw.canAskAgain : undefined;
  if (
    (status !== "granted" && status !== "denied" && status !== "undetermined") ||
    typeof canAskAgain !== "boolean"
  ) {
    return null;
  }
  return { status, canAskAgain };
}
