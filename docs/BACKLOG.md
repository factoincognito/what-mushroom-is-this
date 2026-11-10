# What mushroom is this? Product Backlog

**Status:** Living document
**Owner:** Adam Smolowicz with Clead

---

## How to read this backlog

Entry format: product-office Process P-9 § 2. The markers:

| Marker | Meaning |
|---|---|
| [NOW] | Active — being worked on |
| [NEXT] | Queued — ready to start after current work |
| [LATER] | Confirmed future work, not yet scheduled |
| [BLOCKED] | Waiting on dependency or decision |
| [DONE] | Completed and merged |

Items are numbered `PBI-<phase>.<n>`, for example the first item of
phase one is phase 1, item 1. Numbers are never reused.

---

## Waiting for Adam

What needs Adam is in the product office's "Waiting for Adam" list, the
one list he reads (product-office Process P-9 § 3 (1)), not here.

---

## Phase 1 — First version

**Goal:** the first version of `docs/SPEC.md` on Adam's Android phone,
called done after his test session there (`docs/SPEC.md` 3.8). Built
unattended (product-office PO-159 step 4, Adam, 2026-11-08 22:21). Each
item: one PR, test first, CI green, reviewed by the role that did not
write it.

- **[DONE] PBI-1.1** (done 2026-11-08 in #6, `2298a34`, Clead-role review approved round 2; an unknown address is shown under the disclaimer, the sitemap is off) — The app shell: `expo-router` with its routes under `src/app/` (Log as the start screen, Settings), the config and i18n modules (Swedish, English, Italian; the phone's language by default when it is one of the three, otherwise English), the disclaimer accepted once at first start. Replaces the starter `App`. Creates `THIRD-PARTY-NOTICES.md` with the libraries the project already depends on and those it adds; every later item records in it the libraries it adds (policy `third-party-ip.md`, product-office `RULES.md` § 25). Spec 2, 3.1, 3.5.
- **[DONE] PBI-1.2** (done 2026-11-09 in #12, `df4eb7f`, Clead-role review approved round 2; default model `claude-opus-5-5`, decided by Clead; the secure store's plugin without the Face ID text) — The API key and the model setting: the key module (secure store, trim, empty not saved, cleared on the first start after an install) and the Settings screen's key, model and language; the default model, chosen from the models then available (Known unknown 4); the model list in the config module with each model's image limits, moving the tier limits out of `src/image/tiers.ts` (reviewer's note on #5); the chosen language kept across restarts (#6 kept it in memory only). Spec 2, 3.2, 3.3.
- **[DONE] PBI-1.3** (done 2026-11-08 in #5, `b40e546`, Clead-role review approved round 2; the check made an allowlist, SPEC 3.3 aligned in #7) — The image module: the resize rule for both model tiers, tested with the docs' example and the 4:3 sizes, and the JPEG application-segment check. Spec 3.3.
- **[DONE] PBI-1.4** (done 2026-11-08 in #8, `fb39205`, Clead-role review approved round 2; the API version, Bearer, the spend-limit 400 and the key check decided by Clead) — The analysis module: the request builder, the answer's shape and its validation (low confidence shows "unknown"), the error classes of the table, the time limit, no retries. Spec 3.3.
- **[DONE] PBI-1.5** (done 2026-11-09 in #11, `878476a`, Clead-role review approved round 1; its SQL also run on a real SQLite by the implementer and the reviewer) — The store: the database of finds and the photo files, add, read, replace the answer, delete with its photo. Spec 3.6.
- **[DONE] PBI-1.6** (done 2026-11-09 in #14, `164660e`, Clead-role review approved round 2; without the phone's position, which waits in PBI-1.19; the photo prepared at analysis time; a photo whose save failed is kept until saved or discarded) — New find: camera and gallery, the position rule, the gallery photo's metadata time and position (Known unknown 7 first); and the photo for analysis: resized and re-encoded as JPEG, then put through the segment check; what the encoder writes is checked as early as it can be (SPEC 3.3, Known unknown 2); the store gains setting a find's position after it is added, for SPEC 3.6's 30-second fix, and, if the screens need it, why a find has no position (#11's loose ends); a gallery photo whose source has no file extension (for example an Android `content://` address) is still saved, which the store refuses today (reviewer's note 8 on #11). Spec 3.1, 3.3, 3.6.
- **[DONE] PBI-1.7** (done 2026-11-09 in #17, `128d793`, Clead-role review approved; `expo-network`; an unreadable photo fails only its find; an internal error stops the queue with a message; its follow-ups are PBI-1.21) — The queue (its "oldest first" is the order of saving, the find's ID, not the time taken; **[Clead]**, #11's loose end): its triggers (with a network-state library, Known unknown 6), its run, its stops and restarts, the messages for each error class and stop (the spend-limit message's time when access resumes shown if the answer gives it; Crog's note on #9), and "analyse now" on the Log screen; the time-limit `RangeError` passes through as a programming error, not a failed find (reviewer's note on #8); the key is not read before the first-start clearing has run (reviewer's note 7 on #12); a failed new analysis of an analysed find keeps its answer (SPEC 3.3). Spec 3.1, 3.3, 3.4.
- **[DONE] PBI-1.8** (done 2026-11-09 in #24, `dada5f8`, Clead-role review approved round 2; the names in all four languages as SPEC 3.1 has them; failures in plain words; the iOS map link by version, the older form not checked) — The Log and Find screens in full (a find that failed the segment check names the refused marker in its message): names, edibility with the disclaimer, confidence and its note, general information, look-alikes (as the spec's **[Clead]** wording has them), position and time with their sources and the map link, analyse again (a failed new analysis of an analysed find is shown in its message, the answer kept; SPEC 3.3), delete; how a find the store cannot read is shown (reviewer's note 5 on #11). Spec 3.1, 3.5.
- **[DONE] PBI-1.9** (done 2026-11-09 in #21, `211a431`, Clead-role review approved; Android done, iOS's database and photos in PBI-1.23; the About view from a data file; the open licence parts in PBI-1.24) — Out of the phone's backups, after checking the means the spec marks **[Clead]**, **[not checked]** against the documentation, including the stored disclaimer acceptance on iOS (reviewer's note on #6); the app's Android backup rules include the secure store's own exclusions, or its plugin skips them with only a warning (reviewer's notes on #12); and the About view with the licences, including the shipped transitive packages and the Apache-2.0 NOTICE duties if the product office's policy asks for them (#6's loose end), and the release gate's licence reads #14 left open: the exact Glide and AndroidX POMs and the `SDWebImageWebPCoder` version CocoaPods chooses (`THIRD-PARTY-NOTICES.md`). Spec 3.1, 3.6.
- **[DONE] PBI-1.10** (done 2026-11-09: the project link in #39 and #42, `9a595c3` and `af1161d`, to the Expo project `factoincognito/what-mushroom-is-this`, which Adam recreated that day because the first one's slug was `sugose` and `eas build` refused it, and had deleted the old one by 17:44; the `preview` profile, `tools:ignore` on the backup excludes and the blocked permissions in #40, `9d0cab2`. Adam started the first build at 16:18 and had it installed on his phone by 17:44. Its log has no `FullBackupContent`, by Adam's search at 18:02. #40's review read the generated main manifest; the merged release manifest is still unchecked, see PBI-1.29) — EAS Build, Android: the build profile and the project link, then an installable build; check whether Android lint's `FullBackupContent` check stops the release build over the backup excludes, and if so mark them `tools:ignore` (reviewer's note 1 on #21); block the unused `ACCESS_WIFI_STATE` permission with `android.blockedPermissions` (#23). Spec 3.8, Known unknowns 3 and 5.
- **[DONE] PBI-1.11** (done 2026-11-09: Adam, 21:37, "pahse 1 passed testing". By his answers in the question dialog right after: analyses took under 30 seconds and none timed out, which settles Known unknown 9; the app follows the phone's dark or light setting; he did not test a gallery photo with GPS (Known unknown 7) and did not notice whether camera finds got a fix (Known unknown 10), so both move to PBI-2.11. His camera photos were analysed, so they passed the segment check, which settles Known unknown 2. The spec's Known unknowns 2 and 9 are marked settled in the next spec PR. Not reported: the look-alike and "analyse now" watch items below) — Adam's test session on his Android phone; the first version is done when it passes. Also to watch for: a look-alike given an edibility that is not poisonous under "Poisonous look-alikes" (reviewer's note on #24, Clead decides after the session), and, under a lasting fault of the phone's own, each "analyse now" failing one more find (Crog's note on #27). It also settles Known unknowns 2, 7, 9 and 10 (10: whether position fixes arrive on Android while the camera app is open): the segment check on what the phone's encoder writes, a gallery photo's position on Android, and whether a request with thinking keeps to the time limit. Also to watch for: whether the app follows the phone's dark or light setting on Android, since `userInterfaceStyle: "automatic"` needs `expo-system-ui` there and the app does not have it (reviewer's note 4 on #40). Spec 3.8.
- **[DONE] PBI-1.12** (done 2026-11-09 in #19, `c3fd6ef`, Clead-role review approved) (Clead-role reviewer's notes on #5) — Image module follow-ups: `countImageTokens` validates its input as `resizedSize` does; the name of the 952.5 tie test says only what it asserts.
- **[DONE] PBI-1.13** (done 2026-11-09 in #18, `1ad510b`, Clead-role review approved; the workspace message checked against the "Authentication" page) (Crog's note on #9) — The analysis module's error classes: the 400 that says the key is not scoped to a workspace is handled as 401, 403, with its message taken from the API's "Authentication" page; and, Clead's decisions on #15's review, a refusal (`stop_reason` `refusal`) marks the find failed and lets the queue go on, and an answer's text blocks are joined in order. Spec 3.3, Known unknown 8.
- **[DONE] PBI-1.14** (done 2026-11-09 in #15, `9c24b96`, Clead-role review approved; thinking counts toward `max_tokens` on the current models, so `max_tokens` is 16,000 and each model keeps its own thinking and effort, decided by Clead) (Clead-role reviewer's notes on #8, Crog's on #9 and #10, the PBI-1.2 implementer's on #12) — Analysis module follow-ups: first, check against the API documentation whether thinking is always on for the current models and counts toward `max_tokens`, and if so set `max_tokens` (or the thinking settings) so the JSON answer is not cut off; a `retry-after` too far ahead (one a JavaScript date cannot hold, and a bound for far-future values) is treated as missing; a cut-off answer (`stop_reason`) gets its own detail; the API address and the model ID are validated; `buildAnalysisRequest` is not exported or checks the key itself; where `MAX_TOKENS` and the API version live (product-office P-11 § 5 (2)); the refused-key test also asserts the class. Spec 3.3.
- **[DONE] PBI-1.15** (done 2026-11-09 in #31, `85dae78`, Clead-role review approved; `expo` 57.0.32, `jest-expo` 57.0.6, nothing else moved) (#6's loose end) — Bring `expo` and `jest-expo` to the versions SDK 57 expects (`npx expo install --check`), in one change.
- **[DONE] PBI-1.16** (done 2026-11-09 in #26, `d90ab53`, Clead-role review approved round 3; the list and the queue judge a row alike; the times and the offset bounded) (Clead-role reviewer's notes 3 to 6 on #11) — Store follow-ups, before the first release so schema version 1 can still change in place: a STRICT table and a CHECK on the edibility; one store however often it is opened, so the stray-photo sweep cannot remove a photo being added; one unreadable row does not hide the whole list, and an unreadable oldest waiting row does not stop every queue run (reviewer's note 9 on #17); the store's SQL runs in CI on a real SQLite, which #17's `schema.sqlite.test.ts` started (the schema, the causes, `oldestWaiting`), for the rest of its statements. Spec 3.6.
- **[DONE] PBI-1.17** (done 2026-11-09 in #29, `bf6cfe6`, Clead-role review approved) (Clead-role reviewer's notes on #12) — Key and settings follow-ups: a failed write of the install marker does not later delete a key saved since; Remove is offered while the key store cannot be read; the key is not read for analysis when the first-start clearing reported a failure (reviewer's note on #17); the startup promise does not depend on the order of effects; the `app.json` plugin test runs the real plugin, as the sitemap test does. Spec 3.2.
- **[LATER] PBI-1.18** (Known unknown 7, #14) — A gallery photo's position on Android, if Adam's test session (PBI-1.11) shows it does not arrive: `expo-media-library` with `ACCESS_MEDIA_LOCATION`, only if the permission it then asks for is in proportion. Spec 3.1, 3.6.
- **[DONE] PBI-1.19** (done 2026-11-09 in #16, `84e0d81`, Clead-role review approved round 2; no "Always" or motion permission on iOS; the licences of Play services and the AndroidX libraries its POMs name recorded, deeper ones in PBI-1.24) (Adam allowed `play-services-location` on 2026-11-09, product-office `DECISIONS.md`, factoincognito/product-office#684; in #16, which also adds the location permission text to `locales/*.json`, #32's review note 5) — The phone's position for a new find, SPEC 3.6's position rule and its 30-second fix; #16 merges main first, as #24 and #26 changed the Log and the store since. Spec 3.1, 3.6.
- **[DONE] PBI-1.20** (done 2026-11-09 in #32, `6fc9aea`, Clead-role review and Crog's of its SPEC line approved round 2; leaving is held while a photo is kept or being saved; the iOS permission texts in three languages) (Clead-role reviewer's notes on #14) — New find follow-ups: `setPosition`'s SQL runs on a real SQLite (with PBI-1.16); the iOS permission texts in the three languages; the comment on the 0,0 rule says only what its source says; a kept photo is not dropped without a word when the screen is left; "Discard the photo" asks first, with a SPEC 3.1 line for it. Spec 3.1.
- **[DONE] PBI-1.21** (done 2026-11-09 in #23, `946acc9`, Clead-role review approved; `ACCESS_WIFI_STATE` moved to PBI-1.10, since its fix is in `app.json`) (Clead-role reviewer's notes on #17, Clead's decisions) — Queue follow-ups: a find fails with cause `photo` only when its photo cannot be loaded, decoded or sized, and any other error while it is prepared stops the queue with `internal-error`; `key-not-scoped` gets a field of its own in the error classes; a refusal gets its own failure cause and message; the resume time pinned to its "UTC" form; the device queue's time limit asserted; the network test's name; `ACCESS_WIFI_STATE` removed if `expo-network` allows. Spec 3.3, 3.4.
- **[DONE] PBI-1.22** (done 2026-11-09 in #28, `af620bf`, Clead-role review approved; the `http://` refusal was already in the code) (Clead-role reviewer's notes 1 and 2 on #18, note 7 on #17) — Test follow-ups: the root `__mocks__/expo-network.ts` is type-checked (it is outside the `tsconfig` `include`); a 400 whose message shares only a shorter start with the not-scoped message is not classed as it; the test of text blocks joined "with nothing between them" splits inside a JSON string; `parseNotices` refuses an `http://` address, with a test (reviewer's note 4 on #21). Spec 3.3.
- **[LATER] PBI-1.23** (#21, Known unknown 3; any iOS build item is blocked on it) — Before any iOS build: the find-log database and the photos excluded from iOS backups at run time, per file (`isExcludedFromBackupKey`, set again after operations that reset it), which needs native code, for example a small local Expo module; and, with the iOS checks, the older Apple Maps link form the Find screen uses below iOS 18.4, which is not checked (#24); and VoiceOver announcing the messages and questions that use `accessibilityLiveRegion`, which works on Android only, on every screen: New find, the Log, Settings and Find (reviewer's note 3 on #32, Crog's note on #34); and `ios.bundleIdentifier`, which is unset, so the resolved config lists `com.placeholder.appid` among the iOS URL schemes (reviewer's note 3 on #41). Spec 3.1, 3.6.
- **[NEXT] PBI-1.24** (Clead-role reviewer's notes 2 and 3 on #21) — The licence parts the About view and the release gate still need: the shipped transitive packages and the Apache-2.0 NOTICE duties, once the product office's third-party policy says whether it asks for them; the exact Glide and AndroidX POMs and the `SDWebImageWebPCoder` version CocoaPods chooses; a licence text for `expo-router`, which ships none (the `expo` repository's MIT text); from #16, the AndroidX libraries the recorded AndroidX POMs name in turn (`androidx.annotation`, `androidx.lifecycle`, `androidx.versionedparcelable`, `androidx.legacy`, `androidx.loader`), the versions Gradle resolves at the build, the Android SDK licence text for the About view, and the `third_party_licenses.txt` in `play-services-location`'s AAR (the policy question is product-office PO-160 item 6). Spec 3.1.
- **[DONE] PBI-1.25** (done 2026-11-09 in #27, `53c000b`, Clead-role review and Crog's of its SPEC row approved) (Clead-role reviewer's note 1 on #23) — On Android a failed photo load does not say why, so low memory or a missing module looks like a bad photo and would fail every waiting find: two failed loads in a row in one run stop the queue with `internal-error` instead (**[Clead]**, the reviewer's option b), with the SPEC 3.3 row to match. Spec 3.3.
- **[DONE] PBI-1.26** (done 2026-11-09 in #33, `a63a3eb`, Clead-role review approved round 2; a find whose ID cannot be read is deleted from its Log row) (the Clead-role reviewers' non-blocking notes on #24, #26 to #29) — Follow-ups that need no phone:
  - the Find screen's delete is tested to remove the photo too;
  - the load-failure sentence also covers a phone short of memory;
  - a −1081 offset test, and the count in #26's table;
  - a find whose ID cannot be read can still be removed;
  - a damaged `id` past 2^53, or a `photo_file` that is not text, no longer fails the whole list or the opening;
  - #27's trigger-during-a-run test takes a path of its own;
  - the expo-network mock's cast is checked against the enum's string form;
  - #29's test imports `compileModsAsync` from `expo/config-plugins`, and the key's startup survives the effect running twice.
  Spec 3.2, 3.3, 3.6.
- **[DONE] PBI-1.27** (done 2026-11-09 in #36, `54a0adf`, Clead-role review approved; also the ordinary delete answers `not-found` when its DELETE changed no row; a find with the ID 2^53−1 exactly, reachable only by damage, is left as it is, Clead's decision) (the Clead-role reviewers' non-blocking notes on #31 to #33) — Follow-ups that need no phone:
  - `deleteUnreadable` removes the photo only when the delete changed a row;
  - after a damaged ID past 2^53, `AUTOINCREMENT` does not leave every new find unreadable;
  - the "Development tools" rows of `THIRD-PARTY-NOTICES.md` are tested against what is installed;
  - the comment on "Save again"'s `void` names the test reason too;
  - with the location allowed, a test asserts that New find shows neither the refusal text nor the settings button (reviewer's note 1 on #16).
  Spec 3.1, 3.6.
- **[DONE] PBI-1.28** (done 2026-11-09 in #38, `5682968`, Clead-role review approved; the router's first load is paid before the New find, Find and Log tests) (Clead-role reviewers' notes on #16 and #36) — Follow-ups that need no phone: find why the first test of `newFind.test.tsx` sometimes times out under load (seen in the #24, #32, #16 and #36 work; it passes alone and in CI), and fix it; the code comment on the next-ID rule names that on a damaged file, once SQLite's high-water mark is past 2^53, an ID above every readable ID left may be given again. Spec 3.6.
- **[LATER] PBI-1.29** (reviewers' notes on #38, #40, #41 and #42) — Follow-ups that need no phone:
  - a readable high-water mark of exactly 2^53 − 1 makes the next ID 2^53, which the store cannot read; it is reachable only through a damaged file (note 4 on #38);
  - the name test's text scan does not see a string literal written straight into a component; none exists today (note 1 on #41);
  - `android.package` is checked by two constants, in `appName.test.ts` and `easBuild.test.ts` (note 2 on #41);
  - `READ_EXTERNAL_STORAGE`, which only the image picker's media-library functions use and the app does not call, could be blocked; it is limited to Android 12 and below and never requested (#40's review, point 3);
  - a test could pin `owner` and `extra.eas.projectId` in `app.json` (note 3 on #42);
  - check that the APK's merged release manifest lacks `ACCESS_WIFI_STATE` and `SYSTEM_ALERT_WINDOW`. #40's review checked only the generated main manifest and listed this as not verified, and the first build's log was not read for it;
  - the test of #45 checks `expo-font` only; a check for any native module installed twice could follow if it happens again (note 2 on #45).
  Spec 3.6, 3.8.
- **[DONE] PBI-1.30** (done 2026-11-09 in #45, `1a9ad61`, Clead-role review approved; `expo-doctor` 21/21 locally; the next EAS build carries it) (the first EAS build's `expo doctor` step, from Adam's screenshot of its log, 2026-11-09 18:04; taken up the same day as unattended work, product-office `RULES.md` § 24 (2)) — One copy of `expo-font`. `expo doctor` found two: 57.0.4 under `expo`, and 58.0.11 at the top level, pulled in by `expo-router` → `expo-symbols`, whose peer dependency on `expo-font` is `*`. A native module installed twice may cause build or runtime errors, so the app keeps the SDK 57 version only. Spec 3.8.

---

## Phase 2 — Text lookup, several photos, the Library

**Goal:** `docs/SPEC.md` 3.9 on Adam's Android phone, called done after
his Phase 2 test session there. Intent approved by Adam, 2026-11-09
20:49; built now, alongside Phase 1's test session (his answer of
18:48), unattended. Each item: one PR, test first, CI green, reviewed by
the role that did not write it.

- **[DONE] PBI-2.1** (done 2026-11-09: findings in the product office, `library/designs/what-mushroom-is-this/phase-2-checks.md`; the map and Wikimedia escalations decided by Adam at 21:27; Known unknowns 11 to 13 and 15 updated in #50; what is left of them is checked at the build of PBI-2.6, PBI-2.8 and PBI-2.9) (the checks Known unknowns 11, 12, 13 and 15 name before the build; the uses go to the product office as escalations under the third-party code and IP policy) — The map provider and library, the Claude API's image limits, the file picker, and Wikidata and Commons: their terms, licences, fees, keys, attribution and caching, checked and written up, with a recommendation for the map provider. Spec 3.9, Known unknowns 11, 12, 13, 15.
- **[DONE] PBI-2.2** (done 2026-11-09 in #49, `bc735f9`, Clead-role review approved round 2; the photos are a JSON array in the find's row, so each write is one statement; answers are stored against the photos their analysis sent; the migration was also run on expo's vendored SQLite 3.50.3 by the reviewer; the Phase 2 methods are in `LookupStore`, beside the unchanged `FindStore`) — The store, schema version 2. The fields of 3.9's "The store", and a migration from version 1 that keeps every Phase 1 find, its photo as its first photo and its answer as it was. Spec 3.9.
- **[DONE] PBI-2.3** (done 2026-11-09 in #52, `d58afa1`, Clead-role review approved round 1; a new answer with a Phase 1 level fails the shape check, stored Phase 1 answers keep their level; the number shown as "90 of 100"; the Italian "su 100" awaits Jakob's check; the reviewer's notes are PBI-2.12) — The answer's confidence from 1 to 100, a whole number, shown with 3.1's note. The edibility is "unknown" below 70, as configuration. Phase 1 finds keep their level and 3.3's rule. Spec 3.9.
- **[DONE] PBI-2.4** (done 2026-11-10 in #54, `2acfd8f`, Clead-role review approved round 2; the queue's pick and the Log list moved to `getStored` in it, Clead's decision; 3.9's "unknown until the check agrees" built in it for every answer from text alone, Clead's decision after Crog flagged it; the photo lookup's Save switch moved to PBI-2.13, Clead's decision; a text find in the Log has no mark yet, PBI-2.7; the Italian awaits Jakob's check; the reviews' notes are PBI-2.14) (in the night shift of 2026-11-09, Clead's decision: it moves the queue's pick and the Log list itself, without waiting for PBI-2.7) (it moves the queue's pick and the Log list to the store's `getStored`, so that a text find is not shown as "could not be read" and is analysed; or it ships with PBI-2.7: the Clead-role review of #49, note 3) — Text lookups and the save setting:
  - the text screen, up to 2,000 characters;
  - the "Save" switch with its starting values in Settings;
  - when a text find is saved, and its position;
  - unsaved lookups and their three error groups;
  - "no mushroom" and "cannot tell" for text;
  - the disclaimer for a lookup without photos. Its new sentence replaces only 3.5's second sentence, the one about the photo, and keeps the first; Clead's reading of his own proposal, which Adam approved. The Italian is checked by Jakob.
  Spec 3.9.
- **[NOW] PBI-2.5** (in the night shift; it also sends the find's text with its photos, which #54 does not yet: the Clead-role review of #54, note 3) (it sends all of a find's photos and passes all their URIs as `sent` to `setAnswer` and `replaceAnswer`; from the review of #49 round 2, also: read the self-check result by name, not `columns[3]`, and move `outcomeOf`'s doc comment back above it in `queue.ts`) — Several photos per find:
  - batches, and when they complete;
  - completing a batch as a queue trigger;
  - all of a find's photos in one request, labelled;
  - the per-photo failure rule and the PBI-1.25 count;
  - a new batch on an analysed find, with its three states;
  - removing a photo.
  Spec 3.9.
- **[NEXT] PBI-2.13** (moved out of PBI-2.4 by Clead, 2026-11-10: it depends on PBI-2.5's batches, and with it #54 was too large to review) — The photo lookup's "Save" switch:
  - the switch on a new photo lookup, on by default;
  - its starting value in Settings, beside the text lookup's;
  - unsaved photo lookups: held on the screen, analysed on "Analyse", their copies removed when the screen is left, with the three error groups as for an unsaved text lookup;
  - a lookup saved after its first photo was taken keeps that photo's time and position.
  Spec 3.9.
- **[NEXT] PBI-2.6** (the picker as Known unknown 13 has it, after PBI-2.1) — Photos from the phone's files, images only, without position or time of their own. Spec 3.9, Known unknown 13.
- **[NEXT] PBI-2.7** — The Library's list, replacing the Log:
  - the species, years and months filters;
  - unreadable finds always listed;
  - the text mark;
  - the Library opens on the list.
  Spec 3.9.
- **[NEXT] PBI-2.8** (MapLibre React Native with OpenFreeMap, Adam, 2026-11-09 21:27; the open points of Known unknown 11 are checked first) — The Library's map:
  - the 10 km shorter side;
  - the phone's position, with its limits and the location permission;
  - the fallbacks;
  - the finds in the area shown, following zoom and pan;
  - the pins;
  - the attribution.
  Spec 3.9, Known unknown 11.
- **[NEXT] PBI-2.9** (Wikimedia's terms and the licence allowlist, Adam, 2026-11-09 21:27; the open points of Known unknown 15 are checked first) — The representative picture for text lookups:
  - the Wikidata image by Latin name, as a thumbnail;
  - the credit;
  - stored apart from the photos;
  - Wikimedia's failures classed;
  - the picture belongs to an answer from text alone.
  Spec 3.9, Known unknown 15.
- **[NEXT] PBI-2.10** (after PBI-2.9) — The self-check of text lookups:
  - the photo lookup on the picture;
  - the match on genus and species;
  - its outcomes and the edibility "unknown" until it agrees;
  - its place in the queue run;
  - its error groups.
  Also, from the Crog-role review of #47, round 6: a 429 from Wikimedia ends the run, as 3.3 does for one from Anthropic; and a check still waiting when a batch completes on its find is skipped. Spec 3.9.
- **[LATER] PBI-2.11** — Adam's Phase 2 test session on his phone, including Known unknown 14 (memory with five photos), and Known unknowns 7 (a gallery photo's position) and 10 (a position fix while the camera is open), not tested in Phase 1 (PBI-1.11). Also to watch for: whether the model answers with a whole number for the confidence, as 3.9's prompt asks; an answer with a level fails the shape check, so every analysis would fail (Crog's note on #52; the prompt was not tried against a real model). Spec 3.9.
- **[LATER] PBI-2.12** (the Clead-role reviewer's non-blocking notes 1 to 3 on #52, Crog's note on #52) — Follow-ups that need no phone:
  - a narrower type for an answer from the API, so that "a level is never written" is checked by the compiler; the level branch in `answerColumns` cannot run today (note 1);
  - `isConfidenceLevel` is exported but used only in `answer.ts` (note 2);
  - the Log reads the confidence from the row's columns, the Find screen from the answer's JSON; nothing finds a damaged file where the two differ, as before #52 for the level (note 3);
  - SPEC 3.3's list still says "a confidence: low, medium or high"; 3.9 holds for Phase 2, but 3.3 read alone misleads.
  - SPEC Known unknowns 7 and 10 still say they are checked in, or point to, Adam's Phase 1 test session, which tested neither (PBI-1.11); they move to PBI-2.11 (Crog's note on #56);
  - SPEC 3.9's "so an SVG or TIFF original gives no picture" means only an original served in place of a thumbnail, and one line of Known unknown 15 is past the file's wrap width (Crog's notes on #56, round 3).
  Spec 3.3, 3.9, 4.
- **[LATER] PBI-2.15** (Clead's decision 3 on #57, 2026-11-10; SPEC 3.9 "Answers", #58) — The store records what an answer was based on (from the text alone, or from photos), so that "no mushroom" and "cannot tell" use the wording for a description or for a photo by the analysis that gave them, as the disclaimer of an answer naming a species already does. Today the store can tell the basis only for an answer naming a species (by its self-check); a schema change, with a migration from version 2. Spec 3.9, 3.6.
- **[LATER] PBI-2.14** (the Clead-role reviewer's non-blocking notes on #54, rounds 1 and 2, and Crog's loose ends on #54) — Follow-ups that need no phone:
  - a stored text over 2,000 characters, reachable only through a damaged file, is read as readable; the queue picks it, the request builder throws, and every run stops with an internal error (note 1);
  - the text field's `maxLength` counts UTF-16 units, while the counter, the flow and the store count code points (note 2);
  - a text find whose match has no self-check, reachable only through a damaged file, shows the answer's edibility; the rule relies only on the stored self-check (note 4);
  - after an unsaved lookup's answer of the wrong shape, the Log shows the queue's stop message "That find is marked failed", though no find was (Crog);
  - `FindStore.get`, the Phase 1 view, has no caller left in app code (Crog);
  - lines the tests do not reach: `settings.tsx` 96, 175 and 266, `text-lookup.tsx` 214 (the link to Settings), and the flow's close while the location is being asked (Crog).
  Not taken up: the look-alikes' edibilities and the general information stay shown while a text answer's check waits (note 5). 3.9's "unknown" is the matched species' edibility; the look-alikes carry their own, and the poisonous ones are a warning (Clead, 2026-11-10).
  Spec 3.9.

---

## Explicitly out of scope

- What `docs/SPEC.md` 3.7 lists as not in this version, apart from what 3.9 adds.
