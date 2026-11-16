<!--
How to keep this file: product-office Process P-9 § 6.
-->

# Status

Last update: 2026-11-16

## Phase
Build: Phase 2, whose spec ([`docs/SPEC.md`](https://github.com/factoincognito/what-mushroom-is-this/blob/main/docs/SPEC.md) 3.9) Adam approved on 2026-11-09 20:49 ([#47](https://github.com/factoincognito/what-mushroom-is-this/pull/47)); the items are in [`docs/BACKLOG.md`](https://github.com/factoincognito/what-mushroom-is-this/blob/main/docs/BACKLOG.md). Phase 1 passed Adam's test session on 2026-11-09.

## Current focus
Phase 2's code is in: PBI-2.3 to 2.10 and 2.13, in [#52](https://github.com/factoincognito/what-mushroom-is-this/pull/52), [#54](https://github.com/factoincognito/what-mushroom-is-this/pull/54), [#57](https://github.com/factoincognito/what-mushroom-is-this/pull/57), [#61](https://github.com/factoincognito/what-mushroom-is-this/pull/61), [#63](https://github.com/factoincognito/what-mushroom-is-this/pull/63), [#66](https://github.com/factoincognito/what-mushroom-is-this/pull/66), [#68](https://github.com/factoincognito/what-mushroom-is-this/pull/68), [#71](https://github.com/factoincognito/what-mushroom-is-this/pull/71) and [#75](https://github.com/factoincognito/what-mushroom-is-this/pull/75). The night shift Adam started on 2026-11-09 at 22:54 (session https://claude.ai/code/session_01RZ8pEJjkkFM9VDxAs7KA6f) did PBI-1.29 in [#79](https://github.com/factoincognito/what-mushroom-is-this/pull/79) and PBI-2.12 in [#81](https://github.com/factoincognito/what-mushroom-is-this/pull/81) and [#82](https://github.com/factoincognito/what-mushroom-is-this/pull/82), and PBI-2.15 (schema version 3) in [#84](https://github.com/factoincognito/what-mushroom-is-this/pull/84) and [#85](https://github.com/factoincognito/what-mushroom-is-this/pull/85). The read checks for damaged files from PBI-2.14, 2.16 and 2.17 are in [#87](https://github.com/factoincognito/what-mushroom-is-this/pull/87). The shift ended at 2026-11-10 09:57, when Adam asked to close its session; The night batch of 2026-11-11 merged the follow-ups on what the app tells the user ([#89](https://github.com/factoincognito/what-mushroom-is-this/pull/89)), the description field's cut ([#95](https://github.com/factoincognito/what-mushroom-is-this/pull/95)), the test gaps ([#94](https://github.com/factoincognito/what-mushroom-is-this/pull/94)), the guards on removing the app's copies of photos and pictures ([#96](https://github.com/factoincognito/what-mushroom-is-this/pull/96)) and version 0.2.0 ([#99](https://github.com/factoincognito/what-mushroom-is-this/pull/99), PBI-2.18, merge commit `eea2393`). Adam built 0.2.0 from `eea2393` with EAS and tagged it `v0.2.0` on 2026-11-16. After 0.2.0, so not in a build from `eea2393`: on 2026-11-15 the stored photo failure loses its number when a photo is removed ([#101](https://github.com/factoincognito/what-mushroom-is-this/pull/101), `e0d3793`, under `[Unreleased]` in `CHANGELOG.md`) and the specification was aligned with the app after #89 ([#102](https://github.com/factoincognito/what-mushroom-is-this/pull/102), `ac6fbd6`); on 2026-11-16 every screen was kept clear of the Android system bars after Adam found the Settings link under the navigation buttons ([#106](https://github.com/factoincognito/what-mushroom-is-this/pull/106), `6c0dff3`, PBI-2.20), to be checked on the phone with a new build.

## Next step
- Adam: his Phase 2 test session ([PBI-2.11](https://github.com/factoincognito/what-mushroom-is-this/blob/78444261e9f1d953cfe88840c1b7d32210d6ce9c/docs/BACKLOG.md?plain=1#L158)) on the 0.2.0 build, which he installed over the Phase 1 build on 2026-11-16. The database migrations are one-way: a Phase 1 build cannot read the Phase 2 build's database (schema version 3).
- Adam: Jakob's check of the new Italian strings, and his own read of the Swedish ones (product office, "Waiting for Adam").
- Adam: whether the next build is 0.2.1 with #101 and #106; the 0.2.0 build installed on his phone lacks both.
- Clead: the rest of PBI-2.14 and 2.16 needs a phone, a decision or a SPEC line; no EAS builds.

## Blockers
None.
