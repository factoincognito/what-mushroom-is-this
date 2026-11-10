import type { PermissionAsker } from "../newFind/permissions";
import type { LocationSource } from "../position/positionTracker";
import type { ListedFind, Position } from "../store/find";
import { type MapBounds, squareAround } from "./mapArea";
import { type OpeningLimits, startOpening } from "./mapOpening";

const NOW = Date.UTC(2026, 8, 1, 10, 0);
const DEFAULT_AREA: MapBounds = [10.9, 55.3, 24.2, 69.1];
const LIMITS: OpeningLimits = {
  fixWaitMs: 5_000,
  lastKnownMaxAgeMs: 120_000,
  sideM: 10_000,
  defaultArea: DEFAULT_AREA,
};

/** A reading as expo-location gives it. */
function reading(latitude: number, longitude: number, timestamp = NOW) {
  return { coords: { latitude, longitude, accuracy: 5 }, timestamp };
}

type Answer = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

/** A permission that answers `current`, and `asked` when it is requested. */
function permission(current: Answer, asked: Answer = current) {
  return {
    get: jest.fn(async () => current),
    request: jest.fn(async () => asked),
  } satisfies PermissionAsker;
}

const GRANTED: Answer = { status: "granted", canAskAgain: true };
const UNDETERMINED: Answer = { status: "undetermined", canAskAgain: true };
const DENIED: Answer = { status: "denied", canAskAgain: true };
const BLOCKED: Answer = { status: "denied", canAskAgain: false };

/** The phone's location service; `emit` sends a reading to the watch. */
function location(lastKnown: unknown = null) {
  let onFix: ((reading: unknown) => void) | null = null;
  const stop = jest.fn();
  const source = {
    watch: jest.fn(async (callback: (reading: unknown) => void) => {
      onFix = callback;
      return stop;
    }),
    lastKnown: jest.fn(async (_maxAgeMs: number) => lastKnown),
  } satisfies LocationSource;
  return {
    source,
    stop,
    emit: (raw: unknown) => onFix?.(raw),
  };
}

function find(id: number, position: Position | null): ListedFind {
  return {
    readable: true,
    id,
    photoUri: null,
    time: { takenAtMs: NOW, utcOffsetMinutes: 60, source: "saved" },
    position,
    analysis: { state: "waiting" },
    selfCheck: null,
    species: null,
  };
}

const AT_FIND: Position = { latitude: 59.7, longitude: 17.2, accuracyM: 10, source: "fix" };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the phone's position for the map (SPEC 3.9)", () => {
  it("opens on a fix that comes within 5 seconds, its shorter side spanning 10 km, and stops watching", async () => {
    const phone = location();
    const opening = startOpening(
      { permission: permission(GRANTED), location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(4_900);
    phone.emit(reading(59.64, 17.08));
    await expect(opening.area).resolves.toEqual({
      from: "fix",
      bounds: squareAround({ latitude: 59.64, longitude: 17.08 }, 10_000),
    });
    expect(phone.stop).toHaveBeenCalled();
    expect(phone.source.lastKnown).not.toHaveBeenCalled();
  });

  it("does not wait for a fix past 5 seconds: it takes the last known position no older than two minutes", async () => {
    const phone = location(reading(59.5, 17.0, NOW - 119_000));
    const opening = startOpening(
      { permission: permission(GRANTED), location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(4_999);
    expect(phone.source.lastKnown).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(opening.area).resolves.toEqual({
      from: "last-known",
      bounds: squareAround({ latitude: 59.5, longitude: 17.0 }, 10_000),
    });
    expect(phone.source.lastKnown).toHaveBeenCalledWith(120_000);
    expect(phone.stop).toHaveBeenCalled();
  });

  it("ignores a fix that comes after the 5 seconds", async () => {
    const phone = location(null);
    const opening = startOpening(
      {
        permission: permission(GRANTED),
        location: phone.source,
        now: () => NOW,
        entries: [find(1, AT_FIND)],
      },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    phone.emit(reading(1, 1));
    await expect(opening.area).resolves.toMatchObject({ from: "find" });
  });

  it("ignores a reading that is not a valid fix, and goes on to the last known position", async () => {
    const phone = location(reading(59.5, 17.0, NOW - 1_000));
    const opening = startOpening(
      { permission: permission(GRANTED), location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(100);
    phone.emit({ coords: { latitude: 200, longitude: 17 } });
    phone.emit("not a reading");
    await jest.advanceTimersByTimeAsync(4_900);
    await expect(opening.area).resolves.toMatchObject({ from: "last-known" });
  });

  it("does not take a last known position older than two minutes", async () => {
    const phone = location(reading(59.5, 17.0, NOW - 121_000));
    const opening = startOpening(
      {
        permission: permission(GRANTED),
        location: phone.source,
        now: () => NOW,
        entries: [find(1, AT_FIND)],
      },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(opening.area).resolves.toMatchObject({ from: "find" });
  });

  it("takes the limits from the configuration when none are given", async () => {
    const phone = location(reading(59.5, 17.0, NOW - 60_000));
    const opening = startOpening({
      permission: permission(GRANTED),
      location: phone.source,
      now: () => NOW,
      entries: [],
    });
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(opening.area).resolves.toEqual({
      from: "last-known",
      bounds: squareAround({ latitude: 59.5, longitude: 17.0 }, 10_000),
    });
    expect(phone.source.lastKnown).toHaveBeenCalledWith(120_000);
  });
});

describe("the location permission when the map opens (SPEC 3.9)", () => {
  it("asks for it when the app has not yet asked, then watches the position", async () => {
    const asker = permission(UNDETERMINED, GRANTED);
    const phone = location();
    const opening = startOpening(
      { permission: asker, location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(10);
    expect(asker.request).toHaveBeenCalledTimes(1);
    expect(phone.source.watch).toHaveBeenCalledTimes(1);
    phone.emit(reading(59.64, 17.08));
    await expect(opening.area).resolves.toMatchObject({ from: "fix" });
  });

  it("does not ask when it is already granted", async () => {
    const asker = permission(GRANTED);
    const phone = location();
    const opening = startOpening(
      { permission: asker, location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await opening.area;
    expect(asker.request).not.toHaveBeenCalled();
  });

  it.each<[string, Answer]>([
    ["refused before", DENIED],
    ["refused for good", BLOCKED],
  ])(
    "does not ask again when the user %s, watches nothing and opens on the newest find at once",
    async (_name, answer) => {
      const asker = permission(answer);
      const phone = location(reading(1, 1));
      const opening = startOpening(
        {
          permission: asker,
          location: phone.source,
          now: () => NOW,
          entries: [find(2, null), find(1, AT_FIND)],
        },
        LIMITS,
      );
      await expect(opening.area).resolves.toEqual({
        from: "find",
        bounds: squareAround(AT_FIND, 10_000),
      });
      expect(asker.request).not.toHaveBeenCalled();
      expect(phone.source.watch).not.toHaveBeenCalled();
      expect(phone.source.lastKnown).not.toHaveBeenCalled();
    },
  );

  it("goes on to the fallbacks when the user refuses when asked", async () => {
    const asker = permission(UNDETERMINED, DENIED);
    const phone = location();
    const opening = startOpening(
      { permission: asker, location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await expect(opening.area).resolves.toEqual({ from: "default", bounds: DEFAULT_AREA });
    expect(phone.source.watch).not.toHaveBeenCalled();
  });

  it("counts a permission answer it cannot read as not granted", async () => {
    const asker = { get: jest.fn(async () => ({ status: "maybe" })), request: jest.fn() };
    const phone = location();
    const opening = startOpening(
      { permission: asker, location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await expect(opening.area).resolves.toMatchObject({ from: "default" });
    expect(phone.source.watch).not.toHaveBeenCalled();
  });

  it("counts a permission check that fails as not granted", async () => {
    const asker = {
      get: jest.fn(async () => {
        throw new Error("no location service");
      }),
      request: jest.fn(),
    };
    const phone = location();
    const opening = startOpening(
      { permission: asker, location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await expect(opening.area).resolves.toMatchObject({ from: "default" });
  });
});

describe("the fallbacks without the phone's position (SPEC 3.9)", () => {
  it("opens on the newest find with a position, at the same scale", async () => {
    const phone = location(null);
    const opening = startOpening(
      {
        permission: permission(GRANTED),
        location: phone.source,
        now: () => NOW,
        entries: [{ readable: false, id: 9 }, find(3, null), find(2, AT_FIND), find(1, null)],
      },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(opening.area).resolves.toEqual({
      from: "find",
      bounds: squareAround(AT_FIND, 10_000),
    });
  });

  it("opens on the default area when no find has a position", async () => {
    const phone = location(null);
    const opening = startOpening(
      {
        permission: permission(GRANTED),
        location: phone.source,
        now: () => NOW,
        entries: [find(1, null)],
      },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(opening.area).resolves.toEqual({ from: "default", bounds: DEFAULT_AREA });
  });

  it("opens on the default area when the newest find's position cannot hold an area, which only a damaged file gives", async () => {
    const opening = startOpening(
      {
        permission: permission(DENIED),
        location: location().source,
        now: () => NOW,
        entries: [find(1, { ...AT_FIND, latitude: 95 })],
      },
      LIMITS,
    );
    await expect(opening.area).resolves.toEqual({ from: "default", bounds: DEFAULT_AREA });
  });

  it("goes on to the last known position when watching cannot start, without waiting 5 seconds", async () => {
    const phone = location(reading(59.5, 17.0, NOW - 1_000));
    phone.source.watch.mockRejectedValueOnce(new Error("location off"));
    const opening = startOpening(
      { permission: permission(GRANTED), location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(10);
    await expect(opening.area).resolves.toMatchObject({ from: "last-known" });
  });

  it("goes on to the newest find when the last known position cannot be read", async () => {
    const phone = location();
    phone.source.lastKnown.mockRejectedValueOnce(new Error("location off"));
    const opening = startOpening(
      {
        permission: permission(GRANTED),
        location: phone.source,
        now: () => NOW,
        entries: [find(1, AT_FIND)],
      },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(opening.area).resolves.toMatchObject({ from: "find" });
  });
});

describe("cancelling the opening, when the map is left before it opens", () => {
  it("stops watching the position at once", async () => {
    const phone = location();
    const opening = startOpening(
      { permission: permission(GRANTED), location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(1_000);
    opening.cancel();
    expect(phone.stop).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(opening.area).resolves.toBeDefined();
    expect(phone.source.lastKnown).not.toHaveBeenCalled();
  });

  it("starts no watch when cancelled while the permission is being asked for", async () => {
    let answer: (value: Answer) => void = () => {};
    const asker = {
      get: jest.fn(async () => UNDETERMINED),
      request: jest.fn(() => new Promise<Answer>((resolve) => (answer = resolve))),
    };
    const phone = location();
    const opening = startOpening(
      { permission: asker, location: phone.source, now: () => NOW, entries: [] },
      LIMITS,
    );
    await jest.advanceTimersByTimeAsync(10);
    opening.cancel();
    answer(GRANTED);
    await opening.area;
    expect(phone.source.watch).not.toHaveBeenCalled();
  });
});
