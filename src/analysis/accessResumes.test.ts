import { accessResumesAt } from "./accessResumes";

/** An API error body with the message given. */
function errorBody(type: string, message: unknown): string {
  return JSON.stringify({ type: "error", error: { type, message } });
}

describe("accessResumesAt", () => {
  it("reads the time from the spend-cap message the Rate limits page gives as its example", () => {
    const body = errorBody(
      "rate_limit_error",
      "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-09-01 at 00:00 UTC.",
    );
    expect(accessResumesAt(body)).toBe(Date.UTC(2026, 8, 1, 0, 0));
  });

  it("reads the time from the message of a spend limit the user set, in the same form", () => {
    const body = errorBody(
      "invalid_request_error",
      "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 13:45 UTC.",
    );
    expect(accessResumesAt(body)).toBe(Date.UTC(2026, 11, 1, 13, 45));
  });

  it.each([
    [
      "a message with no time",
      errorBody("invalid_request_error", "You have reached your specified API usage limits."),
    ],
    [
      "a time in another form",
      errorBody("rate_limit_error", "You will regain access on 1 September 2026."),
    ],
    [
      "a date that does not exist",
      errorBody("rate_limit_error", "You will regain access on 2026-02-30 at 00:00 UTC."),
    ],
    [
      "an hour that does not exist",
      errorBody("rate_limit_error", "You will regain access on 2026-09-01 at 24:00 UTC."),
    ],
    [
      "a minute that does not exist",
      errorBody("rate_limit_error", "You will regain access on 2026-09-01 at 10:60 UTC."),
    ],
    ["a message that is not text", errorBody("rate_limit_error", 20260901)],
    ["a body that is not JSON", "<html>Sign in to the Wi-Fi</html>"],
    ["a body that is not an error", JSON.stringify({ type: "message" })],
    ["an error that is not an object", JSON.stringify({ type: "error", error: "x" })],
  ])("gives null for %s", (_name, body) => {
    expect(accessResumesAt(body)).toBeNull();
  });
});
