import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ScreenAreaProps = {
  /**
   * Whether the area keeps clear of the top inset too. A screen of the stack does not: its
   * header lies above it and takes that inset. What is drawn with nothing above it does.
   */
  readonly top: boolean;
  readonly children: ReactNode;
};

/**
 * The part of the display where a screen lays out what the user needs, clear of the system bars
 * and the display cutout (PBI-2.20). On Android the app's window covers the whole display, also
 * behind the status bar and the navigation bar (edge-to-edge), so a screen that fills the window
 * draws its last control behind the navigation buttons. The area fills the space it is given and
 * pads it by the insets the phone reports: the bottom, the left and the right, and the top when
 * `top` says so. The insets come from the safe-area provider above, which expo-router's root
 * gives every route; without one this throws, rather than draw behind the bars.
 *
 * It is the one place that reads the insets: a screen inside it adds none of its own.
 */
export function ScreenArea({ top, children }: ScreenAreaProps) {
  const insets = useSafeAreaInsets();
  // The insets are known only when the app runs, so they cannot be in the style sheet.
  const clear = {
    paddingTop: top ? insets.top : 0,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };
  return (
    <View testID="screen-area" style={[styles.area, clear]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    flex: 1,
  },
});
