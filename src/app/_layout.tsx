import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { DisclaimerGate } from "../disclaimer/DisclaimerGate";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";
import { deviceStore } from "../storage/keyValueStore";

/** The root layout: the language, then the first-start disclaimer, then the screens. */
export default function RootLayout() {
  return (
    <LanguageProvider>
      <DisclaimerGate store={deviceStore}>
        <Screens />
      </DisclaimerGate>
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
    </Stack>
  );
}
