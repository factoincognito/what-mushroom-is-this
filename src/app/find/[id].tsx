import { Stack, useLocalSearchParams } from "expo-router";

import { parseFindId } from "../../find/display";
import { FindScreen } from "../../find/FindScreen";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * The route of a find's own screen, `/find/<id>` (docs/SPEC.md 3.1). It reads the ID from the
 * address, where only plain decimal digits name a find, and sets the screen's title here, so that
 * the root layout needs no entry for it.
 */
export default function FindRoute() {
  const { strings } = useLanguage();
  const { id } = useLocalSearchParams();
  return (
    <>
      <Stack.Screen options={{ title: strings.find.title }} />
      <FindScreen id={parseFindId(id)} />
    </>
  );
}
