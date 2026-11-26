/**
 * A version of the app and the comparison of two (docs/SPEC.md 3.10, item 5). It renders nothing.
 *
 * A version is three whole numbers joined by dots, each written without a leading zero (`0.2.1`,
 * `1.10.0`), and nothing else: no `v`, no space, no prerelease or build part. That is the part of
 * SemVer 2.0.0 the app's versions have used.
 */

/** A version's three numbers, each as its digits: a number may be longer than a safe integer. */
export type Version = {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
};

/** A whole number without a leading zero, in the digits 0 to 9 only, and nothing around it. */
const NUMBER = /^(?:0|[1-9][0-9]*)$/;

/** The version a text writes, or null for anything that is not a version, a text or not. */
export function parseVersion(text: unknown): Version | null {
  if (typeof text !== "string") {
    return null;
  }
  const numbers = text.split(".");
  if (numbers.length !== 3 || !numbers.every((number) => NUMBER.test(number))) {
    return null;
  }
  const [major, minor, patch] = numbers as [string, string, string];
  return { major, minor, patch };
}

/**
 * Two whole numbers, as their digits without a leading zero: the longer is the higher, and of two
 * of one length the one with the higher digit at the first place where they differ, which is the
 * order of their texts. No number is made of the digits, so their length has no limit.
 */
function compareNumbers(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Below zero when `a` is the lower version, above zero when it is the higher, and zero when the
 * two are the same: they are compared number by number, and the first difference decides.
 */
export function compareVersions(a: Version, b: Version): number {
  return (
    compareNumbers(a.major, b.major) ||
    compareNumbers(a.minor, b.minor) ||
    compareNumbers(a.patch, b.patch)
  );
}
