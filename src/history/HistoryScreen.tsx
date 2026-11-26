import { Stack } from "expo-router";
import { useState } from "react";

import { useLanguage } from "../i18n/LanguageContext";
import { HISTORY } from "./entries";
import { useHistory } from "./HistoryContext";
import { HistoryView } from "./HistoryView";

/**
 * The version history screen (docs/SPEC.md 3.10, item 3), in its two forms. Opened by itself at a
 * start, it is titled "What's new" and shows the entries of the decision made at that start, with
 * the button "Show full history"; pressing the button makes it the other form, and it stays the
 * same screen. Opened in any other way (the link on About, an address from outside the app), it is
 * titled "Version history" and shows every entry, newest first.
 *
 * Which form it has comes from the decision the app holds (`takeWhatsNew`), taken once when the
 * screen is first shown. The screen reads nothing from its address, and nothing from the store.
 */
export function HistoryScreen() {
  const { strings } = useLanguage();
  const { takeWhatsNew } = useHistory();
  const [whatsNew, setWhatsNew] = useState(() => takeWhatsNew());
  const t = strings.history;
  return (
    <>
      <Stack.Screen options={{ title: whatsNew === null ? t.title : t.whatsNewTitle }} />
      <HistoryView
        entries={whatsNew ?? HISTORY}
        onShowFull={whatsNew === null ? null : () => setWhatsNew(null)}
      />
    </>
  );
}
