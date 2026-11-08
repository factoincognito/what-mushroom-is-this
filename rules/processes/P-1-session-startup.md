# Process P-1. Session startup

P-1 § 1 (C) Reading before work
(1) Before any other work, a session reads all of these Rules (`rules/RULES.md`), the processes its work needs, and the project's local rules and local processes.
(2) Before writing code in a project, a session also reads the project's specification and developer onboarding, where the project has them, and the files its local rules name for session start.

P-1 § 2 Access to the repository
(1) Before any other work, the session makes sure it can read and push to this repository, checked in accordance with P-1 § 3.
(2) Where the repository is attached with `add_repo` and the push attach is refused, the session attaches with read access and retries the push attach once. It reports no lack of GitHub access before both have been tried.
(3) Access is per attached repository: another repository is attached with `add_repo` and then cloned. A token in the environment or the chat does not give access.
(4) Two repositories with the same name under different owners cannot be attached in one session; a session that needs both says so.
(5) The product owner opens every session they start with the start line, which names this repository as `owner/repo`: "Attach <owner>/<repo> with push access, read its CLAUDE.md, rules/RULES.md and RULES.md, and run the session startup."
(6) If the first message of a session the product owner starts does not hold the start line and its attach is still refused after (2), the session gives the product owner the start line as a **Now** item of its For you block, as a code block. The items P-1 §§ 3 (2), 4 (5), 7 (1) and 8 (1) put in the first reply then go in the first reply after the attach.

P-1 § 3 Capabilities
(1) The session checks which capabilities it has (GitHub access and push, memory, connectors) from its actual tool list, and verifies GitHub access by using it: it fetches the repository and reads its open PRs through the API. A setting shown as connected is not proof.
(2) It reports its capabilities to the product owner in one line before other work, naming any that differ from what its work needs.

P-1 § 4 State of the work
(1) The session reads the project's decisions file and its `STATUS.md` in full, in the way P-1 § 9 sets out. Of the project's backlog it reads the open entries: the section "Waiting for the product owner" and the entries marked `NOW`, `NEXT` and `BLOCKED`.
(2) It lists the open PRs and the branches other than the default branch in this repository, and in each other repository its work touches, and checks whether a review is waiting.
(3) Where a project keeps a staging file (`docs/NEXT_SESSION.md`), the session reads and triages it; every entry it touches gets a disposition in accordance with Process P-8 § 4.
(4) It derives the current item from the open PRs and the project's backlog.
(5) In its first reply, a session the product owner starts names every entry of the project's backlog not marked `DONE` that is due within the next seven days or overdue, with its date.

P-1 § 5 Today's work
(1) A session that the product owner starts asks them what today's work is, unless their first message says it.

P-1 § 6 Model and effort
(1) Reviews of code, process and architecture changes, and architecture design drafts, run in a separate agent on Opus. Merge-only runs and the writing of docs, backlog and changelog use the default model.
(2) Clead sessions run by default on Sonnet at High effort; Medium effort is used for a purely mechanical batch.
(3) Clead cannot read or change the model or effort of its own session. Before a task that warrants another setting, Clead recommends one and waits for the product owner to switch or to say proceed, and says when to switch back.
(4) Clead sets the model of the agents it starts; the product owner sets the model and effort of their own sessions.

P-1 § 7 Delegation for the session
(1) In its first reply, a session the product owner starts gives them, as a **Now** item of its For you block and as a code block, this line to send: "I delegate to you, for the rest of this session, every change that the project's rules allow, merges, scheduled-task changes, tool installs and branch deletions included, in this repository." Where the product owner's first message already holds that line, the session says instead that it was received (P-1 § 10 (2)).
(2) The line delegates nothing these Rules do not already allow; it gives in chat the delegation that Claude's permission check has been seen to ask for.
(3) A step that is still refused after the product owner has sent the line is handled in accordance with Process P-5, and the refusal is recorded in accordance with P-5 § 3 (2).

P-1 § 8 Files in context
(1) In its first reply, a session the product owner starts gives a numbered list of every file whose content has entered its context so far, by any route: read by the session, loaded by the harness (such as a `CLAUDE.md`), or returned by a tool. A file read only in part is marked with the part read; where no paragraph of these Rules requires it to be read in full, the mark adds: "intentional partial read, outside the full-read rule; no violation, no action needed".
(2) A file from GitHub, also when it was read from a local clone, is named `owner/repo/path/filename.extension`. A file from another source is named so that it is as easy as possible to identify, for example by its source and full path: `memory: <path>` or `local file: <absolute path>`.
(3) The list comes before the delegation line of P-1 § 7.

P-1 § 9 Complete reads
(1) A file that P-1 § 1 requires a session to read is read with the file-reading tool (in Claude Code, `Read`), one file per call, not through a shell command.
(2) A read is complete only when the tool gives no notice that it returned only part of the file and the last line number returned is not below the file's line count (`wc -l`). Where it is not complete, the session reads the rest before any other work.

P-1 § 10 Startup report
(1) In a session the product owner starts, the first reply that P-1 §§ 3 (2), 4 (5), 7 (1) and 8 (1) name is the session's first message to the product owner after the reads of P-1 § 1 and § 4. It is sent before any work on the day's task begins, also when the product owner's first message holds the start line, the delegation line and the task together. Where the task would otherwise begin in the same turn, the session sends the report with the tool that shows the product owner a message while the session goes on working (in the Claude app, `SendUserMessage`), and starts the task only after it has been sent. A session without such a tool gives the report as the first text of its turn, before any tool call for the task.
(2) The report gives, in this order: the capabilities line of P-1 § 3 (2); the entries P-1 § 4 (5) names, or that there are none; the list of P-1 § 8 (1); the line of P-1 § 7 (1), or, where the product owner's first message already holds that line, that it was received; and, where the product owner's first message names no task, the question of P-1 § 5 (1).
