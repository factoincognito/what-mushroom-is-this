# [PROJECT NAME]

[One or two sentences: what this project is and who it is for.]

A project run with the Clead + Crog workflow. The product owner,
[PO NAME], decides what gets built, Clead (Claude, Tech Owner) owns
how, and Crog (Claude Code, Senior Developer) implements. Everything
the agents need lives in this repo: `CLAUDE.md` is the entry point.

## Finishing the setup

If you see this, the setup of this project has not finished. Until it has, this project's GitHub page shows the bootstrapper's README (the file `.github/README.md`): do its step 0 to install gh and sign in, then run the command below in Git Bash (Windows) or a terminal (Linux; the setup does not support macOS for now), with OWNER and NAME taken from this project's web address, https://github.com/OWNER/NAME:

```
gh api repos/factoincognito/ai-project-bootstrap/contents/bootstrap-project.sh -H "Accept: application/vnd.github.raw+json" > bootstrap-project.sh && bash bootstrap-project.sh --resume --owner OWNER --name NAME
```

The setup then finishes, and removes this section and `.github/README.md`.

## Setup

### Prerequisites
- The Claude app, for Clead (the chat where you plan and decide)
- VS Code with the Claude Code extension, for Crog (optional: Clead can
  also start Crog itself)
- A GitHub account, and git

### Working setup
Run the Claude app next to VS Code. In the Claude app, create a Claude
Project for this repo, add the repo to that Claude Project (give it
access when asked), and start a chat inside the Claude Project;
`CLAUDE.md` loads from the repo. Before the first task, ask Clead to
summarise `memory/context.md` and `memory/project.md`: if it can
describe the project and its goals, it is oriented. In VS Code, open
your clone and use a Claude Code tab if you want to run Crog yourself.

Keep one Claude Project per repo, so what Clead learns in one project
never mixes with another.

### Starting later sessions
In the Claude app, start a new chat inside the project's Claude Project
(it already has the repo). Clead follows the session startup of the
Rules (`rules/processes/P-1-session-startup.md`), which `CLAUDE.md`
points to. The first thing you say is the first thing that matters.

### Working from another computer
You can work on this project from more than one computer, for example
a computer at home and a laptop for travel. Another computer does not
add capacity or let work run in parallel: it is the same work, done
from another place. The project itself is kept on GitHub, so nothing
has to be moved from one computer to the other.

If you work only in the Claude app, step 4 is all you need on the other
computer. Steps 1 to 3 give you a copy of the project to work on in VS
Code with Claude Code.

On the other computer, once:

1. Install gh and sign in to GitHub: step 0 under "Start here" in the
   bootstrapper's README, https://github.com/factoincognito/ai-project-bootstrap.
   Do not do its step 1: step 1 creates a new project.
2. In the same window, go to the folder that should hold the copy of
   this project. This line makes one named projects in your home folder
   and goes there:

   ```
   mkdir -p ~/projects && cd ~/projects
   ```

   Then get a copy of this project, with OWNER and NAME taken from this
   project's web address, https://github.com/OWNER/NAME:

   ```
   gh repo clone OWNER/NAME
   ```

   The copy is in a new folder named NAME.
3. Tell git your name and email address for this copy, with your own
   name and email address in place of Your Name and you@example.com:
   the same ones you gave the setup on your first computer. Git records
   them with each change, and anyone who can see the project can see
   them. If you do not remember them, run `git config user.email` (and
   `git config user.name`) in the copy on your first computer.

   ```
   cd NAME
   git config user.name "Your Name"
   git config user.email "you@example.com"
   ```

   To work on the copy in VS Code, this computer also needs what the
   project's kind of code runs on, and its first-time setup:
   `docs/DEV_INFRASTRUCTURE.md`, "New machine setup", steps 2 and 4.

4. In the Claude app, sign in with the same Claude account and open
   this project's Claude Project, as on your first computer. The Claude
   app needs nothing else on this computer; the copy is for working in
   VS Code with Claude Code.

## The team

| Role | Who | Surface |
|---|---|---|
| Product Owner | [PO NAME] | Claude app |
| Tech Owner / Reviewer | Clead (Claude) | Claude app |
| Senior Developer / Implementer | Crog (Claude Code) | VS Code, or an agent Clead starts |

## Workflow

The product owner describes the next PBI. Clead specs it; the product
owner confirms it captures the intent. Crog implements, test first.
Reviews and merges are delegated: Clead reviews Crog's code, Crog
reviews Clead's code, config and process changes, and Crog merges once
the review passes and CI is green. After 3 review rounds without
agreement, the product owner decides. The product owner is never used to
pass messages between Clead and Crog. Details: the Rules in `rules/`,
§ 10 and § 26 to § 28 of `rules/RULES.md` and Processes P-2 to P-4, and
the project's own rules in `RULES.md`.

## Working without Claude

Without Claude, this project is a conventional, well set-up development
project, as development looked before AI became a tool for writing code.
With Claude, the Clead and Crog workflow comes on top of it.

**What works without Claude.**

- The setup did not need Claude: the setup script needs bash, git and a
  signed-in `gh`, and Node.js with npm for the node, web and
  react-native packs.
- A green `build` check from the start, and `main` protected: nothing
  merges without a pull request and a green `build`. The exception is a
  private project on a free GitHub plan set up with
  `--allow-unprotected`, which has no protection and records that in
  `memory/decisions.md`.
- The test-first check in `build`: a pull request that changes code
  without changing a test fails, unless a commit in it has a
  `Test-exempt: <reason>` trailer line (in the last paragraph of the
  commit message).
- A place for everything: the backlog (`docs/BACKLOG.md`), decisions
  (`memory/decisions.md`, and `docs/decisions/` for longer ones), the
  status (`STATUS.md`), the change history (`CHANGELOG.md`), the pull
  request template, and the language pack's code standards.
- The two workflows that post comments, `review.yml` (a hidden marker
  on pull requests that change `src/`) and `changelog.yml` (a reminder
  after a merge that did not change `CHANGELOG.md`), run on GitHub alone.
  The comments are addressed to Clead and Crog.

**What does not work without Claude.**

- Clead and Crog, and everything they do: specs, reviews, merges,
  session start and end, and pins.
- `CLAUDE.md`, `RULES.md` and the Rules in `rules/` are written for
  Clead and Crog, and
  `memory/context.md` is Clead's session notes. Without Claude, nobody
  reads them as instructions.
  The other files under `memory/` hold the project's own data, such as
  its description and decisions, and stay useful.
- The texts the setup left for the first session with Clead: the phase
  name in `docs/BACKLOG.md`, `memory/project.md`, the questions in
  `docs/SPEC.md`, `memory/context.md` and `STATUS.md`.
- Crog needs Claude Code, which the Free Claude plan does not include
  (https://claude.com/pricing, checked 2026-10-29).
- Whether other AI tools (such as Copilot or Cursor) read any of the
  project's files has not been checked.

**How to work with the project without Claude.** These are the rules
written for Clead and Crog, as they apply to a team of people only:

- Every change goes through a pull request; branch protection enforces
  it, except in a project set up with `--allow-unprotected`, where the
  team keeps to it without that check.
- Write the test first and see it fail. The test-first check fails a
  code change without a test; a change no test can check says why in a
  `Test-exempt:` trailer line.
- Someone other than the author reviews the pull request. The review
  standard of the Rules, Process P-3 § 3
  (`rules/processes/P-3-review.md`), works as the review checklist.
- Merge once `build` is green and the review has passed.
- Fill in the texts the setup left for Clead (listed above) yourself,
  and keep `STATUS.md` up to date by hand.
- The comments from `review.yml` and `changelog.yml` can be ignored, or
  the two workflows deleted.

## Branch protection

`main` is protected: nothing merges without a pull request and a green
`build` check, and the rule applies to admins too. The setup script
turns this on. What it enforces, how to check it works, and how to turn
it on by hand: `docs/DEV_INFRASTRUCTURE.md`, "Branch protection
runbook".
