type AppStart = typeof import("./appStart");

/** The module as a new run of the app loads it: nothing of an earlier load is kept. */
function inANewRun(run: (appStart: AppStart) => void): void {
  jest.isolateModules(() => {
    run(jest.requireActual<AppStart>("./appStart"));
  });
}

describe("the start of the app (SPEC 3.10, item 7: at most once at each start of the app's process)", () => {
  it("is taken once in a run of the app, and never again in that run", () => {
    inANewRun(({ takeAppStart }) => {
      expect(takeAppStart()).toBe(true);
      expect(takeAppStart()).toBe(false);
      expect(takeAppStart()).toBe(false);
    });
  });

  it("is there to take again in a new run of the app", () => {
    inANewRun(({ takeAppStart }) => {
      expect(takeAppStart()).toBe(true);
    });
    inANewRun(({ takeAppStart }) => {
      expect(takeAppStart()).toBe(true);
      expect(takeAppStart()).toBe(false);
    });
  });
});
