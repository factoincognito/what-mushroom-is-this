import { isRecord } from "./answer";

/**
 * The time access resumes, as a spend limit's error message states it (docs/SPEC.md 3.3, the 429
 * and the spend-limit rows). The Claude docs page "Rate limits",
 * https://platform.claude.com/docs/en/api/rate-limits, read 2026-11-09 through
 * https://platform.claude.com/docs/en/api/rate-limits.md: the spend cap's 429 has no `retry-after`
 * and its message ends "You will regain access on 2026-09-01 at 00:00 UTC."; the 400 of a spend
 * limit the user set "states when access resumes", in a form the page does not show. This reads the
 * one form the page shows. It is for the message only: the queue still waits for the user
 * (SPEC 3.3, "as 429 without `retry-after`").
 */

const RESUMES = /\bon (\d{4})-(\d{2})-(\d{2}) at (\d{2}):(\d{2}) UTC\b/;

/** The time in ms since the epoch, or null when the body is no error message stating one. */
export function accessResumesAt(body: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.error) || typeof parsed.error.message !== "string") {
    return null;
  }
  const match = RESUMES.exec(parsed.error.message);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const at = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(at);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return at;
}
