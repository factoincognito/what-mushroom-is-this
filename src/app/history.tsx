import { HistoryScreen } from "../history/HistoryScreen";

/**
 * The route of the version history, `/history` (docs/SPEC.md 3.10; PBI-2.24), reached from the
 * link on About, and opened by the app itself after an upgrade. The route reads nothing from its
 * address: opened by an address from outside the app, it is the screen the link opens.
 */
export default function HistoryRoute() {
  return <HistoryScreen />;
}
