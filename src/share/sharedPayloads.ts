/**
 * What another app shared to the app, as expo-sharing gives it, checked (docs/SPEC.md 3.9, Shared
 * photos; Known unknown 16; PBI-2.21). Only an image file on the phone is taken; a shared item
 * that is a web address or a text is refused, and nothing is fetched for it.
 *
 * The library (57.0.26; its Android source in `node_modules/expo-sharing/android/`, read, not
 * run) gives a share in two forms:
 * - the raw payloads (`getSharedPayloads`), read from the share itself without a request: for
 *   each shared file its address as the sharing app gave it (`value`), a share type from its MIME
 *   type, and that MIME type; for a share of the type `text/plain`, the shared text, typed "url"
 *   when it is a web address and "text" otherwise;
 * - the resolved payloads (`getResolvedSharedPayloadsAsync`), for every item of the share at
 *   once: a shared file is copied into a folder of its own under `expo-sharing/` in the app's
 *   cache, and `contentUri` is that copy's address; a shared web address is resolved with a
 *   request to it (`resolveUrlContext`, reached only for a share of the type `text/plain`).
 *
 * So the raw payloads are read first, and the library is asked to resolve a share only when
 * every item of it is a file on the phone (`mayResolve`). The resolved payloads are then taken
 * only as the copies of the very share that was read (`takeResolved`).
 */

/** One item of a share, as the raw payload names it. */
export interface SharedItem {
  /** The item's address or text; empty for an item that is no payload. */
  readonly value: string;
  /** Whether it is an image file on the phone: the only kind the app takes. */
  readonly image: boolean;
  /** Whether its value is the address of a file on the phone. */
  readonly onPhone: boolean;
}

/** A share as read from the library's raw payloads. */
export interface ReadShare {
  readonly items: readonly SharedItem[];
  /** Tells this share from another: the same for two reads of one share. */
  readonly key: string;
}

/** The library's copies of a share. */
export interface ResolvedShare {
  /** Whether the resolved payloads are those of the share that was read. */
  readonly same: boolean;
  /** The addresses of the copies of the share's image files, in the order shared. */
  readonly photos: readonly string[];
  /** The items of the share that are not taken. */
  readonly refused: number;
  /** The addresses of copies that are not taken, to be removed. */
  readonly others: readonly string[];
}

/**
 * The address of a file on the phone: Android's `content` or `file` scheme, in the lower case
 * Android's content resolver reads. A web address, any other scheme, and a text are not.
 */
const ON_PHONE = /^(?:content|file):\/\/./;
const IMAGE_TYPE = /^image\//i;

/** The fields of a payload, or null for anything that is not a plain object. */
function fieldsOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function readItem(payload: unknown): { item: SharedItem; key: unknown[] } {
  const fields = fieldsOf(payload);
  const value = fields?.value;
  if (fields === null || typeof value !== "string") {
    return { item: { value: "", image: false, onPhone: false }, key: [null] };
  }
  const { shareType, mimeType } = fields;
  const onPhone = ON_PHONE.test(value);
  const image =
    onPhone && shareType === "image" && typeof mimeType === "string" && IMAGE_TYPE.test(mimeType);
  return {
    item: { value, image, onPhone },
    key: [value, typeof shareType === "string" ? shareType : null, mimeType ?? null],
  };
}

/**
 * The share the library holds, from its raw payloads; null when it holds none: anything but a
 * list with an item. Nothing is coerced: an item that is no payload is kept as one that is
 * refused.
 */
export function readShare(raw: unknown): ReadShare | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const read = raw.map(readItem);
  return {
    items: read.map(({ item }) => item),
    key: JSON.stringify(read.map(({ key }) => key)),
  };
}

/**
 * Whether the library may be asked to resolve the share: only when every item of it is a file on
 * the phone, and one of them an image. The library resolves every item of a share in one call,
 * and resolves a web address with a request, so a share that holds a web address or a text is
 * never resolved, whatever else it holds.
 */
export function mayResolve(share: ReadShare): boolean {
  return share.items.every((item) => item.onPhone) && share.items.some((item) => item.image);
}

function addressOf(fields: Record<string, unknown> | null): string | null {
  const address = fields?.contentUri;
  return typeof address === "string" && address !== "" ? address : null;
}

/**
 * The copies the library made of the share that was read. The resolved payloads are taken only
 * when they are a list of the share's own items, each with the value read, in the same order:
 * the library resolves whatever share it holds when it is asked, which may be another by then.
 * An image is taken when the library resolved it as an image with the address of a copy.
 */
export function takeResolved(share: ReadShare, resolved: unknown): ResolvedShare {
  const list = Array.isArray(resolved) ? resolved.map(fieldsOf) : [];
  const same =
    Array.isArray(resolved) &&
    list.length === share.items.length &&
    list.every((fields, index) => fields !== null && fields.value === share.items[index]?.value);
  if (!same) {
    return {
      same: false,
      photos: [],
      refused: share.items.length,
      others: list.flatMap((fields) => addressOf(fields) ?? []),
    };
  }
  const photos: string[] = [];
  const others: string[] = [];
  list.forEach((fields, index) => {
    const address = addressOf(fields);
    if (address === null) {
      return;
    }
    if (share.items[index]?.image === true && fields?.contentType === "image") {
      photos.push(address);
    } else {
      others.push(address);
    }
  });
  return { same: true, photos, refused: share.items.length - photos.length, others };
}
