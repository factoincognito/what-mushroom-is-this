import { type LocationSource, startPositionTracker } from "./positionTracker";

const NOW = 1_762_600_000_000;
const OPTIONS = { lastKnownMaxAgeMs: 120_000, fixWaitMs: 30_000, now: () => NOW };

/** A location reading as expo-location gives it. */
function reading(latitude: number, longitude: number, accuracy: number | null, timestamp = NOW) {
  return { coords: { latitude, longitude, accuracy, altitude: null }, timestamp };
}

/** Stands in for the phone's location service: fixes are sent by the test. */
class FakeLocation implements LocationSource {
  onFix: ((fix: unknown) => void) | null = null;
  stopped = 0;
  watchError: Error | null = null;
  lastKnownReply: unknown = null;
  lastKnownError: Error | null = null;
  lastKnownAsked: number[] = [];
  private release: (() => void) | null = null;
  private pending: Promise<void> | null = null;

  /** Makes the next watch wait until `startWatching` is called. */
  holdWatch(): void {
    this.pending = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  startWatching(): void {
    this.release?.();
  }

  async watch(onFix: (fix: unknown) => void): Promise<() => void> {
    if (this.pending !== null) {
      await this.pending;
    }
    if (this.watchError !== null) {
      throw this.watchError;
    }
    this.onFix = onFix;
    return () => {
      this.stopped += 1;
      this.onFix = null;
    };
  }

  async lastKnown(maxAgeMs: number): Promise<unknown> {
    this.lastKnownAsked.push(maxAgeMs);
    if (this.lastKnownError !== null) {
      throw this.lastKnownError;
    }
    return this.lastKnownReply;
  }

  send(fix: unknown): void {
    this.onFix?.(fix);
  }
}

/** Lets the promises queued so far run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

let location: FakeLocation;

beforeEach(() => {
  location = new FakeLocation();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("positionNow", () => {
  it("gives the most accurate fix that has come, as a fix", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    location.send(reading(59.1, 17.1, 30));
    location.send(reading(59.2, 17.2, 5));
    location.send(reading(59.3, 17.3, 12));
    await expect(tracker.positionNow()).resolves.toEqual({
      latitude: 59.2,
      longitude: 17.2,
      accuracyM: 5,
      source: "fix",
    });
    expect(location.lastKnownAsked).toEqual([]);
  });

  it("takes the later of two equally accurate fixes", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    location.send(reading(59.1, 17.1, 10));
    location.send(reading(59.2, 17.2, 10));
    await expect(tracker.positionNow()).resolves.toMatchObject({ latitude: 59.2 });
  });

  it("ranks a fix without an accuracy below every fix with one", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    location.send(reading(59.1, 17.1, 500));
    location.send(reading(59.2, 17.2, null));
    await expect(tracker.positionNow()).resolves.toMatchObject({ latitude: 59.1, accuracyM: 500 });
  });

  it("keeps a fix without an accuracy when it is the only one", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    location.send(reading(59.2, 17.2, null));
    await expect(tracker.positionNow()).resolves.toEqual({
      latitude: 59.2,
      longitude: 17.2,
      accuracyM: null,
      source: "fix",
    });
  });

  it.each<[string, unknown]>([
    ["no reading at all", null],
    ["a reading without coordinates", { timestamp: NOW }],
    ["a latitude past 90", reading(90.5, 17, 5)],
    ["a longitude before -180", reading(59, -180.5, 5)],
    ["a latitude that is not a number", reading(Number.NaN, 17, 5)],
    ["a latitude given as text", { coords: { latitude: "59", longitude: 17, accuracy: 5 } }],
    ["a negative accuracy", reading(59, 17, -1)],
    ["an infinite accuracy", reading(59, 17, Number.POSITIVE_INFINITY)],
    ["an accuracy given as text", { coords: { latitude: 59, longitude: 17, accuracy: "5" } }],
  ])("ignores %s", async (_, fix) => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    location.send(fix);
    await expect(tracker.positionNow()).resolves.toBeNull();
  });

  it("without a fix, gives the last known position no older than the limit, marked as such", async () => {
    location.lastKnownReply = reading(59.5, 17.5, 40, NOW - 120_000);
    const tracker = startPositionTracker(location, OPTIONS);
    await expect(tracker.positionNow()).resolves.toEqual({
      latitude: 59.5,
      longitude: 17.5,
      accuracyM: 40,
      source: "last-known",
    });
    expect(location.lastKnownAsked).toEqual([120_000]);
  });

  it("does not take a last known position older than the limit, whatever the phone says", async () => {
    location.lastKnownReply = reading(59.5, 17.5, 40, NOW - 120_001);
    const tracker = startPositionTracker(location, OPTIONS);
    await expect(tracker.positionNow()).resolves.toBeNull();
  });

  it.each<[string, unknown]>([
    ["none", null],
    ["one without a time", { coords: { latitude: 59, longitude: 17, accuracy: 5 } }],
    ["one with a time that is not a number", { ...reading(59, 17, 5), timestamp: "now" }],
    ["one with a latitude past 90", reading(91, 17, 5)],
  ])("gives nothing when the phone gives %s as the last known position", async (_, reply) => {
    location.lastKnownReply = reply;
    const tracker = startPositionTracker(location, OPTIONS);
    await expect(tracker.positionNow()).resolves.toBeNull();
  });

  it("gives nothing when the last known position cannot be read", async () => {
    location.lastKnownError = new Error("location services are off");
    const tracker = startPositionTracker(location, OPTIONS);
    await expect(tracker.positionNow()).resolves.toBeNull();
  });
});

describe("firstFix", () => {
  it("gives the best fix at once when one has come", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    location.send(reading(59.2, 17.2, 5));
    await expect(tracker.firstFix()).resolves.toMatchObject({ latitude: 59.2, source: "fix" });
  });

  it("waits for the first fix that comes, then stops watching", async () => {
    jest.useFakeTimers();
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    const first = tracker.firstFix();
    jest.advanceTimersByTime(29_000);
    location.send(reading(59.3, 17.3, 15));
    await expect(first).resolves.toEqual({
      latitude: 59.3,
      longitude: 17.3,
      accuracyM: 15,
      source: "fix",
    });
    expect(location.stopped).toBe(1);
  });

  it("ignores a reading that is not a fix while it waits", async () => {
    jest.useFakeTimers();
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    const first = tracker.firstFix();
    location.send(reading(95, 17, 5));
    location.send(reading(59.3, 17.3, 15));
    await expect(first).resolves.toMatchObject({ latitude: 59.3 });
  });

  it("gives nothing once the wait is over without a fix, and stops watching", async () => {
    jest.useFakeTimers();
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    const first = tracker.firstFix();
    jest.advanceTimersByTime(30_000);
    await expect(first).resolves.toBeNull();
    expect(location.stopped).toBe(1);
    location.send(reading(59.3, 17.3, 15));
    await expect(tracker.positionNow()).resolves.toBeNull();
  });

  it("gives nothing at once when watching could not start", async () => {
    location.watchError = new Error("location services are off");
    const tracker = startPositionTracker(location, OPTIONS);
    await expect(tracker.firstFix()).resolves.toBeNull();
  });

  it("gives nothing at once when the tracker has been stopped", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    tracker.stop();
    await expect(tracker.firstFix()).resolves.toBeNull();
  });

  it("gives nothing to a wait under way when the tracker is stopped", async () => {
    jest.useFakeTimers();
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    const first = tracker.firstFix();
    tracker.stop();
    await expect(first).resolves.toBeNull();
  });
});

describe("stop", () => {
  it("stops watching, and stopping again changes nothing", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    tracker.stop();
    tracker.stop();
    expect(location.stopped).toBe(1);
  });

  it("stops a watch that starts only after the stop", async () => {
    location.holdWatch();
    const tracker = startPositionTracker(location, OPTIONS);
    tracker.stop();
    location.startWatching();
    await settle();
    expect(location.stopped).toBe(1);
    expect(location.onFix).toBeNull();
  });

  it("keeps no fix that comes after the stop", async () => {
    const tracker = startPositionTracker(location, OPTIONS);
    await settle();
    const onFix = location.onFix;
    tracker.stop();
    onFix?.(reading(59.2, 17.2, 5));
    await expect(tracker.positionNow()).resolves.toBeNull();
  });
});
