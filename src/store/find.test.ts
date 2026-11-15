/**
 * A photo's failure that names the photo by its number (docs/SPEC.md 3.9, Batches; PBI-2.16), as
 * `numberedPhotoFailure` reads it: the form the queue writes, and nothing else.
 */

import { FAILURE_CAUSES, type FindFailure, numberedPhotoFailure } from "./find";

describe("numberedPhotoFailure (PBI-2.16)", () => {
  it.each([
    ["photo", "photo 2: load-failed", "2", "load-failed"],
    ["photo", "photo 5: invalid-size: 0 x 0", "5", "invalid-size: 0 x 0"],
    ["segment-check", "photo 3: forbidden-segment 0xFFE1", "3", "forbidden-segment 0xFFE1"],
    ["segment-check", "photo 1: trailing-data", "1", "trailing-data"],
    // The number is every digit up to the colon, and the detail everything after ": ".
    ["photo", "photo 12: load-failed", "12", "load-failed"],
    ["photo", "photo 10: x", "10", "x"],
    [
      "photo",
      "photo 2: load-failed: Could not load: file:///p.jpg",
      "2",
      "load-failed: Could not load: file:///p.jpg",
    ],
    ["photo", "photo 1: : x", "1", ": x"],
    ["photo", "photo 1: photo 2: x", "1", "photo 2: x"],
    // A detail of several lines, as a native message may be.
    ["photo", "photo 2: load-failed: a\nb", "2", "load-failed: a\nb"],
    ["photo", "photo 2: \n", "2", "\n"],
    ["photo", "photo 1:  ", "1", " "],
  ] as const)(
    "reads the %s failure %j as photo %s with the detail %j",
    (cause, detail, number, rest) => {
      expect(numberedPhotoFailure({ cause, detail })).toEqual({
        number,
        unnumbered: { cause, detail: rest },
      });
    },
  );

  it.each([
    "load-failed",
    "photo",
    "photo 1",
    "photo 1:",
    "photo 1: ",
    "photo 1:x",
    "photo 0: x",
    "photo 01: x",
    "photo x: y",
    "photo 1a: x",
    "photo 1 : x",
    "photo  1: x",
    "photo -1: x",
    "photo 1.5: x",
    "Photo 1: x",
    " photo 1: x",
    "aphoto 1: x",
    "photo 2:\n x",
    // Digits that are not 0 to 9.
    "photo 1٢: x",
    "photo １: x",
  ])("reads the photo failure %j as naming no photo", (detail) => {
    expect(numberedPhotoFailure({ cause: "photo", detail })).toBeNull();
    expect(numberedPhotoFailure({ cause: "segment-check", detail })).toBeNull();
  });

  it("reads a number only on the causes that are about a photo", () => {
    const about = FAILURE_CAUSES.filter(
      (cause) => numberedPhotoFailure({ cause, detail: "photo 2: load-failed" }) !== null,
    );
    expect(about).toEqual(["segment-check", "photo"]);
  });

  it("leaves the failure it was given as it was", () => {
    const failure: FindFailure = { cause: "photo", detail: "photo 2: load-failed" };
    const read = numberedPhotoFailure(failure);
    expect(failure).toEqual({ cause: "photo", detail: "photo 2: load-failed" });
    expect(read?.unnumbered).not.toBe(failure);
  });
});
