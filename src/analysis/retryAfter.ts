/**
 * The `retry-after` header of a 429 answer (docs/SPEC.md 3.3): a number of
 * seconds, or an HTTP date in the IMF-fixdate form that senders generate
 * (RFC 9110 § 5.6.7), such as `Sun, 06 Nov 1994 08:49:37 GMT`. Any other value
 * is treated as missing.
 */

const SECONDS = /^\d+$/;
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The time, in milliseconds since the epoch, from which a request may be sent
 * again, or null when the value is missing or neither seconds nor a date.
 * `receivedAtMs` is when the answer came; seconds count from then.
 */
export function parseRetryAfter(value: string | null, receivedAtMs: number): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (SECONDS.test(trimmed)) {
    const at = receivedAtMs + Number(trimmed) * 1_000;
    return Number.isFinite(at) ? at : null;
  }
  return parseImfFixdate(trimmed);
}

function parseImfFixdate(value: string): number | null {
  const match = IMF_FIXDATE.exec(value);
  if (match === null) {
    return null;
  }
  const [, weekday, day, monthName, year, hour, minute, second] = match;
  if (
    weekday === undefined ||
    day === undefined ||
    monthName === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  const month = MONTHS.indexOf(monthName);
  const parts = {
    year: Number(year),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    return null;
  }
  const at = Date.UTC(parts.year, month, parts.day, parts.hour, parts.minute, parts.second);
  const date = new Date(at);
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== parts.day ||
    WEEKDAYS[date.getUTCDay()] !== weekday
  ) {
    return null;
  }
  return at;
}
