# Process P-8. Session end

P-8 § 1 Writing as the work goes
(1) Records are written when a decision is made and when a PR opens, whether or not the session ends with a check. The end-of-session check catches what was missed.
(2) No stop word is used. There is no automatic end-of-session hook, so the session runs the end-of-session check itself.

P-8 § 2 End-of-session check
Whenever a session reports work as done, and when the product owner says they are stopping, in any words, the session, before replying:
(1) gives every staging-file entry it touched a disposition in accordance with P-8 § 4, and resolves every pin it wrote this session in accordance with Process P-9 § 5;
(2) opens PRs for anything agreed in the session and not yet written down, to the container Process P-9 assigns;
(3) runs the check of P-8 § 3 last, so that it checks the state after (1) and (2);
(4) reports the session clean, or what is open and why, links the PRs from (2), and shows the product owner the diff of every memory file touched.

P-8 § 3 Clean session end state
A session is clean only when each of the following was checked in this session, not assumed from an earlier report:
(1) `git status` is clean in every repository touched, carry-over from earlier sessions included;
(2) every PR opened in the session is merged and verified in accordance with Process P-4 § 3, or left open with the product owner's knowledge and a stated reason; a PR from P-8 § 2 (2) goes through the normal review and merge;
(3) every follow-up is persisted in the repository, in the container Process P-9 assigns; private memory does not count;
(4) every claim of done or confirmed rests on a direct check of that claim;
(5) `CHANGELOG.md`, where the project keeps one, reflects all merged PRs except the one documenting itself;
(6) "no open items" is checked against the actual threads (uncommitted diffs, unmerged PRs, unchecked claims), not against an empty tracking list;
(7) every pin of the session is in the backlog or has been dropped by the product owner.

P-8 § 4 Graduation of staging entries
(1) Every staging-file entry touched in a session is promoted (to a backlog item, a decision or a document), re-affirmed as still next, or deleted as resolved or obsolete before the session is clean.
