/**
 * App entry point (package.json "main"). It only registers the root component,
 * so it is excluded from the coverage gate. Keep logic out of this file.
 */
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
