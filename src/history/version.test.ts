import { compareVersions, parseVersion, type Version } from "./version";

/** A version the test knows to be one. */
function version(text: string): Version {
  const parsed = parseVersion(text);
  if (parsed === null) {
    throw new Error(`${text} is not a version`);
  }
  return parsed;
}

describe("a version (SPEC 3.10, item 5)", () => {
  it.each(["0.2.1", "1.10.0", "0.0.0", "10.20.30", "0.1.0", "123456789012345678901234567890.0.1"])(
    "is three whole numbers joined by dots: %s",
    (text) => {
      expect(parseVersion(text)).not.toBeNull();
    },
  );

  it("keeps its three numbers as they are written", () => {
    expect(parseVersion("1.10.0")).toEqual({ major: "1", minor: "10", patch: "0" });
  });

  it.each([
    ["a leading zero in the first number", "01.2.3"],
    ["a leading zero in the second number", "0.02.1"],
    ["a leading zero in the third number", "0.2.01"],
    ["two zeros for a number", "00.2.1"],
    ["a v before it", "v0.2.1"],
    ["a capital V before it", "V0.2.1"],
    ["a space before it", " 0.2.1"],
    ["a space after it", "0.2.1 "],
    ["a space inside it", "0.2. 1"],
    ["a line break after it", "0.2.1\n"],
    ["a line break before it", "\n0.2.1"],
    ["a tab after it", "0.2.1\t"],
    ["two numbers", "0.2"],
    ["one number", "2"],
    ["four numbers", "0.2.1.0"],
    ["a prerelease part", "0.2.1-beta"],
    ["a numeric prerelease part", "0.2.1-0"],
    ["a build part", "0.2.1+5"],
    ["a prerelease and a build part", "0.2.1-rc.1+build.5"],
    ["nothing", ""],
    ["dots alone", ".."],
    ["a missing first number", ".2.1"],
    ["a missing last number", "0.2."],
    ["letters", "a.b.c"],
    ["a letter for a number", "0.2.x"],
    ["a minus sign", "-1.0.0"],
    ["a plus sign", "+1.0.0"],
    ["an exponent", "1e3.0.0"],
    ["a hexadecimal number", "0x1.0.0"],
    ["commas for dots", "0,2,1"],
    ["full-width digits", "０.２.１"],
    ["Arabic-Indic digits", "٠.٢.١"],
  ])("refuses %s", (_what, text) => {
    expect(parseVersion(text)).toBeNull();
  });

  it.each([
    ["no value", null],
    ["nothing", undefined],
    ["a number", 21],
    ["a list of numbers", [0, 2, 1]],
    ["an object", { major: "0", minor: "2", patch: "1" }],
    ["a string object", Object("0.2.1")],
  ])("refuses what is not a text: %s", (_what, value) => {
    expect(parseVersion(value)).toBeNull();
  });
});

describe("the comparison of two versions (SPEC 3.10, item 5)", () => {
  it("has 0.9.0 below 0.10.0: the numbers are compared as numbers, not as text", () => {
    expect(compareVersions(version("0.9.0"), version("0.10.0"))).toBeLessThan(0);
    expect(compareVersions(version("0.10.0"), version("0.9.0"))).toBeGreaterThan(0);
  });

  it("has a version equal to itself", () => {
    expect(compareVersions(version("0.2.1"), version("0.2.1"))).toBe(0);
  });

  it.each([
    ["0.2.0", "0.2.1"],
    ["0.1.9", "0.2.0"],
    ["0.9.9", "1.0.0"],
    ["0.2.1", "0.10.0"],
    ["1.0.0", "1.0.10"],
    ["2.0.0", "10.0.0"],
  ])("has %s below %s, and the other way round above", (lower, higher) => {
    expect(compareVersions(version(lower), version(higher))).toBeLessThan(0);
    expect(compareVersions(version(higher), version(lower))).toBeGreaterThan(0);
  });

  it("lets the first difference decide, whatever the numbers after it", () => {
    expect(compareVersions(version("1.0.99"), version("1.1.0"))).toBeLessThan(0);
    expect(compareVersions(version("1.99.99"), version("2.0.0"))).toBeLessThan(0);
    expect(compareVersions(version("2.0.0"), version("1.99.99"))).toBeGreaterThan(0);
  });

  it("compares numbers longer than JavaScript's safe integers, which as JavaScript numbers are equal", () => {
    expect(Number("9007199254740993")).toBe(Number("9007199254740992"));
    const lower = version("0.0.9007199254740992");
    const higher = version("0.0.9007199254740993");
    expect(compareVersions(lower, higher)).toBeLessThan(0);
    expect(compareVersions(higher, lower)).toBeGreaterThan(0);
    expect(compareVersions(higher, version("0.0.9007199254740993"))).toBe(0);
  });

  it("has a longer number above a shorter one, of any length", () => {
    const shorter = version("99999999999999999999999999999.0.0");
    const longer = version("100000000000000000000000000000.0.0");
    expect(compareVersions(shorter, longer)).toBeLessThan(0);
    expect(compareVersions(longer, shorter)).toBeGreaterThan(0);
    expect(compareVersions(version("0.9.0"), version("0.123456789012345678901.0"))).toBeLessThan(0);
  });
});
