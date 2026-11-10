# Third-party notices

The third-party libraries this project depends on, as the product office's
policy on third-party code and IP requires (`policies/third-party-ip.md`
in `factoincognito/product-office`, rule 1 and Appendix A.1). Each item
that adds a library records it here in the same change.

Each entry gives the library's exact version, its licence as the
installed package states it (the `license` field of its `package.json`,
and its licence file where the package ships one), the mode of use and
its source: the repository its `package.json` names and, where it names
one, the package's directory in that repository. The mode is "depend" for
every entry: the project uses the library as a package from npm and copies
none of its code.

All the libraries below are under permissive licences (Appendix A.3), except
Google's Play services libraries, a vendor SDK under Google's terms, which the
Product Office allowed by decision (their section below), and five Maven
libraries MapLibre React Native builds in, whose licences PBI-2.8 could not read
(their section below; to be read before the merge). The copyright and
licence texts of the npm packages ship inside each package, in `node_modules/`.

Intended use (Appendix A.1, 3): the libraries under "In the app" are built
into the app, and are recorded as for a commercial product, the stricter
category, which permissive licences allow. The libraries under
"Development tools" are used only to build and check the code and are not
shipped in the app (internal tooling).

## In the app

| Library | Version | Licence | Mode | Source | Added for |
|---|---|---|---|---|---|
| `expo` | 57.0.32 | MIT | depend | https://github.com/expo/expo, `packages/expo` | the Expo SDK (project setup) |
| `expo-status-bar` | 57.0.1 | MIT | depend | https://github.com/expo/expo, `packages/expo-status-bar` | the status bar (project setup) |
| `react` | 19.2.3 | MIT | depend | https://github.com/facebook/react, `packages/react` | React (project setup) |
| `react-native` | 0.86.3 | MIT | depend | https://github.com/react/react-native, `packages/react-native` | React Native (project setup) |
| `expo-router` | 57.0.30 | MIT (`package.json`; the package ships no licence file) | depend | https://github.com/expo/expo, `packages/expo-router` | the screens and their routes (PBI-1.1) |
| `expo-constants` | 57.0.23 | MIT | depend | https://github.com/expo/expo, `packages/expo-constants` | a peer library of `expo-router` (PBI-1.1) |
| `expo-linking` | 57.0.13 | MIT | depend | https://github.com/expo/expo, `packages/expo-linking` | a peer library of `expo-router` (PBI-1.1) |
| `react-native-safe-area-context` | 5.7.0 | MIT | depend | https://github.com/AppAndFlow/react-native-safe-area-context | a peer library of `expo-router` (PBI-1.1) |
| `react-native-screens` | 4.26.2 | MIT | depend | https://github.com/software-mansion/react-native-screens | a peer library of `expo-router` (PBI-1.1) |
| `react-dom` | 19.2.3 | MIT | depend | https://github.com/facebook/react, `packages/react-dom` | a peer library of libraries `expo-router` depends on (PBI-1.1) |
| `react-native-gesture-handler` | 2.32.0 | MIT | depend | https://github.com/software-mansion/react-native-gesture-handler | a peer library of `react-native-drawer-layout`, which `expo-router` depends on (PBI-1.1) |
| `react-native-reanimated` | 4.5.1 | MIT | depend | https://github.com/software-mansion/react-native-reanimated, `packages/react-native-reanimated` | a peer library of `react-native-drawer-layout`, which `expo-router` depends on (PBI-1.1) |
| `react-native-worklets` | 0.10.1 | MIT | depend | https://github.com/software-mansion/react-native-reanimated, `packages/react-native-worklets` | a peer library of `react-native-reanimated` (PBI-1.1) |
| `expo-localization` | 57.0.2 | MIT | depend | https://github.com/expo/expo, `packages/expo-localization` | the phone's language (PBI-1.1) |
| `@react-native-async-storage/async-storage` | 2.2.0 | MIT | depend | https://github.com/react-native-async-storage/async-storage, `packages/default-storage-backend` | the plain key-value store: the first-start acceptance of the disclaimer (PBI-1.1) |
| `expo-sqlite` | 57.0.4 | MIT | depend | https://github.com/expo/expo, `packages/expo-sqlite` | the find log's database (PBI-1.5). It builds in the SQLite it ships in `vendor/sqlite3/` (3.50.3), whose authors disclaim copyright and dedicate it to the public domain; its SQLCipher build (`vendor/sqlcipher/`) is used only when `useSQLCipher` is set, which this project does not set |
| `expo-file-system` | 57.0.7 | MIT | depend | https://github.com/expo/expo, `packages/expo-file-system` | the finds' photo files (PBI-1.5) |
| `expo-secure-store` | 57.0.4 | MIT | depend | https://github.com/expo/expo, `packages/expo-secure-store` | the API key in the secure store (PBI-1.2) |
| `expo-image-manipulator` | 57.0.22 | MIT | depend | https://github.com/expo/expo, `packages/expo-image-manipulator` | resizing and re-encoding the photo for analysis as JPEG (PBI-1.6) |
| `expo-image-loader` | 57.0.1 | MIT | depend | https://github.com/expo/expo, `packages/expo-image-loader` | a dependency of `expo-image-picker` and `expo-image-manipulator`, installed with them (PBI-1.6) |
| `expo-image-picker` | 57.0.21 | MIT | depend | https://github.com/expo/expo, `packages/expo-image-picker` | the camera and the gallery of a new find (PBI-1.6). Its Android side builds in the native libraries below, from Maven, not npm (its `android/build.gradle`) |
| `expo-network` | 57.0.3 | MIT | depend | https://github.com/expo/expo, `packages/expo-network` | the queue's "network is back" trigger (PBI-1.7, Known unknown 6). It builds in no other native library: its `android/build.gradle` adds test-only dependencies, and the POM of its prebuilt Android module names only `kotlin-stdlib-jdk7` 2.1.20, `org.jetbrains:annotations` 23.0.0 and `pika-api` 0.3.2, which the POMs of `expo-secure-store`, `expo-sqlite` and `expo-localization` here already name; on Android it uses the platform's `ConnectivityManager`, on iOS Apple's `Network` and `SystemConfiguration` frameworks (its `ios/ExpoNetwork.podspec` depends only on `ExpoModulesCore`) |
| `expo-location` | 57.0.23 | MIT | depend | https://github.com/expo/expo, `packages/expo-location` | the phone's position for a new find (PBI-1.19). Its Android side builds in Google's `play-services-location`, below, from Maven, not npm (its `android/build.gradle`, and the POM of its prebuilt Android module, which otherwise names only `kotlin-stdlib-jdk7` 2.1.20, `org.jetbrains:annotations` 23.0.0 and `pika-api` 0.3.2, as for `expo-network`); on iOS its `ios/ExpoLocation.podspec` depends only on `ExpoModulesCore` |
| `expo-font` | 57.0.4 | MIT | depend | https://github.com/expo/expo, `packages/expo-font` | one copy of the fonts library (PBI-1.30): a dependency of `expo`, and a peer library of `expo-symbols`, which `expo-router` depends on. Without it as a direct dependency, npm filled that peer with a version of the next SDK, beside the one `expo` brings |
| `expo-document-picker` | 57.0.3 | MIT | depend | https://github.com/expo/expo, `packages/expo-document-picker` | photos from the phone's files (PBI-2.6, Known unknown 13). Its Android side builds in the two libraries below, from Maven, not npm (its `android/build.gradle`); the POM of its prebuilt Android module otherwise names only `kotlin-stdlib-jdk7` 2.1.20, `org.jetbrains:annotations` 23.0.0 and `pika-api` 0.3.2, as for `expo-network`; on iOS its `ios/ExpoDocumentPicker.podspec` depends only on `ExpoModulesCore`. Its config plugin adds only iCloud entitlements, and only when `ios.usesIcloudStorage` is set (its `plugin/build/withDocumentPickerIOS.js`); `app.json` neither sets that nor lists the plugin |
| `@maplibre/maplibre-react-native` | 11.5.1 | MIT | depend | https://github.com/maplibre/maplibre-react-native | the Library's map (PBI-2.8, Known unknown 11), installed with `npx expo install` and pinned; its peer ranges (`expo >=54.0.0`, optional; `react-native >=0.80.0`; `react >=19.1.0`, from `npm view`) hold the app's 57.0.32, 0.86.3 and 19.2.3. Its licence file, `LICENSE.md`, names "MapLibre contributors" and "Mapbox". Its config plugin is in `app.json` with `locationEngine` "default", so its Android side builds in no Google location library (its `android/build.gradle`). It brings in these npm packages, each read from its installed `package.json`, all permissive; whether the shipped transitive npm packages are listed one by one is PBI-1.24's: `@maplibre/maplibre-gl-style-spec` 26.4.4 (ISC), `@mapbox/jsonlint-lines-primitives` 2.0.3 (MIT), `@mapbox/unitbezier` 1.0.0 (BSD-2-Clause), `json-stringify-pretty-compact` 4.0.0 (MIT), `minimist` 1.2.8 (MIT), `quickselect` 3.0.0 (ISC), `tinyqueue` 3.0.0 (ISC), `@turf/distance`, `@turf/helpers`, `@turf/invariant`, `@turf/length`, `@turf/meta` and `@turf/nearest-point-on-line` 7.4.0 (MIT), and the type package `@types/geojson` 7946.0.16 (MIT, not shipped). Its native libraries are in their own section below |

### The Android libraries `expo-image-picker` builds in

From Maven, not npm; no Gradle cache was at hand, so each licence was read from the pages named,
on 2026-11-09. Mode "depend" for each. All are Apache-2.0, a permissive licence (Appendix A.3),
whose NOTICE duty is PBI-1.9's.

| Library | Version | Licence | Mode | Source | Where the licence was read |
|---|---|---|---|---|---|
| `com.vanniktech:android-image-cropper` | 4.7.0 | Apache-2.0 ("The Apache Software License, Version 2.0") | depend | https://github.com/CanHub/Android-Image-Cropper | its 4.7.0 POM, as Maven Central shows it: https://central.sonatype.com/artifact/com.vanniktech/android-image-cropper |
| `org.jetbrains.kotlinx:kotlinx-coroutines-core` | 1.10.2 | Apache-2.0 | depend | https://github.com/Kotlin/kotlinx.coroutines | the POM of its JVM artifact, `kotlinx-coroutines-core-jvm` 1.10.2, on Maven Central: https://central.sonatype.com/artifact/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.10.2 |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | 1.10.2 | Apache-2.0 | depend | https://github.com/Kotlin/kotlinx.coroutines | the POM of version 1.11.0 on Maven Central, the page's current version, not 1.10.2's own: https://central.sonatype.com/artifact/org.jetbrains.kotlinx/kotlinx-coroutines-android |
| `androidx.activity:activity-ktx` | 1.11.0 | Apache-2.0 | depend | https://android.googlesource.com/platform/frameworks/support/ | not this version's POM (on Google's Maven, not reached): the Apache-2.0 header of its source, https://android.googlesource.com/platform/frameworks/support/+/2abd2315fd690a61c868684c93018ed79ad949d1/activity/activity-ktx/build.gradle, and version 1.13.0's licence on https://badges.mvnrepository.com/artifact/androidx.activity/activity-ktx/1.13.0 |
| `androidx.appcompat:appcompat` | 1.7.1 | Apache-2.0 | depend | https://android.googlesource.com/platform/frameworks/support/ | not this version's POM: the AndroidX repository it is built from, as for `activity-ktx` |
| `androidx.core:core-ktx` | 1.17.0 | Apache-2.0 | depend | https://android.googlesource.com/platform/frameworks/support/ | not this version's POM: the AndroidX repository it is built from, as for `activity-ktx` |
| `androidx.exifinterface:exifinterface` | 1.4.1 | Apache-2.0 | depend | https://android.googlesource.com/platform/frameworks/support/ | not this version's POM: the AndroidX repository it is built from, as for `activity-ktx` |

### The native libraries `expo-image-loader` and `expo-image-manipulator` build in

Read on 2026-11-09, as above. Mode "depend" for each. Both licences are permissive (Appendix
A.3). Their own dependencies (behind Glide, and `SDWebImage` and `libwebp` behind the WebP coder)
are for the release gate and PBI-1.9.

| Library | Version | Licence | Mode | Source | Where the licence was read |
|---|---|---|---|---|---|
| `com.github.bumptech.glide:glide` (Android, through `expo-image-loader`'s `android/build.gradle`) | 5.0.5 | BSD-2-Clause ("Simplified BSD License") and Apache-2.0 | depend | https://github.com/bumptech/glide | version 5.0.5's licences, "Apache 2.0" and "BSD", on https://badges.mvnrepository.com/artifact/com.github.bumptech.glide/glide/5.0.5/changes; their names and URLs from the POM on Maven Central, https://central.sonatype.com/artifact/com.github.bumptech.glide/glide, which shows version 5.0.9, not 5.0.5 |
| `SDWebImageWebPCoder` (iOS, a CocoaPods dependency in `expo-image-manipulator`'s `ios/ExpoImageManipulator.podspec`) | not pinned: the podspec names no version, so CocoaPods chooses it at the iOS build; the release gate fixes it and reads its licence for that version | MIT ("available under the MIT license") | depend | https://github.com/SDWebImage/SDWebImageWebPCoder | https://www.cocoapods.org/pods/SDWebImageWebPCoder, which shows version 0.15.0 |

### The Android libraries `expo-location` builds in

Google's vendor SDK and the AndroidX libraries it names, from Google's Maven repository, not
npm; read on 2026-11-09. Mode "depend".
`play-services-location` and the three Play services libraries its POM and theirs name are not
under a permissive licence: each POM names Google's "Android Software Development Kit License".
The policy escalates a vendor SDK in a product (Appendix A.2, A.3); the Product Office decided on
2026-11-09 that `expo-location` may be used with `play-services-location`, under Google's terms,
with what it brings in, and that the IP lawyer's review before release still applies (policy
rule 6): `DECISIONS.md` in `factoincognito/product-office` (private), row 2026-11-09,
https://github.com/factoincognito/product-office/blob/b4286388dbf779cc039d6b2b8a2028e888f7c0c6/DECISIONS.md?plain=1#L232.

Google's terms are a page at the address the POMs give; no package ships their text. So the About
view shows each library's name, version, the licence's name with that address, and its source, and
says that the licence text is not in the app. Whether the app should carry the terms' text is for
the release gate (PBI-1.24).

The POMs of `play-services-base` and `play-services-basement` name three AndroidX libraries, the
last three rows below. Each POM names "The Apache Software License, Version 2.0", a permissive
licence (Appendix A.3); the About view gives them the Apache License 2.0 text it holds for the
other Apache-2.0 libraries. Their own POMs name further AndroidX libraries (`androidx.annotation`,
`androidx.lifecycle`, `androidx.versionedparcelable`, `androidx.legacy`, `androidx.loader`),
whose licences were not read here.

Also for PBI-1.24 and the release gate: those further AndroidX libraries; the versions Gradle
resolves for these AndroidX libraries at the build, which were not checked and may be later than
those the POMs name; and the `third_party_licenses.txt` that
`play-services-location`'s AAR carries, the notices of 21 open-source components Google builds
into it.

| Library | Version | Licence | Mode | Source | Where the licence was read |
|---|---|---|---|---|---|
| `com.google.android.gms:play-services-location` (Android, through `expo-location`'s `android/build.gradle`) | 21.0.1 | Android Software Development Kit License, https://developer.android.com/studio/terms.html (Google's terms, as the POM names them; the page itself was not read) | depend | https://dl.google.com/dl/android/maven2/, `com/google/android/gms/play-services-location/21.0.1` | its 21.0.1 POM on Google's Maven: https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-location/21.0.1/play-services-location-21.0.1.pom |
| `com.google.android.gms:play-services-base` (Android, a dependency of `play-services-location`) | 18.1.0 | Android Software Development Kit License, https://developer.android.com/studio/terms.html (Google's terms, as the POM names them; the page itself was not read) | depend | https://dl.google.com/dl/android/maven2/, `com/google/android/gms/play-services-base/18.1.0` | its 18.1.0 POM on Google's Maven, read on 2026-11-09 by Clead: https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-base/18.1.0/play-services-base-18.1.0.pom |
| `com.google.android.gms:play-services-basement` (Android, a dependency of `play-services-base` and `play-services-tasks`) | 18.1.0 | Android Software Development Kit License, https://developer.android.com/studio/terms.html (Google's terms, as the POM names them; the page itself was not read) | depend | https://dl.google.com/dl/android/maven2/, `com/google/android/gms/play-services-basement/18.1.0` | its 18.1.0 POM on Google's Maven, read on 2026-11-09 by Clead: https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-basement/18.1.0/play-services-basement-18.1.0.pom |
| `com.google.android.gms:play-services-tasks` (Android, a dependency of `play-services-base`) | 18.0.2 | Android Software Development Kit License, https://developer.android.com/studio/terms.html (Google's terms, as the POM names them; the page itself was not read) | depend | https://dl.google.com/dl/android/maven2/, `com/google/android/gms/play-services-tasks/18.0.2` | its 18.0.2 POM on Google's Maven, read on 2026-11-09 by Clead: https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-tasks/18.0.2/play-services-tasks-18.0.2.pom |
| `androidx.collection:collection` (Android, named by the POMs of `play-services-base` and `play-services-basement`) | 1.0.0 | Apache-2.0 ("The Apache Software License, Version 2.0", as the POM names it) | depend | https://dl.google.com/dl/android/maven2/, `androidx/collection/collection/1.0.0` | its 1.0.0 POM on Google's Maven, read on 2026-11-09 by Clead: https://dl.google.com/dl/android/maven2/androidx/collection/collection/1.0.0/collection-1.0.0.pom |
| `androidx.core:core` (Android, named by the POMs of `play-services-base` and `play-services-basement`) | 1.2.0 | Apache-2.0 ("The Apache Software License, Version 2.0", as the POM names it) | depend | https://dl.google.com/dl/android/maven2/, `androidx/core/core/1.2.0` | its 1.2.0 POM on Google's Maven, read on 2026-11-09 by Clead: https://dl.google.com/dl/android/maven2/androidx/core/core/1.2.0/core-1.2.0.pom |
| `androidx.fragment:fragment` (Android, named by the POMs of `play-services-base` and `play-services-basement`) | 1.0.0 | Apache-2.0 ("The Apache Software License, Version 2.0", as the POM names it) | depend | https://dl.google.com/dl/android/maven2/, `androidx/fragment/fragment/1.0.0` | its 1.0.0 POM on Google's Maven, read on 2026-11-09 by Clead: https://dl.google.com/dl/android/maven2/androidx/fragment/fragment/1.0.0/fragment-1.0.0.pom |

### The Android libraries `expo-document-picker` builds in

From Maven, not npm; no Gradle cache was at hand, and neither version's own POM was read: each
licence was read from the pages named, on 2026-11-10. Mode "depend" for each. Both are Apache-2.0,
a permissive licence (Appendix A.3); the About view gives them the Apache License 2.0 text it
holds for the other Apache-2.0 libraries. Their NOTICE duties (whether either carries a NOTICE
file was not checked), and the licence read from each version's own POM, are for PBI-1.24 and the
release gate.

| Library | Version | Licence | Mode | Source | Where the licence was read |
|---|---|---|---|---|---|
| `androidx.annotation:annotation` (Android, through `expo-document-picker`'s `android/build.gradle`) | 1.0.0 | Apache-2.0 ("The Apache Software License, Version 2.0") | depend | https://android.googlesource.com/platform/frameworks/support/ | not this version's POM: version 1.1.0's licence on https://badges.mvnrepository.com/artifact/androidx.annotation/annotation/1.1.0, and the AndroidX repository it is built from, as for `activity-ktx` |
| `commons-io:commons-io` (Android, through `expo-document-picker`'s `android/build.gradle`) | 2.6 | Apache-2.0 | depend | https://commons.apache.org/proper/commons-io/ | not this version's POM: the Maven Central page, https://central.sonatype.com/artifact/commons-io/commons-io, which shows version 2.22.0, lists "Apache-2.0", and its POM's header says the ASF licenses it under the Apache License, Version 2.0 |

### The native libraries `@maplibre/maplibre-react-native` builds in

Mode "depend" for each. On Android, the libraries its `android/build.gradle` asks for, from
Maven, not npm, with the versions its `android/gradle.properties` gives, which the plugin's
options in `app.json` leave as they are (only `locationEngine`, at its default): the native
variant is the plugin's default, "opengl". The same file also asks for
`androidx.appcompat:appcompat` 1.7.1, recorded above for `expo-image-picker` at that version, and
`androidx.annotation:annotation` 1.9.1, recorded above for `expo-document-picker` at 1.0.0 (Gradle
builds in one version of each; which one it resolves was not checked), and for React Native's
`react-android` and Kotlin's `kotlin-stdlib`, which come with the app. On iOS, the MapLibre
Native that its `MapLibreReactNative.podspec` names, added through Swift Package Manager.

Read on 2026-11-10. No Gradle cache was at hand. Fetching the POMs and licence pages needed an
approval that nobody answered, and the GitHub API refused the MapLibre repositories for this
session; so none of these libraries' own POMs or licence files was read in PBI-2.8. The
licence of MapLibre Native, Android and iOS, is the one PBI-2.1's findings give for its
repository (product office, `library/designs/what-mushroom-is-this/phase-2-checks.md`, section
1: BSD-2-Clause), not read again here; its licence text, which BSD-2-Clause asks to reach the
user, is not in the app yet. The licences marked "not read" are to be read, and the About view's
entries completed, before this change merges (policy rule 1, the merge gate). The vulkan flavour of
`android-sdk` 13.6.1, read for PBI-2.1, declares `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
and `ACCESS_WIFI_STATE`; the app keeps blocking `ACCESS_WIFI_STATE` (`app.json`, PBI-1.10).

| Library | Version | Licence | Mode | Source | Where the licence was read |
|---|---|---|---|---|---|
| `org.maplibre.gl:android-sdk-opengl` (Android, MapLibre Native) | 13.6.1 | BSD-2-Clause | depend | https://github.com/maplibre/maplibre-native | not this artefact's POM: MapLibre Native's repository, as PBI-2.1's findings give it; not read again here |
| `org.maplibre.gl:android-plugin-annotation-v9` (Android) | 3.0.2 | not read (PBI-2.8: the POM could not be fetched) | depend | https://central.sonatype.com/artifact/org.maplibre.gl/android-plugin-annotation-v9 | not read |
| `org.maplibre.gl:android-plugin-scalebar-v9` (Android) | 3.0.2 | not read (PBI-2.8: the POM could not be fetched) | depend | https://central.sonatype.com/artifact/org.maplibre.gl/android-plugin-scalebar-v9 | not read |
| `org.maplibre.gl:android-sdk-turf` (Android) | 6.0.1 | not read (PBI-2.8: the POM could not be fetched) | depend | https://central.sonatype.com/artifact/org.maplibre.gl/android-sdk-turf | not read |
| `com.squareup.okhttp3:okhttp` (Android) | 4.12.0 | not read (PBI-2.8: the POM could not be fetched) | depend | https://central.sonatype.com/artifact/com.squareup.okhttp3/okhttp | not read |
| `com.squareup.okhttp3:okhttp-urlconnection` (Android) | 4.12.0 | not read (PBI-2.8: the POM could not be fetched) | depend | https://central.sonatype.com/artifact/com.squareup.okhttp3/okhttp-urlconnection | not read |
| `androidx.vectordrawable:vectordrawable` (Android) | 1.2.0 | Apache-2.0 | depend | https://android.googlesource.com/platform/frameworks/support/ | not this version's POM: the AndroidX repository it is built from, as for `activity-ktx` |
| `maplibre-gl-native-distribution` (iOS, MapLibre Native, the Swift package `MapLibre`) | 6.31.0 | BSD-2-Clause | depend | https://github.com/maplibre/maplibre-gl-native-distribution | not this package's licence file: MapLibre Native's repository, as PBI-2.1's findings give it for iOS 6.31.0; not read again here |

## Map data

The map's tiles, style, glyphs and sprites come from OpenFreeMap (`tiles.openfreemap.org`), as
data, not as a library (SPEC 3.9; the escalation of OpenFreeMap's terms decided by Adam,
2026-11-09 21:27). The map credits them through MapLibre's "(i)" button, which lists the
attributions the style's sources give: for OpenFreeMap "OpenFreeMap", "© OpenMapTiles" and "Data
from OpenStreetMap", each linked, OpenStreetMap to its copyright page (PBI-2.1's findings, section
5; not seen on a phone). The About view lists the credits below. Their licences, from OpenFreeMap's
licence file (https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md, read 2026-11-10) and
PBI-2.1's findings: the map data is OpenStreetMap's, under the ODbL; OpenMapTiles' design is CC
BY 4.0 and its code BSD-3-Clause; the Liberty style is a fork of OSM Liberty, itself a fork of OSM
Bright, its design CC BY 4.0 and its code BSD-3-Clause. The style also loads the Noto Sans glyphs
(SIL Open Font License 1.1), the Maki icons (CC0 1.0) and a public-domain arrow, and Natural Earth
data (public domain), which ask for no credit. The style's own JSON was not read in PBI-2.8 (its
fetch needed an approval nobody answered).

| Name | Credit | Licence | Link |
|---|---|---|---|
| `OpenStreetMap` | © OpenStreetMap contributors | Open Database License (ODbL) 1.0 | https://www.openstreetmap.org/copyright |
| `OpenMapTiles` | © OpenMapTiles | design CC BY 4.0, code BSD-3-Clause | https://github.com/openmaptiles/openmaptiles |
| `OpenFreeMap Liberty` | OpenFreeMap; the Liberty style, a fork of OSM Liberty, itself a fork of OSM Bright | design CC BY 4.0, code BSD-3-Clause | https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md |

## Development tools

| Library | Version | Licence | Mode | Source | Added for |
|---|---|---|---|---|---|
| `@biomejs/biome` | 2.5.15 | MIT OR Apache-2.0 | depend | https://github.com/biomejs/biome, `packages/@biomejs/biome` | lint and format (project setup) |
| `@react-native/jest-preset` | 0.86.3 | MIT (`package.json`; the package ships no licence file) | depend | https://github.com/react/react-native, `packages/jest-preset` | the Jest preset of React Native (project setup) |
| `@testing-library/react-native` | 14.0.1 | MIT | depend | https://github.com/callstack/react-native-testing-library | component tests (project setup) |
| `@types/jest` | 29.5.14 | MIT | depend | https://github.com/DefinitelyTyped/DefinitelyTyped, `types/jest` | Jest's types (project setup) |
| `@types/react` | 19.2.18 | MIT | depend | https://github.com/DefinitelyTyped/DefinitelyTyped, `types/react` | React's types (project setup) |
| `jest` | 29.7.0 | MIT | depend | https://github.com/jestjs/jest, `packages/jest` | the test runner (project setup) |
| `jest-expo` | 57.0.6 | MIT | depend | https://github.com/expo/expo, `packages/jest-expo` | the Jest preset of Expo (project setup) |
| `test-renderer` | 1.2.0 | MIT (`package.json`; the package ships no licence file) | depend | https://github.com/mdjastrzebski/test-renderer | the renderer of the component tests (project setup) |
| `typescript` | 6.0.3 | Apache-2.0 | depend | https://github.com/microsoft/TypeScript | the type check (project setup) |
