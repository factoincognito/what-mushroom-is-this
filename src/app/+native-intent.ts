import { routeOfSystemPath } from "../share/shareAddress";

/**
 * Expo Router's hook for an address that reaches the app from outside it, at its start
 * (`initial`) and while it runs: a share another app sent opens the choice (docs/SPEC.md 3.9,
 * Shared photos; PBI-2.21). This file is no route of its own.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return routeOfSystemPath(path);
}
