# Process P-11. Engineering infrastructure

P-11 § 1 Principles
(1) What is mechanical is automated (formatting, lint, type checks, tests, the coverage gate) and blocks the merge in CI; design and specification questions go to review.
(2) Nothing depends on one person's machine; a new machine is productive in minutes.
(3) A project has only what it needs. Docker, deployment beyond the web pack's optional workflow, an operating-system matrix in CI, automated dependency updates, status badges and secrets management are left out until needed.

P-11 § 2 Continuous integration
(1) CI runs on every push to any branch and on every PR to the default branch, as one job named `build`, which is green from the first day (each language pack ships a starter test).
(2) `build` fails on every code-standards rule a tool can check: types, lint, formatting and at least 80% line coverage. Rules no tool checks are for review.
(3) Once a language pack's CI is in place, the test-change check runs first in `build` and fails a PR that changes code without changing a test; a `Test-exempt:` trailer is shown in the job summary. The check sees file names only; review judges whether the tests exercise the code.
(4) The same checks run locally before a push, in the order of `ci.yml`.
(5) Tool versions are pinned exactly and refreshed together, in one change, with a full CI run.

P-11 § 3 Branch protection
(1) Where the plan allows, the default branch is protected: a PR and the `build` check are required, no approving review is required, there is no bypass for administrators, and an up-to-date branch is not required. On GitHub's free plan only public repositories can be protected; private repositories rely on § 26 by convention.
(2) Protection is checked by opening a PR with a deliberately failing test: the merge must stay blocked, and the PR is closed unmerged. A setting shown as on is not proof.
(3) Where the bootstrap script did not turn protection on, the repository owner does it by hand: run CI once, add the rule, require a PR with no approvals, require `build`, allow no bypass.

P-11 § 4 Development setup
(1) A new machine gets git, VS Code (with the Claude Code extension for Crog) and the language pack's runtime; the repository is cloned, the recommended extensions are accepted, the pack's first-time setup is run and then the full CI command list once.
(2) A project ships `.gitattributes` with `* text=auto eol=lf` from the first day; it is not removed or overridden for a file without a reason recorded in the project's decisions.
(3) A project made from the template keeps the template's file layout unless its local rules say otherwise.

P-11 § 5 Language packs
(1) A project's code meets the `code-standards.md` of the language pack it uses (C#, Node, Python, React Native, Web), as shipped into the project.
(2) In every pack: no value is hardcoded (configuration file, environment variable or command-line argument instead); lint and format checks are clean before a push; line coverage is at least 80%.

P-11 § 6 Deployment
(1) Deployment is optional. A deploy workflow, which does not run the tests again, is added only once the default branch requires CI. The repository owner sets the deployment secrets.
