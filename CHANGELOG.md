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
  picture and a self-check for text lookups (#47, #50, #56, #58, #62,
  #69, #72, #76, #78, #82, #85).
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
- The answer's confidence is a whole number from 1 to 100, and below 70
  the edibility shown is "unknown"; Phase 1 finds keep their level (#52).
- Text lookups: a description of up to 2,000 characters, saved as a find
  or analysed unsaved by a "Save" switch whose starting value is in
  Settings; a text answer's edibility is "unknown" until its self-check
  agrees (#54).
- Several photos per find: up to 5, added in batches from New find or a
  find's screen, all sent in one labelled request with the find's text;
  a photo can be removed, and photos added to an analysed find wait for
  a new analysis while the find keeps its answer (#57).
- A "Save" switch on a new photo lookup, on by default from Settings: an
  unsaved photo lookup is analysed on its screen and nothing of it is
  kept (#61).
- The Library replaces the Log as the start screen: the finds with
  species, year and month filters, held while the app runs; a text find
  without photos shows a text mark (#63).
- Photos from the phone's files, beside the camera and the gallery: images
  only, with no time or position of their own (#66).
- The Library's map: MapLibre with OpenFreeMap's tiles, opening on the
  phone's position, the finds that pass the filters as pins, with the
  map data's attribution; the iOS location text now says the map's
  provider sees the area shown (#68).
- A text lookup's answer gets a representative picture of the species
  from Wikimedia Commons, credited, under an allowlist of licences; it is
  shown on the find, the lookup screen and in the Library (#71).
- The self-check of a text lookup: a photo lookup on the representative
  picture; the text answer's edibility is shown only when the check names
  the same genus and species (#75).
- Follow-ups that need no phone: a new find's ID stays readable after a
  damaged ID of 2^53 − 1, the unused permission to read shared storage is
  blocked, and the tests check the app's own texts for its old name, the
  Expo project link, and every native module for a second version (#79).
- An answer from the API holds its confidence as a number by type, so a
  Phase 1 level cannot be written as a new answer; a find whose stored
  confidence and answer disagree is shown as one that cannot be read
  (#81).
- The store at schema version 3: each answer records whether it came from
  the text alone or from photos, and "no mushroom" and "cannot tell" speak
  of the description or the photo accordingly; the migration fills this
  in only where the stored data proves it (#84).
- A find a damaged file holds past the store's limits (more than 5
  photos, a text over 2,000 characters, a position out of range), or
  whose stored species, names or edibility differ from its answer, is
  shown as one that cannot be read, can be deleted, and no longer stops
  the queue (#87).
- The app is named Wushroom, not Washroom, on the phone and in the
  User-Agent it sends (#91).
- What the app tells the user: the stop after an answer of the wrong form
  says a find is marked failed only when one was; a self-check that waits
  on a find's photos says that it waits until they are analysed or
  removed; when the only photo of a text find fails, the message names the
  photo and says it can be removed; a description takes its full 2,000
  characters also when they are emoji; and the message when the camera
  may not be used names the phone's files beside the gallery (#89).
- A paste or insertion too long for a nearly full description loses its
  own last characters, not the end of the description already written
  (#95).
- The app's copies of photos and pictures are removed by one rule: only a
  file in its cache directory, named without a parent step. A fetched
  picture's copy now has the guard a picked photo's had, and a parent
  step that is percent-encoded, set off by backslashes or encoded
  slashes, or written with a tab or a line break in it, is refused as a
  plain one is (#96).

## Project created

- Bootstrapped from the Clead + Crog project template
  v2.9.2, built from
  factoincognito/ai-project-template-v2@8d5ee3bd90cc6632a3510c497f175a748bd2790a.
- Language pack: react-native.
- Licence: polyform-noncommercial-1.0.0.
- Set up by bootstrap-project.sh.
