import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useLanguage } from "../i18n/LanguageContext";
import { ScreenArea } from "../screen/ScreenArea";
import type { KeyValueStore } from "../storage/keyValueStore";
import { type AcceptanceAtStart, acceptDisclaimer, isDisclaimerAccepted } from "./acceptance";

type GateState = "loading" | "needed" | AcceptanceAtStart;

const AcceptanceContext = createContext<AcceptanceAtStart | null>(null);

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
 *
 * The gate tells the app it lets through whether the acceptance was read or given at this start
 * (`useAcceptanceAtStart`), which the version history's decision needs (docs/SPEC.md 3.10,
 * item 7). An acceptance that was given counts as given also when storing it failed.
 */
export function DisclaimerGate({ store, children }: DisclaimerGateProps) {
  const { strings } = useLanguage();
  const [state, setState] = useState<GateState>("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    isDisclaimerAccepted(store).then((accepted) => {
      if (mounted.current) {
        setState(accepted ? "read" : "needed");
      }
    });
    return () => {
      mounted.current = false;
    };
  }, [store]);

  const accept = useCallback(() => {
    acceptDisclaimer(store).then(() => {
      if (mounted.current) {
        setState("given");
      }
    });
  }, [store]);

  if (state === "read" || state === "given") {
    return <AcceptanceContext.Provider value={state}>{children}</AcceptanceContext.Provider>;
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

/**
 * Whether the disclaimer's acceptance was read from the store or given at this start. Only what
 * the gate has let through can ask.
 */
export function useAcceptanceAtStart(): AcceptanceAtStart {
  const acceptance = useContext(AcceptanceContext);
  if (acceptance === null) {
    throw new Error("useAcceptanceAtStart must be used inside a DisclaimerGate");
  }
  return acceptance;
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
