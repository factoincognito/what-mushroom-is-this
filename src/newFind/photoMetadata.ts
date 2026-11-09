/**
 * The time and position a gallery photo's own metadata holds (docs/SPEC.md 3.1, 3.6), from the
 * EXIF that expo-image-picker gives with the photo. Every value is checked; a value that does not
 * fit is treated as missing, never coerced.
 *
 * The keys, as the installed expo-image-picker 57.0.21 gives them (its Android and iOS sources,
 * not its documentation, which says only that `exif` "is an object containing the image's EXIF
 * data"):
 * - `DateTimeOriginal`, the time the photo was taken, "YYYY:MM:DD HH:MM:SS" in the camera's local
 *   time, and `OffsetTimeOriginal`, that time's UTC offset, "+HH:MM" or "-HH:MM". The Android side
 *   does not pass `OffsetTimeOriginal` on, so there the phone's offset on that date is used, and
 *   the find marks it so. `DateTime`, the time the file was last changed, is not the time taken
 *   and is not used.
 * - `GPSLatitude` and `GPSLongitude` as numbers of degrees, with `GPSLatitudeRef` ("N", "S") and
 *   `GPSLongitudeRef` ("E", "W"): unsigned with the letter on iOS, already signed on Android, with
 *   the letter beside them. `GPSHPositioningError`, in metres, when it is a number.
 *
 * A position of exactly 0, 0 is treated as none (accepted by Clead for #14). Android
 * hides a photo's location from an app without `ACCESS_MEDIA_LOCATION` (the Android Developers
 * page "Access media files from shared storage", read 2026-11-09); that page does not say in what
 * form a hidden location reaches the app. That a find is really made at 0° N, 0° E, in the Gulf
 * of Guinea, is not a case this app needs.
 */

import type { FindTime, Position } from "../store/find";

/** A date and time of day, as a clock shows it, with no offset. */
export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The instant of a local time on the phone, and the phone's UTC offset then, in minutes. */
export type PhoneTimeAt = (
  local: LocalTime,
) => { takenAtMs: number; utcOffsetMinutes: number } | null;

export interface PhotoMetadata {
  time: FindTime | null;
  position: Position | null;
}

const EXIF_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;
const MAX_OFFSET_MINUTES = 18 * 60;

export function readPhotoMetadata(exif: unknown, phoneTime: PhoneTimeAt): PhotoMetadata {
  if (typeof exif !== "object" || exif === null || Array.isArray(exif)) {
    return { time: null, position: null };
  }
  const tags = Object.fromEntries(Object.entries(exif));
  return { time: readTime(tags, phoneTime), position: readPosition(tags) };
}

/** The phone's own clock: a local time on the phone, read in the phone's time zone. */
export const phoneTimeAt: PhoneTimeAt = (local) => {
  const instant = new Date(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const takenAtMs = instant.getTime();
  if (!Number.isSafeInteger(takenAtMs)) {
    return null;
  }
  return { takenAtMs, utcOffsetMinutes: -instant.getTimezoneOffset() };
};

function readTime(tags: Record<string, unknown>, phoneTime: PhoneTimeAt): FindTime | null {
  const local = readLocalTime(tags.DateTimeOriginal);
  if (local === null) {
    return null;
  }
  const offset = readOffset(tags.OffsetTimeOriginal);
  if (offset !== null) {
    const utc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    return { takenAtMs: utc - offset * 60_000, utcOffsetMinutes: offset, source: "photo" };
  }
  const onPhone = phoneTime(local);
  return onPhone === null ? null : { ...onPhone, source: "photo-phone-offset" };
}

function readLocalTime(value: unknown): LocalTime | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = EXIF_TIME.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  // The date must exist: Date.UTC rolls 31 September over to 1 October, so compare it back.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function readOffset(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = EXIF_OFFSET.exec(value);
  if (match === null) {
    return null;
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const total = hours * 60 + minutes;
  if (minutes > 59 || total > MAX_OFFSET_MINUTES) {
    return null;
  }
  return match[1] === "-" ? -total || 0 : total;
}

function readPosition(tags: Record<string, unknown>): Position | null {
  const latitude = readCoordinate(tags.GPSLatitude, tags.GPSLatitudeRef, "N", "S", 90);
  const longitude = readCoordinate(tags.GPSLongitude, tags.GPSLongitudeRef, "E", "W", 180);
  if (latitude === null || longitude === null) {
    return null;
  }
  if (latitude === 0 && longitude === 0) {
    return null;
  }
  const error = tags.GPSHPositioningError;
  const accuracyM =
    typeof error === "number" && Number.isFinite(error) && error >= 0 ? error : null;
  return { latitude, longitude, accuracyM, source: "photo" };
}

/**
 * A coordinate in degrees with its reference letter: the positive letter keeps the sign
 * (a negative value with it is a contradiction, so no value), the negative letter makes it
 * negative, and without a letter the value's own sign holds.
 */
function readCoordinate(
  value: unknown,
  ref: unknown,
  positive: string,
  negative: string,
  limit: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    return null;
  }
  if (ref === undefined || ref === null) {
    return value;
  }
  if (ref === negative) {
    return -Math.abs(value);
  }
  if (ref === positive && value >= 0) {
    return value;
  }
  return null;
}
