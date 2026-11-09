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
- **[NEXT] PBI-1.8** — The Log and Find screens in full (a find that failed the segment check names the refused marker in its message): names, edibility with the disclaimer, confidence and its note, general information, look-alikes (as the spec's **[Clead]** wording has them), position and time with their sources and the map link, analyse again (a failed new analysis of an analysed find is shown in its message, the answer kept; SPEC 3.3), delete; how a find the store cannot read is shown (reviewer's note 5 on #11). Spec 3.1, 3.5.
- **[NEXT] PBI-1.9** — Out of the phone's backups, after checking the means the spec marks **[Clead]**, **[not checked]** against the documentation, including the stored disclaimer acceptance on iOS (reviewer's note on #6); the app's Android backup rules include the secure store's own exclusions, or its plugin skips them with only a warning (reviewer's notes on #12); and the About view with the licences, including the shipped transitive packages and the Apache-2.0 NOTICE duties if the product office's policy asks for them (#6's loose end), and the release gate's licence reads #14 left open: the exact Glide and AndroidX POMs and the `SDWebImageWebPCoder` version CocoaPods chooses (`THIRD-PARTY-NOTICES.md`). Spec 3.1, 3.6.
- **[BLOCKED] PBI-1.10** (needs Adam: `eas init` run signed in to his Expo account, which he has created, by his word in the product office, not checked, to link the project) — EAS Build, Android: the build profile and the project link, then an installable build. Spec 3.8, Known unknown 5.
- **[LATER] PBI-1.11** — Adam's test session on his Android phone; the first version is done when it passes. It also settles Known unknowns 2, 7 and 9: the segment check on what the phone's encoder writes, a gallery photo's position on Android, and whether a request with thinking keeps to the time limit. Spec 3.8.
- **[DONE] PBI-1.12** (done 2026-11-09 in #19, `c3fd6ef`, Clead-role review approved) (Clead-role reviewer's notes on #5) — Image module follow-ups: `countImageTokens` validates its input as `resizedSize` does; the name of the 952.5 tie test says only what it asserts.
- **[DONE] PBI-1.13** (done 2026-11-09 in #18, `1ad510b`, Clead-role review approved; the workspace message checked against the "Authentication" page) (Crog's note on #9) — The analysis module's error classes: the 400 that says the key is not scoped to a workspace is handled as 401, 403, with its message taken from the API's "Authentication" page; and, Clead's decisions on #15's review, a refusal (`stop_reason` `refusal`) marks the find failed and lets the queue go on, and an answer's text blocks are joined in order. Spec 3.3, Known unknown 8.
- **[DONE] PBI-1.14** (done 2026-11-09 in #15, `9c24b96`, Clead-role review approved; thinking counts toward `max_tokens` on the current models, so `max_tokens` is 16,000 and each model keeps its own thinking and effort, decided by Clead) (Clead-role reviewer's notes on #8, Crog's on #9 and #10, the PBI-1.2 implementer's on #12) — Analysis module follow-ups: first, check against the API documentation whether thinking is always on for the current models and counts toward `max_tokens`, and if so set `max_tokens` (or the thinking settings) so the JSON answer is not cut off; a `retry-after` too far ahead (one a JavaScript date cannot hold, and a bound for far-future values) is treated as missing; a cut-off answer (`stop_reason`) gets its own detail; the API address and the model ID are validated; `buildAnalysisRequest` is not exported or checks the key itself; where `MAX_TOKENS` and the API version live (product-office P-11 § 5 (2)); the refused-key test also asserts the class. Spec 3.3.
- **[NEXT] PBI-1.15** (#6's loose end) — Bring `expo` and `jest-expo` to the versions SDK 57 expects (`npx expo install --check`), in one change.
- **[NEXT] PBI-1.16** (Clead-role reviewer's notes 3 to 6 on #11) — Store follow-ups, before the first release so schema version 1 can still change in place: a STRICT table and a CHECK on the edibility; one store however often it is opened, so the stray-photo sweep cannot remove a photo being added; one unreadable row does not hide the whole list, and an unreadable oldest waiting row does not stop every queue run (reviewer's note 9 on #17); the store's SQL runs in CI on a real SQLite, which #17's `schema.sqlite.test.ts` started (the schema, the causes, `oldestWaiting`), for the rest of its statements. Spec 3.6.
- **[NEXT] PBI-1.17** (Clead-role reviewer's notes on #12) — Key and settings follow-ups: a failed write of the install marker does not later delete a key saved since; Remove is offered while the key store cannot be read; the key is not read for analysis when the first-start clearing reported a failure (reviewer's note on #17); the startup promise does not depend on the order of effects; the `app.json` plugin test runs the real plugin, as the sitemap test does. Spec 3.2.
- **[LATER] PBI-1.18** (Known unknown 7, #14) — A gallery photo's position on Android, if Adam's test session (PBI-1.11) shows it does not arrive: `expo-media-library` with `ACCESS_MEDIA_LOCATION`, only if the permission it then asks for is in proportion. Spec 3.1, 3.6.
- **[BLOCKED] PBI-1.19** (needs Adam: his decision on the escalation under the product office's third-party policy, A.2: `expo-location` builds in Google's `play-services-location` on Android; parked in #16) — The phone's position for a new find, SPEC 3.6's position rule and its 30-second fix. Spec 3.1, 3.6.
- **[NEXT] PBI-1.20** (Clead-role reviewer's notes on #14) — New find follow-ups: `setPosition`'s SQL runs on a real SQLite (with PBI-1.16); the iOS permission texts in the three languages; the comment on the 0,0 rule says only what its source says; a kept photo is not dropped without a word when the screen is left; "Discard the photo" asks first, with a SPEC 3.1 line for it. Spec 3.1.
- **[NEXT] PBI-1.21** (Clead-role reviewer's notes on #17, Clead's decisions) — Queue follow-ups: a find fails with cause `photo` only when its photo cannot be loaded, decoded or sized, and any other error while it is prepared stops the queue with `internal-error`; `key-not-scoped` gets a field of its own in the error classes; a refusal gets its own failure cause and message; the resume time pinned to its "UTC" form; the device queue's time limit asserted; the network test's name; `ACCESS_WIFI_STATE` removed if `expo-network` allows. Spec 3.3, 3.4.
- **[NEXT] PBI-1.22** (Clead-role reviewer's notes 1 and 2 on #18, note 7 on #17) — Test follow-ups: the root `__mocks__/expo-network.ts` is type-checked (it is outside the `tsconfig` `include`); a 400 whose message shares only a shorter start with the not-scoped message is not classed as it; the test of text blocks joined "with nothing between them" splits inside a JSON string. Spec 3.3.

---

## Explicitly out of scope

- What `docs/SPEC.md` 3.7 lists as not in this version.
