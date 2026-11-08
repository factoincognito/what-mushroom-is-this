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

- **[NEXT] PBI-1.1** — The app shell: `expo-router` with its routes under `src/app/` (Log as the start screen, Settings), the config and i18n modules (Swedish, English, Italian; the phone's language by default when it is one of the three, otherwise English), the disclaimer accepted once at first start. Replaces the starter `App`. Creates `THIRD-PARTY-NOTICES.md` with the libraries the project already depends on and those it adds; every later item records in it the libraries it adds (policy `third-party-ip.md`, product-office `RULES.md` § 25). Spec 2, 3.1, 3.5.
- **[NEXT] PBI-1.2** — The API key and the model setting: the key module (secure store, trim, empty not saved, cleared on the first start after an install) and the Settings screen's key, model and language; the default model, chosen from the models then available (Known unknown 4). Spec 3.2, 3.3.
- **[NEXT] PBI-1.3** — The image module: the resize rule for both model tiers, tested with the docs' example and the 4:3 sizes, and the JPEG application-segment check. Spec 3.3.
- **[NEXT] PBI-1.4** — The analysis module: the request builder, the answer's shape and its validation (low confidence shows "unknown"), the error classes of the table, the time limit, no retries. Spec 3.3.
- **[NEXT] PBI-1.5** — The store: the database of finds and the photo files, add, read, replace the answer, delete with its photo. Spec 3.6.
- **[NEXT] PBI-1.6** — New find: camera and gallery, the position rule, the gallery photo's metadata time and position. Spec 3.1, 3.6.
- **[NEXT] PBI-1.7** — The queue: its triggers (with a network-state library, Known unknown 6), its run, its stops and restarts, the messages for each error class and stop, and "analyse now" on the Log screen. Spec 3.1, 3.3, 3.4.
- **[NEXT] PBI-1.8** — The Log and Find screens in full: names, edibility with the disclaimer, confidence and its note, general information, look-alikes (as the spec's **[Clead]** wording has them), position and time with their sources and the map link, analyse again, delete. Spec 3.1, 3.5.
- **[NEXT] PBI-1.9** — Out of the phone's backups, after checking the means the spec marks **[Clead]**, **[not checked]** against the documentation, and the About view with the licences. Spec 3.1, 3.6.
- **[BLOCKED] PBI-1.10** (needs Adam: `eas init` run signed in to his Expo account, which exists, to link the project) — EAS Build, Android: the build profile and the project link, then an installable build. Spec 3.8, Known unknown 5.
- **[LATER] PBI-1.11** — Adam's test session on his Android phone; the first version is done when it passes. Spec 3.8.

---

## Explicitly out of scope

- What `docs/SPEC.md` 3.7 lists as not in this version.
