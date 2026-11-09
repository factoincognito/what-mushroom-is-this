/**
 * What a find holds (docs/SPEC.md 3.6, 3.1), the input that adds one, and the store's error.
 */

import type { Answer, Confidence, Edibility, Texts } from "../analysis/answer";

/**
 * Where a find's time came from: the moment of saving; the photo's metadata, with an offset of
 * its own; or the photo's metadata without one, read with the phone's offset on that date.
 */
export const TIME_SOURCES = ["saved", "photo", "photo-phone-offset"] as const;
export type TimeSource = (typeof TIME_SOURCES)[number];

/** Where a find's position came from: a fix, the phone's last known position, the photo. */
export const POSITION_SOURCES = ["fix", "last-known", "photo"] as const;
export type PositionSource = (typeof POSITION_SOURCES)[number];

export const FIND_STATES = ["waiting", "done", "failed"] as const;
export type FindState = (typeof FIND_STATES)[number];

/**
 * Why an analysis failed: the photo failed the segment check, the API refused the request
 * (400, 413), the answer did not fit the shape or was not from the API, the photo could not be
 * loaded, decoded or sized (PBI-1.7, PBI-1.21), or Claude declined to answer (PBI-1.21).
 */
export const FAILURE_CAUSES = ["segment-check", "request", "answer", "photo", "refused"] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

/** The time a find was taken, as an instant, with the UTC offset it was taken at. */
export interface FindTime {
  /** Milliseconds since the epoch. */
  takenAtMs: number;
  /** Minutes east of UTC, -1080 to 1080. */
  utcOffsetMinutes: number;
  source: TimeSource;
}

export interface Position {
  latitude: number;
  longitude: number;
  /** In metres, as the phone gives it; null when it gives none. */
  accuracyM: number | null;
  source: PositionSource;
}

export interface FindFailure {
  cause: FailureCause;
  /** What the message names: for the segment check, the refused marker or the reason. */
  detail: string;
}

/** An answer, the model that gave it and when. */
export interface AnalysedAnswer {
  answer: Answer;
  model: string;
  /** Milliseconds since the epoch. */
  analysedAtMs: number;
}

export type Analysis =
  | { state: "waiting" }
  | { state: "failed"; failure: FindFailure }
  | ({ state: "done" } & AnalysedAnswer);

export interface Find {
  id: number;
  photoUri: string;
  time: FindTime;
  position: Position | null;
  analysis: Analysis;
}

/** What the Log list shows of a find, read without parsing its answer. */
export type SummaryAnalysis =
  | { state: "waiting" }
  | { state: "failed"; failure: FindFailure }
  | {
      state: "done";
      result: "match";
      /** The species' names in the app's three languages. */
      names: Texts;
      /** As Claude gave it: the screen shows "unknown" when the confidence is low. */
      edibility: Edibility;
      confidence: Confidence;
    }
  | { state: "done"; result: "no_mushroom" | "cannot_tell" };

export interface FindSummary {
  id: number;
  photoUri: string;
  time: FindTime;
  analysis: SummaryAnalysis;
}

/**
 * An entry of the Log list (PBI-1.16): a find the store could read, with what the Log shows of
 * it, or a find whose row it could not read, which is listed in its place so that it does not hide
 * the others. An unreadable find's `id` is null only when the ID itself cannot be read; with an
 * ID, the find can still be deleted.
 */
export type ListedFind =
  | ({ readable: true } & FindSummary)
  | { readable: false; id: number | null };

/** A new find: its photo where the camera or the gallery left it, its time and its position. */
export interface NewFind {
  photoUri: string;
  time: FindTime;
  position: Position | null;
}

export type StoreErrorCode =
  /** The caller passed a value the store does not accept. Nothing was changed. */
  | "invalid-input"
  /** No find has the ID. */
  | "not-found"
  /** The find is not in a state the change applies to. Nothing was changed. */
  | "wrong-state"
  /** What the database or the photo directory holds is not what the store wrote. */
  | "corrupt"
  /** The database was written by a newer version of the app. */
  | "newer-schema";

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

/** The widest UTC offset ISO 8601 allows, in minutes. */
const MAX_OFFSET_MINUTES = 18 * 60;

export function checkNewFind(find: NewFind): void {
  if (typeof find.photoUri !== "string" || find.photoUri.trim().length === 0) {
    throw invalid("the photo URI is empty");
  }
  checkTime(find.time);
  if (find.position !== null) {
    checkPosition(find.position);
  }
}

function checkTime(time: FindTime): void {
  if (!Number.isSafeInteger(time.takenAtMs)) {
    throw invalid("the time taken is not a whole number of milliseconds");
  }
  const offset = time.utcOffsetMinutes;
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > MAX_OFFSET_MINUTES) {
    throw invalid("the UTC offset is not whole minutes within 18 hours");
  }
  if (!isOneOf(TIME_SOURCES, time.source)) {
    throw invalid("the time source is not one the store knows");
  }
}

export function checkPosition(position: Position | null): void {
  if (position === null || typeof position !== "object") {
    throw invalid("there is no position");
  }
  if (!isInRange(position.latitude, 90)) {
    throw invalid("the latitude is not a number from -90 to 90");
  }
  if (!isInRange(position.longitude, 180)) {
    throw invalid("the longitude is not a number from -180 to 180");
  }
  const accuracy = position.accuracyM;
  if (accuracy !== null && !(Number.isFinite(accuracy) && accuracy >= 0)) {
    throw invalid("the accuracy is not a number of metres of zero or more");
  }
  if (!isOneOf(POSITION_SOURCES, position.source)) {
    throw invalid("the position source is not one the store knows");
  }
}

export function checkFailure(failure: FindFailure | null): void {
  if (failure === null || typeof failure !== "object") {
    throw invalid("there is no failure");
  }
  if (!isOneOf(FAILURE_CAUSES, failure.cause)) {
    throw invalid("the failure cause is not one the store knows");
  }
  if (typeof failure.detail !== "string" || failure.detail.trim().length === 0) {
    throw invalid("the failure detail is empty");
  }
}

/** A positive whole number, as SQLite gives a row ID. */
export function checkId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw invalid("the find ID is not a positive whole number");
  }
}

function isInRange(value: number, limit: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((known) => known === value);
}

export function invalid(message: string): StoreError {
  return new StoreError("invalid-input", message);
}

export function corrupt(message: string): StoreError {
  return new StoreError("corrupt", message);
}
