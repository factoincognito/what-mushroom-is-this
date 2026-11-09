/**
 * The router's first load, paid before a test file's tests (PBI-1.28).
 *
 * The first render of the router in a test file loads the app: expo-router's test renderer
 * requires every route under `src/app/`, and with them the screens' modules and the navigation
 * libraries, and Jest first transforms each one its cache does not hold (a fresh clone, a changed
 * file). On a 2-CPU machine with a cold cache that took 4 to 9 s, inside whichever test ran first,
 * against Jest's 5 s for a test; every later render took well under 1 s.
 */
import { cleanup } from "expo-router/testing-library";

/** The time the first opening of the router in a test file may take. */
export const FIRST_LOAD_TIMEOUT_MS = 120_000;

/**
 * Opens the router once before the file's tests, under `FIRST_LOAD_TIMEOUT_MS`, so that each test
 * keeps Jest's 5 s. `open` sets the stand-ins the file's tests use and opens a screen as they do;
 * the tree it leaves is removed, as after each test, so nothing of it reaches the first test.
 */
export function warmUpRouter(open: () => Promise<unknown>): void {
  beforeAll(async () => {
    await open();
    await cleanup();
  }, FIRST_LOAD_TIMEOUT_MS);
}
