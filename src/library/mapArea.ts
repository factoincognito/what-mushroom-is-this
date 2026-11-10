/**
 * The areas of the Library's map (docs/SPEC.md 3.9, The Library), in degrees: the area it opens
 * on, whether a find lies in the area shown, and the area the map reports after a zoom or pan.
 * It renders nothing.
 *
 * An area is a box given as west, south, east and north, the order of MapLibre's `LngLatBounds`.
 * Its longitudes may run past 180 (the map reports them so when panned around the world); a box
 * given wrapped, with its west above its east, runs east across the 180th meridian.
 */

export type MapBounds = readonly [west: number, south: number, east: number, north: number];

export interface Point {
  readonly latitude: number;
  readonly longitude: number;
}

/** The Earth's mean radius in metres, by which a span on the ground becomes degrees. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** The northernmost latitude the map's Web Mercator projection shows; the south mirrors it. */
export const MAX_MAP_LATITUDE = 85.051_128_779_806_59;

const DEGREES = 180 / Math.PI;

function isCoordinate(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

/**
 * The square around `center` whose sides span `sideM` metres on the ground: north to south along
 * a meridian, and east to west along the parallel through its centre. Fitted into the map's view,
 * its span is that of the view's shorter side (SPEC 3.9: "its shorter side spanning 10 km").
 * Near a pole the square is moved toward the equator, keeping its size, so that it lies within
 * the latitudes the map shows. Its longitudes are not wrapped, so the box stays in one piece
 * across the 180th meridian. A centre or a span that is not a valid one throws a RangeError.
 */
export function squareAround(center: Point, sideM: number): MapBounds {
  if (!isCoordinate(center.latitude, 90) || !isCoordinate(center.longitude, 180)) {
    throw new RangeError("the centre of a map area is not a valid position");
  }
  const halfLatitude = (sideM / 2 / EARTH_RADIUS_M) * DEGREES;
  if (!Number.isFinite(sideM) || sideM <= 0 || halfLatitude >= MAX_MAP_LATITUDE) {
    throw new RangeError("the span of a map area is not a positive span the map can show");
  }
  const limit = MAX_MAP_LATITUDE - halfLatitude;
  const latitude = Math.min(limit, Math.max(-limit, center.latitude));
  const halfLongitude = halfLatitude / Math.cos(latitude / DEGREES);
  return Object.freeze([
    center.longitude - halfLongitude,
    latitude - halfLatitude,
    center.longitude + halfLongitude,
    latitude + halfLatitude,
  ] as const);
}

/** `value` within 0 to 360, for any finite value. */
function turn(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Whether `point` lies in `bounds`, its edges included. A box as wide as the world or wider takes
 * every longitude.
 */
export function isInArea(point: Point, bounds: MapBounds): boolean {
  const [west, south, east, north] = bounds;
  if (point.latitude < south || point.latitude > north) {
    return false;
  }
  const width = east - west;
  if (width >= 360) {
    return true;
  }
  const span = width >= 0 ? width : width + 360;
  return turn(point.longitude - west) <= span;
}

/**
 * The area the map reports, as MapLibre's `LngLatBounds`, checked: four finite numbers, its
 * latitudes within 90 degrees and its south not above its north. Anything else gives null.
 */
export function readViewBounds(raw: unknown): MapBounds | null {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return null;
  }
  const [west, south, east, north] = raw as unknown[];
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number" ||
    !Number.isFinite(west) ||
    !Number.isFinite(east) ||
    !isCoordinate(south, 90) ||
    !isCoordinate(north, 90) ||
    south > north
  ) {
    return null;
  }
  return Object.freeze([west, south, east, north] as const);
}
