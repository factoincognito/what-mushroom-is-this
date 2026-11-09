import { AboutView } from "../about/AboutView";
import { NOTICES } from "../about/notices";

/** The About screen (docs/SPEC.md 3.1), reached from Settings. */
export default function AboutScreen() {
  return <AboutView notices={NOTICES} />;
}
