import { type LocalTime, phoneTimeAt, readPhotoMetadata } from "./photoMetadata";

/** The phone's offset on any date, for these tests: one hour east of UTC. */
const atPlusOneHour = (parts: LocalTime) => ({
  takenAtMs:
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    60 * 60_000,
  utcOffsetMinutes: 60,
});

const read = (exif: unknown) => readPhotoMetadata(exif, atPlusOneHour);

describe("the time of a gallery photo", () => {
  it("is the time it was taken, with the offset the photo gives", () => {
    expect(
      read({ DateTimeOriginal: "2026:09:14 15:42:07", OffsetTimeOriginal: "+02:00" }).time,
    ).toEqual({
      takenAtMs: Date.UTC(2026, 8, 14, 13, 42, 7),
      utcOffsetMinutes: 120,
      source: "photo",
    });
  });

  it.each<[string, number]>([
    ["-05:30", -330],
    ["+00:00", 0],
    ["-00:00", 0],
    ["+14:00", 840],
    ["+18:00", 1080],
    ["-18:00", -1080],
  ])("reads the offset %s", (offset, minutes) => {
    const time = read({ DateTimeOriginal: "2026:09:14 15:42:07", OffsetTimeOriginal: offset }).time;
    expect(time).toEqual({
      takenAtMs: Date.UTC(2026, 8, 14, 15, 42, 7) - minutes * 60_000,
      utcOffsetMinutes: minutes,
      source: "photo",
    });
  });

  it("is read with the phone's offset on that date when the photo gives none, and marked so", () => {
    expect(read({ DateTimeOriginal: "2026:09:14 15:42:07" }).time).toEqual({
      takenAtMs: Date.UTC(2026, 8, 14, 14, 42, 7),
      utcOffsetMinutes: 60,
      source: "photo-phone-offset",
    });
  });

  it.each([
    ["an offset without a sign", "02:00"],
    ["an offset in another form", "+0200"],
    ["the letter Z", "Z"],
    ["an offset past 18 hours", "+18:30"],
    ["minutes past 59", "+01:60"],
    ["a blank offset", "      "],
  ])("is read with the phone's offset when the photo gives %s", (_, offset) => {
    expect(
      read({ DateTimeOriginal: "2026:09:14 15:42:07", OffsetTimeOriginal: offset }).time,
    ).toMatchObject({ source: "photo-phone-offset", utcOffsetMinutes: 60 });
  });

  it("is read with the phone's offset when the offset is not text", () => {
    expect(
      read({ DateTimeOriginal: "2026:09:14 15:42:07", OffsetTimeOriginal: 120 }).time,
    ).toMatchObject({ source: "photo-phone-offset" });
  });

  it("is none when the phone's offset for that date cannot be found", () => {
    expect(readPhotoMetadata({ DateTimeOriginal: "2026:09:14 15:42:07" }, () => null).time).toBe(
      null,
    );
  });

  it("does not use the time the file was last changed, only the time it was taken", () => {
    expect(
      read({ DateTime: "2026:09:14 15:42:07", DateTimeDigitized: "2026:09:14 15:42:07" }).time,
    ).toBeNull();
  });

  it.each<[string, unknown]>([
    ["no time", {}],
    ["a time that is not text", { DateTimeOriginal: 1_757_857_327 }],
    ["a blank time, as cameras write when the clock is not set", "    :  :     :  :  "],
    ["zeros", "0000:00:00 00:00:00"],
    ["a date in another form", "2026-09-14 15:42:07"],
    ["a 31st of September", "2026:09:31 15:42:07"],
    ["a 29th of February in a common year", "2026:02:29 12:00:00"],
    ["a 13th month", "2026:13:01 12:00:00"],
    ["hour 24", "2026:09:14 24:00:00"],
    ["minute 60", "2026:09:14 15:60:00"],
    ["second 60", "2026:09:14 15:42:60"],
    ["a time with more after it", "2026:09:14 15:42:07 extra"],
  ])("is none for %s", (_, value) => {
    const exif = typeof value === "object" ? value : { DateTimeOriginal: value };
    expect(read(exif).time).toBeNull();
  });

  it("reads a 29th of February in a leap year", () => {
    expect(read({ DateTimeOriginal: "2028:02:29 12:00:00" }).time).toMatchObject({
      takenAtMs: Date.UTC(2028, 1, 29, 11, 0, 0),
    });
  });
});

describe("the position of a gallery photo", () => {
  it("is the photo's own, with its accuracy, as the iPhone gives it: unsigned with N, S, E, W", () => {
    expect(
      read({
        GPSLatitude: 33.86,
        GPSLatitudeRef: "S",
        GPSLongitude: 151.21,
        GPSLongitudeRef: "E",
        GPSHPositioningError: 4.5,
      }).position,
    ).toEqual({ latitude: -33.86, longitude: 151.21, accuracyM: 4.5, source: "photo" });
  });

  it("is the photo's own as Android gives it: already signed, with N, S, E, W beside it", () => {
    expect(
      read({
        GPSLatitude: -33.86,
        GPSLatitudeRef: "S",
        GPSLongitude: -70.65,
        GPSLongitudeRef: "W",
      }).position,
    ).toEqual({ latitude: -33.86, longitude: -70.65, accuracyM: null, source: "photo" });
  });

  it("takes the sign of the numbers when the photo gives no N, S, E or W", () => {
    expect(read({ GPSLatitude: 59.64, GPSLongitude: -17.08 }).position).toEqual({
      latitude: 59.64,
      longitude: -17.08,
      accuracyM: null,
      source: "photo",
    });
  });

  it("gives no accuracy when the photo's positioning error is not a number of metres", () => {
    expect(
      read({ GPSLatitude: 59.64, GPSLongitude: 17.08, GPSHPositioningError: "5/1" }).position,
    ).toMatchObject({ accuracyM: null });
    expect(
      read({ GPSLatitude: 59.64, GPSLongitude: 17.08, GPSHPositioningError: -1 }).position,
    ).toMatchObject({ accuracyM: null });
  });

  it.each<[string, Record<string, unknown>]>([
    ["no position", {}],
    ["a latitude only", { GPSLatitude: 59.64 }],
    ["a latitude given as text", { GPSLatitude: "59/1,38/1,0/1", GPSLongitude: 17.08 }],
    ["a latitude past 90", { GPSLatitude: 90.5, GPSLongitude: 17.08 }],
    ["a longitude past 180", { GPSLatitude: 59.64, GPSLongitude: 180.5 }],
    ["a longitude that is not a number", { GPSLatitude: 59.64, GPSLongitude: Number.NaN }],
    [
      "a reference letter it does not know",
      { GPSLatitude: 59.64, GPSLatitudeRef: "X", GPSLongitude: 17.08 },
    ],
    [
      "a reference that is not text",
      { GPSLatitude: 59.64, GPSLongitude: 17.08, GPSLongitudeRef: 1 },
    ],
    [
      "a negative latitude marked north",
      { GPSLatitude: -59.64, GPSLatitudeRef: "N", GPSLongitude: 17.08 },
    ],
    [
      "a negative longitude marked east",
      { GPSLatitude: 59.64, GPSLongitude: -17.08, GPSLongitudeRef: "E" },
    ],
    [
      "0, 0, which a phone that hides the position can leave in its place",
      { GPSLatitude: 0, GPSLatitudeRef: "N", GPSLongitude: 0, GPSLongitudeRef: "E" },
    ],
  ])("is none for %s", (_, exif) => {
    expect(read(exif).position).toBeNull();
  });

  it("keeps a position on the equator or the prime meridian alone", () => {
    expect(read({ GPSLatitude: 0, GPSLongitude: 17.08 }).position).toMatchObject({ latitude: 0 });
    expect(read({ GPSLatitude: 59.64, GPSLongitude: 0 }).position).toMatchObject({ longitude: 0 });
  });
});

describe("metadata that is not there", () => {
  it.each<[string, unknown]>([
    ["no EXIF at all", null],
    ["EXIF that is not an object", "Exif"],
    ["EXIF that is a list", [1, 2]],
  ])("gives no time and no position for %s", (_, exif) => {
    expect(read(exif)).toEqual({ time: null, position: null });
  });
});

describe("phoneTimeAt", () => {
  it("gives the instant whose local time on the phone is the one given, with that offset", () => {
    const parts = { year: 2026, month: 7, day: 4, hour: 9, minute: 30, second: 15 };
    const result = phoneTimeAt(parts);
    expect(result).not.toBeNull();
    const instant = new Date(result?.takenAtMs ?? 0);
    expect([
      instant.getFullYear(),
      instant.getMonth() + 1,
      instant.getDate(),
      instant.getHours(),
      instant.getMinutes(),
      instant.getSeconds(),
    ]).toEqual([2026, 7, 4, 9, 30, 15]);
    expect(result?.utcOffsetMinutes).toBe(-instant.getTimezoneOffset());
  });
});
