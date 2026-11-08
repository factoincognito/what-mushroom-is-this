# AI project bootstrapper

**For people who know what they want built, but not how to build it.**

You bring the what: the idea, what it should do, what matters most.
Claude brings the how: it turns your idea into a plan, writes the
code and tests it. You stay in charge: nothing is built until you have
said yes to the plan, and you can stop any change.

For that to work, the project has to be set up the way a careful
developer would set it up: checks that catch mistakes before they get
in, rules that stop a change whose checks have not passed, and files
where Claude keeps the plan and the decisions, so it picks up where it
left off next time. Doing that by hand takes knowledge of exactly the how that
you want to leave to Claude. This bootstrapper does it for you: you
answer a few questions, and a script sets everything up. You do not
need to have typed commands before: this page gives every command to
copy. To begin, go to "Start here" below.

## What you get

At the end you have a project on GitHub (a website that keeps your
project's files and every change to them) and a copy of it on your
computer. In it:

- The starting files for the kind of software you choose: a website or
  web app, a program in TypeScript, a program in Python, or a mobile
  app for phones and tablets.
- Checks that GitHub runs on every proposed change, and a main version
  that only takes a change once its checks have passed.
- Files where Claude keeps the plan, the decisions and the status of
  the project, so nothing depends on a chat being remembered.

Then the work goes like this: you say what you want, in a chat in the
Claude app. Claude writes it down as a plan and asks you to confirm
it. Claude Code (a version of Claude that writes code) builds it,
writing the test first, and each change is reviewed by the other
Claude before it goes in. The project's files call these two roles
Clead (the one that plans and reviews) and Crog (the one that writes
the code).

## What you need, and what it costs

To set up the project (step 0 below installs the tools):

- **A computer** with Windows or Linux. macOS is not supported for now: the setup stops on a Mac.
- **A GitHub account.** Free. Make one at https://github.com/signup.
  Anyone can see the files of a public project; only you, and the
  people you invite, can see a private one. On a free account, a public
  project gets full protection of its main version; protecting a
  private one needs a paid GitHub plan (https://github.com/pricing). If
  you choose a private project on a free account, the script offers you
  three ways on.
- **On Windows: Git for Windows.** Free. It gives you Git, which keeps
  track of every change to the project's files, and Git Bash, the
  window where you type the commands from this page.
- **On Linux: Git.** Free, and often there already. If it is
  missing, the script says so and shows how to install it.
- **gh, GitHub's tool for the command line.** Free. The script uses it
  to create the project on GitHub for you, signed in as you.
- **Only for a website, a TypeScript program or a mobile app: Node.js.**
  Free. It runs the tools these kinds of project are built and checked
  with, and the script uses it to set them up. If it is missing, the
  script says so and shows how to install it.

To work on the project with Claude afterwards:

- **A paid Claude plan.** Claude Code, which writes the code, is not in
  the Free plan. The cheapest plan with it is Pro: 17 US dollars a
  month when paid for a year at once (200 dollars), or 20 dollars a
  month when paid monthly, plus tax where it applies (prices as
  https://claude.com/pricing showed them on 2026-10-29).
- **The Claude app** (https://claude.ai), where you plan and decide.
- Later, if you want to watch or run the coding part yourself: VS Code
  (a free program for editing code) with its Claude Code extension.
  Not needed to start.

## Start here

Step 0 prepares your computer. Step 1 sets up the project. For another
project later, step 1 is all you do again.

A physical keyboard is recommended, though not required. On a touch
screen with the on-screen keyboard, typing symbols such as `@` and
copying long commands out of that window is harder. If the window where
you type commands stops reacting after you selected text in it, press
Ctrl-Q (hold Ctrl and press Q).

**Step 0: install gh and sign in.**

1. Install the tools.
   - **Windows:** open https://git-scm.com/download/win in your browser,
     download Git for Windows and run the installer. It asks many
     questions, one screen at a time: keep every choice as it is on
     every screen, the editor (Vim) included. Click Next on each
     screen, then Install on the last one. The setup script in step 1
     never opens that editor. Then open https://cli.github.com, choose
     the Windows option that says **Download MSI** (not the one that
     says WinGet) and run the downloaded installer too. Then open
     **Git Bash**: press
     the Windows key, type `Git Bash` and press Enter (or click the
     Start button and choose Git Bash from the list of apps). A window
     opens with a line that ends in `$`; you type every command below
     in that window. If Git Bash was already open, close it and open it
     again, so it finds `gh`.
   - **macOS:** not supported for now: the setup stops on a Mac. Use a computer with Windows or Linux.
   - **Linux:** open a terminal and follow the steps for your system at
     https://github.com/cli/cli/blob/trunk/docs/install_linux.md.
   - **Linux on Windows (WSL):** to work in Linux on a Windows computer,
     do this instead of the Windows step above (not both). First install
     Ubuntu (a Linux):
     1. Right-click the Start button and choose **Terminal (Admin)**. If
        Windows asks whether to allow this app to make changes, choose
        Yes.
     2. Type this line and press Enter:

        ```
        wsl --install -d Ubuntu
        ```

        If it asks you to restart the computer, restart it.
     3. If no Ubuntu window opens by itself, press the Windows key, type
        `Ubuntu` and press Enter. If Ubuntu is not in the list either,
        open **Terminal (Admin)** again as in step 1 and type the same
        line again.
     4. The first start unpacks files and may take a few minutes. Wait
        until Ubuntu asks for a new user name and a password. Choose
        them and remember the password: commands that start with `sudo`
        ask for it again. Nothing shows on the screen while you type it;
        type it and press Enter.
     5. Ubuntu may ask whether to opt in to platform metrics collection.
        Either answer is fine.

     Then follow the Linux step above, and every step after it, in that
     Ubuntu window, not in the Terminal (Admin) window.

   When it has worked, this command prints a version number:

   ```
   gh --version
   ```

   If it says "command not found", close the window, open a new one and
   try again.
2. Sign in to GitHub. Copy this line into the window and press Enter:

   ```
   gh auth login -h github.com -p https -w -s workflow
   ```

   If gh asks "Authenticate Git with your GitHub credentials?", answer
   Yes: type y and press Enter, or just press Enter. Then gh shows a
   one-time code and opens your browser (press Enter if it asks first).
   If your browser is not signed in to GitHub, GitHub first asks you to
   sign in: your user name or email address, your password, and a
   two-factor code if you use one. Then it shows the page for the code.
   Enter the code on the GitHub page and approve. If the browser does
   not open (as in WSL, the Linux inside Windows), open
   https://github.com/login/device in your browser yourself and enter
   the code there. When it has worked, gh says "Logged in as" and your
   GitHub name, and `gh auth status` shows your account. If you see
   something else, run the line again.

**Step 1: run the setup.** In the same window, go to the folder that
should hold the new project. If you have no such folder yet, this line
makes one named projects in your home folder and goes there; copy it
and press Enter:

```
mkdir -p ~/projects && cd ~/projects
```

Then copy this line and press Enter:

```
gh api repos/factoincognito/ai-project-bootstrap/contents/bootstrap-project.sh -H "Accept: application/vnd.github.raw+json" > bootstrap-project.sh && bash bootstrap-project.sh
```

The first part downloads the script into that folder; the second part
starts it. It asks, one question at a time, for each answer you did not
give as an option: Project name, Display name, Description, Owner,
Product owner name, Language pack, Add the publishing files (web pack
only), Visibility, Licence, Copyright holder (not asked when you choose
no licence), Folder, Your name for git and Your email address for git.
Each question says what it is for, and where a default is safe, Enter
accepts it. Then the script shows its plan and waits for your yes. Each
step prints a line when it starts and when it ends, and at the end it
says what it created and what to do next.

Right after your yes, before it changes anything on GitHub, it prints
the command to continue the setup if it stops before it finishes, for
any reason (also Ctrl-C or a closed window). Copy that command and
keep it until the setup has finished. When it stops by itself, it also
says why and prints the exact command to run next: one that starts
again, or one that continues the setup. If you run the command to
continue and the project was not created yet, the script says so and
prints the command to start again.

**If the setup stops.** The command to continue and the command to
start again carry your answers along, so you are not asked again. The
script saves your answers in a small file next to it, `.bootstrap-project.again`, and the
command it prints reads them back with `--again`. That command also
goes to the folder you started the script in, so it works from any
window, also in a new window, which starts in your home folder. With
the folder of step 1 it reads
`cd ~/projects && bash bootstrap-project.sh --again`. Once the project
exists on GitHub, that command includes `--resume` as well: the saved
answers carry it, and it tells the script to continue the project that
is there instead of creating a new one. Each stop saves the answers
anew, and the first line that `--again` prints names the project they
are for, so a file left from another project is easy to spot. The file
is removed when the setup has finished. When there is nothing to save
yet, or the answers cannot be saved (for example an answer of more
than one line), the script prints the full command instead, after the
same `cd`: the one you ran, with every answer in it.

**What only this README covers.**

- Step 0 above: the script cannot download or start without `gh`.
- After the script: in the Claude app, create a Claude Project for the
  new GitHub project, add the GitHub project to that Claude Project, and
  start a chat inside the Claude Project; the project's instructions for
  Claude (the file `CLAUDE.md`, which points to the Rules in `rules/` and
  the project's own rules in `RULES.md`) do the rest. A Claude Project is a
  workspace in the Claude app that keeps the chats and files of one
  project together. Claude's help pages say how to do the first two:
  - To create a Claude Project: "How can I create and manage projects?",
    https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
  - To add the GitHub project to it: the help page on the GitHub
    integration,
    https://support.claude.com/en/articles/10167454-using-the-github-integration
    It gives these steps: in the Claude Project, click the "+" button at
    the top right of the project knowledge section, then "GitHub", then
    search for the project or paste its web address (the script prints
    it), then choose all files. If Claude cannot reach a private project
    after you paste its address, the page links to the Claude GitHub App,
    where someone who administers the project on GitHub gives Claude
    access to it.
  - To start a chat inside the Claude Project: on a computer, click
    Projects in the menu on the left, choose the project, and type the
    first message in its input field. In the Claude app on an Android
    phone, open the menu at the top left, tap the projects entry, choose
    the project, tap the new-session button at the bottom right, and type
    the first message in the input field.
  - The first message is this line, with `<owner>/<repo>` replaced by
    the owner and name of the new project, as in its web address,
    `https://github.com/<owner>/<repo>` (the script prints the line
    with them filled in). Copy it into the input field:
    ```
    Attach <owner>/<repo> with push access, read its CLAUDE.md, rules/RULES.md and RULES.md, and run the session startup.
    ```
- Working from another computer later: follow "Working from another
  computer" in the new project's README.
- Organisation and billing settings: in an organisation, only its
  owners can allow members to create projects (Settings, Member
  privileges) and turn on GitHub Actions (Settings, Actions, General).
  A plan that protects private projects is chosen in your account's
  Settings, Billing and plans.
- Deleting a project you made to try things out: on the project's page,
  Settings, then at the bottom the button
  Delete this repository (GitHub's word for a project).
  Or in the same window, run
  `gh auth refresh -h github.com -s delete_repo` once (if gh asks
  "Authenticate Git with your GitHub credentials?", answer Yes; if the
  browser does not open, open https://github.com/login/device yourself
  and enter the code there, after signing in to GitHub if it asks), then `gh repo delete OWNER/NAME --yes`. The script never deletes a
  project.

**What the script guides you through.** When something is missing, the
script prints numbered steps for your system (what to do, the page to
open, what you will see when it has worked). You can read the guides
here first:

- Before anything is created, the script checks again and goes on once
  you have fixed it (press Enter):
  - git not installed;
  - gh not installed;
  - gh installed, but too old for the script;
  - Node.js and npm not installed (only for the node, web and
    react-native packs; the guide points to https://nodejs.org). On
    Linux, in Linux on Windows (WSL) and on Windows (Git Bash), only a
    window opened after the install finds the new npm, so this one does
    not go on with Enter: type `q`, copy the command it shows, close the
    window, and run that command in a new window. On Windows, open that
    window from the Start menu, not from the window you are closing: a
    window opened from another one keeps the old list of the folders
    where programs are found;
  - only the Windows npm found in Linux on Windows (WSL): a project in
    Linux should not use it, and the guide shows how to install Node.js
    in Linux, then start again in a new window, as above;
  - gh signed out, or its sign-in no longer accepted;
  - gh signed in without the `workflow` permission (the right to change
    the files that run the project's checks): the script offers to run
    `gh auth refresh -h github.com -s workflow` and walks you through
    the browser step;
  - your name and email for git, which it asks for;
  - GitHub not reachable from this computer;
  - a project with that name that already exists on GitHub;
  - a folder for the new project that does not exist, or that
    is not empty, or that is a file, or that cannot be written to, or
    that is inside another project that git keeps track of.
- Before anything is created, the script stops and you start it again
  with the command it prints, because it cannot check again in the same
  run:
  - a bash that is too old (Windows: install the current Git for Windows);
  - an older version of the script (it shows the command to download
    the current one);
  - gh signs in with a key (a token) set in GH_TOKEN or GITHUB_TOKEN
    that lacks a permission: make a new key, put it there, and open a
    new window.
- When GitHub refuses to create the project (nothing exists yet; fix it
  and start the script again with the command it prints): the name is
  taken by a project your account cannot see, or your account may not
  create projects there (an organisation's setting, or the permissions
  of the key gh signs in with).
- After the project exists (fix it, then continue with the command the
  script prints):
  - gh does not have every permission it needs;
  - GitHub Actions (the GitHub service that runs your project's checks)
    is turned off, or allows only the project's own actions;
  - git cannot sign in to GitHub: the script offers to run
    `gh auth setup-git`, which changes your git settings for every
    project, and asks first;
  - a private project on a free GitHub account, which cannot protect
    its `main` line of work: the script offers three ways on (move to a
    paid GitHub plan, make the project public, or go on without
    protection with `--allow-unprotected`, which it records in the
    project's `memory/decisions.md`).
- Only when you continue a setup with `--resume`:
  - there is no project with that name to continue (the command it
    prints then starts a new one);
  - the project was not made by this version of the bootstrapper, or
    not by the bootstrapper at all, or its README lost the setup
    section: the script will not continue it, and suggests a new
    project under another name;
  - README.md or CHANGELOG.md on GitHub has Windows line endings (a
    carriage return): save it with LF line endings, then continue;
  - the folder is not a copy of this project: give the right folder
    with `--dir`, or choose a new or empty one;
  - the copy on this computer does not match GitHub (unsaved changes,
    or another version): move the folder away, or make it match, then
    continue. The script never deletes your work.


## A project whose setup has not finished

This page also shows on a project that was made with the
**Use this template** button on this page, until its setup has
finished. To finish that setup, do step 0 if you have not, then run
this command in the same window, with OWNER and NAME taken from the
project's web address, https://github.com/OWNER/NAME:

```
gh api repos/factoincognito/ai-project-bootstrap/contents/bootstrap-project.sh -H "Accept: application/vnd.github.raw+json" > bootstrap-project.sh && bash bootstrap-project.sh --resume --owner OWNER --name NAME
```

If a setup you started with step 1 stopped, use the command the script
printed instead.

## Without Claude

The project also works without Claude, as an ordinary, well set-up
project: the setup itself does not use Claude, and the checks run on
GitHub alone. The project's own README says what works without Claude
and what does not.
