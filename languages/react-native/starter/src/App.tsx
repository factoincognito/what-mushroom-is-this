/**
 * Starter root component — replace with your own app.
 * Keep calculations and other logic in plain modules next to it, so Jest can test them directly.
 */
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export function greeting(name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? "Hello!" : `Hello, ${trimmed}!`;
}

type AppProps = {
  name?: string;
};

export default function App({ name = "" }: AppProps) {
  return (
    <View style={styles.container}>
      <Text>{greeting(name)}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
