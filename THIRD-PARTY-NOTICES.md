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

All the libraries below are under permissive licences (Appendix A.3). Their
copyright and licence texts ship inside each package, in `node_modules/`.

Intended use (Appendix A.1, 3): the libraries under "In the app" are built
into the app, and are recorded as for a commercial product, the stricter
category, which permissive licences allow. The libraries under
"Development tools" are used only to build and check the code and are not
shipped in the app (internal tooling).

## In the app

| Library | Version | Licence | Mode | Source | Added for |
|---|---|---|---|---|---|
| `expo` | 57.0.26 | MIT | depend | https://github.com/expo/expo, `packages/expo` | the Expo SDK (project setup) |
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
| `expo-location` | 57.0.23 | MIT | depend | https://github.com/expo/expo, `packages/expo-location` | the position of a new find (PBI-1.6). **Parked**: its Android side builds in `com.google.android.gms:play-services-location` 21.0.1 from Maven (its `android/build.gradle`), Google's vendor SDK under Google's terms, which the policy escalates (Appendix A.2, A.3); it is not used until the Product Office decides in writing |
| `expo-image-picker` | 57.0.21 | MIT | depend | https://github.com/expo/expo, `packages/expo-image-picker` | the camera and the gallery of a new find (PBI-1.6). Its Android side builds in the native libraries below, from Maven, not npm (its `android/build.gradle`) |

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

## Development tools

| Library | Version | Licence | Mode | Source | Added for |
|---|---|---|---|---|---|
| `@biomejs/biome` | 2.5.15 | MIT OR Apache-2.0 | depend | https://github.com/biomejs/biome, `packages/@biomejs/biome` | lint and format (project setup) |
| `@react-native/jest-preset` | 0.86.3 | MIT (`package.json`; the package ships no licence file) | depend | https://github.com/react/react-native, `packages/jest-preset` | the Jest preset of React Native (project setup) |
| `@testing-library/react-native` | 14.0.1 | MIT | depend | https://github.com/callstack/react-native-testing-library | component tests (project setup) |
| `@types/jest` | 29.5.14 | MIT | depend | https://github.com/DefinitelyTyped/DefinitelyTyped, `types/jest` | Jest's types (project setup) |
| `@types/react` | 19.2.18 | MIT | depend | https://github.com/DefinitelyTyped/DefinitelyTyped, `types/react` | React's types (project setup) |
| `jest` | 29.7.0 | MIT | depend | https://github.com/jestjs/jest, `packages/jest` | the test runner (project setup) |
| `jest-expo` | 57.0.5 | MIT | depend | https://github.com/expo/expo, `packages/jest-expo` | the Jest preset of Expo (project setup) |
| `test-renderer` | 1.2.0 | MIT (`package.json`; the package ships no licence file) | depend | https://github.com/mdjastrzebski/test-renderer | the renderer of the component tests (project setup) |
| `typescript` | 6.0.3 | Apache-2.0 | depend | https://github.com/microsoft/TypeScript | the type check (project setup) |
