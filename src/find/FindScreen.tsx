import { Link, router, useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Answer, Match, SpeciesNames } from "../analysis/answer";
import { config } from "../config/config";
import { useLanguage } from "../i18n/LanguageContext";
import { LANGUAGES, type Language } from "../i18n/languages";
import { STRINGS, type Strings } from "../i18n/strings";
import {
  type FormatTime,
  failureMessage,
  formatTimeIn,
  type LookupSubject,
  noticeMessage,
  stopNeedsSettings,
} from "../queue/messages";
import { useQueue } from "../queue/QueueContext";
import type { QueueNotice, QueueState } from "../queue/queue";
import { useFindLog } from "../store/FindLogContext";
import { type Position, type SelfCheck, type StoredFind, StoreError } from "../store/find";
import {
  answerSubject,
  checkedEdibility,
  confidenceText,
  edibilityText,
  fillIn,
  formatAccuracy,
  formatCoordinates,
  formatFindTime,
  mapLink,
  positionSourceText,
  selfCheckReason,
  timeSourceText,
} from "./display";
import { PictureView } from "./PictureView";

/** What the screen has read of its find. */
type Loaded =
  | { kind: "loading" }
  /** No find has the ID, or the address names no ID. */
  | { kind: "absent" }
  /** The store could not read the find. */
  | { kind: "unreadable" }
  | { kind: "ready"; find: StoredFind };

/** The message of the last action on the screen; shown in the language in use. */
type Message =
  | { kind: "notice"; notice: QueueNotice; answerKept: boolean }
  | { kind: "analysis-error" }
  | { kind: "map-failed" }
  | { kind: "delete-failed" }
  | { kind: "remove-photo-failed" };

/**
 * The Find screen (docs/SPEC.md 3.1, 3.3, 3.5): the photo; the species' names in the app's
 * language, in Latin and in the other two; the edibility of the matched species, "unknown" below the
 * confidence line or when a Phase 1 level is low (SPEC 3.9), with the disclaimer next to it;
 * Claude's confidence, a number of 100 or a Phase 1 level, with its note; the
 * general information; the poisonous look-alikes, each with its names and its edibility; the time
 * and the position with where each came from, and a link to the phone's map app. "Analyse again"
 * goes through the queue; a failed new analysis of an analysed find keeps its answer and shows the
 * failure in the message only. "Delete" asks first. The find is read again when the queue's run
 * ends and after an analysis from here.
 *
 * The find is read as `getStored` reads it (PBI-2.4). A text find shows its description, which
 * cannot be edited (SPEC 3.9); without photos, it shows no photo, the disclaimer for a lookup
 * without photos, and "no mushroom" and "cannot tell" in the words of a description. An answer
 * from the text alone shows the edibility "unknown" until its self-check agrees, and says why
 * (SPEC 3.9); an answer from photos has no check.
 *
 * A find's photos (SPEC 3.9, Batches; PBI-2.5): every photo is shown, in the order added, each
 * numbered when there are several; "Add photos" opens New find for this find, while it holds
 * fewer than the most; a photo can be removed, after a question on the screen, but not the last
 * of a find without text, and nothing is analysed for it. On an analysed find, the photos added
 * since its answer are said to wait, or not to have been analysed, while the answer is kept. A
 * find whose batch is still open has "Analyse" complete it, which leaves the find to the queue.
 * The find is read again whenever the screen comes into view, so photos added are shown.
 *
 * A text answer's representative picture (SPEC 3.9; PBI-2.9) is shown after the photos, apart
 * from them, labelled as a picture of the species, not of the user's mushroom, with its credit.
 */
export function FindScreen({ id }: { readonly id: number | null }) {
  const { language, strings } = useLanguage();
  const findLog = useFindLog();
  const { state: queueState, analyseFind } = useQueue();
  const formatTime = useMemo(() => formatTimeIn(language), [language]);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The number of the photo whose removal is being asked about, or null. */
  const [removing, setRemoving] = useState<number | null>(null);
  /** The latest read; an earlier one that ends later is dropped. */
  const latestRead = useRef(0);

  const load = useCallback(async () => {
    const read = ++latestRead.current;
    let next: Loaded;
    if (id === null) {
      next = { kind: "absent" };
    } else {
      try {
        const find = await (await findLog()).getStored(id);
        next = find === null ? { kind: "absent" } : { kind: "ready", find };
      } catch {
        next = { kind: "unreadable" };
      }
    }
    if (read === latestRead.current) {
      setLoaded(next);
    }
  }, [findLog, id]);

  // Read whenever the screen comes into view: also back from adding photos to the find.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // A run of the queue can analyse this find; it is read again when the run ends.
  const { running } = queueState;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void load();
    }
    wasRunning.current = running;
  }, [running, load]);

  async function analyse(findId: number): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await analyseFind(findId);
      // A find that had no answer shows its own failure; only the rest needs the message.
      if (!result.ok && (result.answerKept || result.notice.kind !== "find-failed")) {
        setMessage({ kind: "notice", notice: result.notice, answerKept: result.answerKept });
      }
    } catch {
      setMessage({ kind: "analysis-error" });
    } finally {
      await load();
      setBusy(false);
    }
  }

  /** A find whose batch is still open: "Analyse" completes it, and the queue analyses the find. */
  async function completeBatch(findId: number): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await (await findLog()).completeBatch(findId);
    } catch {
      setMessage({ kind: "analysis-error" });
    } finally {
      await load();
      setBusy(false);
    }
  }

  async function removePhoto(findId: number, photoNumber: number): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await (await findLog()).removePhoto(findId, photoNumber);
    } catch {
      setMessage({ kind: "remove-photo-failed" });
    } finally {
      setRemoving(null);
      await load();
      setBusy(false);
    }
  }

  async function remove(findId: number): Promise<void> {
    setBusy(true);
    try {
      await (await findLog()).delete(findId);
      leave();
    } catch (error) {
      if (error instanceof StoreError && error.code === "not-found") {
        leave();
        return;
      }
      setConfirming(false);
      setMessage({ kind: "delete-failed" });
    } finally {
      setBusy(false);
    }
  }

  function openMap(position: Position): void {
    let url: string;
    try {
      url = mapLink(position, Platform);
    } catch {
      setMessage({ kind: "map-failed" });
      return;
    }
    Linking.openURL(url).catch(() => setMessage({ kind: "map-failed" }));
  }

  const t = strings.find;
  const subject: LookupSubject =
    loaded.kind === "ready" && loaded.find.photos.length === 0 ? "described" : "photo";
  const deleteControls =
    id === null ? null : (
      <DeleteControls
        strings={strings}
        question={subject === "described" ? t.deleteConfirmDescribed : t.deleteConfirm}
        busy={busy}
        confirming={confirming}
        onAsk={() => setConfirming(true)}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove(id)}
      />
    );

  let body: ReactNode;
  switch (loaded.kind) {
    case "loading":
      body = <ActivityIndicator testID="find-loading" />;
      break;
    case "absent":
      body = (
        <>
          <Text style={styles.text}>{t.notFound}</Text>
          <Link href="/" replace accessibilityRole="link" style={styles.link}>
            {t.back}
          </Link>
        </>
      );
      break;
    case "unreadable":
      body = (
        <>
          <Text style={styles.text}>{t.unreadable}</Text>
          {deleteControls}
        </>
      );
      break;
    case "ready": {
      const { find } = loaded;
      const count = find.photos.length;
      // The last photo of a find without text stays (SPEC 3.9, Batches).
      const canRemove = find.text !== null || count > 1;
      body = (
        <>
          {find.photos.map((photo, index) => {
            const number = index + 1;
            const label =
              count === 1
                ? t.photo
                : fillIn(t.photoNumbered, { number: String(number), count: String(count) });
            return (
              <View key={photo.uri} style={styles.section}>
                <Image
                  source={{ uri: photo.uri }}
                  accessibilityLabel={label}
                  resizeMode="contain"
                  style={styles.photo}
                />
                {canRemove && (
                  <RemovePhotoControls
                    strings={strings}
                    number={number}
                    busy={busy}
                    confirming={removing === number}
                    onAsk={() => setRemoving(number)}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => void removePhoto(find.id, number)}
                  />
                )}
              </View>
            );
          })}
          {find.picture !== null &&
            find.analysis.state === "done" &&
            find.analysis.answer.result === "match" && (
              // Apart from the photos: never one of them (docs/SPEC.md 3.9; PBI-2.9).
              <PictureView
                picture={find.picture}
                speciesName={find.analysis.answer.names[language]}
                strings={strings}
              />
            )}
          {count < config.maxPhotosPerFind ? (
            <Link href={`/new-find?find=${find.id}`} accessibilityRole="link" style={styles.link}>
              {t.addPhotos}
            </Link>
          ) : (
            <Text style={styles.note}>
              {fillIn(t.maxPhotos, { max: String(config.maxPhotosPerFind) })}
            </Text>
          )}
          {find.text !== null && (
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>
                {t.description}
              </Text>
              <Text style={styles.text}>{find.text}</Text>
            </View>
          )}
          <AnalysisView
            find={find}
            subject={subject}
            language={language}
            strings={strings}
            formatTime={formatTime}
            queueNotice={queueNoticeFor(find, message, queueState)}
          />
          <TimeAndPosition find={find} language={language} strings={strings} onOpenMap={openMap} />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void (find.batchOpen ? completeBatch(find.id) : analyse(find.id))}
              style={[styles.button, busy && styles.disabled]}
            >
              <Text style={styles.buttonText}>
                {find.analysis.state === "waiting" || find.batchOpen ? t.analyse : t.analyseAgain}
              </Text>
            </Pressable>
          </View>
          {busy && !confirming && (
            <View style={styles.row}>
              <ActivityIndicator />
              <Text style={styles.text}>{t.analysing}</Text>
            </View>
          )}
          {deleteControls}
        </>
      );
      break;
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {body}
      {message !== null && (
        <MessageView
          message={message}
          subject={subject}
          strings={strings}
          formatTime={formatTime}
        />
      )}
    </ScrollView>
  );
}

/**
 * For a waiting find, or an analysed one whose added photos wait, with no message of its own: why
 * the queue left it waiting, if it did.
 */
function queueNoticeFor(
  find: StoredFind,
  message: Message | null,
  state: QueueState,
): QueueNotice | null {
  const waits =
    find.analysis.state === "waiting" ||
    (find.analysis.state === "done" && find.addedPhotos === "waiting");
  if (!waits || message !== null) {
    return null;
  }
  if (state.stop !== null) {
    return { kind: "stopped", stop: state.stop };
  }
  return state.pause === null ? null : { kind: "paused", cause: state.pause };
}

type AnalysisViewProps = {
  readonly find: StoredFind;
  readonly subject: LookupSubject;
  readonly language: Language;
  readonly strings: Strings;
  readonly formatTime: FormatTime;
  readonly queueNotice: QueueNotice | null;
};

function AnalysisView({
  find,
  subject,
  language,
  strings,
  formatTime,
  queueNotice,
}: AnalysisViewProps) {
  const t = strings.find;
  const { analysis } = find;
  switch (analysis.state) {
    case "waiting":
      return (
        <View style={styles.section}>
          <Text style={styles.text}>{t.waiting}</Text>
          {queueNotice !== null && (
            <NoticeView
              notice={queueNotice}
              subject={subject}
              strings={strings}
              formatTime={formatTime}
            />
          )}
        </View>
      );
    case "failed":
      return (
        <View style={styles.section}>
          <Text style={styles.text}>{t.failed}</Text>
          <Text style={styles.text}>{failureMessage(analysis.failure, strings, subject)}</Text>
        </View>
      );
    case "done":
      return (
        <>
          {(find.addedPhotos === "waiting" || find.addedPhotos === "not-analysed") && (
            <View testID="added-photos" style={styles.section}>
              <Text style={styles.text}>
                {find.addedPhotos === "waiting" ? t.addedPhotos.waiting : t.addedPhotos.notAnalysed}
              </Text>
              {queueNotice !== null && (
                <NoticeView
                  notice={queueNotice}
                  subject={subject}
                  strings={strings}
                  formatTime={formatTime}
                />
              )}
            </View>
          )}
          <AnswerView
            answer={analysis.answer}
            selfCheck={find.selfCheck}
            // Its disclaimer, "no mushroom" and "cannot tell" follow what the answer was based on
            // (Clead's decision 3 on #57; SPEC 3.9, Answers; PBI-2.15).
            subject={answerSubject(find.answerBasis, find.photos.length > 0)}
            language={language}
            strings={strings}
          />
        </>
      );
  }
}

type AnswerViewProps = {
  readonly answer: Answer;
  /**
   * The self-check of an answer from the text alone; null for any other answer. Until it agrees,
   * the edibility shown is "unknown", with why (SPEC 3.9).
   */
  readonly selfCheck: SelfCheck | null;
  /** What was analysed: for a lookup without photos, the answers speak of the description. */
  readonly subject: LookupSubject;
  readonly language: Language;
  readonly strings: Strings;
};

/**
 * An answer as a find's screen shows it (SPEC 3.1, 3.5, 3.9): a match with its edibility and the
 * disclaimer, or what Claude could not name. The text lookup screen shows an unsaved lookup's
 * answer with it too.
 */
export function AnswerView({ answer, selfCheck, subject, language, strings }: AnswerViewProps) {
  const t = strings.find;
  const described = subject === "described";
  switch (answer.result) {
    case "match":
      return (
        <MatchView
          match={answer}
          selfCheck={selfCheck}
          disclaimer={described ? strings.disclaimerDescribed : strings.disclaimer}
          language={language}
          strings={strings}
        />
      );
    case "no_mushroom":
      return <Text style={styles.text}>{described ? t.noMushroomDescribed : t.noMushroom}</Text>;
    case "cannot_tell":
      return <Text style={styles.text}>{described ? t.cannotTellDescribed : t.cannotTell}</Text>;
  }
}

type MatchViewProps = {
  readonly match: Match;
  readonly selfCheck: SelfCheck | null;
  /** The disclaimer next to the edibility: SPEC 3.5's, or 3.9's for a lookup without photos. */
  readonly disclaimer: string;
  readonly language: Language;
  readonly strings: Strings;
};

function MatchView({ match, selfCheck, disclaimer, language, strings }: MatchViewProps) {
  const t = strings.find;
  const edibility = edibilityText(checkedEdibility(match, selfCheck), strings);
  const reason = selfCheckReason(selfCheck, match.names, language, strings);
  return (
    <View style={styles.section}>
      <View testID="match-names">
        <NamesView names={match.names} language={language} strings={strings} heading />
      </View>
      <View testID="match-edibility" style={styles.edibility}>
        <Text style={styles.strong}>{fillIn(t.edibility, { edibility })}</Text>
        {reason !== null && <Text style={styles.text}>{reason}</Text>}
        <Text style={styles.disclaimer}>{disclaimer}</Text>
      </View>
      <Text style={styles.text}>{confidenceText(match.confidence, strings)}</Text>
      <Text style={styles.note}>{t.confidenceNote}</Text>
      <Text accessibilityRole="header" style={styles.heading}>
        {t.generalInformation}
      </Text>
      <Text style={styles.text}>{match.generalInformation[language]}</Text>
      <Text accessibilityRole="header" style={styles.heading}>
        {t.lookAlikes}
      </Text>
      {match.lookAlikes.length === 0 ? (
        <Text style={styles.text}>{t.noLookAlikes}</Text>
      ) : (
        match.lookAlikes.map((lookAlike, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the answer's list is fixed and never reordered, and two entries may name the same species.
          <View key={index} testID={`look-alike-${index}`} style={styles.lookAlike}>
            <NamesView names={lookAlike.names} language={language} strings={strings} />
            <Text style={styles.strong}>
              {fillIn(t.lookAlikeEdibility, {
                edibility: edibilityText(lookAlike.edibility, strings),
              })}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

type NamesViewProps = {
  readonly names: SpeciesNames;
  readonly language: Language;
  readonly strings: Strings;
  /** The match's names: its name in the app's language is the screen's heading. */
  readonly heading?: boolean;
};

/** A species' four names: the app's language first, then Latin, then the other two. */
function NamesView({ names, language, strings, heading = false }: NamesViewProps) {
  const others = LANGUAGES.filter((other) => other !== language);
  return (
    <View>
      <Text accessibilityRole={heading ? "header" : "text"} style={styles.name}>
        {names[language]}
      </Text>
      <View style={styles.nameRow}>
        <Text style={styles.label}>{strings.find.latin}</Text>
        <Text style={styles.latin}>{names.la}</Text>
      </View>
      {others.map((other) => (
        <View key={other} style={styles.nameRow}>
          <Text style={styles.label}>{STRINGS[other].languageName}</Text>
          <Text style={styles.text}>{names[other]}</Text>
        </View>
      ))}
    </View>
  );
}

type TimeAndPositionProps = {
  readonly find: StoredFind;
  readonly language: Language;
  readonly strings: Strings;
  readonly onOpenMap: (position: Position) => void;
};

function TimeAndPosition({ find, language, strings, onOpenMap }: TimeAndPositionProps) {
  const t = strings.find;
  const { position } = find;
  const accuracy = position === null ? null : formatAccuracy(position);
  return (
    <View style={styles.section}>
      <Text style={styles.text}>
        {fillIn(t.time, { time: formatFindTime(find.time, language) })}
      </Text>
      <Text style={styles.note}>{timeSourceText(find.time.source, strings)}</Text>
      {position === null ? (
        <Text style={styles.text}>{t.noPosition}</Text>
      ) : (
        <>
          <Text style={styles.text}>
            {fillIn(t.position, { coordinates: formatCoordinates(position) })}
          </Text>
          {accuracy !== null && (
            <Text style={styles.note}>{fillIn(t.accuracy, { metres: accuracy })}</Text>
          )}
          <Text style={styles.note}>{positionSourceText(position.source, strings)}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => onOpenMap(position)}
            style={styles.linkBox}
          >
            <Text style={styles.link}>{t.openMap}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

type DeleteControlsProps = {
  readonly strings: Strings;
  /** The question asked first, which names the photo only for a find that has one. */
  readonly question: string;
  readonly busy: boolean;
  readonly confirming: boolean;
  readonly onAsk: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/** "Delete the find", and the confirmation it asks for first. */
function DeleteControls({
  strings,
  question,
  busy,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: DeleteControlsProps) {
  const t = strings.find;
  if (!confirming) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onAsk}
        style={[styles.button, busy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t.delete}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.section}>
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {question}
      </Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onConfirm}
          style={[styles.button, busy && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t.deleteYes}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={[styles.button, busy && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t.deleteCancel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

type RemovePhotoControlsProps = {
  readonly strings: Strings;
  /** The photo's number, 1 for the first. */
  readonly number: number;
  readonly busy: boolean;
  readonly confirming: boolean;
  readonly onAsk: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/**
 * "Remove photo n", and the question it asks first, on the screen (SPEC 3.9, Batches): only the
 * app's copy is removed.
 */
function RemovePhotoControls({
  strings,
  number,
  busy,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: RemovePhotoControlsProps) {
  const t = strings.find;
  const values = { number: String(number) };
  if (!confirming) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onAsk}
        style={[styles.button, busy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{fillIn(t.removePhoto, values)}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.section}>
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {fillIn(t.removePhotoConfirm, values)}
      </Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onConfirm}
          style={[styles.button, busy && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t.removePhotoYes}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={[styles.button, busy && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t.removePhotoCancel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

type NoticeViewProps = {
  readonly notice: QueueNotice;
  readonly subject: LookupSubject;
  readonly strings: Strings;
  readonly formatTime: FormatTime;
};

/**
 * A queue notice in plain words, with a link to Settings when its stop names a setting. The text
 * lookup screen shows an unsaved lookup's notice with it too.
 */
export function NoticeView({ notice, subject, strings, formatTime }: NoticeViewProps) {
  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.text}>
        {noticeMessage(notice, strings, formatTime, subject)}
      </Text>
      {notice.kind === "stopped" && stopNeedsSettings(notice.stop) && (
        <Link href="/settings" accessibilityRole="link" style={styles.link}>
          {strings.queue.openSettings}
        </Link>
      )}
    </>
  );
}

type MessageViewProps = {
  readonly message: Message;
  readonly subject: LookupSubject;
  readonly strings: Strings;
  readonly formatTime: FormatTime;
};

function MessageView({ message, subject, strings, formatTime }: MessageViewProps) {
  const t = strings.find;
  switch (message.kind) {
    case "notice":
      return (
        <View testID="analysis-message" style={styles.section}>
          {message.answerKept && (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {strings.queue.answerKept}
            </Text>
          )}
          <NoticeView
            notice={message.notice}
            subject={subject}
            strings={strings}
            formatTime={formatTime}
          />
        </View>
      );
    case "analysis-error":
      return (
        <Text testID="analysis-message" accessibilityLiveRegion="polite" style={styles.text}>
          {t.analysisError}
        </Text>
      );
    case "map-failed":
      return (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.mapFailed}
        </Text>
      );
    case "delete-failed":
      return (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.deleteFailed}
        </Text>
      );
    case "remove-photo-failed":
      return (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {t.removePhotoFailed}
        </Text>
      );
  }
}

/** Back to the Log: back where the screen was opened from, or to the Log when it was opened alone. */
function leave(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/");
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
  },
  section: {
    gap: 8,
  },
  edibility: {
    gap: 4,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  nameRow: {
    flexDirection: "row",
    gap: 8,
  },
  lookAlike: {
    gap: 4,
    paddingVertical: 8,
  },
  name: {
    fontSize: 22,
    fontWeight: "bold",
  },
  label: {
    fontSize: 14,
    minWidth: 72,
  },
  latin: {
    fontSize: 16,
    fontStyle: "italic",
  },
  heading: {
    fontSize: 18,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
  strong: {
    fontSize: 16,
    fontWeight: "bold",
  },
  note: {
    fontSize: 14,
  },
  disclaimer: {
    fontSize: 14,
  },
  button: {
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    textAlign: "center",
  },
  linkBox: {
    paddingVertical: 8,
  },
  link: {
    fontSize: 16,
    textDecorationLine: "underline",
  },
});
