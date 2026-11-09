/**
 * What the Log and Find screens show of a find (docs/SPEC.md 3.1, 3.6), as text: the route's find
 * ID, the time at the find's own UTC offset, the position, the map link, and the names of the
 * edibilities and the sources. It renders nothing.
 */

import type { Edibility } from "../analysis/answer";
import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
import type { FindTime, Position, PositionSource, TimeSource } from "../store/find";

/** The widest UTC offset ISO 8601 allows, in minutes, as the store keeps it. */
const MAX_OFFSET_MINUTES = 18 * 60;
/** Decimals of a coordinate on the screen: about a metre. */
const SHOWN_DECIMALS = 5;
/** Decimals of a coordinate in the map link: about a tenth of a metre. */
const LINK_DECIMALS = 6;

/**
 * The find ID of the route `/find/[id]`: a positive whole number written in plain decimal digits,
 * without a sign, a leading zero, blanks or a fraction, and no larger than a safe integer.
 * Anything else, also a number that is not text, is no ID: nothing is coerced.
 */
export function parseFindId(param: unknown): number | null {
  if (typeof param !== "string" || !/^[1-9][0-9]*$/.test(param)) {
    return null;
  }
  const id = Number(param);
  return Number.isSafeInteger(id) ? id : null;
}

/** A UTC offset in minutes as "UTC+02:00" or "UTC-05:30". */
export function formatUtcOffset(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || Math.abs(minutes) > MAX_OFFSET_MINUTES) {
    throw new RangeError("a UTC offset is whole minutes within 18 hours");
  }
  const sign = minutes < 0 ? "-" : "+";
  const whole = Math.abs(minutes);
  const hours = String(Math.floor(whole / 60)).padStart(2, "0");
  const rest = String(whole % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${rest}`;
}

/**
 * The date and time a find was taken, as the clock showed them where it was taken: the instant at
 * the find's own UTC offset, in the language's form, followed by the offset. The phone's own time
 * zone plays no part.
 */
export function formatFindTime(time: FindTime, language: Language): string {
  const offset = formatUtcOffset(time.utcOffsetMinutes);
  const format = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return `${format.format(time.takenAtMs + time.utcOffsetMinutes * 60_000)} ${offset}`;
}

/** A coordinate to a number of decimals, without the minus of one that rounds to zero. */
function decimal(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}

/** Latitude and longitude, to five decimals. */
export function formatCoordinates(position: Position): string {
  return `${decimal(position.latitude, SHOWN_DECIMALS)}, ${decimal(position.longitude, SHOWN_DECIMALS)}`;
}

/** The accuracy in whole metres, or null when the phone gave none. */
export function formatAccuracy(position: Position): string | null {
  return position.accuracyM === null ? null : String(Math.round(position.accuracyM));
}

/**
 * The link that opens the phone's own map app at a position (docs/SPEC.md 3.1). Opening it makes no
 * network call of the app's own.
 *
 * - Android, and any platform but iOS: the `geo:` URI that searches the coordinates,
 *   `geo:0,0?q=<lat>,<lng>`. Android's "Common intents" reference
 *   (https://developer.android.com/guide/appendix/app-intents) lists `geo:` under the VIEW action,
 *   which "Opens the Maps application to the given location or query"; the "Google Maps Intents for
 *   Android" page (https://developer.android.com/guide/components/google-maps-intents) gives the
 *   form `geo:0,0?q=latitude,longitude`, and with no app named "the system determines which apps
 *   can handle the Intent". Both read 2026-11-09.
 * - iOS: Apple's unified Maps URL for a place, `https://maps.apple.com/place?coordinate=<lat>,<lng>`
 *   ("Adopting unified Maps URLs",
 *   https://developer.apple.com/documentation/mapkit/unified-map-urls, read 2026-11-09, for iOS
 *   18.4 and later).
 *
 * The coordinates are plain decimals to six places, never in exponent form.
 */
export function mapLink(position: Pick<Position, "latitude" | "longitude">, os: string): string {
  const { latitude, longitude } = position;
  if (!inRange(latitude, 90) || !inRange(longitude, 180)) {
    throw new RangeError("a position is a latitude within 90 and a longitude within 180 degrees");
  }
  const coordinates = `${decimal(latitude, LINK_DECIMALS)},${decimal(longitude, LINK_DECIMALS)}`;
  return os === "ios"
    ? `https://maps.apple.com/place?coordinate=${coordinates}`
    : `geo:0,0?q=${coordinates}`;
}

function inRange(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

/** The name of an edibility in the app's language. */
export function edibilityText(edibility: Edibility, strings: Strings): string {
  const t = strings.find.edibilities;
  return {
    edible: t.edible,
    edible_after_preparation: t.edibleAfterPreparation,
    not_edible: t.notEdible,
    poisonous: t.poisonous,
    deadly_poisonous: t.deadlyPoisonous,
    unknown: t.unknown,
  }[edibility];
}

/** Where a find's time came from, in the app's language. */
export function timeSourceText(source: TimeSource, strings: Strings): string {
  const t = strings.find.timeSources;
  return { saved: t.saved, photo: t.photo, "photo-phone-offset": t.photoPhoneOffset }[source];
}

/** Where a find's position came from, in the app's language. */
export function positionSourceText(source: PositionSource, strings: Strings): string {
  const t = strings.find.positionSources;
  return { fix: t.fix, "last-known": t.lastKnown, photo: t.photo }[source];
}

/** Fills the `{name}` placeholders of a string; a value is put in as it is. */
export function fillIn(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (whole, name: string) => values[name] ?? whole);
}
