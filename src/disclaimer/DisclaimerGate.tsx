import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import { ScreenArea } from "../screen/ScreenArea";
import type { KeyValueStore } from "../storage/keyValueStore";
import { acceptDisclaimer, isDisclaimerAccepted } from "./acceptance";

type GateState = "loading" | "needed" | "accepted";

type DisclaimerGateProps = {
  readonly store: KeyValueStore;
  readonly children: ReactNode;
};

/**
 * Shows the disclaimer of docs/SPEC.md 3.5, to be accepted, the first time the app is opened,
 * and the app only after that (docs/SPEC.md 3.1). If storing the acceptance fails, the app
 * still opens, and the disclaimer is asked for again at the next start. What the gate itself
 * shows is laid out clear of the system bars and the display cutout (`ScreenArea`, PBI-2.20); the
 * app it lets through is not wrapped, since its screens keep clear themselves.
 */
export function DisclaimerGate({ store, children }: DisclaimerGateProps) {
  const { strings } = useLanguage();
  const [state, setState] = useState<GateState>("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    isDisclaimerAccepted(store).then((accepted) => {
      if (mounted.current) {
        setState(accepted ? "accepted" : "needed");
      }
    });
    return () => {
      mounted.current = false;
    };
  }, [store]);

  const accept = useCallback(() => {
    acceptDisclaimer(store).then(() => {
      if (mounted.current) {
        setState("accepted");
      }
    });
  }, [store]);

  if (state === "accepted") {
    return children;
  }
  // The gate's own views have no header above them, so their area takes the top inset too.
  if (state === "loading") {
    return (
      <ScreenArea top>
        <View style={styles.container} testID="disclaimer-loading">
          <ActivityIndicator />
        </View>
      </ScreenArea>
    );
  }
  return (
    <ScreenArea top>
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {strings.firstStart.title}
        </Text>
        <Text style={styles.text}>{strings.disclaimer}</Text>
        <Pressable accessibilityRole="button" onPress={accept} style={styles.button}>
          <Text style={styles.buttonText}>{strings.firstStart.accept}</Text>
        </Pressable>
      </View>
    </ScreenArea>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
  },
});
