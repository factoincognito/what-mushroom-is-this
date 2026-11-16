import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";

import { DisclaimerGate } from "../disclaimer/DisclaimerGate";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";
import { KeyProvider } from "../key/KeyContext";
import { deviceSecretStore } from "../key/secureStore";
import { LibraryFiltersProvider } from "../library/LibraryFiltersContext";
import { QueueProvider } from "../queue/QueueContext";
import { ScreenArea } from "../screen/ScreenArea";
import { deviceStore } from "../storage/keyValueStore";
import { openFindLog } from "../store/deviceFindStore";
import { FindLogProvider } from "../store/FindLogContext";

/**
 * The root layout: the language, the key (whose first-start clearing runs at once), the find
 * log (opened when a screen first needs it), then the first-start disclaimer, then the analysis
 * queue, which runs only once the disclaimer is accepted, then the Library's filters, held while
 * the app runs (docs/SPEC.md 3.9), then the screens, each laid out clear of the system bars
 * (`screenLayout`).
 */
export default function RootLayout() {
  return (
    <LanguageProvider store={deviceStore}>
      <KeyProvider secrets={deviceSecretStore} store={deviceStore}>
        <FindLogProvider open={openFindLog}>
          <DisclaimerGate store={deviceStore}>
            <QueueProvider>
              <LibraryFiltersProvider>
                <Screens />
              </LibraryFiltersProvider>
            </QueueProvider>
          </DisclaimerGate>
        </FindLogProvider>
      </KeyProvider>
      <StatusBar style="auto" />
    </LanguageProvider>
  );
}

/**
 * The layout of every screen of the stack, also of one this file does not name: inside the area
 * clear of the navigation bar and the display cutout (PBI-2.20). The stack's header, above the
 * screen, keeps clear of the status bar itself, so the area leaves the top inset to it; a screen
 * shown without that header would need the top inset from its area.
 */
function screenLayout({ children }: { readonly children: ReactNode }) {
  return <ScreenArea top={false}>{children}</ScreenArea>;
}

function Screens() {
  const { strings } = useLanguage();
  return (
    <Stack screenLayout={screenLayout}>
      <Stack.Screen name="index" options={{ title: strings.log.title }} />
      <Stack.Screen name="new-find" options={{ title: strings.newFind.title }} />
      <Stack.Screen name="text-lookup" options={{ title: strings.lookup.title }} />
      <Stack.Screen name="settings" options={{ title: strings.settings.title }} />
      <Stack.Screen name="about" options={{ title: strings.about.title }} />
      <Stack.Screen name="+not-found" options={{ title: strings.notFound.title }} />
    </Stack>
  );
}
