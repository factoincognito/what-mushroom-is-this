# Development Infrastructure

How a project made with the bootstrapper is set up, built and checked: a
new machine, CI, branch protection, commits, and the setup for each
language pack. The rules are Process P-11 of the Rules in `rules/`
(`rules/processes/P-11-engineering-infrastructure.md`), cited below by
number; this file is the how-to that goes with them. The rules for code
in each language live in the pack's `code-standards.md`.

Part 1 applies to every project. Part 2 has one section per language
pack.

---

## Part 1: Every project

### 1. Principles

The principles are Process P-11 § 1. Branch protection (section 4) is
how GitHub, not convention, keeps every change to `main` behind a pull
request and a green CI run; section 7 lists what is left out until a
project needs it.

### 2. New machine setup

What a new machine needs is Process P-11 § 4 (1); the steps:

1. Install git and VS Code. For Crog, install the Claude Code extension
   in VS Code.
2. Install the runtime for the project's language pack (Part 2):
   Node.js 24 for `node`, `web` and `react-native`, Python 3.14 for
   `python`.
3. Clone the repo and open the folder in VS Code. Accept the
   recommended extensions when VS Code offers them
   (`.vscode/extensions.json`, from the pack).
4. Run the pack's "First-time setup" (Part 2), then its full CI command
   list once. If everything passes, the machine is ready.

No git line-ending settings are needed on any OS: `.gitattributes`
handles it (section 3).

### 3. Scaffolding every project has from day one

Both of these ship with every project made with the bootstrapper. They
are part of the starting files, not something to add later.

**`.gitattributes`** at the repo root sets `* text=auto eol=lf`: LF line
endings in the repo and in every checkout, on every OS. Why it is
mandatory: in an earlier project, an editor set to "auto" line endings
silently rewrote whole files between LF and CRLF when edits made on
Windows and elsewhere touched the same file. It happened three separate
times on one pull request, and the fix came only after the damage.
With the policy pinned from the first commit, that class of bug cannot
happen. When it may be removed or overridden for a file:
Process P-11 § 4 (2), with the reason recorded in `memory/decisions.md`.

**`docs/NEXT_SESSION.md`** is the staging area for reasoning, revised
assumptions and plan changes that are not yet ready to be a backlog
item, a decision or a doc change. It is wired into the session routine
of the Rules: every session reads and triages it at its start (Process
P-1 § 4 (3)), and every entry touched in a session gets a disposition
before the session counts as clean (Process P-8 § 4). Why it is
mandatory: in an earlier project the same kind of file was added
mid-project, never wired into the session start, and went unread for
nearly a month. The file and its wiring come together; one without the
other does not work.

### 4. Branch protection runbook

**What it enforces.** Process P-11 § 3 (1). The pull request needs
**no** approvals because every PR is opened under the owner's own GitHub
account, and GitHub does not let authors approve their own PRs. Review
happens as a verdict comment instead (Process P-3 § 4).

**Turning it on in a new project.** The setup script,
`bootstrap-project.sh`, does this: it protects `main` right after it
creates the project, and adds `build` as a required check once the setup
pull request's `build` has passed. It then reads the protection back and
reports it. The steps below are the fallback of Process P-11 § 3 (3),
for a project set up without the script or whose protection was changed
by hand (repo owner, once, after the first push of the pack's `ci.yml`):

1. Push a branch and let CI run once. The required-checks picker only
   offers checks that have run in the repo recently.
2. Settings, Branches, add a branch protection rule for `main`.
3. Tick "Require a pull request before merging" and set required
   approvals to 0.
4. Tick "Require status checks to pass before merging" and add `build`,
   plus any other check your CI adds that must pass. Every pack's
   `ci.yml` has one job, named `build`, so `build` alone covers it.
5. Tick "Do not allow bypassing the above settings".
6. Save.

On GitHub's free plan this is only available for public repositories.

**Checking that it works** (Process P-11 § 3 (2)). Open a pull request
with a deliberately failing test: the merge button must stay blocked
until the check is green. Then close it without merging.

### 5. CI/CD

**CI runs on every push to any branch and on every pull request to
`main`** (GitHub Actions, `.github/workflows/ci.yml`). A new project
starts with a stub `ci.yml` that only checks out the code; the language
pack's `ci.yml` replaces it. The stub has no test-first check because,
with no pack, there is no `src/` to define code by.

The rules every pack's CI follows are Process P-11 § 2. How each is
carried out:

- **One job, named `build`** (Process P-11 § 2 (1)). Branch protection
  requires a check by that name. Rename the job and every pull request
  waits for a `build` check that never arrives, until the required check
  is changed too. Each pack ships a placeholder or starter test, so a
  fresh project passes its own CI with no changes.
- **The test-change check** (Process P-11 § 2 (3)). After the checkout,
  the first step of `build` runs `.github/scripts/require-test-change.sh`
  with the pack's patterns. A change no test can check carries a
  `Test-exempt: <reason>` commit trailer, which the job summary shows
  for the reviewer. The checkout needs `fetch-depth: 0` so the base
  branch is there to compare with. To run it locally, give it the base
  with `TEST_FIRST_BASE`; each pack's `code-standards.md` has the full
  command.
- **What a tool can check** (Process P-11 § 2 (2)): the rules a pack's
  `code-standards.md` states that a tool can check (types, lint,
  formatting, the line coverage gate) are steps of its `ci.yml`.
- **The same checks locally** (Process P-11 § 2 (4)). Each pack's
  `code-standards.md` gives the commands; run them in the order of the
  project's `ci.yml`.
- **Pinned versions**: Process P-11 § 2 (5).

**CD** (Process P-11 § 6). None by default. The `web` pack ships an
optional workflow that deploys to Cloudflare on every push to `main`; it
does not re-run the tests, so it is only safe once branch protection
requires `build`.

### 6. Commits, branches and pull requests

- **One PR, one change:** § 27 of the Rules.
- **Branch names:** Process P-2 § 1 (3), e.g. `feat/udp-listener`,
  `fix/multicast-join-error`.
- **Commit messages and PR titles:** Process P-2 § 2. Good:
  `Add configurable UDP listener with multicast support`. Bad:
  `Added stuff`, `WIP`, `fix`.
- **Squash merge:** Process P-4 § 2 (4). To have GitHub delete the
  branch after the merge, turn on "Automatically delete head branches"
  in the repo settings (Settings, General, Pull Requests).

### 7. Deliberately left out

What is left out until a project needs it: Process P-11 § 1 (3).

---

## Part 2: Per language

Each pack's `code-standards.md` is the reference for its rules and
commands. It sits in `languages/<pack>/` in a new project.

### Python (`python` pack)

**Version.** Python 3.14. CI uses the latest 3.14 release that
`actions/setup-python` offers; use the same minor version locally.

**Virtual environment.** Always work in `.venv`, never in the system
Python. Once per clone:

```bash
# macOS / Linux
python3.14 -m venv .venv
source .venv/bin/activate

# Windows
py -3.14 -m venv .venv
.venv\Scripts\activate
```

Activate it again in every new terminal.

**Install, then the pre-commit hook.**

```bash
pip install -r requirements.txt -r requirements-dev.txt
pre-commit install
```

`requirements.txt` holds what the application needs to run;
`requirements-dev.txt` holds Ruff, mypy, pytest, pytest-cov and
pre-commit. Both pin every entry exactly. There is no lockfile, so the
dependencies of those packages are not pinned; add a lock tool if the
project needs fully repeatable installs. After `pre-commit install`,
every `git commit` runs Ruff on the staged files and stops the commit
on any problem. Problems Ruff can fix are fixed in the files; stage
them and commit again.

**The checks, as CI runs them.**

```bash
ruff check .                          # lint
ruff format --check .                 # formatting
mypy                                  # strict type check of src/
pytest --cov=src --cov-fail-under=80  # tests and the coverage gate
```

**Run as a module, from the project root.** Always
`python -m src.<module>.main`, never `python src/<module>/main.py`. Run
as a script, the imports `from src.<module> import ...` fail with
`ModuleNotFoundError: No module named 'src'`, on every OS.

**Gotcha: `MagicMock(spec=...)` inside `patch`.** Building
`MagicMock(spec=socket.socket)` inside `with patch("socket.socket"):`
raises `InvalidSpecError: Cannot spec a Mock object`, because the patch
has already replaced `socket.socket` with a mock. Build the mock before
the patch and hand it in:

```python
mock_sock = MagicMock(spec=socket.socket)  # before the patch
with patch("socket.socket", return_value=mock_sock):
    ...
```

It is often described as a Python 3.14 problem; it is not. Python 3.11
and 3.14 both fail the same way.

Details: `languages/python/code-standards.md`.

### Node.js and TypeScript (`node` pack)

Node.js 24, Biome, TypeScript strict mode, Jest with an 80% line
coverage gate. The first `npm install` creates `package-lock.json`,
which the project commits, because CI installs with `npm ci`. Setup and
commands: `languages/node/code-standards.md`.

### Static web page (`web` pack)

Node.js 24, Biome, TypeScript strict mode and Jest with an 80% line
coverage gate, plus a Vite build into one self-contained HTML file and
Playwright browser tests. The first `npm install` creates
`package-lock.json`, which the project commits, because CI installs with
`npm ci`. Setup, commands and the optional Cloudflare deploy:
`languages/web/code-standards.md`.

### Mobile app (`react-native` pack)

Expo SDK 57 with React Native 0.86 and React 19.2, TypeScript strict
mode, Biome, and Jest through the `jest-expo` preset with React Native
Testing Library for components, under an 80% line coverage gate. The
first `npm install` creates `package-lock.json`, which the project
commits. The Expo, React, React Native, Jest and TypeScript versions
move together with the SDK: add libraries with `npx expo install`, and
upgrade the SDK as one change.

CI checks only what runs in Node on a Linux runner: lint and format,
the type check, and the tests. It does not build the app for Android
or iOS, run it on a device or simulator, or use EAS, which need
platform tooling (Xcode needs macOS) or an Expo account. Try changes
the tests cannot see on a phone with Expo Go. Setup, commands and the
full list of what CI does not check:
`languages/react-native/code-standards.md`.
