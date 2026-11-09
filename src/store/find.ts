/**
 * What a find holds (docs/SPEC.md 3.6, 3.1), the input that adds one, and the store's error.
 */

import type { Answer, Confidence, Edibility, SpeciesNames, Texts } from "../analysis/answer";
import { config } from "../config/config";

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

/**
 * What the analysis behind an answer sent of the find (review of #49, fix 1): the URIs of the
 * photos it included, as the store gave them (`Find.photoUri`, `StoredFind.photos`), in order;
 * none for an analysis of the text alone. The store compares them with the photos the find holds
 * when the answer is stored, which may have changed while the analysis ran.
 */
export interface AnalysisSent {
  photoUris: readonly string[];
}

export function checkSent(sent: AnalysisSent | undefined): void {
  if (sent === undefined || sent === null || typeof sent !== "object") {
    throw invalid("there is no account of what the analysis sent");
  }
  if (!Array.isArray(sent.photoUris)) {
    throw invalid("the photos the analysis sent are not a list");
  }
  for (const uri of sent.photoUris) {
    checkUri(uri, "a photo the analysis sent");
  }
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
      /**
       * As Claude gave it: the screen shows "unknown" below the confidence line, or when a Phase 1
       * level is low (`shownEdibility`).
       */
      edibility: Edibility;
      /** A whole number from 1 to 100, or the level of an answer given in Phase 1. */
      confidence: Confidence;
    }
  | { state: "done"; result: "no_mushroom" | "cannot_tell" };

export interface FindSummary {
  id: number;
  /** The find's first photo; null for a text find without photos (docs/SPEC.md 3.9, PBI-2.4). */
  photoUri: string | null;
  time: FindTime;
  analysis: SummaryAnalysis;
  /**
   * The self-check of an answer from the text alone, or null for any other find: the edibility
   * shown is "unknown" until it agrees (docs/SPEC.md 3.9).
   */
  selfCheck: SelfCheck | null;
}

/**
 * An entry of the Log list (PBI-1.16): a find the store could read, with what the Log shows of
 * it, or a find whose row it could not read, which is listed in its place so that it does not hide
 * the others. An unreadable find's `id` is null only when the ID itself cannot be read; with an
 * ID, the find can still be deleted. Without one, `storedId` is its ID as SQLite writes it, by
 * which `deleteUnreadable` still deletes it, or null when even that cannot be read (PBI-1.26).
 */
export type ListedFind =
  | ({ readable: true } & FindSummary)
  | { readable: false; id: number }
  | { readable: false; id: null; storedId: string | null };

/** A new find: its photo where the camera or the gallery left it, its time and its position. */
export interface NewFind {
  photoUri: string;
  time: FindTime;
  position: Position | null;
}

/** A new text find (docs/SPEC.md 3.9, Lookups): the text the user wrote, its time and position. */
export interface NewTextFind {
  text: string;
  time: FindTime;
  position: Position | null;
}

/**
 * On a find with an answer, the state of the photos added since that answer (docs/SPEC.md 3.9,
 * The store): none waiting ("analysed"), waiting for the queue, or not yet analysed after a
 * failure.
 */
export const ADDED_PHOTOS_STATES = ["analysed", "waiting", "not-analysed"] as const;
export type AddedPhotosState = (typeof ADDED_PHOTOS_STATES)[number];

/**
 * The self-check of an answer from a text alone (docs/SPEC.md 3.9): waiting, agreed, disagreed
 * with the species the check named, could not name a species, failed, or no picture.
 */
export const SELF_CHECK_STATES = [
  "waiting",
  "agreed",
  "disagreed",
  "no-species",
  "failed",
  "no-picture",
] as const;
export type SelfCheckState = (typeof SELF_CHECK_STATES)[number];

/** What a self-check came to; "waiting" is set with the answer, not by an outcome. */
export type SelfCheckOutcome =
  | { state: "agreed" | "no-species" | "failed" | "no-picture" }
  | { state: "disagreed"; names: SpeciesNames };
export type SelfCheck = { state: "waiting" } | SelfCheckOutcome;

/** One of a find's photos, in the order added, with the batch it came in (numbered from 1). */
export interface FindPhoto {
  uri: string;
  batch: number;
}

/** A text find's representative picture, with the credit its licence requires. */
export interface Picture {
  uri: string;
  author: string;
  licence: string;
  /** The picture's page on Wikimedia Commons, an https address. */
  page: string;
}

/** A picture to store: where it was fetched to, and its credit. */
export interface NewPicture {
  sourceUri: string;
  author: string;
  licence: string;
  page: string;
}

/**
 * A find with everything the store holds of it (docs/SPEC.md 3.6 and 3.9, The store). `Find` is
 * Phase 1's view of it, by its first photo.
 */
export interface StoredFind {
  id: number;
  text: string | null;
  photos: FindPhoto[];
  batchOpen: boolean;
  time: FindTime;
  position: Position | null;
  analysis: Analysis;
  /** On a find with an answer, the state of the photos added since; null without one. */
  addedPhotos: AddedPhotosState | null;
  picture: Picture | null;
  /** Only on an answer from the text alone that names a species; otherwise null. */
  selfCheck: SelfCheck | null;
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
  checkUri(find.photoUri, "the photo URI");
  checkTime(find.time);
  if (find.position !== null) {
    checkPosition(find.position);
  }
}

/** A text of at most `lookupTextMaxLength` code points, not of blanks alone (docs/SPEC.md 3.9). */
export function checkNewTextFind(find: NewTextFind): void {
  const { text } = find;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw invalid("the text is empty");
  }
  if ([...text].length > config.lookupTextMaxLength) {
    throw invalid(`the text is longer than ${config.lookupTextMaxLength} characters`);
  }
  checkTime(find.time);
  if (find.position !== null) {
    checkPosition(find.position);
  }
}

export function checkUri(uri: string, what: string): void {
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw invalid(`${what} is empty`);
  }
}

/** A page address: https, with no blank in it. */
const PAGE = /^https:\/\/\S+$/;

export function checkNewPicture(picture: NewPicture | null): void {
  if (picture === null || typeof picture !== "object") {
    throw invalid("there is no picture");
  }
  checkUri(picture.sourceUri, "the picture's URI");
  checkText(picture.author, "the picture's author");
  checkText(picture.licence, "the picture's licence");
  if (typeof picture.page !== "string" || !PAGE.test(picture.page)) {
    throw invalid("the picture's page is not an https address");
  }
}

/** An outcome of a self-check; "waiting" is not one, since the answer sets it. */
export function checkSelfCheckOutcome(outcome: SelfCheckOutcome | null): void {
  if (outcome === null || typeof outcome !== "object") {
    throw invalid("there is no outcome of the self-check");
  }
  if (!isOneOf(["agreed", "disagreed", "no-species", "failed", "no-picture"], outcome.state)) {
    throw invalid("the self-check's outcome is not one the store knows");
  }
  if (outcome.state === "disagreed") {
    const names: unknown = outcome.names;
    if (names === null || typeof names !== "object") {
      throw invalid("a disagreeing self-check names no species");
    }
    const { sv, en, la, it } = outcome.names;
    for (const name of [sv, en, la, it]) {
      checkText(name, "a name of the species the self-check named");
    }
  }
}

function checkText(value: string, what: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`${what} is empty`);
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
