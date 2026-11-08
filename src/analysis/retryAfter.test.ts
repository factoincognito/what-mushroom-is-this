import { parseRetryAfter } from "./retryAfter";

const receivedAt = Date.UTC(2026, 10, 8, 12, 0, 0);

describe("parseRetryAfter, seconds", () => {
  it.each([
    ["0", 0],
    ["1", 1_000],
    ["120", 120_000],
    [" 30 ", 30_000],
  ])("reads %j as that many seconds after the answer", (value, offsetMs) => {
    expect(parseRetryAfter(value, receivedAt)).toBe(receivedAt + offsetMs);
  });

  it("has no upper bound", () => {
    const oneYear = 365 * 24 * 60 * 60;
    expect(parseRetryAfter(String(oneYear), receivedAt)).toBe(receivedAt + oneYear * 1_000);
  });

  it("treats a number too large to be a time as missing", () => {
    expect(parseRetryAfter("9".repeat(400), receivedAt)).toBeNull();
  });
});

describe("parseRetryAfter, HTTP date", () => {
  it("reads an IMF-fixdate", () => {
    expect(parseRetryAfter("Sun, 06 Nov 1994 08:49:37 GMT", receivedAt)).toBe(
      Date.UTC(1994, 10, 6, 8, 49, 37),
    );
  });

  it("reads a date after the answer", () => {
    expect(parseRetryAfter("Sun, 08 Nov 2026 12:05:00 GMT", receivedAt)).toBe(
      receivedAt + 5 * 60 * 1_000,
    );
  });

  it.each([
    ["a day that does not exist", "Sat, 31 Feb 2026 08:00:00 GMT"],
    ["a weekday that does not match the date", "Mon, 08 Nov 2026 12:00:00 GMT"],
    ["an hour out of range", "Sun, 08 Nov 2026 24:00:00 GMT"],
    ["a minute out of range", "Sun, 08 Nov 2026 12:60:00 GMT"],
    ["a second out of range", "Sun, 08 Nov 2026 12:00:61 GMT"],
    ["a zone other than GMT", "Sun, 08 Nov 2026 12:00:00 UTC"],
    ["an unknown month", "Sun, 08 Foo 2026 12:00:00 GMT"],
    ["the obsolete RFC 850 form", "Sunday, 08-Nov-26 12:00:00 GMT"],
    ["the obsolete asctime form", "Sun Nov  8 12:00:00 2026"],
    ["an ISO 8601 date", "2026-11-08T12:00:00Z"],
  ])("treats %s as missing", (_label, value) => {
    expect(parseRetryAfter(value, receivedAt)).toBeNull();
  });
});

describe("parseRetryAfter, neither", () => {
  it.each([
    ["no header", null],
    ["an empty value", ""],
    ["blanks only", "   "],
    ["a fraction", "1.5"],
    ["a negative number", "-5"],
    ["a signed number", "+5"],
    ["an exponent", "1e3"],
    ["a hexadecimal number", "0x10"],
    ["words", "soon"],
    ["seconds with a unit", "30s"],
  ])("treats %s as missing", (_label, value) => {
    expect(parseRetryAfter(value, receivedAt)).toBeNull();
  });
});
