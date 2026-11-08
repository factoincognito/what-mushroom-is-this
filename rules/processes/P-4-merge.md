# Process P-4. Merge

P-4 § 1 Conditions
A PR is merged only when all of the following hold on its current head:
(1) any review § 28 requires has approved it in a verdict comment;
(2) any intent approval § 10 (4) requires is recorded on the PR;
(3) CI, where the repository has it, is green on that exact head;
(4) its title carries no `[claim]` marker;
(5) it carries no WHAT that the product owner has not decided (§ 10 (3)).

P-4 § 2 Who merges
(1) The session driving the PR merges it, or a separate merge-only agent that session starts, without asking the product owner.
(2) The verdict comment is posted before the merge, never as a later step.
(3) A merge-only agent checks the head, the checks and the approval comment again before it merges.
(4) PRs are squash-merged, with the commit title set in accordance with Process P-2 § 2 (4).

P-4 § 3 Verification
(1) Every merge is verified through the GitHub API (merged, merge commit, changed files) before it is reported. A merge agent's report is a relay and is not verification.
(2) Merges are reported to the product owner after the fact.

P-4 § 4 Waiting for CI
(1) A session does not poll CI in short loops. It schedules a check-in or works on something else meanwhile.

P-4 § 5 After the merge
(1) Where the project keeps `CHANGELOG.md`, a PR updates it after each merge; the file reflects every merged PR except the one documenting itself.
(2) Merged branches stay until deleted in GitHub or removed by the repository's automatic deletion setting; branch deletion from a cloud session has been refused (403).

P-4 § 6 Refused merges
(1) A refused merge, or a refused step of the merge route, is handled in accordance with Process P-5 §§ 2 and 3.
