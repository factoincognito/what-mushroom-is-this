# Process P-2. Change flow

P-2 § 1 Author, clone and branch
(1) The author of a change opens its PR: Crog for the code it writes, Clead for docs, process and its own config.
(2) The author works in its own clone, commits to a branch, pushes it and opens the PR through the GitHub API.
(3) A branch is named `<type>/<short-description>`, for example `docs/naming-rollout`. The types are those `@commitlint/config-conventional` allows: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
(4) A name a tool assigns and the session cannot choose (such as a cloud session's assigned `claude/…` branch, or the bootstrapper's `bootstrap-setup` branch and its setup PR title) is kept.

P-2 § 2 Commits
(1) A commit message is imperative, in the present tense, and says specifically what the commit does.
(2) A closing keyword is never written before a PR or issue number ("fixes #N"); the text reads "addressed in #N" or "PR #N".
(3) A PR title reads `<type>(<scope>): <summary>`, with a type under P-2 § 1 (3) and the summary imperative and starting in lower case, for example `docs(backlog): add the naming rollout`.
(4) The session that merges sets the squash commit title to the PR title followed by ` (#<number>)`, and first corrects a PR title that does not follow (3). No CI check enforces this.

P-2 § 3 The PR
(1) A PR description says what changes, why, how it was tested, and what the reviewer should look at closely.
(2) The description of a PR that changes code also holds a test coverage narrative table (behaviour under test, test name, what it asserts), one row per non-trivial behaviour, error-path and recovery rows mandatory, and the red run required by § 30 (3).
(3) Where GraphQL is refused, PRs are opened, read and changed through the REST API (`gh api`), not `gh pr`.

P-2 § 4 Claims
(1) Before changing files, a session claims them: it opens a PR at once, with an empty commit if nothing is written yet, whose description names the area, the files it expects to change and the session, named as (5) sets out. Every comment the session posts on the PR names the session the same way.
(2) A claim PR shall not be opened as a draft.
(3) Until the change is pushed and ready for review, the PR title starts with `[claim]`. Nobody reviews or merges a `[claim]` PR; its review starts once the marker is removed. The claim PR becomes the PR for the change.
(4) Before editing a file its description does not name, the session adds the file to the description, unless another open PR names it; it then comments on that PR instead.
(5) Wherever a session names itself in Git or on GitHub (a PR description, a comment, a commit trailer, a record), it gives both its session link and its internal session ID (the environment variable `CLAUDE_CODE_SESSION_ID`); in a commit, the ID goes in a `Session-ID:` trailer next to the `Claude-Session:` trailer. A session without that variable says so in place of the ID.

P-2 § 5 Other sessions' work
(1) At startup, and before opening or updating each PR, a session lists the open PRs and the branches other than the default branch. A branch without an open PR is not a claim.
(2) A session does not edit files another open PR claims. It comments on that PR and settles the overlap there. Without an answer, the later claim (the higher PR number) waits until the earlier one is merged or closed.
(3) A file to which many sessions add entries (a backlog, a staging file) is claimed per entry or section, not as a whole. Before numbering a new entry, the session checks the default branch and the open PRs that change the file; before merging, it merges the default branch in once more and renumbers if the number was taken.
(4) Listing PRs and merging the default branch into one's branch are allowed at any time, also during a review or fix round.

P-2 § 6 Abandoned claims
(1) A claim with no new commit or comment from its session for 7 days is abandoned, unless it waits on the product owner, a review or a fix prompt.
(2) Another session may then say on it that it takes the files over, and go ahead in its own claim PR. Once its own PR carries those files, it closes the abandoned PR with a comment linking its own.
(3) If the first session comes back, it settles the overlap on the new claim, which goes first.

P-2 § 7 Conflicts
(1) On a conflict, the session merges the default branch into its branch and keeps both sides' content where possible.
(2) A pushed branch is never rebased or force-pushed.
(3) If the merge resolved conflicts, the session says so on the PR and names the files.

P-2 § 8 Working with clones
(1) A fresh clone tracks only the default branch; the session adds a fetch refspec for other branches it needs.
(2) A shallow clone is deepened before a check that needs history is run locally.
(3) At most two git operations run against one repository at a time; clones run inline, not in parallel.
