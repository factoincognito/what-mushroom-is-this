import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { Strings } from "../i18n/strings";
import { licenceDisplay } from "../picture/licences";
import type { Picture } from "../store/find";
import { fillIn } from "./display";

/** A picture and its credit: what the screens show of a stored or a fetched picture. */
export type CreditedPicture = Pick<Picture, "uri" | "author" | "licence" | "page">;

type PictureViewProps = {
  readonly picture: CreditedPicture;
  /** The species' name in the app's language, for the picture's accessible name. */
  readonly speciesName: string;
  readonly strings: Strings;
};

/**
 * A text answer's representative picture (docs/SPEC.md 3.9; PBI-2.9), as the Find screen and the
 * text lookup screen show it: the picture, labelled as a picture of the species from Wikimedia
 * Commons, not of the user's mushroom, with its credit (`PictureCredit`).
 */
export function PictureView({ picture, speciesName, strings }: PictureViewProps) {
  return (
    <View testID="species-picture" style={styles.section}>
      <Image
        source={{ uri: picture.uri }}
        accessibilityLabel={fillIn(strings.find.picture.label, { name: speciesName })}
        resizeMode="contain"
        style={styles.picture}
      />
      <PictureCredit picture={picture} strings={strings} />
    </View>
  );
}

type PictureCreditProps = {
  readonly picture: CreditedPicture;
  readonly strings: Strings;
  readonly testID?: string;
};

/**
 * The credit a picture's licence requires (docs/SPEC.md 3.9 and Known unknown 15): that it is a picture of
 * the species from Wikimedia Commons, not of the user's mushroom; its author; its licence's name,
 * a link to its deed but for public domain, which has none; that the app resized it; and a link to
 * its page on Commons. A link that cannot be opened says so.
 */
export function PictureCredit({ picture, strings, testID }: PictureCreditProps) {
  const t = strings.find.picture;
  const [failed, setFailed] = useState(false);
  const licence = licenceDisplay(picture.licence);
  const licenceText = fillIn(t.licence, {
    licence: licence.kind === "public-domain" ? t.publicDomain : licence.name,
  });
  const deed = licence.kind === "named" ? licence.deed : null;

  function open(url: string): void {
    setFailed(false);
    Linking.openURL(url).catch(() => setFailed(true));
  }

  return (
    <View testID={testID} style={styles.credit}>
      <Text style={styles.note}>{t.caption}</Text>
      <Text style={styles.note}>{fillIn(t.author, { author: picture.author })}</Text>
      {deed !== null ? (
        <Pressable accessibilityRole="link" onPress={() => open(deed)}>
          <Text style={styles.link}>{licenceText}</Text>
        </Pressable>
      ) : (
        <Text style={styles.note}>{licenceText}</Text>
      )}
      <Text style={styles.note}>{t.resized}</Text>
      <Pressable accessibilityRole="link" onPress={() => open(picture.page)}>
        <Text style={styles.link}>{t.page}</Text>
      </Pressable>
      {failed && (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {t.linkFailed}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  picture: {
    width: "100%",
    aspectRatio: 4 / 3,
  },
  credit: {
    gap: 2,
  },
  note: {
    fontSize: 14,
  },
  link: {
    fontSize: 14,
    paddingVertical: 4,
    textDecorationLine: "underline",
  },
});
