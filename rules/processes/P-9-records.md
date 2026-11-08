# Process P-9. Records

P-9 § 1 Containers
(1) Actionable work is kept in the project's backlog and settled decisions in the project's decisions file. A project's local rules name its files.
(2) A project may keep a staging file (`docs/NEXT_SESSION.md`) for reasoning not yet ready to be a backlog item, a decision or a document. It is not a second backlog; its entries graduate in accordance with Process P-8 § 4.
(3) Where a project keeps memory files in its repository, Clead maintains them, and they hold only what cannot be derived from Git.

P-9 § 2 Backlog format
(1) A backlog has one entry per line, `- **[MARKER] ID**`, optionally followed by notes in parentheses, then ` — ` and the title; detail is indented below the entry.
(2) The markers are `NOW`, `NEXT`, `LATER`, `DONE` and `BLOCKED`. A line inside a fenced code block is never an entry.
(3) The specification of the format is the header of the project's backlog file.
(4) A due date is written in the entry's notes as `due YYYY-MM-DD`.

P-9 § 3 Waiting for the product owner
(1) The section "Waiting for the product owner" of the project's backlog is the one list the product owner reads. Every open item that needs their click, setting or decision is one line in it, with Clead's recommendation and the item that holds the detail.
(2) A session adds a line when an item needs the product owner and removes it when they have answered. Nothing for the product owner lives only in a chat.
(3) Lines are grouped as Now, When you have time and Later; Clead raises Later lines with the product owner one at a time.
(4) Unattended work parks what needs the product owner there or in the project's staging file, in accordance with Process P-10 § 1.

P-9 § 5 Pins
(1) When the product owner pins an idea, in any wording, the session writes it to the backlog at once as a one-line entry with its context, answers "Pinned." and continues.
(2) When the product owner asks what is pinned, the session lists the pinned entries.
(3) A pin stays in the backlog until it is promoted or the product owner drops it.

P-9 § 6 `STATUS.md`
(1) Every project keeps a `STATUS.md` at its root.
(2) It has the fixed headings Phase, Current focus, Next step and Blockers, and a "Last update" line (`YYYY-MM-DD`). Its headings and format are not changed.
(3) It holds only what lies ahead; history is in Git.
(4) A session whose work changes what a field says updates the file in the same PR and sets "Last update". A change that has no PR of its own, such as an escalation, gets a PR that updates only `STATUS.md`.
(5) A blocker that waits on the product owner starts with "Product Owner:", written exactly so. A session that finds a blocker resolved removes it the same way.
(6) The specification of the format is the header of the project's `STATUS.md`.
(7) In the fields, a reference to something that can be linked (a backlog entry, a PR, a commit, a file, a repository) is written as a Markdown link to it, and a line of a file as a link at a commit of the default branch. A session that changes a field writes its own references that way; older text gets its links when its field is next changed.

P-9 § 8 Renames
(1) When a name or path changes, live references are repointed; dated history keeps the names it was written with.
(2) Files are moved with `git mv`.
