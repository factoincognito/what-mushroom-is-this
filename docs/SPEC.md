# What mushroom is this? — Technical Specification

**Date:** 2026-11-08
**Status:** Intent approved
**Owner:** Clead (technical correctness) / Adam (intent)

Intent approved: Adam, 2026-11-08 17:48, in chat ("Apyr mushroom spec"),
with Clead's recommendations; the licence and the Italian disclaimer
18:12; the Italian disclaimer checked by an Italian speaker Adam named,
19:28. Phase 2 (3.9): intent approved by Adam, 2026-11-09 20:49, in
chat ("apyr"), with Clead's two proposals (the disclaimer for a lookup
without photos, and the edibility until the self-check agrees) and the
choices marked **[Clead]** at that time (#47). Of the choices marked
**[Clead]** later (#50), Adam confirmed five on 2026-11-09 at 21:36, in
chat ("apyr"), answering Clead's list of them: Wikimedia's standard
thumbnail widths, the map's credit folding to "(i)" and listed in
About, no offline map downloads, the library's own location engine,
and the rule for a picture under several licences. He confirmed the
others at 22:05 ("apyr", to Clead's recommendation of 22:05): the
map's own User-Agent, the file picker's settings, the Wikimedia lookup
with its rank check, the Wikimedia User-Agent and one request at a
time, and the credit for a picture under several listed licences. The
approved text and its decisions are
recorded in the product
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

The app's public name is "Washroom" (Adam's decision, 2026-11-09).

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
There is no server. Phase 2 adds the text and the several photos of a
lookup, sent for analysis, the area the map shows, sent to the map
provider for its tiles, the Latin name of a text lookup's species, sent
to Wikimedia for its picture, and that picture, sent to Anthropic for the
self-check (3.9, Adam's decisions, 2026-11-09). The map provider's tiles
may come through Cloudflare as its CDN (3.9).

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
   has no position. A photo whose find could not be saved is kept on the
   screen until it is saved again or discarded. It is dropped only after a
   question on the screen, not a system alert: when "Discard the photo" is
   tapped, and when the screen is left while the photo is kept
   (**[Clead]**, PBI-1.20, #14).
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
  storage. If that clearing fails, no key is read for analysis and the key
  store is shown as unreadable, with Save and Remove; a save runs the
  clearing again first (**[Clead]**, #29).
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
  What the phone's image encoder writes (Known unknown 2): if it writes
  something this check refuses, every analysis fails, so it was checked
  in Adam's test session on his phone, since the encoder cannot be run
  off a phone (#14); his camera photos passed (PBI-1.11). Other phones
  are not checked.
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
  | the find's photo cannot be loaded, decoded or sized | the photo itself is the problem (**[Clead]**, #17, #23; on Android a failed load does not say why, so a cause that is not the photo's can look the same: PBI-1.25) | that find is marked failed; the queue goes on with the next. When the photos of two finds in a row in one run cannot be loaded, the second find stays waiting instead, as do the finds after it, and the queue stops as in the next row; the first stays failed. A photo that loads, whatever then comes of its find, ends the count, and each run counts afresh, the one "analyse now" starts too; a find analysed from its screen is not counted (**[Clead]**, PBI-1.25) |
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
  Nothing runs while the app is closed. A waiting find the store cannot
  read is passed over and left as it is; the Log shows it as a find that
  could not be read, and its screen offers only Delete; a find whose ID
  cannot be read has no screen, so its Log row offers Delete, which asks
  first (**[Clead]**, #26, #33).
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
this?" app. Phase 2 (3.9) adds maps inside the app; the rest stays out.

### 3.8 Distribution and done

- The app gets onto a phone through EAS Build, Android first.
- The first version is called done only after a test session on Adam's
  Android phone: what CI cannot check (camera, location, layout, the real
  API call) is tried there.

### 3.9 Phase 2

Adam's additions of 2026-11-09 (18:48), with his answers to Clead's
questions the same evening: the map shows online tiles from a map
provider; the Library replaces the Log; below a confidence of 70 the
edibility shown is "unknown"; Phase 2 is built now, alongside Phase 1's
test session. Where this section and 3.1 to 3.7 differ, this section
holds for Phase 2. Phase 1's test session (3.8) tests 3.1 to 3.8.

**Lookups.**

- A lookup is by photo or by text (Adam). A photo lookup takes one or
  more photos, each from the camera, the gallery or the phone's files
  (Adam). A text lookup takes a description the user writes (Adam), up to
  2,000 characters (**[Clead]**: the limit, configuration). The text is
  shown on the find's screen and cannot be edited (**[Clead]**).
- Whether a lookup is saved is a setting of the lookup (Adam): on for a
  photo lookup and off for a text lookup unless the user changes it
  (Adam). It is a "Save" switch on the lookup screen, and Settings holds
  the two starting values (**[Clead]**).
- A saved lookup is a find, saved before any analysis as in 3.1, and goes
  through the queue (3.4) once its batch is complete (below). A text find
  has the time of saving and the position taken as for a camera find
  (3.6); it has no photo. A photo find has the time and position of the
  first photo of its first batch, by the rules of 3.1 and 3.6 for that
  photo's source (**[Clead]**).
- An unsaved lookup is held on the screen only and is analysed when the
  user taps "Analyse" (**[Clead]**). Nothing of it is stored; the app's
  copies of its photos are removed when the screen is left. Its answer
  is shown on the screen as a find's would be. Each error class of 3.3
  has the outcome it has for a find analysed from its screen, with the
  screen in place of the find (**[Clead]**):
  - those that leave a find waiting (no network, time limit, 500, 504,
    529) keep the lookup on the screen with "Analyse" and an offer to
    turn "Save" on, so it waits in the queue;
  - those that mark a find failed show the failure, and "Analyse" can be
    tapped again;
  - those that stop the queue (429, the spend limits, 401, 403, 402, 404,
    the shape and cut-off answers, any other status) stop it as for a
    find, and the screen shows the same message;
  - without a key, the screen says a key is needed, links to Settings and
    offers to turn "Save" on.
  "Analyse" sends the lookup even while the queue is stopped, as "analyse
  again" does for a find (**[Clead]**).
- A saved text lookup becomes a find when the user taps "Analyse" or
  leaves the screen with text entered; its position is asked for when the
  screen opens, as the camera's is (3.6), whether or not "Save" is on
  (**[Clead]**). The location permission is asked for the first time a
  lookup screen opens, saved or not (**[Clead]**). Leaving the
  screen with an unsaved lookup asks first, on the screen, as 3.1 does
  for a photo (**[Clead]**).
- The position is asked for when the camera opens whether or not "Save"
  is on. A lookup saved after its first photo was taken keeps that
  photo's time and position by the rules of 3.1 and 3.6 (**[Clead]**).
- The "Save" switch is shown on the screen of a new photo lookup, and not
  when photos are added to a find from its screen; once the lookup's
  first photo is saved with "Save" on, the switch cannot be turned off
  (**[Clead]**, 2026-11-10, #61).
- A photo can be removed from an unsaved photo lookup on its screen,
  after a question asked on the screen, not in a system alert. Unlike
  from a find without text, its last photo can be removed too, since
  nothing is stored, and the screen then offers "Analyse" again only once
  a photo is added. Removing a photo drops an answer shown (**[Clead]**,
  2026-11-10, #61).
- Photos from the phone's files are images only; a file the app cannot
  load as an image is refused with a message (**[Clead]**). A photo from
  the files has no position or time of its own, as a gallery photo
  without metadata (3.1).
- Removing a photo, or a find, removes only the app's own copies, never
  the original in the gallery or the files (**[Clead]**).

**Batches.**

- A batch is the photos added in one go: on a new photo lookup, or from a
  find's screen. A find holds up to 5 photos in all (**[Clead]**: the
  limit, configuration). A text find can also get photos this way
  (**[Clead]**).
- On a saved lookup each photo is saved to the find as it is taken or
  picked, so it is never lost, but the queue does not take the find while
  its batch is open (**[Clead]**). The batch is complete when the user
  taps "Analyse" or leaves the screen; a batch still open when the app
  starts is complete then (**[Clead]**). Completing a batch is a queue
  trigger, in addition to those of 3.4. Saving a photo is not, and the
  saving of a photo find with its first photo is not the trigger of 3.4
  "a new find is saved" (**[Clead]**).
- Each completed batch brings a new analysis (Adam). On a find that has
  no answer, the find waits as in 3.4. On a find that has an answer, the
  find keeps its answer, which is shown and used by the filters, and its
  new photos wait for analysis in the queue (**[Clead]**). When that
  analysis meets an error class of 3.3 that leaves a find waiting, the
  photos stay waiting and the queue takes the find again at its next run.
  Any other class marks them as not yet analysed, and they are analysed
  only when the user asks. Either way the find keeps its answer, as 3.3
  says (**[Clead]**). Even so, two cases leave the photos waiting, as
  they leave a find without an answer (3.2, 3.3;
  **[Clead]**, 2026-11-10, #57):
  - there is no key;
  - the queue stops with an internal error, including the stop after two
    finds in a row whose photos cannot be loaded (PBI-1.25), for the
    find it stops on; the first of those two is failed as 3.3 says, so
    its photos are not yet analysed.
- An analysis sends all of the find's photos, in the order added, each
  labelled "Image 1:", "Image 2:" and so on, each resized and checked as
  in 3.3, in one request, and the find's text when it has one
  (**[Clead]**). The photos are resized one at a time (**[Clead]**). The
  new answer replaces the earlier one, as in 3.6.
- If any photo of the find fails the metadata check, or cannot be loaded,
  decoded or sized, nothing is sent and the find's analysis fails, with a
  message naming the photo; the user can remove that photo and analyse
  again (**[Clead]**). For the count of 3.3 (PBI-1.25), a find counts as
  one whose photos cannot be loaded when any of its photos cannot; a find
  whose photos all load, or a text find without photos, ends the count
  (**[Clead]**).
- A photo can be removed from a find, but not the last photo of a find
  without text (**[Clead]**). The find is then analysed again only when
  the user asks. It keeps its time and position, also when its first
  photo is removed (**[Clead]**). If photos added since its answer are
  waiting for the queue, the analysis still runs, with the photos left
  (**[Clead]**).

**Answers.**

- The answer gives a confidence from 1 to 100, low to high (Adam), a whole
  number; anything else fails the shape check (**[Clead]**). It is shown
  as a number with the note of 3.1, that it is Claude's own statement,
  not a measured probability.
- Below 70 the edibility shown is "unknown", whatever the answer said
  (Adam: the line; configuration). It replaces the rule for "low" in 3.3.
- A find analysed in Phase 1 keeps its low, medium or high, and the rule
  of 3.3 applies to it, until it is analysed again (**[Clead]**).
- For a text lookup, "no mushroom" means the description is not of a
  mushroom, and "cannot tell" that it does not say enough (**[Clead]**).
- The disclaimer of 3.5 speaks of "the mushroom in your photo". A lookup
  without photos, saved or not, shows instead: "There is no guarantee
  that the mushroom you described is that species", with its Swedish and
  Italian counterparts; the Italian is checked as before (Adam, 20:49,
  approving Clead's proposal). On a saved find, an answer naming a
  species shows this disclaimer when it is an answer from the text
  alone, also after the find has got photos, and 3.5's when it is an
  answer from photos, also after photos were removed (**[Clead]**,
  2026-11-10, #57: Clead's reading of his own proposal, that the
  disclaimer follows the analysis that gave the answer). For "no mushroom"
  and "cannot tell" the store does not yet hold what the answer was
  based on, so their wording follows whether the find has photos
  (PBI-2.15).

**A representative picture for text lookups** (Adam, 19:01; the source,
Wikimedia Commons, is his answer to Clead's question, by 19:03).

- When the answer to a text lookup names a species, the app shows a
  representative picture of that species from Wikimedia Commons (Adam).
  It is the picture that Wikidata gives as the image of the species'
  item, found by its Latin name, fetched as a thumbnail at
  the smallest of Wikimedia's standard widths at or above the width the
  resize of 3.3 needs (3840 when the need is above that, and the
  original's own width when the original is narrower than the chosen
  standard width), then resized on the phone
  (**[Clead]**; Wikimedia rounds a requested width up to a standard one
  itself, and gives the original when it is narrower, but reports the
  width asked for, so the size is read from the picture received, Known
  unknown 15). The thumbnail is taken in JPEG, PNG, WebP or GIF, the
  formats the Claude API accepts, its type read from its bytes, not from
  what Wikimedia says it is (Adam, 2026-11-10 00:10, approving Clead's
  proposal). The same holds for the original when Wikimedia serves it in
  place of a thumbnail, so an SVG or TIFF original gives no picture
  (**[Clead]**). Its licence must be CC0, public domain
  without a country limit, CC BY or CC BY-SA; any other licence means no
  picture (Adam, 2026-11-09 21:27). A file under several licences is used
  when one of them is on that list, and is credited under the first of
  its listed licences in the order CC0, public domain, CC BY, CC BY-SA
  (**[Clead]**).
- The picture, and the check below, belong to an answer from text alone.
  When a text find gets photos, it keeps its answer, its picture and its
  check, with the check's outcome for the edibility shown, until an answer
  from its photos and text replaces that answer (Batches). From then on it
  has no picture and no check, and the list shows its first photo
  (**[Clead]**).
- The picture is shown on the find's screen, and in the Library list in
  place of the text mark, labelled as a picture of the species, not of
  the user's mushroom. Its author, its licence and a link to its page on
  Commons are shown with it, as its licence requires (**[Clead]**). A
  file whose author Wikimedia does not give in machine-readable form is
  not used: there is no picture, and the find says it could not be
  checked (Adam, 2026-11-10 00:10, approving Clead's proposal).
- On a saved find it is stored with the find, apart from its photos: it
  is never one of the find's photos and does not count toward the 5
  (**[Clead]**). A new answer naming another species replaces it. On an
  unsaved lookup it is shown, not stored, and the app's copy is removed
  when the screen is left (**[Clead]**).
- Only the Latin name is sent to Wikimedia, which also sees the phone's
  IP address (**[Clead]**).
- Fetching it (**[Clead]**):
  - no network, a time limit, 429 or 5xx from Wikimedia: the picture,
    and so the check, wait; on a saved find the queue tries again at its
    next run, and an unsaved lookup's screen offers "Check again";
  - no Wikidata item, no image, a licence the IP policy does not allow
    for this use, any other answer, or a picture that cannot be loaded or
    fails the metadata check after its resize: there is no picture, for
    that answer, and the find says it could not be checked.
- Pictures from Wikimedia Commons, and the Wikidata data used to find
  them, are an exception to 3.7's "pictures from outside sources" and
  "species data from outside sources" (**[Clead]**). The licence of each
  picture must allow it to be shown with credit, resized, and sent to
  Anthropic for the check. Their use was escalated under the IP policy,
  and Adam decided it on 2026-11-09 at 21:27 (Known unknown 15).

**The self-check of a text lookup** (Adam, 19:01; at run time, after
every text lookup, and a mismatch makes the edibility "unknown": his
answers to Clead's questions, 19:05).

- After a text lookup's answer names a species and its picture is
  fetched, the app runs a photo lookup on that picture, without the
  text, and compares the species it names with the text lookup's (Adam).
  The picture is resized and checked as a photo is in 3.3; the picture,
  not the user's text, is sent to Anthropic (**[Clead]**). The two match
  when the first two words of their Latin names, genus and species, are
  the same, ignoring case (**[Clead]**). The check's own confidence is
  not used (**[Clead]**).
- On a saved find the queue run that brings the text answer fetches the
  picture and runs the check at once, before it takes the next find
  (**[Clead]**). An unsaved lookup runs them at once after its answer. A
  new answer to a text find brings a new picture and a new check
  (**[Clead]**).
- When they match, the find says the check agreed. When the check names
  another species, the find says so, names both, and the edibility shown
  is "unknown" (Adam). A check answer of "no mushroom" or "cannot tell"
  counts as not matching, and the find says the check could not name a
  species (**[Clead]**). The filters use the text answer's species
  (**[Clead]**).
- The check is a request of its own, on the user's key. Its error
  classes are those of 3.3, in the same three groups as for an unsaved
  lookup (Lookups): one that leaves a find waiting leaves the check
  waiting; one that stops the queue stops it as for a find, and the check
  waits; any other marks the check failed, and the find says it could
  not be checked. A check that waits is tried again at the queue's next
  run, or by "Check again" on an unsaved lookup's screen (**[Clead]**).
  A run takes waiting checks together with waiting finds, oldest find
  first; a check that waits for want of a network or a fault on
  Anthropic's or Wikimedia's side ends the run, as a waiting find does
  in 3.4 (**[Clead]**).
- A check picture that cannot be loaded neither counts toward the count
  of 3.3 (PBI-1.25) nor ends it (**[Clead]**).
- Until the check agrees (while it waits, after it failed, or with no
  picture) the edibility shown is "unknown", and the find says why
  (Adam, 20:49, approving Clead's proposal).

**The store** (3.6 for Phase 2; **[Clead]**).

- A find holds, besides 3.6:
  - its text or none;
  - its photos in the order added, up to 5, each with its file and the
    batch it came in;
  - whether a batch is open;
  - on a find with an answer, the state of the photos added since that
    answer: analysed, waiting for the queue, or not yet analysed after a
    failure;
  - its confidence as a level (Phase 1) or a number from 1 to 100;
  - its representative picture with its author, licence and page, or
    none;
  - its self-check: waiting, agreed, disagreed with the species the check
    named, could not name a species, failed, or no picture.
- The database moves to schema version 2 by a migration that keeps every
  Phase 1 find, its photo as its first photo and its answer as it was.
  Adam's test-session finds are kept.

**The Library** (replaces the Log as the start screen; Adam).

- It shows the finds either as a list or as pins on a map, with a switch
  between the two (Adam). It opens on the list (**[Clead]**).
- Both views are filtered by the same filters (Adam):
  - species: all (the default), or a choice of one or more species among
    the finds, grouped by their Latin names and shown by their names in
    the app's language, and "not identified" for finds without an answer
    naming a species (**[Clead]**: the grouping and "not identified");
  - years: all years (the default), or a choice of one or more of the
    years that have finds;
  - months: all months (the default), or a choice of one or more months.
  A find's year and month are those of its time, in its own UTC offset
  (**[Clead]**). The filters hold until changed while the app runs, and
  start at their defaults when it starts (**[Clead]**).
- The list shows every find that passes the filters, as the Log did
  (3.1), with the queue's messages and "analyse now"; a text find without
  photos shows a text mark in place of a photo (**[Clead]**). A text find
  with photos whose answer is from the text alone shows its picture while
  it has one (the representative picture, below), and otherwise its first
  photo (**[Clead]**, 2026-11-10, #63). A find that could not be
  read (3.4) is always in the list, whatever the filters, so it can be
  deleted, and never on the map (**[Clead]**).
- The map opens on the phone's position, its shorter side spanning 10 km
  (a radius of 5 km; Adam; **[Clead]**: the measure, configuration). It
  shows the finds that pass the filters and lie in the area shown.
  Zooming or panning changes the area, and the finds shown follow it
  (Adam).
- The phone's position for the map: when the map is first opened, the app
  asks for the location permission if it has not yet asked (**[Clead]**).
  It uses a fix if one comes within 5 seconds, otherwise the phone's last
  known position when no older than two minutes (**[Clead]**: the limits,
  configuration). Without either, the map opens on the newest find with a
  position among those that pass the filters, at the same scale; with
  none, on a default area (**[Clead]**: configuration). The area is
  Sweden's, about 10.9° to 24.2° E and 55.3° to 69.1° N (**[Clead]**,
  2026-11-10, #68); so is taking the newest find among those that pass
  the filters (**[Clead]**, 2026-11-10, #68). Finds without a position
  appear in the list only.
- Tapping a pin shows the find's species name, or "not identified", and
  its date; tapping that opens the find (**[Clead]**).
- The tiles come from a map provider (Adam's decision). Each tile request
  tells the provider the area shown, and so where the phone is when the
  map opens on it and which areas the user looks at, and the phone's IP
  address; the finds' details are not sent to it (**[Clead]**). Tiles
  from the provider are an exception to 3.7's "pictures from outside
  sources" (**[Clead]**). The map is MapLibre React Native with
  OpenFreeMap's vector tiles; the style URL is configuration (the
  escalation under the IP policy, decided by Adam, 2026-11-09 21:27).
  The map shows the attribution that OpenStreetMap's attribution
  guidelines and OpenMapTiles ask for (PBI-2.1's findings; with the map,
  Adam's decision, 2026-11-09 21:27): OpenStreetMap,
  with a link to its copyright page, and OpenMapTiles. It may collapse to
  an "(i)" button, and is also listed in About (**[Clead]**; the
  library's default "(i)" button lists the style's attributions, which
  for OpenFreeMap are these, Known unknown 11; **[not checked]** on a
  phone). The library's own logo is shown, as it is by default (Adam,
  2026-11-10 00:10, approving Clead's proposal). Requests carry the app's
  own User-Agent (**[Clead]**; the library's default on Android names the
  app, Known unknown 11; **[not checked]** on iOS). No
  offline areas are downloaded; the map uses what its cache holds
  (**[Clead]**). The library's location engine is its default, not
  Google's (**[Clead]**). OpenFreeMap's tiles may come through Cloudflare
  as its CDN, which then also sees the tile requests (PBI-2.1's findings).

---

## 4. Known unknowns

1. That each expected Expo library has a version for SDK 57.
2. What `expo-image-manipulator` keeps of a photo's metadata (the segment
   check of 3.3 guards the result either way). The phone's own encoder
   writes the JPEG, so this can be checked only on a phone, in Adam's test
   session (Crog, #14). Settled for Adam's phone: his camera photos were
   analysed in his test session, so they passed the segment check
   (PBI-1.11, 2026-11-09).
3. How the database and photos are excluded from iOS backups under Expo,
   and the Android data extraction rules (3.6). Android settled in #21;
   iOS needs native code (PBI-1.23). Android lint's `FullBackupContent`
   check did not stop the first release build (PBI-1.10, 2026-11-09):
   it finished, and Adam found no `FullBackupContent` in its log. The
   excludes have carried `tools:ignore` since #40, so the log cannot show
   what lint would do without it. The question is moot while they carry it.
4. The default model, chosen at the build.
5. EAS Build's setup for this project (its project ID and build profile).
   Settled: the Expo project `factoincognito/what-mushroom-is-this` (#42;
   its owner since #39) and the `preview` profile (#40), with which the
   first build was made (PBI-1.10).
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
   Settled: in Adam's test session analyses took under 30 seconds and none
   timed out (PBI-1.11, 2026-11-09).
10. Whether the phone's position fixes arrive on Android while the camera
    app is in front: `expo-location` stops its updates when the app goes
    to the background (the Clead-role reviewer's reading of its source for
    #16). If they do not, a camera find takes its position more often
    from a fix the app had before the camera opened, or from the last
    known position (3.6); a fix after the camera closes still counts
    within the 30 seconds. Checked in Adam's test session (PBI-1.11).
11. Phase 2's map (3.9). Decided by Adam, 2026-11-09 21:27, on PBI-2.1's
    findings (product office,
    `library/designs/what-mushroom-is-this/phase-2-checks.md`): MapLibre
    React Native (MIT), on MapLibre Native (BSD-2-Clause), with
    OpenFreeMap's tiles. Per the findings, OpenFreeMap needs no key and
    charges no fee; its terms allow apps, and offline downloads within
    limits; it has no SLA.
    Checked on 2026-11-09 for the build (product office, the same
    document, section 5):
    - the app's Expo, React Native and React versions are within version
      11.5.1's peer ranges; it ships an Expo config plugin; whether it
      builds on SDK 57 is left for the build;
    - no telemetry found in MapLibre Android 13.6.1 or the library's own
      source; iOS not inspected;
    - the styles: code BSD-3-Clause, design CC BY 4.0 (Positron also
      CARTO, CC BY 3.0, which would need its own credit), fonts SIL OFL
      1.1, sprites CC0;
    - on Android the cache is 50 MB by default, and the "(i)" button and
      the MapLibre logo are on by default; iOS's defaults not checked;
    - the Android User-Agent names the app by default, and the app can
      set its own; iOS not checked;
    - the vulkan flavour of MapLibre Android 13.6.1 declares the location
      permissions and `ACCESS_WIFI_STATE`; the opengl flavour, the
      plugin's default, was not checked. PBI-2.8 checks the merged
      manifest, where the app's block of `ACCESS_WIFI_STATE` must still
      hold.
12. Phase 2's request with several photos and text (3.9). Per the Claude
    API's "Vision" page, read for PBI-2.1 on 2026-11-09:
    - 100 images per request on models with a 200k context window, and 600
      on the others;
    - above 20 images, a stricter limit per image, whose value the page
      does not give; it advises at most 3,000 px a side;
    - 10 MB per image, base64, and 128 MB per request;
    - at most 8,000 × 8,000 px;
    - JPEG, PNG, GIF or WebP;
    - each image introduced by "Image 1:" and so on, the images before the
      text.
    Five photos at 3.3's sizes are within these. Settled.
13. Phase 2's library for picking from the phone's files (3.9)
    (**[Clead]**, on PBI-2.1's findings): `expo-document-picker`, with
    `type: 'image/*'` and
    `copyToCacheDirectory` on, so that `expo-image-manipulator` reads a
    local file; the copy then goes into the app's photo store. Its
    `lastModified` is never used as the photo's time. To be checked on the phone: `content://` sources,
    and HEIC and SVG files (PBI-2.6).
14. Whether resizing up to five photos for one request (one at a time,
    3.9) brings back the low-memory load failures PBI-1.25 was written
    for, on Adam's phone.
15. Phase 2's representative picture (3.9).
    Adam decided on 2026-11-09 21:27, on PBI-2.1's findings:
    - Wikimedia's API terms are accepted;
    - the pictures are limited to CC0, public domain without a country
      limit, CC BY and CC BY-SA.
    From PBI-2.1's findings, with Clead's choices marked:
    - the lookup: the Wikidata item by P225 (taxon name), its image, P18,
      then the Commons file's thumbnail URL, author, licence and page
      (**[Clead]**); a check that the item's rank, P105, is species
      (**[Clead]**; it does not settle the homonyms found, below);
    - thumbnails at Wikimedia's standard widths only, since other widths
      are rate-limited (**[Clead]**);
    - a User-Agent that names the app, its version and the repository's
      URL, as Wikimedia's policy asks (**[Clead]**: the form);
    - requests one at a time, within limits of a few hundred an hour per
      phone (**[Clead]**).
    Checked on 2026-11-09 for the build (product office,
    `library/designs/what-mushroom-is-this/phase-2-checks.md`, section 5):
    - Wikimedia's policies, read on the original sites. Its rate limits
      are now 10 requests a minute by IP alone and 200 a minute with a
      User-Agent that follows its policy; "a few hundred an hour per
      phone" is within them. Clients may not hide Wikimedia as the source;
    - the calls and the metadata field names;
    - `fetch` in Expo SDK 57 sends the app's User-Agent unchanged on
      Android, from the sources, not run on a phone; ASCII only; iOS not
      checked;
    - JPEG, PNG, WebP and GIF originals give thumbnails of their own
      format, SVG gives PNG and TIFF gives JPEG; an original narrower
      than the width asked for is served as it is, in its own format;
      Wikimedia's stated type and width are not always those served;
    - among the 11,574 fungus species items with an English Wikipedia
      article and an Index Fungorum ID, 19 share their Latin name with
      another item, all fungi of the same genus, which rank and parent do
      not tell apart; the second mostly has no picture. Within that set
      no name was shared with an item outside the fungi; fungus items
      outside the set were not checked, and the search by name covers all
      of Wikidata;
    - about a third of fungus species with an English Wikipedia article
      have a picture; 20 of 20 common Nordic species sampled do.
    Open for PBI-2.9 (**[Clead]** to settle in its PR): which item when a
    name has several, also outside the fungi; which picture when an item
    has several; reading a file's licences and a public-domain mark's country limit from the
    file page, since the metadata gives one licence and only "pd"; and
    naming Wikimedia Commons as the source.
    Before release, the IP lawyer's review covers resizing under CC
    2.x/3.0 and sending pictures to Anthropic (policy rule 6).
