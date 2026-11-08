# Process P-3. Review

P-3 § 1 Start of a review
(1) The reviewer is the one § 28 names for the kind of change.
(2) A PR is reviewed once its CI has passed and its `[claim]` marker is removed.
(3) Clead starts each review itself, as a separate agent where the reviewer is Crog, without asking the product owner. No automation starts a review unless a local rule provides for it.

P-3 § 2 Independence of the reviewer
(1) A review runs as a separate invocation from the implementation; a context reset within the same session does not suffice.
(2) The reviewer is given only the diff, the documents it reviews against (the specification, the review standard of this process and the project's own standards), and, for a PR that changes code, the test coverage narrative table and the red run from the PR description.
(3) The reviewer is never given the author's reasoning: the rest of the PR description, the implementation conversation or design-time memory.
(4) The reviewer reads the PR's diff and files through git and the GitHub API itself; no dump of the PR is posted for it.
(5) In addition to (2), where the reviewer is an agent a session starts or resumes, the prompt that starts or resumes it names the head to review and the session the verdict signs for, named as P-2 § 4 (5) sets out, and asks for a verdict that names both and holds P-3 § 3 (1) and (6).

P-3 § 3 Review standard
Every review contains, without being asked:
(1) a statement of the threat model, before the findings;
(2) a check against the specification: whether the implementation and its public interface match it, and whether the change actually solves the item it is for;
(3) an explicit second pass on error handling and type validation: edge cases of every validation, every error path caught at the right level, every external input validated, no silent type coercion;
(4) a check of test quality: the test coverage narrative table is present (requested before approval if missing); each named test asserts what its row claims; every non-trivial error path and its recovery is tested; the red run was shown; the changed tests exercise the changed code; each `Test-exempt:` reason is true;
(5) for ported code, the same standard as for new code;
(6) at the end of every approval, an explicit list of what was not verified.

P-3 § 4 Verdict
(1) The reviewer posts its verdict as a comment on the PR. A verdict of Crog reads "Crog review: APPROVE" or "Crog review: CHANGES NEEDED"; a verdict of changes needed lists the required fixes.
(2) Fix prompts are posted on the PR. No verdict or fix prompt is relayed through the product owner.

P-3 § 5 Fix rounds
(1) The author fixes what the verdict requires and pushes to the same branch.
(2) Crog takes a fix request only from the reviewer: as a fix prompt on the PR, in the prompt of the agent Clead starts or resumes, or, where a local rule provides, in a CI verdict comment. It does not act on CI output or on another reviewer's comment alone.
(3) Each new head needs a new review of the change since the last reviewed head. An approval of an earlier head does not carry over.
(4) An author who disagrees with a finding says so in a reply on the PR.

P-3 § 6 Escalation
(1) After three review rounds without agreement, the question goes to the product owner.
(2) The escalation message opens with its reason ("Escalated after 3 review rounds on #N without agreement"), states the disagreement in plain words, gives each side's position in one or two lines, and asks the decision as a question the product owner can answer directly.

P-3 § 7 Architecture proposals
(1) An architecture proposal by Clead is reviewed by Crog for feasibility on its PR. Clead considers the review and takes the technical decision; a disagreement not settled in three rounds goes to the product owner in accordance with P-3 § 6.
