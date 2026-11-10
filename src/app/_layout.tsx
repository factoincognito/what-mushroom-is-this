import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { DisclaimerGate } from "../disclaimer/DisclaimerGate";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";
import { KeyProvider } from "../key/KeyContext";
import { deviceSecretStore } from "../key/secureStore";
import { LibraryFiltersProvider } from "../library/LibraryFiltersContext";
import { QueueProvider } from "../queue/QueueContext";
import { deviceStore } from "../storage/keyValueStore";
import { openFindLog } from "../store/deviceFindStore";
import { FindLogProvider } from "../store/FindLogContext";

/**
 * The root layout: the language, the key (whose first-start clearing runs at once), the find
 * log (opened when a screen first needs it), then the first-start disclaimer, then the analysis
 * queue, which runs only once the disclaimer is accepted, then the Library's filters, held while
 * the app runs (docs/SPEC.md 3.9), then the screens.
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

function Screens() {
  const { strings } = useLanguage();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: strings.log.title }} />
      <Stack.Screen name="new-find" options={{ title: strings.newFind.title }} />
      <Stack.Screen name="text-lookup" options={{ title: strings.lookup.title }} />
      <Stack.Screen name="settings" options={{ title: strings.settings.title }} />
      <Stack.Screen name="about" options={{ title: strings.about.title }} />
      <Stack.Screen name="+not-found" options={{ title: strings.notFound.title }} />
    </Stack>
  );
}
