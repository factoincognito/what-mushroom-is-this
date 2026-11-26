/**
 * A Jest environment for a test file whose phone is in a time zone west of UTC, where the day is
 * still the one before when it has begun in UTC. A test file asks for it in its first comment
 * (`@jest-environment`). The app does not import this module.
 *
 * Node reads the time zone from the `TZ` variable of its own process, also when it changes while
 * the process runs. A test cannot set it: Jest gives each test file a copy of `process.env`. An
 * environment runs outside that copy, so it sets the variable before the file's tests and puts
 * back what was there after them. Jest runs the files of one worker one after another, so no
 * other file sees the zone.
 */
const ReactNativeEnvironment = require("@react-native/jest-preset/jest/react-native-env.js");

/** Eight hours behind UTC in winter and seven in summer; never ahead of it. */
const WEST_OF_UTC = "America/Los_Angeles";

module.exports = class WestOfUtcEnvironment extends ReactNativeEnvironment {
  async setup() {
    this.zoneBefore = process.env.TZ;
    process.env.TZ = WEST_OF_UTC;
    await super.setup();
  }

  async teardown() {
    if (this.zoneBefore === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = this.zoneBefore;
    }
    await super.teardown();
  }
};
