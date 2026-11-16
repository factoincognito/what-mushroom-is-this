import { ShareScreen } from "../share/ShareScreen";

/**
 * The route of the choice a share of photos opens, `/share` (docs/SPEC.md 3.9, Shared photos;
 * PBI-2.21). The router sends the library's share address here (`+native-intent.ts`). The route
 * reads nothing from its address: the photos are those the library hands over.
 */
export default function ShareRoute() {
  return <ShareScreen />;
}
