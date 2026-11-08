import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { DisclaimerGate } from "../disclaimer/DisclaimerGate";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";
import { KeyProvider } from "../key/KeyContext";
import { deviceSecretStore } from "../key/secureStore";
import { deviceStore } from "../storage/keyValueStore";

/**
 * The root layout: the language, the key (whose first-start clearing runs at once), then the
 * first-start disclaimer, then the screens.
 */
export default function RootLayout() {
  return (
    <LanguageProvider store={deviceStore}>
      <KeyProvider secrets={deviceSecretStore} store={deviceStore}>
        <DisclaimerGate store={deviceStore}>
          <Screens />
        </DisclaimerGate>
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
      <Stack.Screen name="settings" options={{ title: strings.settings.title }} />
      <Stack.Screen name="+not-found" options={{ title: strings.notFound.title }} />
    </Stack>
  );
}
