/**
 * MapLibre React Native in every Jest test (Jest uses a mock beside `node_modules` without
 * `jest.mock`): its map cannot run under Jest, as it draws through MapLibre Native. The parts the
 * app uses are stood in for at the library's boundary (PBI-2.8):
 *
 * - `Map` and `Camera` are plain views that carry the props they are given, so a test reads the
 *   style, the attribution and logo settings and the camera's opening area from them, and fires
 *   their events (`fireEvent(map, "regionDidChange", event)`);
 * - `Marker` is a button, `maplibre-marker-<id>`, whose press calls the marker's `onPress` with
 *   the event the library gives, and renders its one child;
 * - `TransformRequestManager.addHeader` is a mock function, so a test sees the header set on the
 *   map's requests.
 *
 * Typed against the library's own declarations and type-checked, as `expo-network.ts` here, so a
 * change of the library's shape fails `npm run typecheck`. Only types are imported: a value
 * imported from "@maplibre/maplibre-react-native" here would be this file.
 */
import type * as MapLibre from "@maplibre/maplibre-react-native";
import { createElement, type ReactElement } from "react";
import { type NativeSyntheticEvent, Pressable, View } from "react-native";

function MapView({ children, ...props }: MapLibre.MapProps): ReactElement {
  return createElement(View, { ...props, testID: props.testID ?? "maplibre-map" }, children);
}

function CameraView(props: MapLibre.CameraProps): ReactElement {
  return createElement(View, { ...props, testID: props.testID ?? "maplibre-camera" });
}

function MarkerView({ id, lngLat, onPress, children }: MapLibre.MarkerProps): ReactElement {
  const event = { nativeEvent: { id: id ?? "", lngLat, point: [0, 0] } };
  return createElement(
    Pressable,
    {
      testID: `maplibre-marker-${id ?? ""}`,
      accessibilityRole: "button",
      onPress: () => onPress?.(event as unknown as NativeSyntheticEvent<MapLibre.MarkerEvent>),
    },
    children,
  );
}

export { CameraView as Camera, MapView as Map, MarkerView as Marker };

type AddHeader = (typeof MapLibre.TransformRequestManager)["addHeader"];

export const TransformRequestManager: {
  addHeader: jest.MockedFunction<AddHeader>;
} = {
  addHeader: jest.fn<ReturnType<AddHeader>, Parameters<AddHeader>>(
    (options) => options.id ?? "header",
  ),
};
