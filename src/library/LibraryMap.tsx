import {
  Camera,
  Map as MapLibreMap,
  Marker,
  TransformRequestManager,
} from "@maplibre/maplibre-react-native";
import { Link } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import appJson from "../../app.json";
import { config } from "../config/config";
import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
import { deviceLocationSource, locationPermission } from "../position/deviceLocation";
import type { ListedFind } from "../store/find";
import type { LibraryFilters } from "./filters";
import { type MapBounds, readViewBounds } from "./mapArea";
import { type OpeningArea, startOpening } from "./mapOpening";
import { type Pin, pinLabel, pinsInArea } from "./mapPins";
import { setMapUserAgent } from "./mapRequests";

type LibraryMapProps = {
  /** The Library's finds, newest first, as the store lists them. */
  readonly entries: readonly ListedFind[];
  readonly filters: LibraryFilters;
  readonly language: Language;
  readonly strings: Strings;
};

/** The area event of MapLibre's `onRegionDidChange`, read as unknown until it is checked. */
type RegionEvent = { readonly nativeEvent?: { readonly bounds?: unknown } } | undefined;

/**
 * The Library's map (docs/SPEC.md 3.9, The Library, PBI-2.8). When it opens it sets the app's own
 * User-Agent on the map's requests, and finds its opening area (`startOpening`: the phone's
 * position, the newest find with one that passes the filters, or the default area), saying so while it waits; it then
 * shows OpenFreeMap's tiles through MapLibre, with the library's attribution "(i)" button and its
 * logo, as they are by default. The pins are the finds that pass the Library's filters and lie in
 * the area shown, which follows each zoom and pan as the map reports it. Tapping a pin shows its
 * find's species, or "not identified", and its date, which open the find; tapping the map, or the
 * find leaving the area shown, closes that. No offline areas are downloaded; the map uses what its
 * cache holds, and says so when it cannot load its style. The location engine is the library's
 * default (app.json), which the app itself does not use: the position comes from expo-location.
 */
export function LibraryMap({ entries, filters, language, strings }: LibraryMapProps) {
  const [opening, setOpening] = useState<OpeningArea | null>(null);
  const [area, setArea] = useState<MapBounds | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * The finds and filters when the map opens, for its fallback; a later read or filter change
   * does not move the map.
   */
  const openedWith = useRef({ entries, filters });

  useEffect(() => {
    setMapUserAgent(TransformRequestManager, appJson.expo);
    const started = startOpening({
      permission: locationPermission,
      location: deviceLocationSource,
      now: Date.now,
      entries: openedWith.current.entries,
      filters: openedWith.current.filters,
    });
    let live = true;
    void started.area.then((found) => {
      if (live) {
        setOpening(found);
        setArea(found.bounds);
      }
    });
    return () => {
      live = false;
      started.cancel();
    };
  }, []);

  const pins = useMemo(
    () => (area === null ? [] : pinsInArea(entries, filters, area)),
    [entries, filters, area],
  );
  const chosen = pins.find((pin) => pin.id === selected) ?? null;

  if (opening === null) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator testID="map-opening" />
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {strings.log.mapOpening}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapLibreMap
        style={styles.map}
        mapStyle={config.mapStyleUrl}
        attribution
        logo
        onRegionDidChange={(event: RegionEvent) => {
          const shown = readViewBounds(event?.nativeEvent?.bounds);
          if (shown !== null) {
            setArea(shown);
          }
        }}
        onPress={() => setSelected(null)}
        onDidFailLoadingMap={() => setFailed(true)}
        onDidFinishLoadingMap={() => setFailed(false)}
      >
        <Camera initialViewState={{ bounds: [...opening.bounds] }} />
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            id={String(pin.id)}
            lngLat={[pin.longitude, pin.latitude]}
            onPress={() => setSelected(pin.id)}
          >
            <View
              accessible
              accessibilityLabel={pinLabel(pin.find, language, strings).title}
              style={styles.pin}
            />
          </Marker>
        ))}
      </MapLibreMap>
      {failed && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {strings.log.mapFailed}
        </Text>
      )}
      {chosen !== null && <PinDetails pin={chosen} language={language} strings={strings} />}
    </View>
  );
}

type PinDetailsProps = {
  readonly pin: Pin;
  readonly language: Language;
  readonly strings: Strings;
};

/** What a tapped pin shows of its find: its species and date, which open the find's screen. */
function PinDetails({ pin, language, strings }: PinDetailsProps) {
  const { title, date } = pinLabel(pin.find, language, strings);
  return (
    <View testID="map-callout" style={styles.callout}>
      <Link href={`/find/${pin.id}`} asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={date === null ? title : `${title}, ${date}`}
          style={styles.calloutLink}
        >
          <Text style={styles.name}>{title}</Text>
          {date !== null && <Text style={styles.text}>{date}</Text>}
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 8,
  },
  map: {
    flex: 1,
  },
  centred: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#c0392b",
  },
  callout: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  calloutLink: {
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
  },
});
