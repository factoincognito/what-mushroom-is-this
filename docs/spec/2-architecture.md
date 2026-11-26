## 2. Architecture

The template's React Native pack (`languages/react-native/`): Expo SDK 57,
React Native 0.86, TypeScript strict, Biome, jest-expo with React Native
Testing Library, the 80% line coverage gate. Libraries are added with
`npx expo install`, and each is recorded under the third-party code and IP
policy when it is added. Expected: `expo-image-picker`,
`expo-image-manipulator`, `expo-location`, `expo-sqlite`,
`expo-file-system`, `expo-secure-store`, `expo-localization`,
`expo-network` (Known unknown 6), `expo-router` (its routes under
`src/app/`, so they count as code for the test-change
check and the coverage gate). Not checked yet: an SDK 57 version of each
(`npx expo install --check` settles it).

Logic lives in plain modules under `src/` that render nothing, each with
its own tests; the screens only wire them together. The modules:

| Module | Holds |
|---|---|
| config | the API address, the default model, each model's image limits, the request time limit, the API version, `max_tokens`, the bound on `retry-after`, the position limits (section 3.6) |
| i18n | the strings of the three app languages, and the language choice |
| key | the API key in the secure store; the first-start-after-install clearing |
| image | the resize rule, and the strip and the check of a JPEG's application segments |
| analysis | the request builder, the answer's shape and its validation, the error classes |
| queue | the finds waiting for analysis, when the queue runs and stops |
| store | the database of finds and the photo files |
| position | taking the position for a new find |
| history | the version history's entries in the three languages, the comparison of versions, what opens by itself after an upgrade, the version last seen (3.10; **[Clead]**, 2026-11-26, #131) |

Nothing leaves the phone except the photo sent for analysis (section 3.3).
There is no server. Phase 2 adds the text and the several photos of a
lookup, sent for analysis, the area the map shows, sent to the map
provider for its tiles, the Latin name of a text lookup's species, sent
to Wikimedia for its picture, and that picture, sent to Anthropic for the
self-check (3.9, Adam's decisions, 2026-11-09). The map provider's tiles
may come through Cloudflare as its CDN (3.9).

