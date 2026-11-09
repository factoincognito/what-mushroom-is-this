# Changelog

All notable changes to What mushroom is this? are documented here.

## [Unreleased]

### Added

- The specification, from the approved design (#4, #7, #9, #10, #13).
- The image module: the resize to the model's image limits and the JPEG
  segment check (#5).
- The app shell: routes, the three languages, the disclaimer at first
  start (#6).
- The analysis module: the request, the answer's validation and the
  error classes (#8, #15).
- The find log store: the database and the photo files (#11).
- Settings: the API key, the model and the kept language (#12).
- New find: camera and gallery, the gallery photo's time and position, and
  the photo prepared for analysis (#14).
- The analysis queue: its triggers, stops, restarts and messages, and
  "analyse now" on the Log screen (#17).
- Out of Android's backups and device transfers: the find log, the photos
  and the settings; and the About view with the licences (#21).
- The Log and Find screens: names, edibility with the disclaimer,
  look-alikes, position and time, the map link, analyse again and delete
  (#24).
- EAS Build for Android: the link to the Expo project, and the `preview`
  profile for an installable APK, with the backup excludes marked for
  lint and the unused Wi-Fi state and overlay permissions blocked (#39,
  #40, #42).
- Phase 2's specification, approved by Adam: text lookup, several photos
  per find, a 1–100 confidence, the Library with a map, a Wikimedia
  picture and a self-check for text lookups (#47, #50).
- The store at schema version 2, with a migration that keeps every
  Phase 1 find (#49).

### Changed

- The analysis module: a key that belongs to no workspace is refused, a
  refused answer fails only its find, and an answer's text blocks are
  joined (#18).
- The image module checks the input of its token count (#19).
- The queue fails a find only when its photo cannot be read, and stops
  on other errors; a refused answer and a key in no workspace get their
  own messages (#23).
- The phone's position for a new find, with the first fix within 30
  seconds for a find saved without one (#16).
- Two failed photo loads in a row stop the queue (#27).
- Test gaps closed (#28).
- The key: kept after a failed first-start clearing, and Remove offered
  when the store cannot be read (#29).
- The store: a stricter schema, one store, and unreadable finds shown in
  their place rather than hiding the Log (#26).
- `expo` and `jest-expo` at the versions SDK 57 expects (#31).
- New find: the photo is not dropped without a question, and the iOS
  permission texts are in the three languages (#32).
- Follow-ups from the reviews: a find whose ID cannot be read can be
  deleted from its Log row, and a damaged ID or photo name no longer fails
  the list or the opening (#33).
- The last follow-ups: a delete removes the photo only when the find went,
  a new find gets a readable ID after a damaged one, and the development
  tools' notices are tested (#36).
- The first New find, Find and Log tests no longer time out under load:
  the router's first load is paid before them (#38).
- The app is named Washroom on the phone (#41).
- One copy of `expo-font`, the SDK 57 version, is installed; the first
  build had two (#45).

## Project created

- Bootstrapped from the Clead + Crog project template
  v2.9.2, built from
  factoincognito/ai-project-template-v2@8d5ee3bd90cc6632a3510c497f175a748bd2790a.
- Language pack: react-native.
- Licence: polyform-noncommercial-1.0.0.
- Set up by bootstrap-project.sh.
