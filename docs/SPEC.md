# What mushroom is this? — Technical Specification

**Date:** 2026-11-08
**Status:** Intent approved
**Owner:** Clead (technical correctness) / Adam (intent)

Intent approved: Adam, 2026-11-08 17:48, in chat ("Apyr mushroom spec"),
with Clead's recommendations; the licence and the Italian disclaimer
18:12; the Italian disclaimer checked by an Italian speaker Adam named,
19:28. The approved text and its decisions are recorded in the product
office (`library/designs/what-mushroom-is-this/design.md` and
`DECISIONS.md` in `factoincognito/product-office`, private). This file
carries that specification for the build, with its private parts left
out (product-office `RULES.md` § 19 (2)); where the two differ, the
product office's record holds, and the difference is a defect of this
file.

---

## 1. System overview

A phone app, Android and iOS, the proof of concept of a mushroom find
log: it takes a photo of a mushroom, has Claude give its best assessment
of the species, and keeps a log of the finds on the phone. The user
provides their own Claude API key. It comes before a general "What is
this?" app.

The app's languages are Swedish, English and Italian. For each analysed
find it shows the species' names in Swedish, English, Latin and Italian,
its edibility, general information, and the poisonous look-alikes of the
species (how they are shown: 3.1 and 3.3, **[Clead]**).

The edibility shown is always that of the species the app matched, and a
disclaimer says there is no guarantee the mushroom in the photo is that
species (section 3.5).

Marked **[Clead]** below: Clead's wording of what follows from Adam's
decisions, not decided by Adam in those words (product-office `RULES.md`
§ 7 (3)). Marked **[not checked]**: a fact still to be checked in the
build, before the item that depends on it.

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
| image | the resize rule and the check of a JPEG's application segments |
| analysis | the request builder, the answer's shape and its validation, the error classes |
| queue | the finds waiting for analysis, when the queue runs and stops |
| store | the database of finds and the photo files |
| position | taking the position for a new find |

Nothing leaves the phone except the photo sent for analysis (section 3.3).
There is no server.

## 3. Component specs

### 3.1 Screens

1. **Log** (the start screen): the finds, newest first, each with its
   photo, date and time, the species name in the app's language, and the
   edibility. A find still waiting for analysis says so.
2. **New find**: opens the camera; a photo can also be picked from the
   gallery. The photo, the time and the position are saved before any
   analysis, so a find is never lost. For a photo from the gallery, the
   time and position are those the photo's own metadata holds, if any,
   and the find says that they come from the photo; a metadata time
   without a UTC offset is read as the phone's offset on that date, and the
   find marks it so. Without them, the time is that of saving and the find
   has no position.
3. **Find**: the photo; the species names in all four languages; the
   edibility with the disclaimer; Claude's confidence, with a note that it
   is Claude's own statement, not a measured probability; the general
   information; the poisonous look-alikes, each with its names in the four
   languages and its edibility (**[Clead]**: the place and the details;
   Adam decided that the look-alikes are listed); date, time and position
   (as coordinates, with a link that opens the phone's own map app), each
   with where it came from. Buttons: analyse again, and delete the find
   (after a confirmation).
4. **Settings**: the API key (enter, replace, remove; never shown again
   once saved); the app's language (the phone's language by default when
   it is one of the three, otherwise English); the model; "About", which
   lists the licences of the libraries the app ships.

The disclaimer is also shown once, to be accepted, the first time the app
is opened.

When the queue has stopped (3.3), the Log screen says why and offers
"analyse now" (**[Clead]**: the spec names the control, not its place).

### 3.2 The API key

- Kept in the secure store (`expo-secure-store`: the Keychain on iOS, the
  Keystore on Android). Sent only to the Claude API; never logged, never
  written to the database or a file, never built into the app.
- A pasted key is trimmed of spaces and line breaks before it is saved; an
  empty key is not saved.
- On iOS a key in the secure store survives an uninstall when the app is
  reinstalled with the same bundle ID. The app clears the key store on its
  first start after an install, which it tells from a marker in its own
  storage.
- Without a key, a find is saved and waits; its screen says a key is needed
  and links to Settings.

### 3.3 Photo analysis

- The app calls the Messages API directly from the phone with one image
  content block (base64) and a text prompt. Only the photo and the prompt
  are sent: not the position, not the time, nothing else from the log.
- The photo is resized on the phone, JPEG, to the largest size at its own
  aspect ratio that fits both image limits of the model in use: the
  long-edge limit and the visual-token limit, at one token per 28 × 28 px
  patch. Standard-tier models: 1,568 px and 1,568 tokens;
  high-resolution-tier models (Claude 4.7 and later): 2,576 px and 4,784
  tokens. For a 4:3 photo that is about 1270 × 952 px (1,564 tokens) and
  about 2212 × 1659 px (4,740 tokens). The limits are configuration kept
  with the model's ID. The size is computed by the resize rule of the
  Claude docs' "Coordinates and bounding boxes" page, rounding the short
  edge half to even as the page's reference code does (so 4032 × 3024 gives
  1270 × 952, not 1269 × 952); the module's tests include that page's
  example (1075 × 1520 to 924 × 1307 on the standard tier).
- The photo sent carries no metadata. A plain module checks the bytes of
  the JPEG to be sent, through the whole file to its end, between scans
  too (**[Clead]**: the check's detail). It is an allowlist:
  - the structural markers pass (start and end of image, the frame
    markers, Huffman and arithmetic tables, quantisation tables, restart
    interval, start of scan, and restart markers inside a scan);
  - APP0 passes only as JFIF (identifier `JFIF\0`), and APP2 only as an
    ICC colour profile (identifier `ICC_PROFILE\0`);
  - every other marker fails, among them APP1 (EXIF, XMP), APP13 (IPTC),
    a JFIF extension APP0 (which can hold a thumbnail image with metadata
    of its own), an APP2 of another kind (such as a Multi-Picture index,
    which points to further images) and a comment: each can carry a
    position, text or another image;
  - any byte after the end of the image fails: phones can append further
    images there, with metadata of their own;
  - input that is not a JPEG, or is cut short or malformed, fails.
  Not checked yet: what the phone's image encoder writes (Known unknown
  2); if it writes something this check refuses, every analysis fails,
  so it is checked in Adam's test session on his phone, since the encoder
  cannot be run off a phone (#14).
  A JPEG that fails the check is not sent; the find is marked failed.
- The prompt asks for one answer in a fixed JSON shape:
  - the best match: its names in Swedish, English, Latin and Italian;
  - its edibility, one of: edible, edible only after preparation, not
    edible, poisonous, deadly poisonous, unknown;
  - a confidence: low, medium or high;
  - the general information in Swedish, English and Italian, so a change
    of the app's language needs no new call;
  - the poisonous look-alikes, each with its names in the four languages
    and its edibility (**[Clead]**);
  - or that Claude cannot see a mushroom in the photo, or cannot tell.
  The app validates the answer against the shape; anything that does not
  fit is a failed analysis, which can be retried.
- Whenever the confidence is low, the edibility shown is "unknown",
  whatever the answer said. The stored answer keeps what Claude said; the
  rule applies where the edibility is shown (**[Clead]**).
- The model is a setting holding a model ID, with one default chosen at the
  build from the models then available. An empty model ID is not saved.
- Each request has a time limit (configuration; 60 seconds) and is sent
  once: no hidden retries by a client library.
- The request uses API version `2026-10-21` and sends the key as
  `Authorization: Bearer`; a key that, after the trim, holds anything but
  the characters 0x21–0x7E (so also an inner space, an invisible
  character or a smart quote from a paste) is not sent, and is handled as 401, 403 (**[Clead]**,
  PBI-1.4, #8).
- Errors are shown in plain words, and each class has its own outcome:

  | Answer | Meaning | Outcome |
  |---|---|---|
  | no network, time limit passed, 500, 504, 529 | not reachable, or a fault on Anthropic's side | the find stays waiting; the queue tries it again at its next run |
  | 429 | rate limit or spend limit | the queue stops until the time the answer's `retry-after` gives; without one, until the user starts it again |
  | 400 `invalid_request_error` whose message starts "You have reached your specified API usage limits" or "You have reached your specified workspace API usage limits" | the key owner's own spend limit, or a workspace's, which the API reports this way (**[Clead]**, from the API's "Rate limits" page, read by Crog on 2026-11-08 for PBI-1.4 and #9) | as 429 without `retry-after` |
  | 400 `invalid_request_error` whose message starts "This API key is not scoped to a workspace" | the key needs the `anthropic-workspace-id` header (Known unknown 8; **[Clead]**, from the API's "Authentication" page as Crog read it on 2026-11-08, checked against that page on 2026-11-09 for PBI-1.13) | as 401, 403, with a message of its own: the key must be replaced with one that belongs to a workspace (**[Clead]**, #17) |
  | 401, 403 | the key is refused or lacks permission | the queue stops; Settings asks for a key |
  | 402 or a billing error | no credit on the key's account | the queue stops; the message says so |
  | 404 | the model is not known (for example retired) | the queue stops; Settings asks for a model |
  | 400, 413 | the request is wrong or too large | that find is marked failed; the queue goes on with the next |
  | an answer whose `stop_reason` is `refusal` | Claude declined to answer (**[Clead]**, PBI-1.13) | that find is marked failed; the queue goes on with the next |
  | an answer that does not fit the shape, is cut off (`stop_reason` `max_tokens` or `model_context_window_exceeded`), or is not from the API at all (for example a Wi-Fi sign-in page) | | that find is marked failed and the queue stops |
  | any other status | | the queue stops; the message gives the status |
  | the find's photo cannot be loaded, decoded or sized | the photo itself is the problem (**[Clead]**, #17, #23; on Android a failed load does not say why, so a cause that is not the photo's can look the same: PBI-1.25) | that find is marked failed; the queue goes on with the next |
  | any other error in the app while the queue runs (for example, full storage) | (**[Clead]**, #17, PBI-1.21) | the find stays waiting; the queue stops and the Log screen says so, without the error's text; "analyse now" starts it again |

  **[Clead]**, both: a billing error is told apart from other 400 answers
  by the error type in the answer's body, and a `retry-after` value that
  is not a number of seconds or a date, or is more than a day ahead, is
  treated as missing.
  **[Clead]**, PBI-1.14: the request sets no thinking or effort, so each
  model uses its own default; since its thinking counts toward
  `max_tokens`, `max_tokens` is 16,000. A model ID the app cannot send is
  handled as 404. The text of the answer is that of its text blocks, in
  order (PBI-1.13).
  **[Clead]**: a row that names a 400 by its error type and message takes
  precedence over the "400, 413" row; it matches only when both the type
  and the start of the message match. The refusal row takes precedence
  over the shape row (PBI-1.13).
  A failed find is tried again only when the user asks. When a new
  analysis of a find that already has an answer fails, whatever the
  error class, the find keeps its answer and stays analysed, the failure
  is not stored and is shown in the message only, and the table's outcome
  for the queue or Settings (the queue stops, Settings asks for a key or a
  model) still applies (**[Clead]**, #11). A stopped queue
  starts again when the user changes the setting named or taps "analyse
  now".
- The cost falls on the key's owner; the app shows no prices.

### 3.4 The queue (without a network)

- A find is saved with its photo, time and position whether or not there
  is a network, and is marked as waiting.
- The queue runs when the app comes to the front, when a new find is saved,
  and when the phone reports that the network is back, each time only
  while the app is in front and only if the queue is not stopped (3.3). A
  run takes the waiting finds one at a time, oldest first, and ends when
  none is left or one stays waiting for want of a network or a fault on
  Anthropic's side. A find can also be analysed at once from its screen.
  Nothing runs while the app is closed.
- Position works without a network, from the phone's GPS. The map link of
  3.1 needs the map app's own maps.

### 3.5 Edibility and the disclaimer

- The edibility shown is always that of the species Claude matched,
  labelled as such, never as a property of the photographed mushroom.
- The disclaimer stands next to the edibility on every find screen and in
  the analysis result; it cannot be hidden or switched off.
- Its text:
  - Swedish: "Ätligheten som visas gäller den art som appen har matchat.
    Det finns ingen garanti för att svampen på ditt foto är den arten."
  - English: "The edibility shown is that of the species the app matched.
    There is no guarantee that the mushroom in your photo is that species."
  - Italian: "La commestibilità indicata è quella della specie individuata
    dall'app. Non c'è alcuna garanzia che il fungo nella tua foto sia di
    quella specie."

### 3.6 The find log

- One SQLite database (`expo-sqlite`) and the photos as files in the app's
  own storage.
- A find holds: an ID; the time it was taken, with the phone's UTC offset,
  and where it came from (the moment of saving, or the photo's metadata,
  with or without an offset of its own);
  the position (latitude, longitude, the accuracy the phone gives) or none,
  and where it came from (a fix, the last known position, the photo's
  metadata); the photo's file; its analysis state (waiting, done,
  failed); and, once analysed, the answer, the model that gave it and
  when. Analysing again replaces the earlier answer.
- Position: the app asks for the location permission the first time a find
  is made. When the camera opens, it starts asking the phone for a
  position. When the photo is taken, the find is saved at once with the
  best fix the app has; if it has none, with the phone's last known
  position when that is no older than two minutes, marked as such; if it
  has neither, the app goes on asking for up to 30 seconds and adds the
  first fix that comes, after which the find stays without a position and
  says so. The two limits are configuration. Without the permission the
  find has no position; nothing blocks the photo.
- Deleting a find deletes its photo too.
- The log is kept out of the phone's backups (Adam's decision). How
  (**[Clead]**, checked against Expo's and the platforms' documentation
  for PBI-1.9, #21): on Android, `android.allowBackup` is off, and the
  app's own backup and data extraction rules also exclude the database,
  the photos and the key-value store from backup and device-to-device
  transfer, which `allowBackup` alone may not stop on some phones for
  apps that target API level 31 or later; the secure store's own rules
  are kept. On iOS the key-value store is excluded; the database and the
  photos must be excluded at run time per file, which Expo offers no
  supported means for. The builds are Android first (3.8, PBI-1.10); no
  iOS build is made before PBI-1.23 (**[Clead]**).
- Uninstalling the app deletes the log. No export or sync in this version.

### 3.7 Not in this version

Sharing finds, importing them, maps inside the app, accounts, a server of
any kind, backup, export or sync, species data or pictures from outside
sources, push notifications, a web version, and the general "What is
this?" app.

### 3.8 Distribution and done

- The app gets onto a phone through EAS Build, Android first.
- The first version is called done only after a test session on Adam's
  Android phone: what CI cannot check (camera, location, layout, the real
  API call) is tried there.

---

## 4. Known unknowns

1. That each expected Expo library has a version for SDK 57.
2. What `expo-image-manipulator` keeps of a photo's metadata (the segment
   check of 3.3 guards the result either way). The phone's own encoder
   writes the JPEG, so this can be checked only on a phone, in Adam's test
   session (Crog, #14).
3. How the database and photos are excluded from iOS backups under Expo,
   and the Android data extraction rules (3.6). Android settled in #21;
   iOS needs native code (PBI-1.23). Whether Android lint's
   `FullBackupContent` check stops a release build over excludes outside
   every include is checked at the first release build (PBI-1.10).
4. The default model, chosen at the build.
5. EAS Build's setup for this project (its project ID and build profile),
   which needs Adam's Expo account: `eas init` signed in to that account
   links the project.
6. A library for the network state, which the queue's "network is back"
   trigger needs (3.4). Settled for #17:
   `expo-network`, not NetInfo, whose reachability check can send a
   request to a Google server, against section 2 (**[Clead]**).
7. Whether a gallery photo's position arrives on Android. Android's
   documentation says reading it needs the `ACCESS_MEDIA_LOCATION`
   permission, and `expo-image-picker` does not ask for it, so it most
   likely does not (Crog's reading of the documentation and the library's
   source for #14, 2026-11-09; to be checked on a phone, PBI-1.18).
8. Whether a user's API key can be one that needs the
   `anthropic-workspace-id` header, which the API documentation says a key
   not scoped to a workspace needs (Crog's reading for PBI-1.4, checked
   against the "Authentication" page on 2026-11-09 for PBI-1.13); the app
   does not send it, and handles that answer as 401, 403 (3.3).
9. Whether a request keeps to the 60-second time limit while the model
   thinks, which on the current models it always may (PBI-1.14). If not, a
   find times out, stays waiting and is sent again at each run; the time
   limit is then the setting to change (Clead-role reviewer on #15).
