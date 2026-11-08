/**
 * Starter example test — keeps CI green on a fresh project.
 * Delete it together with example.ts when you write your first real module and test.
 */
import { add } from "./example";

describe("add", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
