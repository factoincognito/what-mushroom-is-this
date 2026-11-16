import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import {
  answerSubject,
  checkedEdibility,
  edibilityText,
  fillIn,
  formatFindTime,
  selfCheckReason,
} from "../find/display";
import { PictureCredit } from "../find/PictureView";
import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
import type { FindSummary } from "../store/find";

type FindRowProps = {
  readonly find: FindSummary;
  readonly language: Language;
  readonly strings: Strings;
  /**
   * Wraps the row's content, the photo and the texts, in what makes the row pressable: the
   * Library's link to the find's screen, or the button that chooses the find for shared photos.
   */
  readonly renderRow: (content: ReactNode) => ReactNode;
  /** A note under the row, apart from what is pressed. */
  readonly note?: ReactNode;
};

/**
 * One find as its row in the Library's list (docs/SPEC.md 3.9, The Library), also shown where a
 * find is chosen for shared photos (3.9, Shared photos; PBI-2.21). A text answer's representative
 * picture (PBI-2.9) takes the place of the text mark, and of the first photo of a text find with
 * photos whose answer is from the text alone, while it has one; its credit follows the row, apart
 * from it, so that its links do not act as the row.
 */
export function FindRow({ find, language, strings, renderRow, note }: FindRowProps) {
  const { picture, analysis } = find;
  const speciesName =
    analysis.state === "done" && analysis.result === "match" ? analysis.names[language] : null;
  const shownPicture = picture !== null && speciesName !== null ? picture : null;
  let thumbnail: ReactNode;
  if (shownPicture !== null) {
    thumbnail = (
      <Image
        source={{ uri: shownPicture.uri }}
        accessibilityLabel={fillIn(strings.find.picture.label, { name: speciesName ?? "" })}
        style={styles.thumbnail}
      />
    );
  } else if (find.photoUri !== null) {
    thumbnail = (
      <Image
        source={{ uri: find.photoUri }}
        accessibilityLabel={strings.find.photo}
        style={styles.thumbnail}
      />
    );
  } else {
    thumbnail = (
      <View
        accessible
        accessibilityLabel={strings.log.textMarkLabel}
        style={[styles.thumbnail, styles.textMark]}
      >
        <Text style={styles.textMarkText}>{strings.log.textMark}</Text>
      </View>
    );
  }
  return (
    <View style={styles.findEntry}>
      {renderRow(
        <>
          {thumbnail}
          <View style={styles.findText}>
            <Text style={styles.note}>{formatFindTime(find.time, language)}</Text>
            <SummaryView find={find} language={language} strings={strings} />
          </View>
        </>,
      )}
      {note}
      {shownPicture !== null && (
        <PictureCredit
          picture={shownPicture}
          strings={strings}
          testID={`picture-credit-${find.id}`}
        />
      )}
    </View>
  );
}

type SummaryViewProps = Pick<FindRowProps, "find" | "language" | "strings">;

function SummaryView({ find, language, strings }: SummaryViewProps) {
  const { analysis } = find;
  // The answer's wording follows what it was based on (SPEC 3.9, Answers; PBI-2.15).
  const described = answerSubject(find.answerBasis, find.photoUri !== null) === "described";
  switch (analysis.state) {
    case "waiting":
      return <Text style={styles.text}>{strings.log.waiting}</Text>;
    case "failed":
      return <Text style={styles.text}>{strings.log.failed}</Text>;
    case "done": {
      if (analysis.result !== "match") {
        const t = strings.find;
        const said =
          analysis.result === "no_mushroom"
            ? described
              ? t.noMushroomDescribed
              : t.noMushroom
            : described
              ? t.cannotTellDescribed
              : t.cannotTell;
        return <Text style={styles.text}>{said}</Text>;
      }
      // An answer from the text alone shows "unknown" until its self-check agrees (SPEC 3.9).
      // A waiting check on a find with photos waits on them (Clead's decision on #78).
      const reason = selfCheckReason(
        find.selfCheck,
        analysis.names,
        language,
        strings,
        find.photoUri !== null,
      );
      return (
        <>
          <Text style={styles.name}>{analysis.names[language]}</Text>
          <Text style={styles.text}>
            {fillIn(strings.find.edibility, {
              edibility: edibilityText(checkedEdibility(analysis, find.selfCheck), strings),
            })}
          </Text>
          {reason !== null && <Text style={styles.note}>{reason}</Text>}
          {/* The disclaimer follows what the answer was based on (Clead's decision 3 on #57). */}
          <Text style={styles.note}>
            {described ? strings.disclaimerDescribed : strings.disclaimer}
          </Text>
        </>
      );
    }
  }
}

const styles = StyleSheet.create({
  findEntry: {
    gap: 4,
  },
  findRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 4,
  },
  textMark: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textMarkText: {
    fontSize: 14,
    fontWeight: "bold",
  },
  findText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
  note: {
    fontSize: 14,
  },
});

/** The layout of what `renderRow` wraps: the photo beside the texts. */
export const findRowStyle = styles.findRow;
