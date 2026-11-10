/**
 * The app's own User-Agent on the requests of the Library's map (docs/SPEC.md 3.9): the app's
 * name and version, and the repository's address as the contact, in the form Wikimedia's policy
 * asks of the app's other requests (`<client>/<version> (<contact>)`, SPEC Known unknown 15). It is
 * set through MapLibre React Native's request transforms, which replace the header on Android
 * (OkHttp's `header`, in the library's `TransformRequestInterceptor.kt`) and set it on iOS (not
 * checked). It renders nothing.
 */

import type { HeaderOptions } from "@maplibre/maplibre-react-native";

import { config } from "../config/config";

/** The ID of the header's transform, so that setting it again replaces it in place. */
export const MAP_USER_AGENT_ID = "user-agent";

/** A product token of HTTP (RFC 9110, 5.6.2): printable ASCII without spaces or delimiters. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function tokenOf(fields: object, key: "name" | "version"): string | null {
  const value: unknown = key in fields ? (fields as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

/**
 * The User-Agent, from the app's config (app.json's `expo`): its name and version. Null when
 * either is missing or cannot stand in a product token, so that the library's own stays.
 */
export function mapUserAgent(expoConfig: unknown): string | null {
  if (typeof expoConfig !== "object" || expoConfig === null) {
    return null;
  }
  const name = tokenOf(expoConfig, "name");
  const version = tokenOf(expoConfig, "version");
  if (name === null || version === null) {
    return null;
  }
  return `${name}/${version} (${config.mapUserAgentContact})`;
}

/** MapLibre React Native's request transforms, as this module uses them. */
export interface HeaderSetter {
  addHeader(options: HeaderOptions): string;
}

/**
 * Sets the User-Agent on every request of the map: its style, tiles, glyphs and sprites. Gives
 * whether it was set; a library that refuses it leaves the library's own, and the map still opens.
 */
export function setMapUserAgent(manager: HeaderSetter, expoConfig: unknown): boolean {
  const value = mapUserAgent(expoConfig);
  if (value === null) {
    return false;
  }
  try {
    manager.addHeader({ id: MAP_USER_AGENT_ID, name: "User-Agent", value });
    return true;
  } catch {
    return false;
  }
}
