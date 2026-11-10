import {
  EARTH_RADIUS_M,
  isInArea,
  type MapBounds,
  MAX_MAP_LATITUDE,
  readViewBounds,
  squareAround,
} from "./mapArea";

/** The great-circle distance between two points, in metres (the haversine formula). */
function distanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** The east-west and north-south extent of a box through its middle, in metres. */
function sides(bounds: MapBounds): { eastWest: number; northSouth: number } {
  const [west, south, east, north] = bounds;
  const middle = (south + north) / 2;
  return {
    eastWest: distanceM({ latitude: middle, longitude: west }, { latitude: middle, longitude: east }),
    northSouth: distanceM({ latitude: south, longitude: west }, { latitude: north, longitude: west }),
  };
}

describe("squareAround: the area the map opens on (SPEC 3.9: its shorter side spans 10 km)", () => {
  it.each<[string, number, number]>([
    ["at Enköping's latitude", 59.64, 17.08],
    ["on the equator", 0, 0],
    ["in the south", -33.9, 18.4],
    ["far north", 69.65, 18.96],
  ])("is 10 km east to west and north to south, %s", (_where, latitude, longitude) => {
    const { eastWest, northSouth } = sides(squareAround({ latitude, longitude }, 10_000));
    expect(Math.abs(eastWest - 10_000)).toBeLessThan(1);
    expect(Math.abs(northSouth - 10_000)).toBeLessThan(1);
  });

  it("has its centre at the point it is around", () => {
    const [west, south, east, north] = squareAround({ latitude: 59.64, longitude: 17.08 }, 10_000);
    expect((west + east) / 2).toBeCloseTo(17.08, 10);
    expect((south + north) / 2).toBeCloseTo(59.64, 10);
  });

  it("follows the span it is given", () => {
    const { northSouth } = sides(squareAround({ latitude: 10, longitude: 10 }, 2_000));
    expect(Math.abs(northSouth - 2_000)).toBeLessThan(1);
  });

  it("stays within the latitudes the map can show near a pole, keeping its size", () => {
    const bounds = squareAround({ latitude: 89.9, longitude: 0 }, 10_000);
    const [, south, , north] = bounds;
    expect(north).toBeCloseTo(MAX_MAP_LATITUDE, 10);
    expect(south).toBeLessThan(north);
    expect(Math.abs(sides(bounds).northSouth - 10_000)).toBeLessThan(1);
    const [, southern] = squareAround({ latitude: -89.9, longitude: 0 }, 10_000);
    expect(southern).toBeCloseTo(-MAX_MAP_LATITUDE, 10);
  });

  it("runs on past the 180th meridian without wrapping, so the box stays in one piece", () => {
    const [west, , east] = squareAround({ latitude: 0, longitude: 179.99 }, 10_000);
    expect(west).toBeLessThan(179.99);
    expect(east).toBeGreaterThan(180);
  });

  it.each<[string, number, number, number]>([
    ["a latitude past 90", 90.5, 0, 10_000],
    ["a longitude past 180", 0, 180.5, 10_000],
    ["a latitude that is not a number", Number.NaN, 0, 10_000],
    ["a longitude that is infinite", 0, Number.POSITIVE_INFINITY, 10_000],
    ["a span of zero", 0, 0, 0],
    ["a negative span", 0, 0, -10],
    ["a span that is not a number", 0, 0, Number.NaN],
    ["a span too wide for the map's latitudes", 0, 0, 20_000_000],
  ])("refuses %s with a RangeError", (_name, latitude, longitude, sideM) => {
    expect(() => squareAround({ latitude, longitude }, sideM)).toThrow(RangeError);
  });
});

describe("isInArea: whether a find lies in the area the map shows", () => {
  const area: MapBounds = [17.0, 59.6, 17.2, 59.7];

  it("takes a point inside", () => {
    expect(isInArea({ latitude: 59.65, longitude: 17.1 }, area)).toBe(true);
  });

  it("takes a point on the edge and on a corner", () => {
    expect(isInArea({ latitude: 59.6, longitude: 17.1 }, area)).toBe(true);
    expect(isInArea({ latitude: 59.7, longitude: 17.2 }, area)).toBe(true);
  });

  it.each<[string, number, number]>([
    ["north of it", 59.71, 17.1],
    ["south of it", 59.59, 17.1],
    ["east of it", 59.65, 17.21],
    ["west of it", 59.65, 16.99],
    ["on the other side of the earth", -59.65, -162.9],
  ])("leaves out a point %s", (_where, latitude, longitude) => {
    expect(isInArea({ latitude, longitude }, area)).toBe(false);
  });

  it("takes a point across the 180th meridian, for a box that runs past it unwrapped", () => {
    const across: MapBounds = [179.9, -1, 180.1, 1];
    expect(isInArea({ latitude: 0, longitude: -179.95 }, across)).toBe(true);
    expect(isInArea({ latitude: 0, longitude: 179.95 }, across)).toBe(true);
    expect(isInArea({ latitude: 0, longitude: -179.8 }, across)).toBe(false);
  });

  it("takes a point across the 180th meridian, for a box given wrapped, west above east", () => {
    const across: MapBounds = [179.9, -1, -179.9, 1];
    expect(isInArea({ latitude: 0, longitude: -179.95 }, across)).toBe(true);
    expect(isInArea({ latitude: 0, longitude: 179.95 }, across)).toBe(true);
    expect(isInArea({ latitude: 0, longitude: 0 }, across)).toBe(false);
  });

  it("takes every longitude when the map shows the whole world's width or more", () => {
    const world: MapBounds = [-200, -60, 200, 60];
    expect(isInArea({ latitude: 0, longitude: 179 }, world)).toBe(true);
    expect(isInArea({ latitude: 0, longitude: -179 }, world)).toBe(true);
    expect(isInArea({ latitude: 61, longitude: 0 }, world)).toBe(false);
  });

  it("takes a box panned a whole turn around the world as the same box", () => {
    const panned: MapBounds = [377.0, 59.6, 377.2, 59.7];
    expect(isInArea({ latitude: 59.65, longitude: 17.1 }, panned)).toBe(true);
    expect(isInArea({ latitude: 59.65, longitude: 18 }, panned)).toBe(false);
  });
});

describe("readViewBounds: the area the map reports after a zoom or pan, checked", () => {
  it("reads west, south, east and north", () => {
    expect(readViewBounds([17.0, 59.6, 17.2, 59.7])).toEqual([17.0, 59.6, 17.2, 59.7]);
  });

  it("reads longitudes past 180, which a map panned around the world reports", () => {
    expect(readViewBounds([179.9, -1, 180.1, 1])).toEqual([179.9, -1, 180.1, 1]);
  });

  it("gives a frozen box", () => {
    expect(Object.isFrozen(readViewBounds([17.0, 59.6, 17.2, 59.7]))).toBe(true);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["an object", { west: 1, south: 2, east: 3, north: 4 }],
    ["three numbers", [1, 2, 3]],
    ["five numbers", [1, 2, 3, 4, 5]],
    ["a string among them", [1, "2", 3, 4]],
    ["a value that is not a number", [1, Number.NaN, 3, 4]],
    ["an infinite longitude", [Number.NEGATIVE_INFINITY, 2, 3, 4]],
    ["a latitude past 90", [1, 2, 3, 90.5]],
    ["a south above the north", [1, 10, 3, 5]],
  ])("refuses %s", (_name, raw) => {
    expect(readViewBounds(raw)).toBeNull();
  });
});
