<!--
How to keep this file: product-office Process P-9 § 6.
-->

# Status

Last update: 2026-11-10

## Phase
Build: Phase 2, whose spec ([`docs/SPEC.md`](https://github.com/factoincognito/what-mushroom-is-this/blob/main/docs/SPEC.md) 3.9) Adam approved on 2026-11-09 20:49 ([#47](https://github.com/factoincognito/what-mushroom-is-this/pull/47)); the items are in [`docs/BACKLOG.md`](https://github.com/factoincognito/what-mushroom-is-this/blob/main/docs/BACKLOG.md). Phase 1 passed Adam's test session on 2026-11-09.

## Current focus
Phase 2's code is in: PBI-2.3 to 2.10 and 2.13, in [#52](https://github.com/factoincognito/what-mushroom-is-this/pull/52), [#54](https://github.com/factoincognito/what-mushroom-is-this/pull/54), [#57](https://github.com/factoincognito/what-mushroom-is-this/pull/57), [#61](https://github.com/factoincognito/what-mushroom-is-this/pull/61), [#63](https://github.com/factoincognito/what-mushroom-is-this/pull/63), [#66](https://github.com/factoincognito/what-mushroom-is-this/pull/66), [#68](https://github.com/factoincognito/what-mushroom-is-this/pull/68), [#71](https://github.com/factoincognito/what-mushroom-is-this/pull/71) and [#75](https://github.com/factoincognito/what-mushroom-is-this/pull/75). The night shift Adam started on 2026-11-09 at 22:54 (session https://claude.ai/code/session_01RZ8pEJjkkFM9VDxAs7KA6f) did PBI-1.29 in [#79](https://github.com/factoincognito/what-mushroom-is-this/pull/79) and PBI-2.12 in [#81](https://github.com/factoincognito/what-mushroom-is-this/pull/81) and [#82](https://github.com/factoincognito/what-mushroom-is-this/pull/82), and PBI-2.15 (schema version 3) in [#84](https://github.com/factoincognito/what-mushroom-is-this/pull/84) and [#85](https://github.com/factoincognito/what-mushroom-is-this/pull/85). The read checks for damaged files from PBI-2.14, 2.16 and 2.17 are in [#87](https://github.com/factoincognito/what-mushroom-is-this/pull/87). The shift ended at 2026-11-10 09:57, when Adam asked to close its session; [#89](https://github.com/factoincognito/what-mushroom-is-this/pull/89), the follow-ups on what the app tells the user, is open and unfinished (tests partly written, no code), for the next session to continue.

## Next step
- Adam: the Phase 2 build and his Phase 2 test session ([PBI-2.11](https://github.com/factoincognito/what-mushroom-is-this/blob/78444261e9f1d953cfe88840c1b7d32210d6ce9c/docs/BACKLOG.md?plain=1#L158)), when he means to move to Phase 2. The database migrations are one-way: a Phase 1 build cannot read the Phase 2 build's database (schema version 3). Install over the Phase 1 build, not after an uninstall, to keep the key and the finds.
- Adam: Jakob's check of the new Italian strings, and his own read of the Swedish ones (product office, "Waiting for Adam").
- Clead, the next session: finish #89 (its description holds the points and Clead's decisions), then the rest of PBI-2.16 and 2.14 that needs no phone; no EAS builds. Then the rename to Wushroom (PBI-2.19, [#91](https://github.com/factoincognito/what-mushroom-is-this/pull/91)); last, the version 0.2.0 PR (PBI-2.18), after which Adam builds and tags `v0.2.0`.

## Blockers
None.
