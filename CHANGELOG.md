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

### Changed

- The analysis module: a key that belongs to no workspace is refused, a
  refused answer fails only its find, and an answer's text blocks are
  joined (#18).
- The image module checks the input of its token count (#19).
- The queue fails a find only when its photo cannot be read, and stops
  on other errors; a refused photo and a key in no workspace get their
  own messages (#23).
- Two failed photo loads in a row stop the queue (#27).
- Test gaps closed (#28).
- The key: kept after a failed first-start clearing, and Remove offered
  when the store cannot be read (#29).
- The store: a stricter schema, one store, and unreadable finds shown in
  their place rather than hiding the Log (#26).

## Project created

- Bootstrapped from the Clead + Crog project template
  v2.9.2, built from
  factoincognito/ai-project-template-v2@8d5ee3bd90cc6632a3510c497f175a748bd2790a.
- Language pack: react-native.
- Licence: polyform-noncommercial-1.0.0.
- Set up by bootstrap-project.sh.
