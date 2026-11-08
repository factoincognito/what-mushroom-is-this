#!/usr/bin/env bash
# bootstrap-project.sh: sets up a new project from this bootstrapper.
# Spec: "Turn-key bootstrap script" in
# https://github.com/factoincognito/ai-project-template-v2/blob/main/docs/BACKLOG.md
#
# Built so far: the inputs (options, questions, checks and defaults), the
# guided checks of this computer (bash, git, gh, npm, the git name and
# email, the target folder), the guided checks on GitHub (signed in, the
# current version of this script, the permissions gh has, the project
# name still free, the licence name), the plan and its "Proceed?"
# question, creating the project on GitHub and protecting its main
# version, the check that GitHub Actions is turned on for it, the copy of
# the project on this computer (with the git name and email, the line of work
# bootstrap-setup, the language pack laid out, the tidy-up, the
# placeholders filled in, the lockfile of the npm packs, the licence and
# the CHANGELOG entry), the self-check, saving the setup's changes,
# sending them to GitHub and proposing them there, waiting for the check
# build, making it required, adding the change to main, updating the
# copy, the report at the end, and the layout-pack subcommand; continuing
# a setup that stopped part way (--resume, which works out where to go on
# from GitHub and the copy on this computer, never from a file of its own),
# --allow-unprotected, the offer to make a private project public, the
# answers carried in the command shown at a stop, and the stop that says
# what exists when something unexpected happens or Ctrl-C is pressed.
#
# Usage:
#   bash bootstrap-project.sh [options]
#     Asks for each answer not given as an option, then checks them all.
#     --help lists the options; --non-interactive asks nothing.
#     --version prints the version and the commit it was built from.
#   bash bootstrap-project.sh layout-pack <node|web|python|react-native|csharp> <target-dir>
#     Lays out a language pack in <target-dir>, which must be empty or
#     absent. The packs are read from PACKS_DIR, by default the
#     languages/ folder next to this script.
#
# Exit codes: 0 done (or a --dry-run that passed its checks), 1 failed or
# stopped (also at once on a Mac: macOS is not supported for now), 2 usage
# error, unknown pack, or an input that is missing or
# cannot be used, 3 a check of this computer or on GitHub did not pass, or
# a step on GitHub was refused: its steps were shown, with the command to
# start again (or, once the project exists, to continue with --resume).
# Runs on bash 3.2 (macOS /bin/bash): no associative arrays, no mapfile,
# no ${var,,}.
#
# Test hooks (environment variables the tests set; users leave them unset):
#   BOOTSTRAP_GH   the gh command to run (default: gh on the PATH).
#   BOOTSTRAP_RUN  a command that replaces the runner of the install and
#                  login commands the script offers. It gets the command
#                  as one argument, so the tests never install anything.
#   BOOTSTRAP_TTY  the terminal the yes to an offered command is read from
#                  (default: /dev/tty), never stdin.
#   BOOTSTRAP_INPUT_TERMINAL  yes or no: whether the input of a question
#                  (stdin, or BOOTSTRAP_TTY for the offer) is a terminal,
#                  where keys typed before the question are discarded
#                  (default: asked of the shell, [ -t 0 ]).
#   BOOTSTRAP_OS_RELEASE  the Linux release file (default: /etc/os-release).
#   BOOTSTRAP_KERNEL_RELEASE  the file WSL (Linux on Windows) is read from
#                  (default: /proc/sys/kernel/osrelease).
#   BOOTSTRAP_WINDOWS_DRIVES  the folder where WSL shows the Windows drives,
#                  one folder per drive letter (default: /mnt).
#   BOOTSTRAP_SLEEP  the command that waits between two checks of GitHub
#                  (default: sleep). It gets the seconds as its argument.
#   BOOTSTRAP_STDOUT_TERMINAL  yes or no: whether the output goes to a
#                  terminal, where the wait for build shows a * a second
#                  (default: asked of the shell, [ -t 1 ]).
#   BOOTSTRAP_NPM  the npm the lockfile step runs (default: npm on the
#                  PATH), so the tests never reach the npm registry. The
#                  check that npm is installed runs the npm on the PATH.
#   BOOTSTRAP_COLOR  set (not empty): the lines the user acts on are in
#                  colour as at a terminal, though the output goes to a
#                  file. NO_COLOR, set and not empty, and TERM=dumb still
#                  turn colour off (see colour_on).
#
# Sourcing this file defines its functions and runs nothing (the tests
# load it that way); running it with bash runs the main part at the end.
set -euo pipefail

# The bootstrapper version and commit this script ships with. The build
# stamps both values in place; in the template the script is unstamped
# and these hold the placeholders. These two lines are the only place a
# placeholder may appear: the build refuses any left in its output, so
# code compares against these variables, never a literal placeholder.
SCRIPT_VERSION='v2.9.2'
SCRIPT_COMMIT='8d5ee3bd90cc6632a3510c497f175a748bd2790a'

# State of the stop handling (see catch_stops): CLEAN is set by every
# deliberate stop, CURRENT_STEP is the step being done.
CLEAN=""
CURRENT_STEP=""
WORK_DIR=""

# ---------- messages ----------
# Everything the script shows the user goes through these helpers, and
# nothing outside this block writes to the terminal by itself, so the
# tests can check every user-facing string for plain words (see
# "Ease-of-use requirements" in the spec). Only say_command may print
# any word: it shows an exact command for the user to copy.

usage() {
  printf '%s\n' "usage: bootstrap-project.sh layout-pack <node|web|python|react-native|csharp> <target-dir>" \
    "   or: bootstrap-project.sh [options]   (run it with --help to see them)" >&2
  CLEAN=1
  exit 2
}

# show_help: the options, on stdout.
show_help() {
  printf '%s\n' \
    "usage: bootstrap-project.sh [options]" \
    "       bootstrap-project.sh layout-pack <node|web|python|react-native|csharp> <target-dir>" \
    "" \
    "Sets up a new project on GitHub. It asks a question for each answer" \
    "that is not given as an option below." \
    "" \
    "  --name <name>              the short name of the project on GitHub (needed)" \
    "  --owner <account>          the GitHub account or organisation that owns it" \
    "                             (default: your own account)" \
    "  --project-name <text>      the name people see (default: the short name)" \
    "  --description <text>       one line that says what the project is for (needed)" \
    "  --po-name <text>           the product owner's name (default: your GitHub" \
    "                             profile name, or your account name)" \
    "  --pack <pack>              node, web, python or react-native (needed)" \
    "  --with-deploy              web only: also add the files that publish the website" \
    "  --without-deploy           web only: leave those files out (the default)" \
    "  --public, --private        who can see the project (default: public)" \
    "  --license <licence>        none, mit, apache-2.0, gpl-3.0, bsd-3-clause," \
    "                             polyform-noncommercial-1.0.0, or another licence" \
    "                             name from choosealicense.com (needed)" \
    "  --copyright-holder <text>  the name written in the licence (default: the" \
    "                             product owner's name)" \
    "  --dir <folder>             where to put the copy of the project on this" \
    "                             computer (default: ./<name>)" \
    "  --git-name <text>          your name, which git writes into each saved change" \
    "                             (default: the name already set in git)" \
    "  --git-email <address>      your email address, written next to your name" \
    "                             (default: the address already set in git)" \
    "  --ci-timeout <minutes>     how long to wait for the project's checks (default: 20)" \
    "  --non-interactive          ask nothing: every needed option must be given" \
    "                             (needs --yes or --dry-run)" \
    "  --yes                      do not ask \"Proceed?\" before creating anything" \
    "  --dry-run                  check everything and show the plan, create nothing" \
    "  --resume                   continue a setup that stopped part way" \
    "  --again                    start again or continue with the answers saved at the last stop" \
    "  --allow-unprotected        with --resume: go on without protecting the main" \
    "                             version, when a private project cannot be protected" \
    "                             on the GitHub plan" \
    "  --help                     show this text" \
    "  --version                  show the version of this script" \
    "" \
    "An option takes its value after a space or after =, as in --name=my-app."
}

# show_version: one line on stdout, the version and the template commit
# the build stamped in. The unstamped script in the template (the build
# only stamps a vMAJOR.MINOR.PATCH version) says it is not a release.
show_version() {
  case "$SCRIPT_VERSION" in
    v[0-9]*.[0-9]*.[0-9]*)
      printf '%s\n' "bootstrap-project.sh $SCRIPT_VERSION, built from factoincognito/ai-project-template-v2@$SCRIPT_COMMIT"
      ;;
    *)
      printf '%s\n' "bootstrap-project.sh, not a release: the copy in factoincognito/ai-project-template-v2 that releases are built from"
      ;;
  esac
}

# say_open <text>: text with no line break after it, so more can follow
# on the same line (the stars of the wait for build), plain (r1h). The
# next message of any helper below ends that line first (end_line).
LINE_OPEN=""
say_open() {
  printf '%s' "$*"
  OUT_BLANK=""
  LINE_OPEN=1
}
end_line() {
  [ -z "$LINE_OPEN" ] || printf '\n'
  LINE_OPEN=""
  LOG_GAP=""
}

# LOG_GAP: the last thing printed is the user's part: a question with its
# answer (ask, ask_terminal, wait_for_enter), or the command to continue
# shown before the first change (show_advance_command; #248 review, N3).
# A line of the progress log (step_start, step_end, say_log) that comes
# straight after it gets one blank line above it first (log_resumes), as
# #202 sets the user's part apart from the log (r1i). Any other line
# printed in between clears it (end_line). Before output that no helper
# sees (an offered command's own), log_resumes is called at once, so the
# blank line follows the answer and is never doubled (#248 review, B1).
LOG_GAP=""
log_resumes() {
  if [ -n "$LOG_GAP" ] && [ -z "$OUT_BLANK" ]; then
    printf '\n'
    OUT_BLANK=1
  fi
  LOG_GAP=""
}

# Two kinds of output (finding 8 of the first end-to-end run): the
# progress log (step_start, step_end, and say while the script works),
# dim when colour is on (see LOG_COLOUR below); and what the script says
# to the user: a question (ask,
# prompt_for, ask_terminal, wait_for_enter), the plan (say_heading), a
# guide (guide_begin to guide_end), a stop (show_error, and the command
# shown above it), the command to continue shown before the first change
# (ADVANCE_INTRO), and the closing "What to do next" line. Each of those
# blocks starts with block_start: it ends an open line first (end_line),
# then prints one blank line, unless the last line printed was blank
# already (or nothing is printed yet), so there are never two in a row.
# The blank line goes to stdout, after the log it closes, also before a
# stop on stderr, whose first line stays "What happened". OUT_BLANK
# tracks the last line: every helper that prints sets it. Output that
# does not go through the helpers (an offered command's own) is not seen;
# at worst a blank line is then left out, never doubled.
OUT_BLANK=1
IN_LOG=""
block_start() {
  end_line
  [ -n "$OUT_BLANK" ] || printf '\n'
  OUT_BLANK=1
  IN_LOG=""
}

# Four kinds of line are in colour (end-to-end run 1 on v2.7.0, finding
# r1g: a line where the user types apart from the text that explains it),
# each colour set once, below:
# - ANSWER_COLOUR, bold cyan: a line where the user types an answer, the
#   question with its default (ask, prompt_for, "Proceed?"), ask_terminal's
#   question and wait_for_enter's line; the colour ends before the space
#   where the answer goes.
# - READ_COLOUR, bold magenta: the text the user reads to act on: the
#   explanation above a question, the plan's heading, a guide's title,
#   "Why this is needed", every step, "When it has worked" and "If you see
#   something else", "What to do next" (of a stop and of the report), the
#   instruction line above a command (the texts *_INTRO), and a note the
#   user may act on (say_note). Not the choices under an explanation, "How
#   the script checks it", "What happened", the details for support, a
#   warning, the lines of the plan and of the report.
# - COMMAND_COLOUR, bold green: a command for the user to copy, or that
#   the script offers to run (end-to-end run 1 repeated, finding r1d).
# - LOG_COLOUR, dim (SGR 2), which follows the terminal's own text colour
#   on any background: the progress log, a step's first and last line,
#   and a say line inside a step (IN_LOG, from
#   step_start until step_end or a block the user reads starts), except a
#   warning and a note (say_note). A terminal that has no dim shows it as
#   plain text. Not the signs of life of the wait for build: its lines
#   and its stars are plain (r1h).
# Nothing else is in colour. show_colour_key, at the start of a run, says
# in words what each colour marks. Setting READ_COLOUR to ANSWER_COLOUR
# gives Adam's fallback (r1g): the two kinds in one colour, and the key
# shows them as one line.
# Magenta for READ_COLOUR is Adam's choice (2026-10-27, #248 review, N1),
# not yellow: yellow is hard to read on a light background (bold yellow is
# about 1.1:1 to 1.35:1 against white in xterm and macOS Terminal), the
# reason r1d chose green over yellow for commands, and the read colour
# carries the most important text. Bold magenta reads on light and dark
# backgrounds alike. Changing it is this one value: '1;36' gives the
# fallback above.
ANSWER_COLOUR='1;36'
READ_COLOUR='1;35'
COMMAND_COLOUR='1;32'
LOG_COLOUR='2'
# colour_on [err]: colour is used when the stream the line goes to is a
# terminal (stdout_is_terminal, whose hook BOOTSTRAP_STDOUT_TERMINAL
# counts too; [ -t 2 ] for a line on stderr), or BOOTSTRAP_COLOR is set
# (a test hook that forces colour); never when NO_COLOR is set and not
# empty (https://no-color.org), which wins over all of these, or when
# TERM is dumb.
colour_on() {
  [ -z "${NO_COLOR:-}" ] || return 1
  [ "${TERM:-}" != dumb ] || return 1
  [ -z "${BOOTSTRAP_COLOR:-}" ] || return 0
  if [ "${1:-}" = err ]; then [ -t 2 ]; else stdout_is_terminal; fi
}

# paint <colour code> <text> [err]: the text, in that colour when
# colour_on (err: for a line on stderr), with the colour reset straight
# after it; no line break, so what the user types after a question is
# not coloured. answer_line <text>: the text in the answer colour;
# read_line <text> [err]: the text in the read colour, then a line break.
paint() {
  if colour_on "${3:-}"; then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
  OUT_BLANK=""
}
answer_line() { paint "$ANSWER_COLOUR" "$1"; }
read_line() {
  paint "$READ_COLOUR" "$1" "${2:-}"
  printf '\n'
}

# show_colour_key: one line per colour, each in its own colour and saying
# in words what it marks, then a blank line; nothing when colour is off.
# Shown once, at the start of a run, before the first check. When the
# answer colour and the read colour are the same, one line says both.
show_colour_key() {
  colour_on || return 0
  if [ "$ANSWER_COLOUR" = "$READ_COLOUR" ]; then
    paint "$ANSWER_COLOUR" "Colour key: where you type an answer, and what to read and do"
    printf '\n'
  else
    paint "$ANSWER_COLOUR" "Colour key: where you type an answer"
    printf '\n'
    paint "$READ_COLOUR" "Colour key: what to read and do"
    printf '\n'
  fi
  paint "$COMMAND_COLOUR" "Colour key: commands to copy or to run"
  printf '\n'
  paint "$LOG_COLOUR" "Colour key: the progress log of what the script does"
  printf '\n\n'
  OUT_BLANK=1
}

# say_heading <text>: the first line of a block the user reads (the
# plan), after a blank line, in the read colour.
say_heading() {
  block_start
  read_line "$*"
}

# say <text>: one line of information. A line that tells the user what
# to do next (the closing one of the report) is a block of its own, in
# the read colour; the line above a command to start again or to continue
# opens a block of its own, and the line above an offered command does
# not; both are in the read colour, as instructions.
say() {
  case "$*" in
    "What to do next: "*) say_heading "$*" ;;
    "$START_AGAIN_INTRO" | "$CONTINUE_INTRO" | "$ADVANCE_INTRO")
      block_start
      read_line "$*"
      ;;
    "$OFFER_INTRO")
      end_line
      read_line "$*"
      ;;
    "")
      end_line
      printf '\n'
      OUT_BLANK=1
      ;;
    "Warning: "*)
      end_line
      printf '%s\n' "$*"
      OUT_BLANK=""
      ;;
    *)
      end_line
      if [ -n "$IN_LOG" ]; then
        paint "$LOG_COLOUR" "$*"
        printf '\n'
      else printf '%s\n' "$*"; fi
      OUT_BLANK=""
      ;;
  esac
}

# say_note <text>: one line that tells the user what to read and do (a
# link to open, an option, a permission to set, what to do after a no):
# in the read colour, never dim like the progress log around it (#237
# review, N2; r1g). The lines after it are log again.
say_note() {
  end_line
  read_line "$*"
}

# say_log <text>: one line of the progress log, dim, also where a block
# the user reads has ended the step's log (what the script did after an
# answer at the terminal, r1g).
say_log() {
  log_resumes
  end_line
  paint "$LOG_COLOUR" "$*"
  printf '\n'
}

# say_sign <text>: a line of the signs of life of the wait for build,
# plain, never dim (r1h: dim, they were hard to see).
say_sign() {
  end_line
  printf '%s\n' "$*"
  OUT_BLANK=""
}

# say_command <command> [err]: a command for the user to copy, indented,
# with only the command in the command colour, not the indent (err: on
# stderr, in colour only when stderr is a terminal).
say_command() {
  end_line
  if [ "${2:-}" = err ]; then
    {
      printf '    '
      paint "$COMMAND_COLOUR" "$1" err
      printf '\n'
    } >&2
  else
    printf '    '
    paint "$COMMAND_COLOUR" "$1"
    printf '\n'
  fi
  OUT_BLANK=""
}

# step_start <what>, step_end <result>: the first and last line of a step,
# dim, as the say lines between them (the indent of the last line stays
# outside the colour).
step_start() {
  log_resumes
  end_line
  CURRENT_STEP="$*"
  paint "$LOG_COLOUR" "==> $*"
  printf '\n'
  IN_LOG=1
}
step_end() {
  log_resumes
  end_line
  printf '    '
  paint "$LOG_COLOUR" "Done. $*"
  printf '\n'
  IN_LOG=""
}

# show_error <what happened> <what to do next> [raw text]: an error in
# plain words with the next action, on stderr. Raw text (an error from a
# tool or from GitHub) is never shown alone: it comes below, for support.
show_error() {
  local what="${1:-}" next="${2:-}" raw="${3:-}"
  [ -n "$what" ] || what="Something unexpected happened."
  [ -n "$next" ] || next="Run the script again. If the same thing happens, ask for help and show the details below."
  block_start
  {
    printf 'What happened: %s\n' "$what"
    read_line "What to do next: $next" err
    [ -z "$raw" ] || details_block "$raw"
  } >&2
}

# details_block <raw text>: raw text (an error from a tool or from
# GitHub), indented below a line that says it is for support. It never
# comes alone: show_error and guide_details put it under a plain message.
details_block() {
  local line
  OUT_BLANK=""
  printf 'Details for support (you can ignore these):\n'
  printf '%s\n' "$1" | tr -d '\r' | while IFS= read -r line; do
    printf '    %s\n' "$line"
  done
}

# fail <exit code> <what happened> <what to do next> [raw text]
fail() {
  local code="$1"
  shift
  show_error "$@"
  CLEAN=1
  exit "$code"
}

# Texts used by more than one message. They live here so the tests
# check them with the rest.
LP_PACK_NEXT="Choose one of the packs: node, web, python, react-native or csharp."
LP_BROKEN_NEXT="This copy of the bootstrapper is incomplete. Download it again; if that does not help, report it to the bootstrapper's maintainers."
SETUP_BROKEN_NEXT="The project was made from the current bootstrapper, so downloading the script again does not help. Report it to the bootstrapper's maintainers and show them the details below."
ASK_NO_DEFAULT="There is no default, because only you can choose it."
ASK_RETRY="Please try again."
ASK_NEEDED="An answer is needed here."
OPTIONS_NEXT="To see every option, run the script with --help."
START_AGAIN_INTRO="To start again, run this command:"
CONTINUE_INTRO="To continue the setup, run this command:"
# Shown once, after the yes and before the first change (show_advance_command).
ADVANCE_INTRO="If the setup stops before it finishes, for any reason, also with Ctrl-C or a closed window, continue it with the command below. Copy it now and keep it until the setup has finished:"
# The line above a command the script offers to run (offer_command).
OFFER_INTRO="The script can run this command for you:"
# The stop on a Mac (stop_on_macos): macOS is not supported for now.
MACOS_WHAT="This computer runs macOS, which the setup does not support for now. Nothing was changed."
MACOS_NEXT="Set up the project on a computer with Windows or Linux. Step 0 of the README says how to prepare it."
# The plan and step 10 give it for a public project with no licence.
NO_LICENCE_WARNING="Warning: the project is public and has no licence: anyone can see its code, but nobody else may copy, change or share it. To add a licence later, see https://choosealicense.com."

# ask <explanation> <question> <default> [choice...]: shows the
# explanation (why the question is asked, in a sentence; in the read
# colour), the choices (plain), then the question with its default (in
# the answer colour), and reads one answer from stdin
# into ANSWER: the spaces around it (a carriage return from Windows
# among them) are removed, and an empty answer takes the default. Returns 1 when stdin has no more
# answers. When stdin is not a terminal (answers given in a file or
# pipe), a line break follows the question, as typing one would.
ask() {
  local why="$1" question="$2" default="$3" got=""
  shift 3
  block_start
  read_line "$why"
  [ "$#" -eq 0 ] || printf '  %s\n' "$@"
  if [ -n "$default" ]; then
    answer_line "$question [$default]:"
  else
    answer_line "$question:"
  fi
  printf ' '
  if ! IFS= read -r got && [ -z "$got" ]; then
    printf '\n'
    return 1
  fi
  [ -t 0 ] || printf '\n'
  LOG_GAP=1
  trim_into "$got"
  ANSWER="${TRIMMED:-$default}"
}

# input_is_terminal: stdin is a terminal (BOOTSTRAP_INPUT_TERMINAL, yes
# or no, answers for the tests).
input_is_terminal() {
  case "${BOOTSTRAP_INPUT_TERMINAL:-}" in
    yes) return 0 ;;
    no) return 1 ;;
  esac
  [ -t 0 ]
}

# discard_typeahead: drops the keys waiting at the terminal on stdin,
# typed before the question that follows was shown (end-to-end run 1 on
# v2.7.0, finding r1f: an Enter pressed while the script was busy, during
# the gh checks, answered "Run it now?" with no before the user saw it).
# Used before the questions a stray Enter must not answer: the offer to
# run a command, "Proceed?", and the pause of a guide. It runs only at a
# terminal: answers from a file or a pipe are all answers and are never
# dropped. It always returns 0 and never waits: with the terminal set to
# -icanon min 0 time 0, one dd read returns at once, with what is waiting
# or with nothing (a whole terminal buffer fits in its 64 KiB), and the
# saved mode is put back. bash's own read cannot do this on bash 3.2: its
# read -t 0 fails at once without reading, and read -n sets the terminal
# to wait for a key. When the mode cannot be saved or set, nothing is
# read (dd would wait for a whole line); when the saved mode cannot be
# put back, stty sane brings back a terminal that reads whole lines.
# While the mode is changed, TTY_SAVED holds the saved one and fd 7 the
# terminal, so that a stop in between (Ctrl-C: the INT trap exits 130)
# still puts it back: leave_script calls restore_terminal_mode (#247
# review, B1). A terminal left at min 0 would make every later read
# return nothing at once, in the user's own shell too.
TTY_SAVED=""
discard_typeahead() {
  local saved
  input_is_terminal || return 0
  saved="$(stty -g 2>/dev/null)" || return 0
  [ -n "$saved" ] || return 0
  exec 7<&0
  TTY_SAVED="$saved"
  if stty -icanon min 0 time 0 2>/dev/null; then
    dd bs=65536 count=1 >/dev/null 2>&1 || true
  fi
  restore_terminal_mode
  return 0
}

# restore_terminal_mode: puts back the terminal mode discard_typeahead
# saved (TTY_SAVED, on the terminal open on fd 7), once; nothing to do
# when it is back already.
restore_terminal_mode() {
  [ -n "$TTY_SAVED" ] || return 0
  stty "$TTY_SAVED" <&7 2>/dev/null || stty sane <&7 2>/dev/null || true
  TTY_SAVED=""
  exec 7<&-
  return 0
}

# wait_for_enter: the pause of a guide. Returns 1 when the user types q
# (or stop) or stdin has no more lines, else 0 (check again). Keys typed
# before the pause was shown are discarded (discard_typeahead).
wait_for_enter() {
  local got=""
  block_start
  discard_typeahead
  answer_line 'Press Enter to check again, or type q to stop:'
  printf ' '
  if ! IFS= read -r got && [ -z "$got" ]; then
    printf '\n'
    return 1
  fi
  [ -t 0 ] || printf '\n'
  LOG_GAP=1
  trim_into "$got"
  case "$(lower "$TRIMMED")" in
    q | quit | stop) return 1 ;;
  esac
  return 0
}

# ask_terminal <explanation> <question>: a yes-or-no question whose
# answer is read from the terminal, never from stdin (the spec: answers
# piped into the script must not approve an install). The default is no.
# Returns 0 for yes, 1 for any other answer, an empty one, or when there
# is no terminal to read from. A terminal that cannot be read is a no at
# once, with the question line ended. One that can be read but not opened
# (/dev/tty with no terminal attached) is a no too: the open, tried first
# in a subshell with its error silenced, fails, nothing in the braces
# runs, the question is shown with its line ended, and that is not a yes.
# Keys typed before the question was shown are discarded first
# (discard_typeahead, finding r1f), with the terminal opened once for the
# discard and the read. No redirect of stderr is in force in this shell
# while it waits: a trap after Ctrl-C runs with the redirects of the
# command it interrupted, so a 2>/dev/null here sent the stop to
# /dev/null (#428). So the group has only the terminal as its stdin, and
# the answer is read from it in a $( ) subshell, which silences its own
# errors.
ask_terminal() {
  local tty="${BOOTSTRAP_TTY:-/dev/tty}" got="" opened="" eof=""
  block_start
  read_line "$1"
  if [ -r "$tty" ] && (: <"$tty") 2>/dev/null; then
    {
      opened=1
      discard_typeahead
      answer_line "$2 [no]:"
      printf ' '
      # The line read, also a last one with no line break, and read's
      # own result: a failed read (end of input) is eof, as before.
      got="$(
        IFS= read -r line 2>/dev/null
        rc=$?
        printf '%s' "${line-}"
        exit "$rc"
      )" || eof=1
    } <"$tty" || true
  fi
  if [ -z "$opened" ]; then
    answer_line "$2 [no]:"
    printf ' \n'
    LOG_GAP=1
    return 1
  fi
  if [ -n "$eof" ] && [ -z "$got" ]; then
    printf '\n'
    LOG_GAP=1
    return 1
  fi
  [ -c "$tty" ] || printf '\n'
  LOG_GAP=1
  trim_into "$got"
  case "$(lower "$TRIMMED")" in
    y | yes) return 0 ;;
  esac
  return 1
}

# A guide: guide_begin <title> <why>, then guide_step <text> for each
# numbered step (with say_command for a command to copy), then guide_end
# <what the user sees when it worked> <what to do otherwise> <how the
# script checks it>. The title, "Why this is needed", every step (its
# indent outside the colour), "When it has worked" and "If you see
# something else" are in the read colour (r1g); "How the script checks
# it" is plain. A step that ends with a colon introduces the command
# printed right below it (the tests hold every such step to a command
# below it, and every command in a guide to such a step above it).
GUIDE_TITLE=""
GUIDE_N=0
guide_begin() {
  GUIDE_TITLE="$1"
  GUIDE_N=0
  block_start
  read_line "$1"
  read_line "Why this is needed: $2"
}
guide_step() {
  GUIDE_N=$((GUIDE_N + 1))
  printf '  '
  read_line "$GUIDE_N. $*"
}
guide_end() {
  read_line "When it has worked: $1"
  read_line "If you see something else: $2"
  printf '%s\n' "How the script checks it: $3"
  OUT_BLANK=""
}
# guide_details <raw text>: after guide_end, the raw text of what went
# wrong (gh's or GitHub's own words), for support; nothing when empty.
guide_details() {
  [ -z "$1" ] || details_block "$1"
}

# say_shown_command: the command to start again or to continue
# (shown_command), with the cd to the folder the script was started in in
# front of it when that is known (SHOWN_CD), so it works from a new
# window too (#267 review, B1).
say_shown_command() {
  if [ -n "$SHOWN_CD" ]; then
    say_command "cd $SHOWN_CD && bash $SHOWN_CMD"
  else
    say_command "bash $SHOWN_CMD"
  fi
}

# ---------- end of messages ----------

# ---------- test hooks ----------

# make_temp [-d]: a new temporary file (or folder with -d). They are all
# made inside one folder (WORK_DIR) that catch_stops removes when the
# script ends, however it ends, so none is left behind.
make_temp() {
  mktemp ${1:+"$1"} "${WORK_DIR:-${TMPDIR:-/tmp}}/bootstrap-project.XXXXXX"
}

# STDERR_LOG: where awk_run keeps awk's own error text (set by
# catch_stops), to show below the plain stop for support.
STDERR_LOG=""

# awk_run <awk arguments>: awk, with its own error text kept in STDERR_LOG
# instead of shown at the terminal by itself.
awk_run() {
  awk "$@" 2>>"${STDERR_LOG:-/dev/null}"
}

# run_gh <args...>: runs gh, or $BOOTSTRAP_GH, with gh's own prompts
# turned off. They misbehave in Git Bash's terminal, so the script asks
# its own questions.
# run_gh --to <out> <err> <args...>: the same, with gh's stdout in the
# file <out> and its stderr in <err>. Give the files here, never as a
# redirect of the call (run_gh ... >"$out"): while a trap runs, the
# redirect of the function call it interrupted is still in force, so a
# stop after Ctrl-C during gh went into those files, which the script
# then deleted, and the user saw nothing (#425). A redirect of gh itself
# is made in gh's own process.
run_gh() {
  if [ "${1:-}" = --to ]; then
    local out="$2" err="$3"
    shift 3
    GH_PROMPT_DISABLED=1 "${BOOTSTRAP_GH:-gh}" "$@" >"$out" 2>"$err"
    return
  fi
  GH_PROMPT_DISABLED=1 "${BOOTSTRAP_GH:-gh}" "$@"
}

# run_npm <args...>: runs npm, or $BOOTSTRAP_NPM.
run_npm() {
  "${BOOTSTRAP_NPM:-npm}" "$@"
}

# run_offered <command>: runs a fixed command that the script offered and
# the user approved (an install or a login), or hands it to
# $BOOTSTRAP_RUN. gh's prompts stay on: a login needs them.
# The argument runs through bash -c, so it must be a fixed string written
# in this script, never built from user input or any variable (the spec:
# "never built from user input"); the tests refuse a $ in it.
run_offered() {
  (
    unset GH_PROMPT_DISABLED
    if [ -n "${BOOTSTRAP_RUN:-}" ]; then
      "$BOOTSTRAP_RUN" "$1"
    else
      bash -c "$1"
    fi
  )
}

# ---------- layout-pack ----------

# The layout table: "<pack path> <project path>". A path ending in / is
# a folder, copied with everything in it. The optional deploy files
# (web: deploy.yml, wrangler.jsonc) and code-standards.md are not laid
# out, except the deploy files with --with-deploy. Every other pack file
# must be in the table, so a new pack file cannot be silently left out.
#
# layout_into <pack> <packs dir> <target> <strict|overlay> [yes]: lays
# out the pack from <packs dir>/<pack> into <target>. LP_KEPT lists the
# pack's files that were not laid out (the setup keeps them), LP_TARGETS
# the paths they are laid out to.
#   strict: the layout-pack subcommand; the target must be empty or
#     absent.
#   overlay: the setup (spec step 6), over the copy of the project: the
#     pack's ci.yml replaces the stub, the pack's gitignore lines are added
#     to .gitignore when it lacks them, and any other target that is there
#     already is an error, found before anything is written. A fifth
#     argument "yes" (--with-deploy, web) lays out the deploy files too.
LP_MODE=""
LP_KEPT=""
LP_TARGETS=""
layout_into() {
  local pack="$1" packs_dir="$2" out="$3" deploy="${5:-}"
  local common typescript table not_laid_out src from to f covered skip broken="$LP_BROKEN_NEXT"
  LP_MODE="$4"
  # In the setup the packs come from the project GitHub made (#152 review,
  # finding 2): downloading the script again would not change them.
  [ "$LP_MODE" != overlay ] || broken="$SETUP_BROKEN_NEXT"

  common="ci.yml .github/workflows/ci.yml
gitignore .gitignore
vscode-settings.json .vscode/settings.json
vscode-extensions.json .vscode/extensions.json"
  typescript="package.json package.json
tsconfig.json tsconfig.json
biome.json biome.json"

  case "$pack" in
    node)
      table="$common
$typescript
placeholder.test.ts src/placeholder.test.ts"
      not_laid_out="code-standards.md"
      ;;
    web)
      table="$common
$typescript
index.html index.html
vite.config.mts vite.config.mts
playwright.config.ts playwright.config.ts
starter/src/ src/
starter/e2e/ e2e/"
      not_laid_out="code-standards.md deploy.yml wrangler.jsonc"
      if [ "$deploy" = yes ]; then
        table="$table
deploy.yml .github/workflows/deploy.yml
wrangler.jsonc wrangler.jsonc"
        not_laid_out="code-standards.md"
      fi
      ;;
    python)
      table="$common
pyproject.toml pyproject.toml
requirements.txt requirements.txt
requirements-dev.txt requirements-dev.txt
pre-commit-config.yaml .pre-commit-config.yaml
starter/src/ src/"
      not_laid_out="code-standards.md"
      ;;
    react-native)
      table="$common
$typescript
app.json app.json
starter/src/ src/"
      not_laid_out="code-standards.md"
      ;;
    csharp)
      table="$common
editorconfig .editorconfig
global.json global.json
Directory.Build.props Directory.Build.props
Directory.Packages.props Directory.Packages.props
Project.slnx Project.slnx
starter/src/ src/
starter/tests/ tests/"
      not_laid_out="code-standards.md"
      ;;
    *)
      fail 2 "layout-pack: unknown pack: $pack (expected node, web, python, react-native or csharp)" "$LP_PACK_NEXT"
      ;;
  esac
  LP_KEPT="$not_laid_out"

  src="$packs_dir/$pack"
  if [ ! -d "$src" ]; then
    if [ "$LP_MODE" = strict ]; then
      lp_fail "pack folder not found: $src" \
        "Check that the languages folder is next to this script, or set PACKS_DIR to the folder that holds the packs."
    fi
    lp_fail "pack folder not found: $src" "$broken" "Not a folder: $src"
  fi

  if [ "$LP_MODE" = strict ] && [ -e "$out" ] && [ -n "$(ls -A "$out")" ]; then
    lp_fail "target dir is not empty: $out" "Choose a folder that is empty or does not exist yet."
  fi

  # Every table source must exist.
  while read -r from _; do
    if [ "${from%/}" != "$from" ]; then
      [ -d "$src/$from" ] || lp_fail "missing from the pack: $from" "$broken" "Not in $src: $from"
    else
      [ -f "$src/$from" ] || lp_fail "missing from the pack: $from" "$broken" "Not in $src: $from"
    fi
  done <<<"$table"

  # Every pack file must be in the table or in not_laid_out.
  while IFS= read -r f; do
    covered=""
    for skip in $not_laid_out; do
      [ "$f" = "$skip" ] && covered=1
    done
    while read -r from _; do
      if [ "$f" = "$from" ]; then covered=1; fi
      case "$from" in */) case "$f" in "$from"*) covered=1 ;; esac ;; esac
    done <<<"$table"
    [ -n "$covered" ] || lp_fail "not in the layout table: $f" "$broken" "In $src but not in the table: $f"
  done < <(cd "$src" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)

  # In the setup the files the pack keeps (not laid out) must be there too,
  # because the tidy-up keeps them; found before anything is written.
  if [ "$LP_MODE" = overlay ]; then
    for f in $not_laid_out; do
      [ -f "$src/$f" ] || lp_fail "missing from the pack: $f" "$broken" "Not in $src: $f"
    done
  fi

  # The paths the layout writes, file by file (a folder of the table is
  # replaced by the files in it), for the self-check before the commit.
  LP_TARGETS=""
  while read -r from to; do
    if [ "${from%/}" != "$from" ]; then
      while IFS= read -r f; do
        LP_TARGETS="$LP_TARGETS $to$f"
      done < <(cd "$src/$from" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)
    else
      LP_TARGETS="$LP_TARGETS $to"
    fi
  done <<<"$table"

  # Overlay: the targets other than ci.yml and .gitignore must not be
  # there yet. All are checked before the first one is written.
  if [ "$LP_MODE" = overlay ]; then
    while read -r from to; do
      case "$to" in .github/workflows/ci.yml | .gitignore) continue ;; esac
      if [ -e "$out/$to" ] || [ -L "$out/$to" ]; then
        lp_fail "The copy of the project on this computer already has $to, which the $pack pack would add." \
          "This version of the bootstrapper cannot set up a $pack project, because its own files and the pack's overlap. Report it to the bootstrapper's maintainers and show them the details below." \
          "Already there: $out/$to"
      fi
    done <<<"$table"
  fi

  mkdir -p "$out"
  while read -r from to; do
    if [ "${from%/}" != "$from" ]; then
      mkdir -p "$out/$to"
      cp -R "$src/$from." "$out/$to"
    elif [ "$LP_MODE" = overlay ] && [ "$to" = .gitignore ]; then
      add_missing_lines "$src/$from" "$out/$to"
    else
      mkdir -p "$(dirname "$out/$to")"
      cp "$src/$from" "$out/$to"
    fi
  done <<<"$table"
}

# as_operand <path>: OPERAND is the path as a file operand for awk: awk
# reads an operand of the form name=value as a variable setting, so a
# path that does not start with / gets ./ in front (#152 review, finding
# 1). The other helpers that run awk on a file read it from stdin.
as_operand() {
  case "$1" in
    /*) OPERAND="$1" ;;
    *) OPERAND="./$1" ;;
  esac
}

# lp_fail <what happened> <what to do next> [raw text]: a layout error.
# The subcommand names itself and exits 1; in the setup the copy and the
# project exist, so it shows the command to continue (stop_with_error).
lp_fail() {
  [ "$LP_MODE" != overlay ] || stop_with_error "$1" "$2" "${3:-}"
  fail 1 "layout-pack: $1" "$2"
}

# add_missing_lines <from> <to>: adds to the file <to> each line of <from>
# that <to> lacks, in order, skipping empty lines and lines already
# added; <to>'s own lines stay as they are, and its last line is ended
# first. Carriage returns do not count when lines are compared.
add_missing_lines() {
  local tmp from to
  tmp="$(make_temp)"
  [ -f "$2" ] || : >"$2"
  as_operand "$1"
  from="$OPERAND"
  as_operand "$2"
  to="$OPERAND"
  awk_run 'FILENAME == ARGV[1] { print; sub(/\r$/, ""); have[$0] = 1; next }
    { sub(/\r$/, "") }
    $0 != "" && !($0 in have) { have[$0] = 1; print }' "$to" "$from" >"$tmp"
  cat "$tmp" >"$2"
  rm -f "$tmp"
}

cmd_layout_pack() {
  [ "$#" -eq 2 ] || usage
  local here packs_dir
  # CDPATH is cleared: a user's CDPATH could send cd to another folder of
  # the same name, or make it print the folder into $here.
  here="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  packs_dir="${PACKS_DIR:-$here/languages}"
  as_operand "$2"
  layout_into "$1" "$packs_dir" "$OPERAND" strict
  say "Laid out the $1 pack in $2"
}

# ---------- inputs ----------
# Each input comes from an option or, without --non-interactive, from a
# question read with plain `read` (gh's own prompts misbehave in Git
# Bash's terminal). parse_args reads the options; collect_inputs checks
# them, asks for the missing ones or takes their defaults, and checks
# those too. The answers end up in the IN_ variables.

IN_NAME="" IN_OWNER="" IN_PROJECT_NAME="" IN_DESCRIPTION="" IN_PO_NAME=""
IN_PACK="" IN_WITH_DEPLOY="" IN_VISIBILITY="" IN_LICENSE="" IN_COPYRIGHT_HOLDER=""
IN_DIR="" IN_CI_TIMEOUT="" IN_SLUG="" IN_GIT_NAME="" IN_GIT_EMAIL=""
OPT_NON_INTERACTIVE="" OPT_YES="" OPT_DRY_RUN="" OPT_RESUME="" OPT_ALLOW_UNPROTECTED=""
SEEN_PUBLIC="" SEEN_PRIVATE="" SEEN_WITH_DEPLOY="" SEEN_WITHOUT_DEPLOY=""
PROBLEMS=""
CR="$(printf '\r')"
NL='
'
# Letters and digits written out: a range such as A-Z can match accented
# letters in some locales.
ALNUM='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
LOWER_ALNUM='abcdefghijklmnopqrstuvwxyz0123456789'

# trim_into <text>: TRIMMED is the text without spaces around it.
trim_into() {
  TRIMMED="$1"
  TRIMMED="${TRIMMED#"${TRIMMED%%[![:space:]]*}"}"
  TRIMMED="${TRIMMED%"${TRIMMED##*[![:space:]]}"}"
}

# lower <text>: prints it in lowercase (ASCII letters only).
lower() { LC_ALL=C tr '[:upper:]' '[:lower:]' <<<"$1"; }

# slug_of <name>: the name lowercased with each . made a -, used where
# npm and Expo need a slug.
slug_of() { lower "${1//./-}"; }

parse_args() {
  local arg val has_val
  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift
    val=""
    has_val=""
    case "$arg" in
      --*=*)
        val="${arg#*=}"
        arg="${arg%%=*}"
        has_val=1
        ;;
    esac
    case "$arg" in
      --name | --owner | --project-name | --description | --po-name | --pack | --license | \
        --copyright-holder | --dir | --ci-timeout | --git-name | --git-email)
        if [ -z "$has_val" ]; then
          [ "$#" -gt 0 ] || fail 2 "The option $arg needs a value after it." \
            "Put the value after the option (in quotes if it has spaces) and run the script again. $OPTIONS_NEXT"
          val="$1"
          shift
        fi
        [ -n "$val" ] || fail 2 "The option $arg needs a value after it, and it is empty." \
          "Put the value after the option (in quotes if it has spaces) and run the script again. $OPTIONS_NEXT"
        case "$arg" in
          --name) IN_NAME="$val" ;;
          --owner) IN_OWNER="$val" ;;
          --project-name) IN_PROJECT_NAME="$val" ;;
          --description) IN_DESCRIPTION="$val" ;;
          --po-name) IN_PO_NAME="$val" ;;
          --pack) IN_PACK="$val" ;;
          --license) IN_LICENSE="$val" ;;
          --copyright-holder) IN_COPYRIGHT_HOLDER="$val" ;;
          --dir) IN_DIR="$val" ;;
          --ci-timeout) IN_CI_TIMEOUT="$val" ;;
          --git-name) IN_GIT_NAME="$val" ;;
          --git-email) IN_GIT_EMAIL="$val" ;;
        esac
        ;;
      --with-deploy | --without-deploy | --public | --private | --non-interactive | --yes | --dry-run | --resume | --allow-unprotected | --help)
        [ -z "$has_val" ] || fail 2 "The option $arg does not take a value." \
          "Remove the = and what follows it, and run the script again. $OPTIONS_NEXT"
        case "$arg" in
          --with-deploy)
            SEEN_WITH_DEPLOY=1
            IN_WITH_DEPLOY=yes
            ;;
          --without-deploy)
            SEEN_WITHOUT_DEPLOY=1
            IN_WITH_DEPLOY=no
            ;;
          --public)
            SEEN_PUBLIC=1
            IN_VISIBILITY=public
            ;;
          --private)
            SEEN_PRIVATE=1
            IN_VISIBILITY=private
            ;;
          --non-interactive) OPT_NON_INTERACTIVE=1 ;;
          --yes) OPT_YES=1 ;;
          --dry-run) OPT_DRY_RUN=1 ;;
          --resume) OPT_RESUME=1 ;;
          --allow-unprotected) OPT_ALLOW_UNPROTECTED=1 ;;
          --help)
            show_help
            exit 0
            ;;
        esac
        ;;
      --again)
        fail 2 "The option --again must come first, right after the name of the script." \
          "Run the script with --again first and the other options after it, as in bash bootstrap-project.sh --again --dry-run. $OPTIONS_NEXT"
        ;;
      --version)
        # Read where it stands, as --help is: the options after it are not read.
        [ -z "$has_val" ] || fail 2 "The option $arg does not take a value." \
          "Remove the = and what follows it, and run the script again. $OPTIONS_NEXT"
        show_version
        exit 0
        ;;
      -*)
        fail 2 "The option $arg is not one this script knows." \
          "Check its spelling and run the script again. $OPTIONS_NEXT"
        ;;
      *)
        fail 2 "The word $arg is not an option: each option starts with --." \
          "If it is a value, put its option in front of it (for the project's short name, --name), and run the script again. $OPTIONS_NEXT"
        ;;
    esac
  done
}

# ---- checks ----
# check_<input> <value>: on success sets CHECKED to the value as it will
# be used (trimmed, and lowercased where noted) and returns 0; otherwise
# sets PROBLEM to what is wrong, in a sentence, and returns 1.

# check_text <value>: rules for every name value (spec: they go into JSON
# and HTML): not empty, one line, no control characters, and none of
# " \ < > & or a backtick.
check_text() {
  trim_into "$1"
  case "$TRIMMED" in
    "")
      PROBLEM="It cannot be empty."
      return 1
      ;;
    *[[:cntrl:]]*)
      PROBLEM="It must be one line, with no tabs or other invisible characters."
      return 1
      ;;
    *'"'* | *\\* | *'<'* | *'>'* | *'&'* | *'`'*)
      PROBLEM='It cannot contain any of these characters: " \ < > & or a backtick (`).'
      return 1
      ;;
  esac
  CHECKED="$TRIMMED"
}

# check_table_text <value>: a name value that also goes into a table in
# the README, where a | would start a new column.
check_table_text() {
  check_text "$1" || return 1
  case "$CHECKED" in
    *'|'*)
      PROBLEM="It cannot contain a | (a vertical bar), because it goes into a table."
      return 1
      ;;
  esac
}

check_name() {
  local slug
  trim_into "$1"
  case "$TRIMMED" in
    "")
      PROBLEM="It cannot be empty."
      return 1
      ;;
    [!$ALNUM]* | *[!$ALNUM._-]*)
      PROBLEM="Use only letters, digits, dots (.), dashes (-) and underscores (_), with no spaces, and start with a letter or a digit."
      return 1
      ;;
  esac
  # GitHub's limit ("Creating a new repository" doc: at most 100
  # characters) is stricter than npm's 214 for the slug, which has the
  # same length as the name.
  if [ "${#TRIMMED}" -gt 100 ]; then
    PROBLEM="It is too long: GitHub allows at most 100 characters."
    return 1
  fi
  slug="$(slug_of "$TRIMMED")"
  if [ "$slug" = node_modules ]; then
    PROBLEM="That name is kept for the project's own tools; choose another one."
    return 1
  fi
  CHECKED="$TRIMMED"
}

# check_owner: an account of an Enterprise Managed User has an _ before
# its enterprise's short code, as in mona-cat_octo (GitHub's "Username
# considerations for external authentication" doc), so _ is allowed.
check_owner() {
  trim_into "$1"
  case "$TRIMMED" in
    "")
      PROBLEM="It cannot be empty."
      return 1
      ;;
    [!$ALNUM]* | *[!${ALNUM}_-]*)
      PROBLEM="Use the name of a GitHub account or organisation: letters, digits, dashes (-) and underscores (_), starting with a letter or a digit."
      return 1
      ;;
  esac
  CHECKED="$TRIMMED"
}

# check_pack: lowercased.
check_pack() {
  trim_into "$1"
  CHECKED="$(lower "$TRIMMED")"
  case "$CHECKED" in
    node | web | python | react-native) return 0 ;;
  esac
  PROBLEM="Choose one of the packs: node, web, python or react-native."
  return 1
}

# check_license: lowercased. "none", a listed licence, or any key of
# GitHub's licence list; whether that key exists is checked with GitHub
# before anything is created (preflight_license), not here.
check_license() {
  trim_into "$1"
  CHECKED="$(lower "$TRIMMED")"
  case "$CHECKED" in
    "" | [!$LOWER_ALNUM]* | *[!$LOWER_ALNUM.-]*)
      PROBLEM="Use none, one of the listed licences, or the short name of a licence from choosealicense.com (such as agpl-3.0): letters, digits, dots and dashes."
      return 1
      ;;
  esac
}

# check_ci_timeout: whole minutes from 1 to 9999, leading zeros dropped.
check_ci_timeout() {
  trim_into "$1"
  case "$TRIMMED" in
    "" | *[!0123456789]*)
      PROBLEM="Use a whole number of minutes, from 1 to 9999."
      return 1
      ;;
  esac
  CHECKED="${TRIMMED#"${TRIMMED%%[!0]*}"}"
  if [ -z "$CHECKED" ] || [ "${#CHECKED}" -gt 4 ]; then
    PROBLEM="Use a whole number of minutes, from 1 to 9999."
    return 1
  fi
}

# check_dir: a ~ at the start stands for the home folder, as the shell
# would read it (a typed answer or a --dir=~/x option does not go through
# the shell). Another account's ~name is refused.
check_dir() {
  trim_into "$1"
  # shellcheck disable=SC2088 # a typed ~ is matched as text here and expanded below
  case "$TRIMMED" in
    "")
      PROBLEM="It cannot be empty."
      return 1
      ;;
    *[[:cntrl:]]*)
      PROBLEM="It must be one line, with no tabs or other invisible characters."
      return 1
      ;;
    "~" | "~/"*)
      [ -n "${HOME:-}" ] || {
        PROBLEM="Your home folder is not known here, so ~ cannot be used: write the folder's full path."
        return 1
      }
      CHECKED="$HOME${TRIMMED#"~"}"
      return 0
      ;;
    "~"*)
      PROBLEM="A ~ at the start can only stand for your own home folder, as in ~/projects/app: write the folder's full path instead."
      return 1
      ;;
  esac
  # A relative folder gets ./ in front (#152 review, finding 1): awk reads
  # an operand such as my=app/README.md as a variable setting, not a file,
  # and gh, git, ls and rm read one starting with - as an option. A
  # Windows drive path (C:/... or C:\...) is not relative.
  case "$TRIMMED" in
    /* | ./* | ../* | . | .. | [A-Za-z]:/* | [A-Za-z]:\\*) CHECKED="$TRIMMED" ;;
    *) CHECKED="./$TRIMMED" ;;
  esac
}

# check_email: one line with no spaces, something before and after a
# single @. Whether the address works is not checked.
check_email() {
  check_text "$1" || return 1
  case "$CHECKED" in
    *[[:space:]]*)
      PROBLEM="Use an email address with no spaces, as in ada@example.com."
      return 1
      ;;
    *@*@* | @* | *@)
      PROBLEM="Use an email address with one @ and text on both sides, as in ada@example.com."
      return 1
      ;;
    *@*) return 0 ;;
  esac
  PROBLEM="Use an email address with one @ and text on both sides, as in ada@example.com."
  return 1
}

# Answers to a question with choices may also be the choice's number.
check_pack_answer() {
  case "$1" in
    1) set -- node ;;
    2) set -- web ;;
    3) set -- python ;;
    4) set -- react-native ;;
  esac
  check_pack "$1"
}

check_license_answer() {
  case "$1" in
    1) set -- none ;;
    2) set -- mit ;;
    3) set -- apache-2.0 ;;
    4) set -- gpl-3.0 ;;
    5) set -- bsd-3-clause ;;
    6) set -- polyform-noncommercial-1.0.0 ;;
    *[!0123456789]*) ;;
    *)
      PROBLEM="Choose a number from 1 to 6, or type the licence's name."
      return 1
      ;;
  esac
  check_license "$1"
}

check_visibility_answer() {
  CHECKED="$(lower "$1")"
  case "$CHECKED" in
    1 | public) CHECKED=public ;;
    2 | private) CHECKED=private ;;
    *)
      PROBLEM="Choose public or private."
      return 1
      ;;
  esac
}

check_yes_no() {
  CHECKED="$(lower "$1")"
  case "$CHECKED" in
    y | yes) CHECKED=yes ;;
    n | no) CHECKED=no ;;
    *)
      PROBLEM="Answer yes or no."
      return 1
      ;;
  esac
}

# add_problem <option> <problem>: one line of the list shown when the
# options cannot be used.
add_problem() {
  PROBLEMS="$PROBLEMS$NL    - $1: $2"
}

# stop_if_problems: shows every problem found so far, exit 2.
stop_if_problems() {
  [ -z "$PROBLEMS" ] || fail 2 "Some options are missing or cannot be used:$PROBLEMS" \
    "Correct the options listed above and run the script again. $OPTIONS_NEXT"
}

# check_given <option> <checker> <value>: checks an input given as an
# option; an empty value (not given) passes. On success CHECKED is the
# value to use.
check_given() {
  CHECKED="$3"
  [ -n "$3" ] || return 0
  "$2" "$3" && return 0
  add_problem "$1" "$PROBLEM"
  return 1
}

# prompt_for <checker> <explanation> <question> <default> [choice...]:
# asks until the answer passes the checker; the result is in CHECKED.
# A question without a default needs an answer.
prompt_for() {
  local check="$1"
  shift
  while :; do
    ask "$@" || fail 2 "The script stopped because a question got no answer." \
      "Run the script again and type an answer to each question, or give every answer as an option with --non-interactive. $OPTIONS_NEXT"
    if [ -z "$ANSWER" ]; then
      say_note "$ASK_NEEDED $ASK_RETRY"
    elif "$check" "$ANSWER"; then
      return 0
    else
      say_note "$PROBLEM $ASK_RETRY"
    fi
  done
}

# answer <option> <checker> <default> <explanation> <question> [choice...]:
# an input not given as an option. Asked as a question, with the default
# offered; with --non-interactive, the default is taken and checked like
# an answer (a missing required input has an empty default). CHECKED is
# the value, also when it was refused.
answer() {
  local opt="$1" check="$2" default="$3" why="$4" question="$5"
  shift 5
  if [ -z "$OPT_NON_INTERACTIVE" ]; then
    ANSWERED="$ANSWERED $opt "
    prompt_for "$check" "$why" "$question" "$default" "$@"
    return 0
  fi
  CHECKED="$default"
  if [ -z "$default" ]; then
    add_problem "$opt" "It is missing. It has no default, so it must be given."
    return 1
  fi
  "$check" "$default" && return 0
  add_problem "$opt" "$PROBLEM (This was the default; give the option to choose another value.)"
  CHECKED="$default"
  return 1
}

# check_options: the options given are checked first, all of them, so
# one run lists every problem; with --non-interactive the missing ones
# are listed too. cmd_setup runs it before the checks of this computer
# and of GitHub (#148 review, finding 5), so a run with a wrong option
# and a missing tool reports the option at once; collect_inputs runs it
# when it has not run yet.
OPTIONS_CHECKED=""
# ANSWERED: the options whose value was typed at a question, not given;
# the command shown at a stop carries them (carried_options).
ANSWERED=""
check_options() {
  [ -z "$OPTIONS_CHECKED" ] || return 0
  OPTIONS_CHECKED=1
  check_given --name check_name "$IN_NAME" && IN_NAME="$CHECKED"
  check_given --owner check_owner "$IN_OWNER" && IN_OWNER="$CHECKED"
  check_given --project-name check_table_text "$IN_PROJECT_NAME" && IN_PROJECT_NAME="$CHECKED"
  check_given --description check_text "$IN_DESCRIPTION" && IN_DESCRIPTION="$CHECKED"
  check_given --po-name check_table_text "$IN_PO_NAME" && IN_PO_NAME="$CHECKED"
  check_given --pack check_pack "$IN_PACK" && IN_PACK="$CHECKED"
  check_given --license check_license "$IN_LICENSE" && IN_LICENSE="$CHECKED"
  check_given --copyright-holder check_text "$IN_COPYRIGHT_HOLDER" && IN_COPYRIGHT_HOLDER="$CHECKED"
  check_given --dir check_dir "$IN_DIR" && IN_DIR="$CHECKED"
  check_given --ci-timeout check_ci_timeout "$IN_CI_TIMEOUT" && IN_CI_TIMEOUT="$CHECKED"
  check_given --git-name check_text "$IN_GIT_NAME" && IN_GIT_NAME="$CHECKED"
  check_given --git-email check_email "$IN_GIT_EMAIL" && IN_GIT_EMAIL="$CHECKED"
  if [ -n "$SEEN_PUBLIC" ] && [ -n "$SEEN_PRIVATE" ]; then
    add_problem --private "Give either --public or --private, not both."
  fi
  if [ -n "$SEEN_WITH_DEPLOY" ] && [ -n "$SEEN_WITHOUT_DEPLOY" ]; then
    add_problem --without-deploy "Give either --with-deploy or --without-deploy, not both."
  fi
  check_deploy_pack
  if [ -n "$OPT_ALLOW_UNPROTECTED" ] && [ -z "$OPT_RESUME" ]; then
    add_problem --allow-unprotected "It goes with --resume: the script offers it, with the command to run, when a private project cannot be protected on the GitHub plan, and it applies to a project that exists already."
  fi
  if [ -n "$OPT_NON_INTERACTIVE" ]; then
    # Missing required inputs are reported before GitHub is asked for
    # any default.
    [ -n "$IN_NAME" ] || add_problem --name "It is missing. It has no default, so it must be given."
    [ -n "$IN_DESCRIPTION" ] || add_problem --description "It is missing. It has no default, so it must be given."
    [ -n "$IN_PACK" ] || add_problem --pack "It is missing. It has no default, so it must be given."
    [ -n "$IN_LICENSE" ] || add_problem --license "It is missing. It has no default, so it must be given."
    # The git name and email default to git's own settings; without
    # them they are missing too. Those settings can be read only when
    # git is installed: without git, the git check shows its guide
    # first, and a missing name or email is reported after it.
    if check_git; then
      read_git_identity
      [ -n "$IN_GIT_NAME" ] || [ -n "$GIT_CFG_NAME" ] ||
        add_problem --git-name "It is missing, and git on this computer has no name set, so it must be given."
      [ -n "$IN_GIT_EMAIL" ] || [ -n "$GIT_CFG_EMAIL" ] ||
        add_problem --git-email "It is missing, and git on this computer has no email address set, so it must be given."
    fi
  fi
  stop_if_problems
}

collect_inputs() {
  local po_default_from
  check_options

  # Then each one not given, in the order of the questions.
  if [ -z "$IN_NAME" ]; then
    answer --name check_name "" \
      "The short name of your project on GitHub, also used in its web address: letters, digits, dots, dashes and underscores, no spaces. $ASK_NO_DEFAULT" \
      "Project name" || true
    IN_NAME="$CHECKED"
  fi
  IN_SLUG="$(slug_of "$IN_NAME")"
  if [ -z "$IN_PROJECT_NAME" ]; then
    answer --project-name check_table_text "$IN_NAME" \
      "The name people see at the top of the project's documents; it may have spaces and capital letters." \
      "Display name" || true
    IN_PROJECT_NAME="$CHECKED"
  fi
  if [ -z "$IN_DESCRIPTION" ]; then
    answer --description check_text "" \
      "One sentence that says what the project is for; it goes at the top of the project's documents. $ASK_NO_DEFAULT" \
      "Description" || true
    IN_DESCRIPTION="$CHECKED"
  fi
  if [ -z "$IN_OWNER" ]; then
    need_github_account
    answer --owner check_owner "$GH_LOGIN" \
      "The GitHub account or organisation that will own the project; press Enter to use your own account." \
      "Owner" || true
    IN_OWNER="$CHECKED"
  fi
  if [ -z "$IN_PO_NAME" ]; then
    need_github_account
    # The explanation says where the default comes from (end-to-end run
    # 1, finding 4). GH_LOGIN is never empty here, so there is always a
    # default.
    if [ -n "$GH_PROFILE_NAME" ]; then
      po_default_from="The default is the name on the GitHub profile of $GH_LOGIN, the account gh is signed in to."
    else
      po_default_from="The default is $GH_LOGIN, the name of the GitHub account gh is signed in to, because its profile has no name."
    fi
    answer --po-name check_table_text "${GH_PROFILE_NAME:-$GH_LOGIN}" \
      "The name of the product owner, the person who decides what the project should do (usually you). $po_default_from" \
      "Product owner name" || true
    IN_PO_NAME="$CHECKED"
  fi
  if [ -z "$IN_PACK" ]; then
    answer --pack check_pack_answer "" \
      "The kind of project, which sets the programming language and the tools that check the work. $ASK_NO_DEFAULT" \
      "Language pack (type the number or the name)" \
      "1) node: a program or service that runs on a computer or server, written in TypeScript" \
      "2) web: a website or web app that people open in their browser" \
      "3) python: a program written in Python, for example for data work or automation" \
      "4) react-native: a mobile app for phones and tablets (iPhone and Android)" || true
    IN_PACK="$CHECKED"
    check_deploy_pack
    stop_if_problems
  fi
  # With --resume the publishing files may be laid out already: for the web
  # pack the choice waits until the state is known (resume_deploy_choice).
  if [ "$IN_PACK" = web ] && [ -z "$IN_WITH_DEPLOY" ] && [ -z "$OPT_RESUME" ]; then
    ask_deploy
  fi
  if [ -z "$IN_WITH_DEPLOY" ] && { [ "$IN_PACK" != web ] || [ -z "$OPT_RESUME" ]; }; then IN_WITH_DEPLOY=no; fi
  if [ -z "$IN_VISIBILITY" ]; then
    answer --public check_visibility_answer public \
      "Who can see the project on GitHub; the protection this setup turns on is free for public projects, but needs a paid GitHub plan for private ones." \
      "Visibility (type the number or the name)" \
      "1) public: anyone can see the project and its code" \
      "2) private: only you and the people you invite can see it" || true
    IN_VISIBILITY="$CHECKED"
  fi
  if [ -z "$IN_LICENSE" ]; then
    ask_license
  fi
  if [ -z "$IN_COPYRIGHT_HOLDER" ]; then
    if [ "$IN_LICENSE" = none ]; then
      # No licence text, so the holder is not asked for.
      CHECKED="$IN_PO_NAME"
    else
      answer --copyright-holder check_text "$IN_PO_NAME" \
        "The name written in the licence as the owner of the code: a person or a company." \
        "Copyright holder" || true
    fi
    IN_COPYRIGHT_HOLDER="$CHECKED"
  fi
  if [ -z "$IN_DIR" ]; then
    answer --dir check_dir "./$IN_NAME" \
      "Where to put the copy of your project on this computer; the folder must be new or empty." \
      "Folder" || true
    IN_DIR="$CHECKED"
  fi
  read_git_identity
  if [ -z "$IN_GIT_NAME" ]; then
    answer --git-name check_text "$GIT_CFG_NAME" \
      "Your name, which git (the tool that keeps the history of your project's files) writes next to each change you save; anyone who can see the project can see it." \
      "Your name for git" || true
    IN_GIT_NAME="$CHECKED"
  fi
  if [ -z "$IN_GIT_EMAIL" ]; then
    answer --git-email check_email "$GIT_CFG_EMAIL" \
      "Your email address, which git writes next to your name on each change you save; anyone who can see the project can see it." \
      "Your email address for git" || true
    IN_GIT_EMAIL="$CHECKED"
  fi
  [ -n "$IN_CI_TIMEOUT" ] || IN_CI_TIMEOUT=20
  stop_if_problems
}

# ask_deploy: the question about the web pack's publishing files (or,
# with --non-interactive, its default no). A no is carried in the
# commands shown as --without-deploy (carried_options).
ask_deploy() {
  answer --with-deploy check_yes_no no \
    "Also add the files that publish the website on Cloudflare (a hosting service); you can add them later." \
    "Add the publishing files? (yes or no)" || true
  IN_WITH_DEPLOY="$CHECKED"
}

# ask_license: the licence question (or, with --non-interactive, the
# missing option); also asked again when GitHub does not know the
# answer (preflight_license).
ask_license() {
  answer --license check_license_answer "" \
    "The licence tells others what they may do with your code. $ASK_NO_DEFAULT" \
    "Licence (type the number or the name)" \
    "1) none: no licence, so nobody else may copy, change or share the code" \
    "2) mit: anyone may use, change and share the code, also in paid products, if they keep your name in it" \
    "3) apache-2.0: like mit, and it also gives users the rights to any patents in the code" \
    "4) gpl-3.0: anyone may use and change the code, but what they share must be open under the same licence" \
    "5) bsd-3-clause: like mit, and others may not use your name to promote their work" \
    "6) polyform-noncommercial-1.0.0: anyone may use and change the code, but not to make money with it" \
    "Or type the short name of another licence from choosealicense.com, such as agpl-3.0." || true
  IN_LICENSE="$CHECKED"
}

# read_git_identity: GIT_CFG_NAME and GIT_CFG_EMAIL, the name and email
# in git's global settings (empty when not set), read once. They are
# only read here: they are written into the new project's own settings
# after it is copied to this computer, never into the global ones.
GIT_CFG_NAME=""
GIT_CFG_EMAIL=""
GIT_CFG_READ=""
read_git_identity() {
  [ -z "$GIT_CFG_READ" ] || return 0
  GIT_CFG_READ=1
  GIT_CFG_NAME="$(git config --global --get user.name 2>/dev/null)" || GIT_CFG_NAME=""
  GIT_CFG_EMAIL="$(git config --global --get user.email 2>/dev/null)" || GIT_CFG_EMAIL=""
  GIT_CFG_NAME="${GIT_CFG_NAME//$CR/}"
  GIT_CFG_EMAIL="${GIT_CFG_EMAIL//$CR/}"
}

# check_deploy_pack: --with-deploy is for the web pack only.
check_deploy_pack() {
  if [ "$IN_WITH_DEPLOY" = yes ] && [ -n "$IN_PACK" ] && [ "$IN_PACK" != web ]; then
    case "$PROBLEMS" in
      *"- --with-deploy:"*) ;;
      *) add_problem --with-deploy "It is only for the web pack." ;;
    esac
  fi
}

# ---------- preflight: checks on this computer ----------
# Before anything is created the script checks this computer (spec:
# "Preflight (guided)"). A check that fails shows a guide: numbered steps
# for this OS, why the step is needed, what the user sees when it worked,
# what to do otherwise and how the script checks it. Then it waits for
# Enter and checks again, until the check passes or the user stops; on
# stop it shows the command to start again and exits 3. With
# --non-interactive it shows the guide and exits 3 at once. Where the
# script can run the fix itself (an install), the guide sets OFFER and the
# script offers the command on each round (not straight after it ran),
# running it only after a yes typed at the terminal (ask_terminal): never
# from stdin, never because of --yes.
#
# guided_check <check> <guide> is the loop; the GitHub checks reuse it.
# A check returns 0 when it passes; a guide prints through guide_begin,
# guide_step, say_command and guide_end, and may set OFFER.

OS_KIND=""
LINUX_PM=""
LINUX_WSL=""
OFFER=""
RESTART_CMD=""
RESTART_ARGS=""
RESTART_SCRIPT=""
RESTART_ARGV=()
NO_RECHECK=""
DQ='"'
SQ="'"

# detect_os: OS_KIND is macos, linux, windows (Git Bash, MSYS or Cygwin)
# or other, from uname -s. On Linux, LINUX_PM is the package manager
# (apt, dnf, pacman or zypper) read from the release file, or empty, and
# LINUX_WSL is yes in WSL (Linux on Windows), whose kernel release names
# Microsoft (WSL 2: 5.15.167.4-microsoft-standard-WSL2, WSL 1:
# 4.4.0-19041-Microsoft), or empty.
detect_os() {
  local kind="" f line id="" like="" w
  kind="$(uname -s 2>/dev/null)" || kind=""
  kind="${kind//$CR/}"
  case "$kind" in
    Darwin) OS_KIND=macos ;;
    Linux) OS_KIND=linux ;;
    MINGW* | MSYS* | CYGWIN*) OS_KIND=windows ;;
    *) OS_KIND=other ;;
  esac
  LINUX_PM=""
  LINUX_WSL=""
  [ "$OS_KIND" = linux ] || return 0
  f="${BOOTSTRAP_KERNEL_RELEASE:-/proc/sys/kernel/osrelease}"
  if [ -r "$f" ]; then
    line=""
    IFS= read -r line <"$f" || true
    case "$line" in *[Mm]icrosoft* | *MICROSOFT*) LINUX_WSL=yes ;; esac
  fi
  f="${BOOTSTRAP_OS_RELEASE:-/etc/os-release}"
  [ -r "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//$CR/}"
    case "$line" in
      ID=*) id="${line#ID=}" ;;
      ID_LIKE=*) like="${line#ID_LIKE=}" ;;
    esac
  done <"$f"
  id="${id//$DQ/}"
  id="${id//$SQ/}"
  like="${like//$DQ/}"
  like="${like//$SQ/}"
  for w in $id $like; do
    case "$w" in
      debian | ubuntu) LINUX_PM=apt ;;
      fedora | rhel | centos) LINUX_PM=dnf ;;
      arch) LINUX_PM=pacman ;;
      suse | sles | opensuse*) LINUX_PM=zypper ;;
      *) continue ;;
    esac
    break
  done
}

# quote_word <word>: QUOTED is the word as it must be typed in a shell to
# reach the script unchanged.
quote_word() {
  local esc="'\\''"
  case "$1" in
    "") QUOTED="''" ;;
    *[!${ALNUM}_./=:,@%+-]*) QUOTED="'${1//$SQ/$esc}'" ;;
    *) QUOTED="$1" ;;
  esac
}

# remember_command <options...>: RESTART_CMD is the command the user ran
# (without its leading "bash"), to show when they stop at a guide. It
# leaves out --resume and --allow-unprotected: shown_command adds them
# where they belong. RESTART_SCRIPT is its first word, the script as it
# was started, and RESTART_ARGV the options, each as it reached the
# script (for the saved answers, save_again).
remember_command() {
  local script="${BASH_SOURCE[0]:-}" arg
  if [ -z "$script" ] || [ -n "$SCRIPT_PIPED" ]; then script=bootstrap-project.sh; fi
  RESTART_ARGS=""
  RESTART_ARGV=()
  for arg in "$@"; do
    case "$arg" in --resume | --allow-unprotected) continue ;; esac
    quote_word "$arg"
    RESTART_ARGS="$RESTART_ARGS $QUOTED"
    RESTART_ARGV[${#RESTART_ARGV[@]}]="$arg"
  done
  quote_word "$script"
  RESTART_SCRIPT="$QUOTED"
  RESTART_CMD="$QUOTED$RESTART_ARGS"
}

# carried_options: CARRIED_OPTS is each answer typed at a question as the
# option that gives it, so that the command shown at a stop asks nothing
# again. An answer not given yet (empty) is left out. CARRIED_ARGV holds
# the same words, unquoted.
CARRIED_OPTS=""
CARRIED_ARGV=()
carried_options() {
  local opt value
  CARRIED_OPTS=""
  CARRIED_ARGV=()
  for opt in --owner --name --project-name --description --po-name --pack --with-deploy --public --license --copyright-holder --dir --git-name --git-email; do
    case " $ANSWERED " in *" $opt "*) ;; *) continue ;; esac
    case "$opt" in
      --owner) value="$IN_OWNER" ;;
      --name) value="$IN_NAME" ;;
      --project-name) value="$IN_PROJECT_NAME" ;;
      --description) value="$IN_DESCRIPTION" ;;
      --po-name) value="$IN_PO_NAME" ;;
      --pack) value="$IN_PACK" ;;
      --with-deploy) value="$IN_WITH_DEPLOY" ;;
      --public) value="$IN_VISIBILITY" ;;
      --license) value="$IN_LICENSE" ;;
      --copyright-holder) value="$IN_COPYRIGHT_HOLDER" ;;
      --dir) value="$IN_DIR" ;;
      --git-name) value="$IN_GIT_NAME" ;;
      --git-email) value="$IN_GIT_EMAIL" ;;
    esac
    [ -n "$value" ] || continue
    case "$opt" in
      --with-deploy)
        if [ "$value" = yes ]; then CARRIED_ARGV[${#CARRIED_ARGV[@]}]=--with-deploy; else CARRIED_ARGV[${#CARRIED_ARGV[@]}]=--without-deploy; fi
        CARRIED_OPTS="$CARRIED_OPTS ${CARRIED_ARGV[${#CARRIED_ARGV[@]} - 1]}"
        ;;
      --public)
        CARRIED_OPTS="$CARRIED_OPTS --$value"
        CARRIED_ARGV[${#CARRIED_ARGV[@]}]="--$value"
        ;;
      *)
        quote_word "$value"
        CARRIED_OPTS="$CARRIED_OPTS $opt $QUOTED"
        CARRIED_ARGV[${#CARRIED_ARGV[@]}]="$opt"
        CARRIED_ARGV[${#CARRIED_ARGV[@]}]="$value"
        ;;
    esac
  done
  return 0
}

# FRESH_START: the stop is a refusal to continue a project (not made by
# this version of the bootstrapper, or not there), so the command shown
# starts a new project and has no --resume.
FRESH_START=""

# shown_command: SHOWN_CMD is the command to show at a stop: what the user
# ran, --resume once the project exists (or the user gave it), the
# answers typed at the questions, and --allow-unprotected when given.
# shown_command_with_allow adds --allow-unprotected whether or not it was
# given (the guide that offers it).
# End-to-end run 2 repeated, r2l: on a touch-only tablet that long command
# could not be copied, and every answer was typed again. So its words
# after the script (SHOWN_ARGV) are saved next to the script (save_again),
# and SHOWN_CMD is then the short command that reads them back, the
# script with --again. Where they cannot be saved, it stays the long one.
# SHOWN_CD is the folder the script was started in (START_DIR), as the
# cd in front of the command writes it: ~/... under the home folder,
# else quoted. Guides send the user to a new window, which starts in
# the home folder (#267 review, B1): the script path and a --dir such as
# ./my-app are read from the folder the script was started in.
SHOWN_CMD=""
SHOWN_CD=""
SHOWN_ARGV=()
START_DIR=""
start_cd() {
  local home="${HOME:-}"
  SHOWN_CD=""
  [ -n "$START_DIR" ] || return 0
  case "$START_DIR" in *"$NL"*) return 0 ;; esac
  # The home folder is read back with cd and pwd, as START_DIR is, so a
  # HOME written with a // or a / at the end still matches it.
  if [ -n "$home" ]; then home="$(CDPATH='' cd -- "$home" 2>/dev/null && pwd)" || home=""; fi
  if [ -n "$home" ] && [ "$START_DIR" = "$home" ]; then
    SHOWN_CD="~"
  elif [ -n "$home" ] && [ "${START_DIR#"$home"/}" != "$START_DIR" ]; then
    quote_word "${START_DIR#"$home"/}"
    # shellcheck disable=SC2088 # shown for the person to type; their shell expands it
    SHOWN_CD="~/$QUOTED"
  else
    quote_word "$START_DIR"
    SHOWN_CD="$QUOTED"
  fi
}
shown_command() {
  start_cd
  [ -n "$RESTART_CMD" ] || remember_command
  SHOWN_CMD="$RESTART_CMD"
  SHOWN_ARGV=(${RESTART_ARGV[@]+"${RESTART_ARGV[@]}"})
  if [ -z "$FRESH_START" ] && { [ -n "$CREATED_NOTE" ] || [ -n "$OPT_RESUME" ]; }; then
    SHOWN_CMD="$SHOWN_CMD --resume"
    SHOWN_ARGV[${#SHOWN_ARGV[@]}]=--resume
  fi
  carried_options
  SHOWN_CMD="$SHOWN_CMD$CARRIED_OPTS"
  SHOWN_ARGV=(${SHOWN_ARGV[@]+"${SHOWN_ARGV[@]}"} ${CARRIED_ARGV[@]+"${CARRIED_ARGV[@]}"})
  if [ -z "$FRESH_START" ] && [ -n "$OPT_ALLOW_UNPROTECTED" ]; then
    SHOWN_CMD="$SHOWN_CMD --allow-unprotected"
    SHOWN_ARGV[${#SHOWN_ARGV[@]}]=--allow-unprotected
  fi
  if save_again ${SHOWN_ARGV[@]+"${SHOWN_ARGV[@]}"}; then SHOWN_CMD="$RESTART_SCRIPT --again"; fi
  return 0
}
# The option is added after the saved answers as well, on the short
# command's line: --again takes the options after it.
shown_command_with_allow() {
  local was="$OPT_ALLOW_UNPROTECTED"
  OPT_ALLOW_UNPROTECTED=""
  shown_command
  OPT_ALLOW_UNPROTECTED="$was"
  SHOWN_CMD="$SHOWN_CMD --allow-unprotected"
}

# ---------- the saved answers (--again) ----------
# AGAIN_DIR: the folder the script runs from (where step 1 of the README
# puts it), which holds the saved answers, AGAIN_NAME. Empty when the
# script was piped into bash, or sourced (the tests): then nothing is
# saved, and the long command is shown. One file per folder: each stop
# writes it anew, and the line at the start of --again names the project
# it is for.
AGAIN_NAME=.bootstrap-project.again
AGAIN_DIR=""
# AGAIN_SAVED: this run wrote the file, so a finished setup removes it.
AGAIN_SAVED=""
AGAIN_ARGS=()
# AGAIN_TMP: the temporary file save_again is writing, removed on the way
# out (leave_script) if a stop comes before it is moved into place.
AGAIN_TMP=""

# find_again_dir: sets AGAIN_DIR (run by main, never when sourced).
find_again_dir() {
  AGAIN_DIR=""
  [ -z "$SCRIPT_PIPED" ] || return 0
  AGAIN_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || AGAIN_DIR=""
}

# save_again <words...>: writes the words, one per line, to AGAIN_NAME in
# AGAIN_DIR, readable by the user only (they hold the answers, the git
# email too); returns 1, and writes nothing, when that cannot be done: no
# AGAIN_DIR, a word with a line break (it cannot be one line), AGAIN_DIR
# inside the project's copy (the file would be a change in it), or a
# write that fails. A temporary file in the same folder is moved over the
# old one, so a stop half way through never leaves half a file.
save_again() {
  local here copy tmp word
  [ -n "$AGAIN_DIR" ] || return 1
  # No words (no option given and no answer yet, as README step 1 starts
  # it): the plain command is shown; a file would hold one empty line
  # (#267 review, B1).
  [ "$#" -gt 0 ] || return 1
  for word in "$@"; do
    case "$word" in *"$NL"*) return 1 ;; esac
  done
  here="$(CDPATH='' cd -- "$AGAIN_DIR" 2>/dev/null && pwd -P)" || return 1
  if [ -n "$IN_DIR" ] && [ -d "$IN_DIR" ]; then
    copy="$(CDPATH='' cd -- "$IN_DIR" 2>/dev/null && pwd -P)" || copy=""
    if [ -n "$copy" ]; then
      case "$here/" in "$copy/"*) return 1 ;; esac
    fi
  fi
  [ ! -d "$AGAIN_DIR/$AGAIN_NAME" ] || return 1
  tmp="$(umask 077 && mktemp "$AGAIN_DIR/$AGAIN_NAME.XXXXXX" 2>/dev/null)" || return 1
  AGAIN_TMP="$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  if printf '%s\n' "$@" >"$tmp" 2>/dev/null && mv -f -- "$tmp" "$AGAIN_DIR/$AGAIN_NAME" 2>/dev/null; then # not-user-facing
    AGAIN_TMP=""
    AGAIN_SAVED=1
    return 0
  fi
  rm -f -- "$tmp"
  AGAIN_TMP=""
  return 1
}

# read_again: AGAIN_ARGS is the saved answers, one word per line, read as
# words and never run; then one line says which project they are for. No
# file, or one that cannot be read or is empty, stops (exit 2).
read_again() {
  local f="$AGAIN_DIR/$AGAIN_NAME" line owner="" name="" prev="" project words=""
  AGAIN_ARGS=()
  if [ -n "$AGAIN_DIR" ] && [ -f "$f" ] && [ -r "$f" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%"$CR"}"
      [ -z "$line" ] || words=1
      AGAIN_ARGS[${#AGAIN_ARGS[@]}]="$line"
    done <"$f" || AGAIN_ARGS=()
  fi
  # Only empty lines are no saved answers either.
  [ -n "$words" ] || AGAIN_ARGS=()
  [ "${#AGAIN_ARGS[@]}" -gt 0 ] || fail 2 "There are no saved answers for --again next to this script: the file $AGAIN_NAME is not in its folder, cannot be read, or holds no answers. The script saves them when it stops, in the folder it runs from." \
    "Start the script as in step 1 of the README: it asks for each answer, and if it stops, it shows the command to run next."
  for line in "${AGAIN_ARGS[@]}"; do
    case "$prev" in
      --owner) owner="$line" ;;
      --name) name="$line" ;;
    esac
    case "$line" in
      --owner=*) owner="${line#--owner=}" ;;
      --name=*) name="${line#--name=}" ;;
    esac
    prev="$line"
  done
  if [ -n "$name" ]; then
    project="for the project ${owner:+$owner/}$name"
  else
    project="before a project name was given"
  fi
  say "Using the answers saved when the script stopped last time, $project."
}

# remove_again: a finished setup removes the file it wrote, and only that
# file, when it is still a file of its own in that folder.
remove_again() {
  local f="$AGAIN_DIR/$AGAIN_NAME"
  [ -n "$AGAIN_SAVED" ] && [ -n "$AGAIN_DIR" ] || return 0
  if [ -f "$f" ] && [ ! -L "$f" ]; then rm -f -- "$f"; fi
  AGAIN_SAVED=""
}

# stop_at_guide: the user stopped at a guide, or --non-interactive (or a
# check that cannot pass in this run) showed it: exit 3 with the command
# to start again.
# Once the project exists on GitHub (CREATED_NOTE set), the command shown
# continues the setup with --resume, and the stop says what exists.
stop_at_guide() {
  shown_command
  if [ -n "$CREATED_NOTE" ]; then
    say "$CONTINUE_INTRO"
    say_shown_command
    fail 3 "$GUIDE_TITLE The script stopped here. $CREATED_NOTE" \
      "Follow the steps above, then run the command shown to continue the setup."
  fi
  say "$START_AGAIN_INTRO"
  say_shown_command
  fail 3 "$GUIDE_TITLE The script stopped here, and nothing was created." \
    "Follow the steps above, then run the command shown to start again."
}

# offered <offer> show|run: the fixed command of each offer, shown for the
# user to copy, or run (through run_offered) after their yes. Each one is
# written twice on its line, and a test checks that what runs is what
# was shown.
offered() {
  case "$1" in
    xcode) if [ "$2" = run ]; then run_offered "xcode-select --install"; else say_command "xcode-select --install"; fi ;;
    winget-git) if [ "$2" = run ]; then run_offered "winget install --id Git.Git -e --source winget"; else say_command "winget install --id Git.Git -e --source winget"; fi ;;
    brew-gh) if [ "$2" = run ]; then run_offered "brew install gh"; else say_command "brew install gh"; fi ;;
    brew-gh-upgrade) if [ "$2" = run ]; then run_offered "brew upgrade gh"; else say_command "brew upgrade gh"; fi ;;
    winget-gh) if [ "$2" = run ]; then run_offered "winget install --id GitHub.cli -e --source winget"; else say_command "winget install --id GitHub.cli -e --source winget"; fi ;;
    winget-gh-upgrade) if [ "$2" = run ]; then run_offered "winget upgrade --id GitHub.cli -e --source winget"; else say_command "winget upgrade --id GitHub.cli -e --source winget"; fi ;;
    gh-refresh-workflow) if [ "$2" = run ]; then run_offered "gh auth refresh -h github.com -s workflow"; else say_command "gh auth refresh -h github.com -s workflow"; fi ;;
    gh-refresh-public) if [ "$2" = run ]; then run_offered "gh auth refresh -h github.com -s public_repo,workflow"; else say_command "gh auth refresh -h github.com -s public_repo,workflow"; fi ;;
    gh-refresh-repo) if [ "$2" = run ]; then run_offered "gh auth refresh -h github.com -s repo,workflow"; else say_command "gh auth refresh -h github.com -s repo,workflow"; fi ;;
    gh-setup-git) if [ "$2" = run ]; then run_offered "gh auth setup-git"; else say_command "gh auth setup-git"; fi ;;
    *) return 1 ;;
  esac
}

# offer_command: offers the command of the guide just shown (OFFER).
# Returns 0 when it ran (the check runs again straight away), 1 when the
# user did not say yes.
offer_command() {
  say "$OFFER_INTRO"
  offered "$OFFER" show
  if ask_terminal "It runs only if you type yes; Enter or any other answer skips it, and you can run it yourself." \
    "Run it now? (yes or no)"; then
    # The blank line after the answer now, before the command's own
    # output, which no helper sees (#248 review, B1).
    log_resumes
    if offered "$OFFER" run; then
      say_log "The command finished. Checking again."
    else
      say_log "The command stopped with an error (its messages are above). Checking again."
    fi
    return 0
  fi
  # This window waits for Enter, so the user's own run is in another one.
  # A winget install is found only in a Git Bash window opened after it,
  # so its guide says to start the script again there: this line too.
  if offer_needs_new_window; then
    say_note "Not run. To run it yourself, run it in another Git Bash window. When it has finished, type q here and copy the command the script shows to start again. Then close both windows, open Git Bash again from the Start menu, and run that command there."
    return 1
  fi
  case "$OS_KIND" in
    windows) say_note "Not run. To run it yourself, open another Git Bash window (this one is waiting), run the command there, then come back here and press Enter to check again." ;;
    *) say_note "Not run. To run it yourself, open another terminal window (this one is waiting), run the command there, then come back here and press Enter to check again." ;;
  esac
  return 1
}

# offer_needs_new_window: the offer (OFFER) is a winget install, which
# this window cannot see (its PATH was read when it opened); its guide
# says to start the script again in a new Git Bash window.
offer_needs_new_window() {
  case "$OFFER" in
    winget-*) return 0 ;;
  esac
  return 1
}

# guided_check <check> <guide>: see the top of this section. A guide
# whose check cannot pass again in this run (a new script or a new
# terminal window is needed) sets NO_RECHECK: it stops at once, as with
# --non-interactive.
# The offer comes on every round whose guide has one (end-to-end run 1:
# after a no by accident, the only ways on were another window or a new
# start), except the round straight after the command ran: that round
# waits for Enter, as the command may still be working (Apple's
# installer goes on in its own window) or need a new window. So every
# round reads a line, from the terminal or from stdin, and between two
# runs there is always an Enter: the loop never goes round on its own.
# Once a winget install has run, no winget install is offered again in
# this window, which cannot see it: each round says to start again in a
# new Git Bash window instead.
guided_check() {
  local check="$1" guide="$2" just_ran="" ran_winget=""
  while ! "$check"; do
    OFFER=""
    NO_RECHECK=""
    "$guide"
    [ -z "$OPT_NON_INTERACTIVE" ] && [ -z "$NO_RECHECK" ] || stop_at_guide
    if [ -n "$ran_winget" ] && offer_needs_new_window; then
      say_note "The script cannot check again in this window, because a program installed with winget is found only in a Git Bash window opened after the install. Type q here and copy the command the script shows to start again. Then close this window, open Git Bash again from the Start menu, and run that command there."
    elif [ -n "$OFFER" ] && [ -z "$just_ran" ]; then
      if offer_command; then
        just_ran=1
        if offer_needs_new_window; then ran_winget=1; fi
        continue
      fi
    fi
    just_ran=""
    wait_for_enter || stop_at_guide
  done
}

# ---- bash ----

check_bash_version() {
  [ "$1" -gt 3 ] || { [ "$1" -eq 3 ] && [ "$2" -ge 2 ]; }
}

guide_bash_old() {
  guide_begin "This bash is too old for the script: it needs version 3.2 or later." \
    "bash is the program that runs this script, and the script uses features that older versions do not have."
  case "$OS_KIND" in
    macos)
      guide_step "Start the script with the bash that comes with macOS: type /bin/bash in place of bash in the command shown below."
      ;;
    windows)
      guide_step "Open https://git-scm.com/download/win in your browser and install the current Git for Windows, which comes with a newer bash."
      guide_step "Close this window, open Git Bash again from the Start menu, and start the script there."
      ;;
    *)
      guide_step "Install a newer bash with your system's software installer, or with this command, which asks for your computer password:"
      case "$LINUX_PM" in
        apt) say_command "sudo apt install bash" ;;
        dnf) say_command "sudo dnf install bash" ;;
        pacman) say_command "sudo pacman -S bash" ;;
        zypper) say_command "sudo zypper install bash" ;;
        *) say "    (your system's own install command, followed by the word bash)" ;;
      esac
      guide_step "Open a new terminal window and start the script there."
      ;;
  esac
  guide_end "the script starts with \"Done. bash 3.2 is new enough.\" or a later version." \
    "ask someone who manages this computer to install bash 3.2 or later." \
    "it reads the version of the bash that runs it. It cannot check again in this run, so it stops here."
}

# preflight_bash [major minor]: the version of the bash running the
# script (the arguments are for the tests).
preflight_bash() {
  local major="${1:-${BASH_VERSINFO[0]}}" minor="${2:-${BASH_VERSINFO[1]}}"
  step_start "Checking that bash (the program that runs this script) is new enough"
  if ! check_bash_version "$major" "$minor"; then
    guide_bash_old
    stop_at_guide
  fi
  step_end "bash $major.$minor is new enough."
}

# ---- git ----

check_git() { git --version >/dev/null 2>&1; }

guide_git() {
  guide_begin "git is not installed." \
    "git keeps the history of your project's files, and the script needs it to put a copy of your project on this computer."
  case "$OS_KIND" in
    macos)
      guide_step "Run this command; it starts Apple's installer for its command line developer tools, which include git:"
      offered xcode show
      OFFER=xcode
      guide_step "A window opens and offers to install the tools. Click Install, then Agree, and wait until it says that the software was installed (this can take several minutes)."
      guide_step "Come back to this window."
      guide_end "the window says \"The software was installed\", and the script says \"Done. git is installed.\"" \
        "if no window opens, open https://git-scm.com/download/mac in your browser and follow the steps there." \
        "it runs git --version, which works only when git is installed."
      ;;
    windows)
      if command -v winget >/dev/null 2>&1; then
        guide_step "Run this command; it installs Git for Windows, which includes git:"
        offered winget-git show
        OFFER=winget-git
      else
        guide_step "Open https://git-scm.com/download/win in your browser, download Git for Windows and run the installer, keeping the default choices."
      fi
      # p2.8.4-e: the command to start again is shown only after q (see
      # the npm guide, p2.8.4-c).
      guide_step "When the install has finished, type q here if the script waits, and copy the command it shows to start again. Then close this window, open Git Bash again from the Start menu, and run that command there, so that it finds git."
      guide_end "the script says \"Done. git is installed.\"" \
        "if the script still says that git is not installed, check that you opened Git Bash again after the install." \
        "it runs git --version, which works only when git is installed."
      ;;
    *)
      case "$LINUX_PM" in
        apt | dnf | pacman | zypper)
          guide_step "Run this command in another terminal window; it asks for your computer password, because installing needs it:"
          case "$LINUX_PM" in
            apt) say_command "sudo apt install git" ;;
            dnf) say_command "sudo dnf install git" ;;
            pacman) say_command "sudo pacman -S git" ;;
            zypper) say_command "sudo zypper install git" ;;
          esac
          ;;
        *)
          if [ "$OS_KIND" = linux ]; then
            guide_step "Open https://git-scm.com/download/linux in your browser and run the install command it shows for your system."
          else
            guide_step "Open https://git-scm.com/downloads in your browser and follow the steps for your system."
          fi
          ;;
      esac
      guide_step "Come back to this window."
      guide_end "the script says \"Done. git is installed.\"" \
        "if the install command says that it cannot find git, update your system's list of software first, then try again." \
        "it runs git --version, which works only when git is installed."
      ;;
  esac
}

preflight_git() {
  step_start "Checking that git is installed"
  guided_check check_git guide_git
  step_end "git is installed."
}

# ---- gh ----

# check_gh: gh runs, and offers each option the script uses that older
# versions lack (the feature check: no version number is compared): repo
# create --template (step 2), pr checks --json (step 15) and pr merge
# --match-head-commit (step 17). Help goes to stdout or stderr by gh
# version, so both are read. GH_PROBLEM says which part failed: missing
# or old.
GH_PROBLEM=""
check_gh() {
  local help=""
  if ! run_gh --to /dev/null /dev/null --version; then
    GH_PROBLEM=missing
    return 1
  fi
  GH_PROBLEM=old
  # The command in quotes is not a message: the marker keeps it out of
  # the banned-words check.
  help="$(run_gh repo create --help 2>&1)" || help="" # not-a-message
  case "$help" in *--template*) ;; *) return 1 ;; esac
  help="$(run_gh pr checks --help 2>&1)" || help=""
  case "$help" in *--json*) ;; *) return 1 ;; esac
  help="$(run_gh pr merge --help 2>&1)" || help=""
  case "$help" in *--match-head-commit*) ;; *) return 1 ;; esac
  GH_PROBLEM=""
  return 0
}

guide_gh() {
  case "$GH_PROBLEM" in
    old) guide_gh_old ;;
    *) guide_gh_missing ;;
  esac
}

guide_gh_missing() {
  guide_begin "The GitHub command-line tool (gh) is not installed." \
    "The script uses gh to talk to GitHub for you: to create your project there and to check it."
  gh_install_steps install
  gh_see_something_else "not installed"
  guide_end "the script says \"Done. gh is installed and can create a project from a template.\"" \
    "$GH_ELSE" \
    "it runs gh --version, which works only when gh is installed."
}

guide_gh_old() {
  guide_begin "The GitHub command-line tool (gh) on this computer is too old." \
    "The script needs a gh that can create a project from a template, read its checks and add a proposed change, which older versions of gh cannot do."
  gh_install_steps upgrade
  gh_see_something_else "too old"
  guide_end "the script says \"Done. gh is installed and can create a project from a template.\"" \
    "$GH_ELSE" \
    "it checks that gh's commands for creating a project, for reading its checks and for adding a proposed change offer the options the script uses: --template, --json and --match-head-commit."
}

# gh_see_something_else <what>: sets GH_ELSE, the "If you see something
# else" line of both gh guides. On Windows it says what the last step
# says (p2.8.4-e).
GH_ELSE=""
gh_see_something_else() {
  case "$OS_KIND" in
    windows) GH_ELSE="if the script still says that gh is $1, type q if the script waits and copy the command it shows; then close this window, open Git Bash again from the Start menu (not from this window), and run that command there." ;;
    *) GH_ELSE="if the script still says that gh is $1, close this window, open a new one, and start the script again there." ;;
  esac
}

# gh_install_steps install|upgrade: the steps both gh guides share.
gh_install_steps() {
  case "$OS_KIND" in
    macos)
      if command -v brew >/dev/null 2>&1; then
        guide_step "Run this command; it uses Homebrew, the installer already on this Mac:"
        if [ "$1" = upgrade ]; then
          offered brew-gh-upgrade show
          OFFER=brew-gh-upgrade
        else
          offered brew-gh show
          OFFER=brew-gh
        fi
      else
        guide_step "Open https://cli.github.com in your browser, click Download for Mac, open the downloaded file and follow the installer."
      fi
      guide_step "Come back to this window."
      ;;
    windows)
      if command -v winget >/dev/null 2>&1; then
        guide_step "Run this command; it uses winget, the installer that comes with Windows:"
        if [ "$1" = upgrade ]; then
          offered winget-gh-upgrade show
          OFFER=winget-gh-upgrade
        else
          offered winget-gh show
          OFFER=winget-gh
        fi
      else
        # The page's Windows options read "Windows - WinGet" and "Windows -
        # Download MSI" (end-to-end run 3, r3b; there is no "Download for
        # Windows" button any more).
        guide_step "Open https://cli.github.com in your browser, choose the Windows option that says Download MSI (not the one that says WinGet), and run the downloaded installer, keeping the default choices."
      fi
      # p2.8.4-e: as in the git and npm guides, q first.
      guide_step "When the install has finished, type q here if the script waits, and copy the command it shows to start again. Then close this window, open Git Bash again from the Start menu, and run that command there, so that it finds the new gh."
      ;;
    linux)
      guide_step "Open https://github.com/cli/cli/blob/trunk/docs/install_linux.md in your browser and follow the steps for your system; the gh in your system's own software list may be too old."
      guide_step "Come back to this window."
      ;;
    *)
      guide_step "Open https://cli.github.com in your browser and follow the steps for your system."
      guide_step "Come back to this window."
      ;;
  esac
}

preflight_gh() {
  step_start "Checking that the GitHub command-line tool (gh) is installed and new enough"
  guided_check check_gh guide_gh
  step_end "gh is installed and can create a project from a template."
}

# preflight_tools: the checks that need no answer, run before the first
# question and before anything is read from GitHub.
preflight_tools() {
  preflight_bash
  preflight_git
  preflight_gh
}

# ---- npm (node, web and react-native packs) ----

# check_npm: npm runs. In WSL (Linux on Windows), an npm in a Windows
# drive's folder (/mnt/c/...) is the Windows one, reached through WSL's
# Windows interop: a project in Linux should not depend on it, so it
# counts as no npm and is not run (end-to-end run 2, r2e). The place is
# followed to the file it leads to (#255 review, N1), so a link to the
# Windows npm, or ./npm with . on PATH in a Windows folder, counts too.
# NPM_PROBLEM says which part failed: missing or windows;
# NPM_WINDOWS_PATH is where the Windows npm was found.
NPM_PROBLEM=""
NPM_WINDOWS_PATH=""
check_npm() {
  local where=""
  if [ -n "$LINUX_WSL" ]; then
    where="$(command -v npm 2>/dev/null)" || where=""
    if [ -n "$where" ] && on_windows_drive "$where"; then
      NPM_PROBLEM=windows
      NPM_WINDOWS_PATH="$where"
      return 1
    fi
  fi
  NPM_PROBLEM=missing
  npm --version >/dev/null 2>&1 || return 1
  NPM_PROBLEM=""
}

# on_windows_drive <path>: the path, or the file it leads to through
# links (and from the current folder, for a relative path), is in the
# folder of a Windows drive as WSL shows it: /mnt/<one letter>/...
# (BOOTSTRAP_WINDOWS_DRIVES for /mnt). Other folders under /mnt (WSL's
# own /mnt/wsl, a disk mounted at /mnt/data) are not Windows drives.
# readlink -f is GNU's, always there in WSL, where alone this runs; where
# it fails, the path is taken as it is. The drives folder is followed
# too, so both are compared the same way.
on_windows_drive() {
  local root="${BOOTSTRAP_WINDOWS_DRIVES:-/mnt}" real="" real_root=""
  root="${root%/}"
  in_drive_folder "$1" "$root" && return 0
  real="$(readlink -f -- "$1" 2>/dev/null)" || real=""
  [ -n "$real" ] || return 1
  real_root="$(readlink -f -- "$root" 2>/dev/null)" || real_root=""
  [ -n "$real_root" ] || real_root="$root"
  in_drive_folder "$real" "${real_root%/}"
}

# in_drive_folder <path> <drives folder>: the path is in a one-letter
# folder of the drives folder.
in_drive_folder() {
  case "$1" in
    "$2"/[A-Za-z]/*) return 0 ;;
  esac
  return 1
}

guide_npm() {
  case "$NPM_PROBLEM" in
    windows) guide_npm_windows ;;
    *) guide_npm_missing ;;
  esac
}

guide_npm_windows() {
  guide_begin "The npm this Linux finds is the Windows one, so npm (part of Node.js) is not installed in this Linux." \
    "This Linux runs inside Windows (WSL, the Windows Subsystem for Linux), and the npm it found, $NPM_WINDOWS_PATH, is a Windows program. A project in this Linux should use a Node.js installed in Linux: the node, web and react-native packs use npm to record the exact versions of the tools your project uses, so that its checks on GitHub can install the same ones."
  npm_steps_in_wsl
  guide_end "the script says \"Done. npm is installed.\"" \
    "if the script still says that the npm it finds is the Windows one, check that the commands from the page ended without an error, then open a new window of this Linux and start the script there." \
    "it looks where the npm it finds is, following links: one in the folder of a Windows drive (/mnt/c/, /mnt/d/ and so on, where this Linux shows the Windows drives) is the Windows one. Otherwise it runs npm --version, which works only when npm is installed."
}

# npm_steps_in_wsl: in WSL, the steps to install Node.js in this Linux,
# for both npm guides (end-to-end run 2 repeated, r2i). The browser runs
# on Windows, so nodejs.org offers the Windows steps first.
npm_steps_in_wsl() {
  guide_step "Open https://nodejs.org/en/download in your browser. It shows the steps for Windows, because the browser runs on Windows: where the page says Windows, choose Linux instead, and keep the version marked LTS (the one with long-term support)."
  guide_step "Open another window of this Linux (from the Start menu, as you opened this one) and run there, one by one, the commands the page shows: they install Node.js, which includes npm, in this Linux."
  npm_step_new_window "a new window of this Linux"
}

# npm_step_new_window <window>: the last step on Linux and in WSL. The
# page's Linux steps install Node.js with nvm, which puts npm on PATH only
# for windows opened after it: this script, waiting in this window, cannot
# find it (r2j), so it is started again in a new window. The command to
# start again is shown only after q (#255 review, N2).
npm_step_new_window() {
  guide_step "When they have finished, type q here if the script waits, and copy the command it shows to start again. Then close this window, open $1, and run that command there: the new npm is found only in a window opened after the install."
}

guide_npm_missing() {
  local other="if the script still says that npm is not installed, close this window, open a new one, and start the script again there."
  guide_begin "npm (part of Node.js) is not installed." \
    "The node, web and react-native packs use npm to record the exact versions of the tools your project uses, so that its checks on GitHub can install the same ones."
  case "$OS_KIND" in
    macos)
      guide_step "Open https://nodejs.org in your browser and download the version marked LTS (the one with long-term support)."
      guide_step "Open the downloaded file and follow the installer, then come back to this window."
      ;;
    windows)
      guide_step "Open https://nodejs.org in your browser and download the version marked LTS (the one with long-term support)."
      guide_step "Run the downloaded installer, keeping the default choices."
      # End-to-end run 4, r4a: a window opened from this one keeps the
      # PATH it started with; the installer changes PATH only for windows
      # started afterwards from the Start menu, so the step says why.
      # p2.8.4-c: the command to start again is shown only after q, so
      # the step says to type q first, as on Linux and in WSL.
      guide_step "When the installer has finished, type q here if the script waits, and copy the command it shows to start again. Then close this window, open Git Bash again from the Start menu, and run that command there. Use the Start menu, not a new window opened from this one: a window opened from another one keeps that window's old list of the folders where programs are found, so it would not find the new npm either."
      other="if the script still says that npm is not installed, type q if the script waits and copy the command it shows; then close this window, open Git Bash again from the Start menu (not from this window), and run that command there."
      ;;
    *)
      if [ -n "$LINUX_WSL" ]; then
        npm_steps_in_wsl
        other="if the script still says that npm is not installed, check that the commands from the page ended without an error, then start the script again in a new window of this Linux."
      else
        guide_step "Open https://nodejs.org/en/download in your browser. Keep Linux and the version marked LTS (the one with long-term support) chosen there; the Node.js in your system's own software list may be older than the one your project's checks use."
        guide_step "Open another terminal window and run there, one by one, the commands the page shows: they install Node.js, which includes npm."
        npm_step_new_window "a new terminal window"
        other="if the script still says that npm is not installed, check that the commands from the page ended without an error, then start the script again in a new terminal window."
      fi
      ;;
  esac
  guide_end "the script says \"Done. npm is installed.\"" \
    "$other" \
    "it runs npm --version, which works only when npm is installed."
}

preflight_npm() {
  case "$IN_PACK" in
    node | web | react-native) ;;
    *) return 0 ;;
  esac
  step_start "Checking that npm is installed (the $IN_PACK pack needs it)"
  guided_check check_npm guide_npm
  step_end "npm is installed."
}

# ---- the target folder ----

# check_target_dir: IN_DIR does not exist, or is an empty folder; with
# --resume a folder with files is allowed too (it may hold the copy of
# the project from the run that stopped; whether it is this project's
# own copy is checked when --resume continues). The folder that holds
# IN_DIR must exist; the script must be able to write in IN_DIR (when it
# is there) or in that folder (when not); and that folder must not be
# inside a git project, so the copy is never a project within another
# (#148 review, finding 7). DIR_PROBLEM: file, not-empty, no-parent,
# not-writable (DIR_UNWRITABLE: the folder) or in-git (DIR_OUTER: where
# that project starts, when git says).
DIR_PROBLEM=""
DIR_DONE=""
DIR_UNWRITABLE=""
DIR_OUTER=""
check_target_dir() {
  local entries="" parent
  DIR_DONE="The folder is new or empty."
  if [ -d "$IN_DIR" ]; then
    entries="$(ls -A "$IN_DIR" 2>/dev/null)" || entries=unreadable
    if [ -n "$entries" ]; then
      if [ -z "$OPT_RESUME" ]; then
        DIR_PROBLEM=not-empty
        return 1
      fi
      # With --resume a folder with files must be this project's own copy.
      if ! dir_is_own_copy; then
        DIR_PROBLEM=not-own-copy
        return 1
      fi
      DIR_DONE="The folder is a copy of the project $IN_OWNER/$IN_NAME, which --resume continues."
    fi
  elif [ -e "$IN_DIR" ] || [ -L "$IN_DIR" ]; then
    DIR_PROBLEM="file"
    return 1
  fi
  parent="$(dirname -- "$IN_DIR")"
  # A copy already there is looked at from outside: its own folder (also
  # when it is given as .) must not count as the folder that holds it.
  if [ -n "$entries" ]; then
    parent="$(dirname -- "$(CDPATH='' cd -- "$IN_DIR" && pwd -P)")"
  fi
  if [ ! -d "$parent" ]; then
    DIR_PROBLEM=no-parent
    return 1
  fi
  if [ -d "$IN_DIR" ]; then DIR_UNWRITABLE="$IN_DIR"; else DIR_UNWRITABLE="$parent"; fi
  if [ ! -w "$DIR_UNWRITABLE" ]; then
    DIR_PROBLEM=not-writable
    return 1
  fi
  if git -C "$parent" rev-parse --git-dir >/dev/null 2>&1; then
    set_dir_outer "$parent"
    DIR_PROBLEM=in-git
    return 1
  fi
  return 0
}

# set_dir_outer <folder>: DIR_OUTER is the top folder of the git project
# that holds <folder>, written the way <folder> was written. git gives its own
# path, with symbolic links resolved (on macOS /var is /private/var) and,
# in Git for Windows, as C:/...; in a message next to the folder the
# user gave, that reads as another place. So the path given is cut by
# the part git says lies below the top folder. Where the two do not line
# up (a symbolic link inside the project), git's own path is used.
set_dir_outer() {
  local f="$1" below top
  below="$(git -C "$f" rev-parse --show-prefix 2>/dev/null)" || below=""
  below="${below//$CR/}"
  below="${below%/}"
  top=""
  if [ -z "$below" ]; then
    top="$f"
  else
    case "$f" in
      */"$below") top="${f:0:$((${#f} - ${#below} - 1))}" ;;
    esac
  fi
  # A relative path (such as .) is shown from the folder the script runs
  # in, as the shell writes it.
  case "$top" in
    "" | /* | [A-Za-z]:*) ;;
    *) top="$(CDPATH='' cd -- "$top" 2>/dev/null && pwd)" || top="" ;;
  esac
  if [ -z "$top" ]; then
    top="$(git -C "$f" rev-parse --show-toplevel 2>/dev/null)" || top=""
    top="${top//$CR/}"
  fi
  DIR_OUTER="$top"
}

# dir_is_own_copy: the folder IN_DIR is the top folder of a git project
# whose origin is OWNER/NAME of this run (any host, any spelling of the
# address, capitals ignored): the copy of this project the setup made.
dir_is_own_copy() {
  local prefix url name rest
  [ -e "$IN_DIR/.git" ] || return 1
  prefix="$(git -C "$IN_DIR" rev-parse --show-prefix 2>/dev/null)" || return 1
  [ -z "$prefix" ] || return 1
  url="$(git -C "$IN_DIR" remote get-url origin 2>/dev/null)" || return 1
  url="${url//$CR/}"
  url="${url%/}"
  url="${url%.git}"
  url="${url//:/\/}"
  name="${url##*/}"
  rest="${url%/*}"
  rest="${rest##*/}"
  [ "$(lower "$rest/$name")" = "$(lower "$IN_OWNER/$IN_NAME")" ]
}

guide_dir() {
  case "$DIR_PROBLEM" in
    file) guide_dir_is_file ;;
    no-parent) guide_dir_no_parent ;;
    not-writable) guide_dir_not_writable ;;
    in-git) guide_dir_in_git ;;
    not-own-copy) guide_dir_not_own_copy ;;
    *) guide_dir_not_empty ;;
  esac
}

guide_dir_no_parent() {
  local parent
  parent="$(dirname -- "$IN_DIR")"
  guide_begin "The folder $parent, which would hold the folder $IN_DIR, does not exist." \
    "The script makes the folder for the copy of your project only inside a folder that is already there, so that a typing mistake in the path does not make folders in the wrong place."
  guide_step "Check the path for a typing mistake. To use another folder, start the script again and give it with --dir, followed by the folder, such as --dir ./my-new-project."
  guide_step "Or, if the path is right, make the folder $parent yourself (for example in your file manager); then come back to this window."
  guide_end "the script says \"Done. The folder is new or empty.\"" \
    "if you made the folder and the script still does not find it, check that its name and place match the path above letter for letter." \
    "it looks whether the folder $parent is there."
}

guide_dir_not_writable() {
  guide_begin "The script may not write in the folder $DIR_UNWRITABLE." \
    "The copy of your project is written there, and this computer does not let your account add files to that folder."
  guide_step "Choose a folder in your own home folder instead: start the script again and give it with --dir, such as --dir ~/my-new-project."
  guide_step "Or ask the person who manages this computer to let your account write in $DIR_UNWRITABLE; then come back to this window."
  guide_end "the script says \"Done. The folder is new or empty.\"" \
    "try to make a new file in that folder yourself; if this computer refuses that too, choose another folder." \
    "it asks this computer whether your account may write in that folder."
}

guide_dir_in_git() {
  guide_begin "The folder $IN_DIR is inside another project that git keeps track of${DIR_OUTER:+ (the one in $DIR_OUTER)}." \
    "The copy of your project keeps its own history with git. Inside another git project the two would get mixed up: the other project would see your project's files as its own."
  guide_step "Choose a folder outside that project: start the script again and give it with --dir, such as --dir ~/my-new-project."
  guide_end "the script says \"Done. The folder is new or empty.\"" \
    "if you do not know where that other project starts, look for a hidden folder named .git in the folders above $IN_DIR; that project starts in the folder that holds it." \
    "it asks git whether the folder that would hold $IN_DIR belongs to a git project."
}

guide_dir_not_empty() {
  guide_begin "The folder $IN_DIR already has files in it." \
    "The script puts the copy of your project in a new or empty folder, so that it never mixes it with files that are already there, and it never deletes them."
  guide_step "Choose another folder: start the script again and give it with --dir, followed by a folder that is new or empty, such as --dir ./my-new-project."
  guide_step "Or, if the files in the folder are not needed, move them somewhere else yourself; then come back to this window."
  guide_step "If you are continuing a setup that stopped part way in this folder, start the script again with --resume added."
  guide_end "the script says \"Done. The folder is new or empty.\"" \
    "if the folder looks empty but the script still says it has files, it holds hidden files (their names start with a dot); show hidden files to find them." \
    "it looks inside the folder and counts what is there, hidden files included."
}

guide_dir_not_own_copy() {
  guide_begin "The folder $IN_DIR has files in it, but it is not a copy of the project $IN_OWNER/$IN_NAME." \
    "With --resume the script goes on in the copy of the project that it made on this computer, and it never changes a folder that holds anything else."
  guide_step "To go on in the copy of the project, give its folder as the top folder of the copy: start the script again and give it with --dir, followed by that folder, such as --dir ./$IN_NAME."
  guide_step "Or choose a folder that is new or empty: the script then makes a new copy of the project there."
  guide_end "the script says \"Done. The folder is a copy of the project $IN_OWNER/$IN_NAME\"." \
    "if you are sure the folder is the copy, check that it is the folder that holds the hidden folder .git, and that git there names $IN_OWNER/$IN_NAME as the place it was copied from." \
    "it asks git which GitHub project the folder was copied from."
}

guide_dir_is_file() {
  guide_begin "The chosen folder $IN_DIR is a file, not a folder." \
    "The copy of your project needs a folder of its own, and a file already has that name in that place."
  guide_step "Choose another folder: start the script again and give it with --dir, followed by a folder that is new or empty, such as --dir ./my-new-project."
  guide_step "Or rename or move the file yourself; then come back to this window."
  guide_end "the script says \"Done. The folder is new or empty.\"" \
    "if you cannot find the file, look for it in the folder where you started the script." \
    "it looks at what is at that place on this computer: nothing, an empty folder, or something else."
}

preflight_target_dir() {
  step_start "Checking the folder for the copy of your project: $IN_DIR"
  guided_check check_target_dir guide_dir
  step_end "$DIR_DONE"
}

# ---------- preflight: checks on GitHub ----------
# After the checks of this computer, with the same guided loop: gh is
# signed in (which also gives the defaults for the owner and product
# owner name, and the permissions gh has) and this is the current
# published version of the script, both before the first question. After
# the questions, which give the visibility, the owner and the name: gh
# has the permissions the setup needs, OWNER/NAME does not exist yet, and
# GitHub knows the licence chosen.
#
# Every GitHub call goes through api_call (gh api -i), so an error is read
# from the HTTP status and the message in the answer's JSON body, not
# from gh's own error text, which is not stable (spec, "Ease-of-use
# requirements"). Without an answer, gh's exit code tells "not signed
# in" (4, gh's documented code for it) from "GitHub not reached". An
# answer that has no guide stops through api_fail: a plain message, the
# next action, the command to start again, and the raw text below it for
# support (exit 1).

BOOTSTRAPPER=factoincognito/ai-project-bootstrap

# GH_GIT_QUESTION_TEXT: gh's question, written once. gh auth login and
# gh auth refresh both ask it (default Yes) before the one-time code,
# unless gh already signs git in to GitHub (gh v2.93.0,
# pkg/cmd/auth/shared/git_credential.go); Yes makes gh git's sign-in for
# GitHub. GH_GIT_QUESTION_STEP is the step every guide that has the user
# run one of them gives right after the command, so the guides cannot
# drift apart; a stop message that names one gives the answer in a
# clause built from GH_GIT_QUESTION_TEXT.
GH_GIT_QUESTION_TEXT='Authenticate Git with your GitHub credentials?'
GH_GIT_QUESTION_STEP="If gh asks \"$GH_GIT_QUESTION_TEXT\", answer Yes: type y and press Enter, or just press Enter."
# GH_SIGN_IN_FIRST_STEP: the step every guide that has the user enter
# gh's one-time code on GitHub's device page gives before the step with
# the code. On a browser not signed in to GitHub, the page first asks
# for the GitHub sign-in (end-to-end run 2 repeated, r2h).
GH_SIGN_IN_FIRST_STEP="If your browser is not signed in to GitHub, GitHub first asks you to sign in: your user name or email address, your password, and a two-factor code if you use one. Then it shows the page for the code."
SIGN_IN_COMMAND_NEXT="Sign in to GitHub with gh as in step 0 of the README, with the command gh auth login -h github.com -p https -w -s workflow (if gh asks \"$GH_GIT_QUESTION_TEXT\", answer Yes), then start the script again."
SIGN_IN_CONTINUE_NEXT="Sign in to GitHub with gh as in step 0 of the README, with the command gh auth login -h github.com -p https -w -s workflow (if gh asks \"$GH_GIT_QUESTION_TEXT\", answer Yes), then continue the setup with the command shown above."

API_RC=0 API_STATUS="" API_HEADERS="" API_BODY="" API_BODY_CR="" API_MESSAGE="" API_ERR="" API_RAW=""

# api_call <args...>: runs gh api -i <args> and reads its answer: API_RC
# (gh's exit code), API_STATUS (the HTTP status; empty when no answer
# came), API_HEADERS (one "Name: value" per line), API_BODY, API_MESSAGE
# (the "message" of a JSON body, as GitHub sends with an error) and
# API_ERR (gh's own error text). Carriage returns are removed. Called as
# API_KEEP_CR=1 api_call ..., it also fills API_BODY_CR: the body with
# its carriage returns kept, for the check of a file's line endings as
# GitHub stores it (S18a). Only on request: building the body twice
# costs seconds on a big answer, such as the script's own file.
api_call() {
  local out err line raw part=status keep="${API_KEEP_CR:-}"
  out="$(make_temp)"
  err="$(make_temp)"
  API_RC=0
  run_gh --to "$out" "$err" api -i "$@" || API_RC=$?
  API_STATUS="" API_HEADERS="" API_BODY="" API_BODY_CR="" API_MESSAGE=""
  API_ERR="$(tr -d '\r' <"$err")"
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="${raw//$CR/}"
    case "$part" in
      status)
        case "$line" in
          HTTP/*)
            API_STATUS="${line#* }"
            API_STATUS="${API_STATUS%% *}"
            part=headers
            ;;
          *)
            part=body
            API_BODY="$line$NL"
            [ -z "$keep" ] || API_BODY_CR="$raw$NL"
            ;;
        esac
        ;;
      headers)
        if [ -z "$line" ]; then part=body; else API_HEADERS="$API_HEADERS$line$NL"; fi
        ;;
      *)
        API_BODY="$API_BODY$line$NL"
        [ -z "$keep" ] || API_BODY_CR="$API_BODY_CR$raw$NL"
        ;;
    esac
  done <"$out"
  rm -f "$out" "$err"
  case "$API_STATUS" in
    [0-9][0-9][0-9]) ;;
    *) API_STATUS="" ;;
  esac
  case "$API_BODY" in
    *"${DQ}message${DQ}"*)
      API_MESSAGE="${API_BODY#*"${DQ}"message"${DQ}"}"
      API_MESSAGE="${API_MESSAGE#*:}"
      trim_into "$API_MESSAGE"
      API_MESSAGE="${TRIMMED#"$DQ"}"
      API_MESSAGE="${API_MESSAGE%%"$DQ"*}"
      ;;
  esac
}

# api_raw: API_RAW is the raw text of the last answer, for support: the
# HTTP status and GitHub's message, then gh's own error text.
api_raw() {
  API_RAW=""
  [ -z "$API_STATUS" ] || API_RAW="HTTP $API_STATUS: ${API_MESSAGE:-(no message)}"
  [ -z "$API_ERR" ] || API_RAW="${API_RAW:+$API_RAW$NL}$API_ERR"
  [ -n "$API_RAW" ] || API_RAW="gh stopped with exit code $API_RC and no message."
}

# stop_with_error <what happened> <what to do next> <raw text>: a GitHub
# check or step that cannot go on: the command to start again (or, once
# the project exists, to continue the setup), then the error (exit 1).
stop_with_error() {
  shown_command
  if [ -n "$CREATED_NOTE" ]; then say "$CONTINUE_INTRO"; else say "$START_AGAIN_INTRO"; fi
  say_shown_command
  fail "${STOP_CODE:-1}" "${1:-Something unexpected happened.}${CREATED_NOTE:+ $CREATED_NOTE}" "$2" "$3"
}

# api_fail <what the script was doing, as "read your GitHub account">
# [next action for a 404]: stops with the plain message for the last
# answer (exit 1). What a 404 means depends on the call, so each call
# that can get one gives its own next action (#149 review, finding 3).
# A status with no arm of its own is "Something unexpected happened"
# with what the script was doing (#150 review, finding 1). Once the
# project exists, the next action is to continue the setup with the
# command shown, never to start again (#150 review, finding 2).
api_fail() {
  local doing="$1" not_found_next="${2:-}" what="" next="" again="start the script again" sign_in="$SIGN_IN_COMMAND_NEXT"
  if [ -n "$CREATED_NOTE" ]; then
    again="continue the setup with the command shown above"
    sign_in="$SIGN_IN_CONTINUE_NEXT"
  fi
  case "$API_STATUS" in
    "")
      if [ "$API_RC" -eq 4 ]; then
        what="gh (the GitHub command-line tool) is not signed in to your GitHub account, so the script could not $doing."
        next="$sign_in"
      else
        what="The script could not reach GitHub to $doing."
        next="Check that this computer is connected to the internet, then $again."
      fi
      ;;
    401)
      what="GitHub no longer accepts the sign-in that gh has on this computer, so the script could not $doing."
      next="$sign_in"
      ;;
    403 | 429)
      # 429 is GitHub's answer for its secondary rate limit.
      case "$API_STATUS $(lower "$API_MESSAGE")" in
        429* | *"rate limit"*)
          what="GitHub has paused answering your account for a while, because it was asked too often, so the script could not $doing."
          next="Wait an hour, then $again."
          ;;
        *)
          what="GitHub refused to let the script $doing."
          next="Check that your GitHub account may do this; for an organisation, one of its owners may have to allow it. Then $again."
          ;;
      esac
      ;;
    404)
      what="GitHub did not find what the script needed to $doing."
      next="${not_found_next:-Wait a few minutes, then $again. If the same thing happens, ask for help and show the details below.}"
      ;;
    5[0-9][0-9])
      what="GitHub had a problem of its own, so the script could not $doing."
      next="Wait a few minutes, then $again; https://www.githubstatus.com shows whether GitHub has a known problem."
      ;;
    *)
      what="Something unexpected happened, so the script could not $doing."
      next="Wait a few minutes, then $again. If the same thing happens, ask for help and show the details below."
      ;;
  esac
  api_raw
  stop_with_error "$what" "$next" "$API_RAW"
}

# ---- signed in ----

# check_github_account: gh api -i user works. Sets GH_LOGIN and
# GH_PROFILE_NAME (empty when the profile has none), and GH_SCOPES (the
# X-OAuth-Scopes header without spaces, as repo,workflow) with
# GH_SCOPES_SEEN set when that header came (a fine-grained token sends
# none). ACCOUNT_PROBLEM: signed-out (gh's exit 4), expired (401),
# offline (no answer) or other.
GH_LOGIN=""
GH_PROFILE_NAME=""
GH_SCOPES=""
GH_SCOPES_SEEN=""
ACCOUNT_PROBLEM=""
check_github_account() {
  local rest h
  ACCOUNT_PROBLEM=""
  api_call user --jq '.login, (.name // "")'
  if [ "$API_RC" -ne 0 ] || [ "$API_STATUS" != 200 ]; then
    case "$API_STATUS" in
      "") if [ "$API_RC" -eq 4 ]; then ACCOUNT_PROBLEM=signed-out; else ACCOUNT_PROBLEM=offline; fi ;;
      401) ACCOUNT_PROBLEM=expired ;;
      *) ACCOUNT_PROBLEM=other ;;
    esac
    return 1
  fi
  GH_LOGIN="${API_BODY%%"$NL"*}"
  rest="${API_BODY#*"$NL"}"
  GH_PROFILE_NAME="${rest%%"$NL"*}"
  if [ -z "$GH_LOGIN" ]; then
    ACCOUNT_PROBLEM=other
    return 1
  fi
  GH_SCOPES=""
  GH_SCOPES_SEEN=""
  while IFS= read -r h; do
    [ -n "$h" ] || continue
    if [ "$(lower "${h%%:*}")" = x-oauth-scopes ]; then
      GH_SCOPES_SEEN=1
      GH_SCOPES="${h#*:}"
      GH_SCOPES="${GH_SCOPES// /}"
    fi
  done <<<"$API_HEADERS"
}

guide_github_account() {
  case "$ACCOUNT_PROBLEM" in
    other) api_fail "read your GitHub account" ;;
    offline)
      guide_github_offline
      return 0
      ;;
    expired)
      guide_begin "GitHub no longer accepts the sign-in that gh (the GitHub command-line tool) has on this computer." \
        "The script works on GitHub as you, through gh, and GitHub no longer accepts that sign-in: it may have run out or been withdrawn."
      ;;
    *)
      guide_begin "gh (the GitHub command-line tool) is not signed in to your GitHub account." \
        "The script works on GitHub as you, through gh, so gh has to be signed in to your account."
      ;;
  esac
  guide_step "Open a second terminal window and run this command there; it is the sign-in command from step 0 of the README:"
  say_command "gh auth login -h github.com -p https -w -s workflow"
  guide_step "$GH_GIT_QUESTION_STEP"
  guide_step "gh shows a one-time code (eight letters and digits, such as ABCD-1234) and asks you to press Enter: copy the code, then press Enter. Your browser opens GitHub's device page."
  guide_step "$GH_SIGN_IN_FIRST_STEP"
  guide_step "On the page for the code, paste the code, click Continue, then approve with the green Authorize button."
  guide_step "Come back to this window."
  guide_end "gh says \"Logged in as\" with your account name, and the script says \"Done. gh is signed in to GitHub as\" with your account name." \
    "if the browser does not open, open https://github.com/login/device yourself and type the code there." \
    "it asks GitHub which account gh is signed in to (gh api user), which works only when gh is signed in."
  api_raw
  guide_details "$API_RAW"
}

guide_github_offline() {
  guide_begin "The script could not reach GitHub." \
    "The script checks your GitHub account and creates your project there, so this computer has to reach GitHub over the internet."
  guide_step "Check that this computer is connected to the internet: open https://github.com in your browser."
  guide_step "If GitHub opens in the browser but the script still cannot reach it, open https://www.githubstatus.com to see whether GitHub has a known problem, and wait until it is solved."
  guide_step "Come back to this window."
  guide_end "the script says \"Done. gh is signed in to GitHub as\" with your account name." \
    "if you are on an office or school network, ask the person who manages it whether it lets gh reach GitHub." \
    "it asks GitHub which account gh is signed in to, which needs a connection to GitHub."
  api_raw
  guide_details "$API_RAW"
}

preflight_github_account() {
  step_start "Checking that gh is signed in to GitHub"
  guided_check check_github_account guide_github_account
  step_end "gh is signed in to GitHub as $GH_LOGIN."
}

# need_github_account: the account, read once. cmd_setup reads it before
# the questions; this is for an input default asked for without it.
need_github_account() {
  [ -n "$GH_LOGIN" ] || preflight_github_account
}

# ---- the current version of this script ----

# read_published_version <text of CHANGELOG.md>: PUBLISHED_VERSION is the
# version the bootstrapper's CHANGELOG.md was stamped with: the text
# before ", built from" (its "Project created" entry reads "<version>,
# built from <template>@<commit>."). Returns 1 when there is none. The
# unstamped stub in the template holds the same placeholder as the
# unstamped script, so the two match there; the build stamps both.
PUBLISHED_VERSION=""
read_published_version() {
  local line
  PUBLISHED_VERSION=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//$CR/}"
    case "$line" in
      *", built from"*)
        trim_into "${line%%, built from*}"
        PUBLISHED_VERSION="$TRIMMED"
        [ -z "$PUBLISHED_VERSION" ] || return 0
        ;;
    esac
  done <<<"$1"
  return 1
}

# check_published_version: the bootstrapper's CHANGELOG.md on GitHub (its
# default branch, which "gh repo create --template" copies) names the
# version this script was stamped with. VERSION_PROBLEM: old, unreadable
# (no version in it) or api.
VERSION_PROBLEM=""
check_published_version() {
  VERSION_PROBLEM=""
  api_call -H "Accept: application/vnd.github.raw+json" "repos/$BOOTSTRAPPER/contents/CHANGELOG.md"
  if [ "$API_RC" -ne 0 ] || [ "$API_STATUS" != 200 ]; then
    VERSION_PROBLEM=api
    return 1
  fi
  if ! read_published_version "$API_BODY"; then
    VERSION_PROBLEM=unreadable
    return 1
  fi
  [ "$PUBLISHED_VERSION" = "$SCRIPT_VERSION" ] && return 0
  VERSION_PROBLEM=old
  return 1
}

guide_published_version() {
  case "$VERSION_PROBLEM" in
    old) guide_old_script ;;
    unreadable)
      stop_with_error "The bootstrapper's CHANGELOG.md file on GitHub does not say which version is current, so the script cannot check that it is the current version." \
        "Start the script again later. If the same thing happens, report it to the bootstrapper's maintainers and show them the details below." \
        "No line with \", built from\" in $BOOTSTRAPPER CHANGELOG.md. Its first lines:$NL$(sed -n 1,5p <<<"$API_BODY")"
      ;;
    *)
      api_fail "read the current version of the bootstrapper" \
        "Download the script again with the command from the README, then start it. If the same thing happens, report it to the bootstrapper's maintainers and show them the details below."
      ;;
  esac
}

# guide_old_script: a re-check in this run cannot change the script that
# runs, so it stops (NO_RECHECK), and the command to start again runs the
# downloaded copy in this folder with the same options.
guide_old_script() {
  guide_begin "This copy of the script is not the current version: it is $SCRIPT_VERSION, and the current one is $PUBLISHED_VERSION." \
    "GitHub always copies the current files of the bootstrapper into a new project, so only the current version of the script fits them."
  guide_step "Download the current version into this folder with this command; it replaces the file bootstrap-project.sh here:"
  say_command 'gh api repos/factoincognito/ai-project-bootstrap/contents/bootstrap-project.sh -H "Accept: application/vnd.github.raw+json" > bootstrap-project.sh'
  guide_step "Start the new copy with the command shown below; it asks again for any answer you did not give as an option."
  guide_end "the new copy says \"Done. This is the current version of the script\" and goes on." \
    "if the download command says that gh is not signed in, sign in as in step 0 of the README, then download again." \
    "it reads the version written in the bootstrapper's CHANGELOG.md file on GitHub and compares it with its own. It cannot check again in this run, so it stops here."
  NO_RECHECK=1
  RESTART_CMD="bootstrap-project.sh$RESTART_ARGS"
  RESTART_SCRIPT=bootstrap-project.sh
  # The new copy reads its saved answers from its own folder, the one the
  # download command writes it to: this folder. They are saved only when
  # this script runs from it too.
  if [ -n "$AGAIN_DIR" ] && [ "$(CDPATH='' cd -- "$AGAIN_DIR" 2>/dev/null && pwd -P)" != "$(pwd -P)" ]; then AGAIN_DIR=""; fi
}

preflight_published_version() {
  step_start "Checking that this is the current version of the script"
  guided_check check_published_version guide_published_version
  step_end "This is the current version of the script ($SCRIPT_VERSION)."
}

# ---- the permissions gh has ----

# check_github_permissions: gh has what the setup needs (from a fresh
# read of the account, so a refresh shows at once): workflow, because the
# setup changes the file that runs the project's checks, and repo, or
# public_repo for a public project. PERM_MISSING lists what is missing.
# Without the X-OAuth-Scopes header (a fine-grained token) the
# permissions cannot be seen: it passes, and the step warns.
PERM_PROBLEM=""
PERM_MISSING=""
check_github_permissions() {
  PERM_PROBLEM=""
  PERM_MISSING=""
  if ! check_github_account; then
    PERM_PROBLEM=account
    return 1
  fi
  [ -n "$GH_SCOPES_SEEN" ] || return 0
  case ",$GH_SCOPES," in
    *,repo,*) ;;
    *,public_repo,*) [ "$IN_VISIBILITY" = public ] || PERM_MISSING=repo ;;
    *) if [ "$IN_VISIBILITY" = public ]; then PERM_MISSING=public_repo; else PERM_MISSING=repo; fi ;;
  esac
  case ",$GH_SCOPES," in
    *,workflow,*) ;;
    *) PERM_MISSING="${PERM_MISSING:+$PERM_MISSING }workflow" ;;
  esac
  [ -n "$PERM_MISSING" ] || return 0
  PERM_PROBLEM=missing
  return 1
}

guide_github_permissions() {
  local p list=""
  if [ "$PERM_PROBLEM" = account ]; then
    guide_github_account
    return 0
  fi
  for p in $PERM_MISSING; do
    case "$p" in
      workflow) p="workflow (to add and change the files that run your project's checks)" ;;
      repo) p="repo (to create your project and change its files)" ;;
      public_repo) p="public_repo (to create a public project and change its files)" ;;
    esac
    list="${list:+$list; }$p"
  done
  guide_begin "gh is signed in, but it does not have every permission on GitHub that the setup needs." \
    "GitHub gives gh each permission separately, and the setup needs these, which gh does not have yet: $list."
  if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
    # gh auth refresh cannot change a token from the environment, and a
    # new one is read only when the script starts again.
    guide_step "gh signs in with a key (a token) set in GH_TOKEN or GITHUB_TOKEN on this computer, so gh cannot ask GitHub for more permissions itself."
    guide_step "Open https://github.com/settings/tokens in your browser, make a new token (classic), and tick the boxes named after the permissions listed above."
    guide_step "Put the new token in GH_TOKEN (or GITHUB_TOKEN) in place of the old one, open a new terminal window, and start the script again there with the command shown below."
    guide_end "the script says \"Done. gh has the permissions on GitHub that the setup needs.\"" \
      "if you did not set GH_TOKEN or GITHUB_TOKEN yourself, ask the person who set up this computer." \
      "it asks GitHub which permissions gh has (gh api -i user). It cannot check again in this run, because the key is read when the script starts, so it stops here."
    NO_RECHECK=1
    return 0
  fi
  guide_step "Run this command; it asks GitHub to give gh the missing permissions:"
  case "$PERM_MISSING" in
    workflow)
      offered gh-refresh-workflow show
      OFFER=gh-refresh-workflow
      ;;
    public_repo*)
      offered gh-refresh-public show
      OFFER=gh-refresh-public
      ;;
    *)
      offered gh-refresh-repo show
      OFFER=gh-refresh-repo
      ;;
  esac
  guide_step "$GH_GIT_QUESTION_STEP"
  guide_step "gh shows a one-time code (eight letters and digits, such as ABCD-1234) and asks you to press Enter: copy the code, then press Enter."
  guide_step "Your browser opens https://github.com/login/device."
  guide_step "$GH_SIGN_IN_FIRST_STEP"
  guide_step "On the page for the code, paste the code, click Continue, then approve with the green Authorize button."
  guide_step "Come back to this window."
  guide_end "gh says that it is done, and the script says \"Done. gh has the permissions on GitHub that the setup needs.\"" \
    "if the browser does not open, open https://github.com/login/device yourself and type the code there." \
    "it asks GitHub which permissions gh has (gh api -i user)."
}

preflight_github_permissions() {
  step_start "Checking that gh has the permissions on GitHub that the setup needs"
  guided_check check_github_permissions guide_github_permissions
  if [ -n "$GH_SCOPES_SEEN" ]; then
    step_end "gh has the permissions on GitHub that the setup needs."
    return 0
  fi
  say_note "GitHub does not say which permissions this sign-in has, as with a fine-grained token (a key made on GitHub with chosen permissions)."
  say_note "The setup needs these permissions, each set to \"Read and write\": Administration, Contents, Workflows and Pull requests; and your account must be allowed to create repositories (new projects on GitHub)."
  say_note "If one of them is missing, a later step stops and says so."
  step_end "Carrying on without checking the permissions."
}

# ---- the project name is free ----

# check_project_absent: GitHub has no project OWNER/NAME (404). With
# --resume it is the other way round: the project must be there (200) and
# a 404 is PROJECT_PROBLEM=missing. PROJECT_PROBLEM: exists, missing, or
# api.
PROJECT_PROBLEM=""
PROJECT_DONE=""
check_project_absent() {
  PROJECT_PROBLEM=""
  # Each check starts again from what the user gave: the "start again"
  # choice of an earlier project-missing guide holds only until the next
  # answer (found, or a failure that says nothing about the project).
  FRESH_START=""
  api_call "repos/$IN_OWNER/$IN_NAME"
  case "$API_STATUS" in
    404)
      if [ -n "$OPT_RESUME" ]; then
        PROJECT_PROBLEM=missing
        return 1
      fi
      PROJECT_DONE="No project named $IN_OWNER/$IN_NAME exists on GitHub yet."
      return 0
      ;;
    200)
      if [ -n "$OPT_RESUME" ]; then
        PROJECT_DONE="The project $IN_OWNER/$IN_NAME exists on GitHub, which --resume allows."
        CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub."
        return 0
      fi
      PROJECT_PROBLEM=exists
      ;;
    *) PROJECT_PROBLEM=api ;;
  esac
  return 1
}

guide_project() {
  case "$PROJECT_PROBLEM" in
    exists) guide_project_exists ;;
    missing) guide_project_missing ;;
    *) api_fail "check whether the name $IN_OWNER/$IN_NAME is free on GitHub" ;;
  esac
}

guide_project_exists() {
  guide_begin "A project named $IN_OWNER/$IN_NAME already exists on GitHub." \
    "The setup creates a new project, and it never changes or deletes one that is already there."
  guide_step "To see it, open https://github.com/$IN_OWNER/$IN_NAME in your browser."
  guide_step "Choose another name: start the script again and give it with --name, such as --name $IN_NAME-2."
  guide_step "If you are continuing a setup of this project that stopped part way, start the script again with --resume added."
  guide_step "Or, if the project on GitHub is not needed, rename or delete it there yourself (in its Settings); then come back to this window."
  guide_end "the script says \"Done. No project named $IN_OWNER/$IN_NAME exists on GitHub yet.\"" \
    "if the page shows a project with another name, the project was renamed and GitHub still sends the old name to it; choose another name." \
    "it asks GitHub for a project at that address, and GitHub answers that there is none."
}

# guide_project_missing: --resume, but GitHub has no such project. Nothing
# is created: the command shown starts the setup without --resume.
guide_project_missing() {
  FRESH_START=1
  guide_begin "There is no project named $IN_OWNER/$IN_NAME on GitHub to continue." \
    "--resume continues a setup of a project that exists on GitHub, and the script never creates a project when it is asked to continue one."
  guide_step "Check the name and the owner for a typing mistake: they are the values after --name and --owner in the command shown below."
  guide_step "If the setup stopped before it created the project, or to set up a new project with this name, start the script again with the command shown below, which has no --resume."
  guide_end "the script says \"Done. The project $IN_OWNER/$IN_NAME exists on GitHub, which --resume allows.\" or, without --resume, creates the project." \
    "if the project is private, check that gh is signed in to the account that can see it." \
    "it asks GitHub for a project at that address, and GitHub answers that there is none."
}

preflight_project_absent() {
  if [ -n "$OPT_RESUME" ]; then
    step_start "Checking that the project $IN_OWNER/$IN_NAME is on GitHub"
  else
    step_start "Checking that the name $IN_OWNER/$IN_NAME is free on GitHub"
  fi
  guided_check check_project_absent guide_project
  step_end "$PROJECT_DONE"
}

# ---- the licence is one GitHub knows ----

# check_license_known: GitHub has a licence with the short name
# IN_LICENSE (gh api licenses/<key>: 200), so step 10 can add its text.
# A 404 means it has none (LICENSE_PROBLEM=unknown); any other answer is
# LICENSE_PROBLEM=api. GitHub's answer for an unknown key is from the
# REST licences doc, not run here.
LICENSE_PROBLEM=""
check_license_known() {
  LICENSE_PROBLEM=""
  api_call "licenses/$IN_LICENSE" --jq .key
  [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ] && return 0
  if [ "$API_STATUS" = 404 ]; then LICENSE_PROBLEM=unknown; else LICENSE_PROBLEM=api; fi
  return 1
}

# preflight_license: before anything is created, the licence chosen must
# be one GitHub knows (#154 review, finding 1); none and PolyForm
# Noncommercial (its text is in the bootstrapper's licenses/) need no
# call. As for every other input (S6): a licence given as an option that
# GitHub does not know stops with exit 2 and the options list, and one
# typed at the question is explained and asked again. Step 10 (add_licence)
# keeps its own handling of the 404 as a second line of defence.
GIVEN_LICENSE=""
preflight_license() {
  local problem
  case "$IN_LICENSE" in
    none | "$POLYFORM_KEY") return 0 ;;
  esac
  step_start "Checking that GitHub knows the licence $IN_LICENSE"
  while ! check_license_known; do
    [ "$LICENSE_PROBLEM" = unknown ] || api_fail "check the licence $IN_LICENSE with GitHub"
    problem="GitHub has no licence with the short name $IN_LICENSE. Use none, one of the listed licences, or the short name of a licence on https://choosealicense.com/licenses/ (each licence's page shows its short name, such as mit)."
    if [ -n "$GIVEN_LICENSE" ] || [ -n "$OPT_NON_INTERACTIVE" ]; then
      add_problem --license "$problem"
      stop_if_problems
    fi
    say_note "$problem $ASK_RETRY"
    ask_license
    case "$IN_LICENSE" in
      none | "$POLYFORM_KEY")
        step_end "Nothing to check with GitHub for the licence $IN_LICENSE."
        return 0
        ;;
    esac
  done
  step_end "GitHub knows the licence $IN_LICENSE."
}

# ---------- the plan, create and protect ----------
# The end of spec step 1 (the plan, and "Proceed?" unless --yes; a
# --dry-run stops after the plan), then step 2 (create the project from
# the bootstrapper and wait until GitHub has copied its files) and step 3
# (protect main straight away, then the merge settings). Nothing is
# created before the "Proceed?" answer. Once the project exists, every
# stop shows the command to continue with --resume (continue_after_create).

# The spec's protection body for step 3, field for field. Step 16 later
# adds the required check with a second PUT.
PROTECT_BODY='{"required_status_checks":null,"enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}'
# Waiting for the template's files: up to POLL_TRIES waits of POLL_DELAY
# seconds (60 s in all), retrying only on 404.
POLL_TRIES=30
POLL_DELAY=2
CREATED_NOTE=""
CREATE_ERR=""
PROTECT_PROBLEM=""

# pause_for <seconds>: waits, or hands the wait to $BOOTSTRAP_SLEEP.
pause_for() {
  "${BOOTSTRAP_SLEEP:-sleep}" "$1"
}

# plan_steps [state]: the six steps of the setup, in the words of the
# plan. A new setup (no state) shows them as they are, under the heading
# show_plan gives; --resume shows the
# same list, each step marked from RESUME_STATE (end-to-end run 1,
# finding 7), so the two lists cannot drift apart. (next) is the first
# step run_steps carries out in that state: template and fresh go on at
# the protection (fresh has its copy already); saved, sent and proposed go
# on in step 5, but sent and proposed first make a new copy when there is
# none (resume_copy); added only re-checks the protection, brings a copy
# that is there up to date, and reports (resume_added makes no copy).
plan_steps() {
  local state="${1:-}" marks="- - - - - -" m1 m2 m3 m4 m5 m6
  case "$state" in
    template) marks="done next - - - -" ;;
    fresh) marks="done next done - - -" ;;
    saved) marks="done done done done next -" ;;
    sent | proposed)
      if [ -n "$COPY_PRESENT" ]; then marks="done done done done next -"; else marks="done done next done - -"; fi
      ;;
    added)
      if [ -n "$COPY_PRESENT" ]; then marks="done done done done done next"; else marks="done done skipped done done next"; fi
      ;;
  esac
  # shellcheck disable=SC2086 # the marks are split into the six words on purpose
  set -- $marks
  step_mark "$1"
  m1="$STEP_MARK"
  step_mark "$2"
  m2="$STEP_MARK"
  # Past the protection with --allow-unprotected, the run that stopped may
  # have gone on without it.
  if [ "$2" = "done" ] && [ -n "$OPT_ALLOW_UNPROTECTED" ]; then m2=" (done, or skipped with --allow-unprotected)"; fi
  step_mark "$3"
  m3="$STEP_MARK"
  step_mark "$4"
  m4="$STEP_MARK"
  step_mark "$5"
  m5="$STEP_MARK"
  step_mark "$6"
  m6="$STEP_MARK"
  # show_plan gives a new setup's heading itself.
  [ -z "$state" ] || say_heading "The steps, in this order: (done) marks a step that is done already, and (next) the step the setup continues with."
  say "  1. Create the project on GitHub, with the bootstrapper's files in it.$m1"
  say "  2. Protect its main version, so that from then on every change comes as a proposed change, not straight into it.$m2"
  say "  3. Make a copy of the project on this computer, in $IN_DIR.$m3"
  if [ "$4" = "done" ]; then
    # Done in the run that stopped, with the licence chosen then, which
    # this run's answer need not be.
    say "  4. Add the language pack's files, fill in the project's names and description, and add the licence that was chosen, if one was.$m4"
  elif [ "$IN_LICENSE" = none ]; then
    say "  4. Add the language pack's files and fill in the project's names and description; no licence file is added, because you chose none.$m4"
  else
    say "  4. Add the language pack's files, fill in the project's names and description, and add the licence $IN_LICENSE.$m4"
  fi
  say "  5. Send these changes to GitHub as one proposed change, wait for the project's checks to pass, then add the change to the main version.$m5"
  say "  6. Show what was made, and the one thing to do next.$m6"
}

# step_mark <done|next|skipped|->: STEP_MARK is the text put after a step.
STEP_MARK=""
step_mark() {
  case "$1" in
    done) STEP_MARK=" (done)" ;;
    next) STEP_MARK=" (next)" ;;
    skipped) STEP_MARK=" (skipped: the script makes no copy of a project that is set up already)" ;;
    *) STEP_MARK="" ;;
  esac
}

# duration_words <seconds>: DURATION is the time in words, such as
# "1 minute 15 seconds" or "20 minutes".
duration_words() {
  local m=$(($1 / 60)) s=$(($1 % 60)) mw="minutes" sw="seconds"
  [ "$m" -ne 1 ] || mw="minute"
  [ "$s" -ne 1 ] || sw="second"
  if [ "$m" -eq 0 ]; then
    DURATION="$s $sw"
  elif [ "$s" -eq 0 ]; then
    DURATION="$m $mw"
  else
    DURATION="$m $mw $s $sw"
  fi
}

# stdout_is_terminal: true when the output goes to a terminal, or
# BOOTSTRAP_STDOUT_TERMINAL says yes (the tests' stand-in for one).
stdout_is_terminal() {
  case "${BOOTSTRAP_STDOUT_TERMINAL:-}" in
    yes) return 0 ;;
    no) return 1 ;;
  esac
  [ -t 1 ]
}

show_plan() {
  local vis licence deploy=""
  if [ "$IN_VISIBILITY" = private ]; then
    vis="private (only you and the people you invite can see it)"
  else
    vis="public (anyone can see it and its code)"
  fi
  if [ "$IN_LICENSE" = none ]; then
    licence="none (no licence file, so nobody else may copy, change or share the code)"
  else
    licence="$IN_LICENSE, in the name of $IN_COPYRIGHT_HOLDER"
  fi
  [ "$IN_WITH_DEPLOY" != yes ] || deploy=", with the files that publish the website"
  say_heading "Here is the plan. Nothing has been created yet."
  say "The project:"
  say "    On GitHub: $IN_OWNER/$IN_NAME, $vis"
  say "    Its page: https://github.com/$IN_OWNER/$IN_NAME"
  say "    Display name: $IN_PROJECT_NAME"
  say "    Description: $IN_DESCRIPTION"
  say "    Product owner: $IN_PO_NAME"
  say "    Language pack: $IN_PACK$deploy"
  say "    Licence: $licence"
  say "    Copy on this computer: $IN_DIR"
  say "    Your name and email for git: $IN_GIT_NAME, $IN_GIT_EMAIL"
  duration_words $((IN_CI_TIMEOUT * 60))
  say "    Waiting for the project's checks: at most $DURATION; if build has not passed by then, the script stops, leaves the proposed change open and shows how to continue (--ci-timeout sets a different limit)"
  say "The steps, in this order:"
  plan_steps
  # Step 4 adds no licence: the warning step 10 gives, before anything
  # is created.
  if [ "$IN_LICENSE" = none ] && [ "$IN_VISIBILITY" != private ]; then
    say "$NO_LICENCE_WARNING"
  fi
  if [ "$IN_VISIBILITY" = private ]; then
    # Spec, "Private repo, no protection possible": the plan cannot be
    # read before creating (it needs a permission gh lacks), so it warns.
    say "Warning: protection for a private project needs a paid GitHub plan (Pro, Team or Enterprise); on the free plan GitHub protects only public projects. The script cannot see your plan before it creates the project, so on the free plan it stops right after creating it and shows what you can do then: upgrade the plan, make the project public, or carry on without protection."
  fi
}

# confirm_plan: "Proceed?", unless --yes. The default is no, because it
# is the safe answer: a stray Enter must create or change nothing, and
# the explanation says so. A no stops with nothing created (exit 1), like
# every other stop: it saves the answers and shows the command to start
# again, or to continue with --resume (end-to-end run 3, r3d: an Enter
# by accident would otherwise mean typing every answer again).
# --non-interactive without --yes never gets here: cmd_setup refuses it
# with the other option problems. Keys typed during the checks before it
# are discarded (discard_typeahead, finding r1f): the answer is one typed
# after the plan was shown.
confirm_plan() {
  [ -z "$OPT_YES" ] || return 0
  discard_typeahead
  if [ -n "$OPT_RESUME" ]; then
    prompt_for check_yes_no \
      "If you answer yes, the script continues the setup as described above; if you answer no, it stops and changes nothing. Pressing Enter alone answers no, so nothing is changed by accident; type yes to go on." \
      "Proceed? (yes or no)" no
    [ "$CHECKED" != yes ] || return 0
    shown_command
    say "$CONTINUE_INTRO"
    say_shown_command
    fail 1 "You answered no, so the script stopped, and nothing was changed." \
      "Run the command shown to continue the setup, and answer yes."
  fi
  prompt_for check_yes_no \
    "If you answer yes, the script creates the project on GitHub and carries out the plan above; if you answer no, it stops and creates nothing. Pressing Enter alone answers no, so nothing is created by accident; type yes to go on." \
    "Proceed? (yes or no)" no
  [ "$CHECKED" != yes ] || return 0
  shown_command
  say "$START_AGAIN_INTRO"
  say_shown_command
  fail 1 "You answered no, so the script stopped, and nothing was created." \
    "Run the command shown to start again, and answer yes."
}

# show_advance_command: after the yes (or --yes) and before the first
# change on GitHub, the command to continue the setup, with --resume and
# every answer, shown once. A stop that runs no trap (end-to-end run 1,
# finding 6: Ctrl-C while gh ran, in Git Bash on Windows, showed no stop
# message at all) still leaves the user this command. Before the project
# exists, --resume refuses to create it and shows the command to start
# again (guide_project_missing), so this command is safe at any stop.
show_advance_command() {
  local was="$OPT_RESUME"
  OPT_RESUME=1
  shown_command
  OPT_RESUME="$was"
  say "$ADVANCE_INTRO"
  say_shown_command
  [ -n "$OPT_RESUME" ] || say_note "If the project was not created yet, that command says so and shows the command to start again."
  # The log that follows comes after one blank line (#248 review, N3).
  LOG_GAP=1
}

# continue_after_create: the project exists now. From here on, the
# command shown at a stop continues the setup (shown_command adds
# --resume), and the stop says what exists.
continue_after_create() {
  CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, with only the bootstrapper's files in it."
}

# create_project: spec step 2, gh repo create from the bootstrapper. gh
# repo create gives no HTTP status, so a failure is read from gh's exit
# code, then from GitHub itself (does the project exist now?), and only
# the two cases the spec guides at this step are told apart by gh's
# text: the name is taken, or the account may not create it.
create_project() {
  local out err rc=0
  step_start "Creating the project $IN_OWNER/$IN_NAME on GitHub"
  out="$(make_temp)"
  err="$(make_temp)"
  run_gh --to "$out" "$err" repo create "$IN_OWNER/$IN_NAME" --template "$BOOTSTRAPPER" "--$IN_VISIBILITY" --description "$IN_DESCRIPTION" || rc=$?
  CREATE_ERR="$(tr -d '\r' <"$err")"
  rm -f "$out" "$err"
  if [ "$rc" -eq 0 ]; then
    continue_after_create
    step_end "The project $IN_OWNER/$IN_NAME was created: https://github.com/$IN_OWNER/$IN_NAME"
    return 0
  fi
  [ -n "$CREATE_ERR" ] || CREATE_ERR="gh stopped with exit code $rc and no message."
  if [ "$rc" -eq 4 ]; then
    stop_with_error "gh (the GitHub command-line tool) is not signed in to your GitHub account, so the script could not create the project. Nothing was created." \
      "$SIGN_IN_COMMAND_NEXT" "$CREATE_ERR"
  fi
  case "$(lower "$CREATE_ERR")" in
    *"already exists"*)
      guide_create_taken
      stop_at_guide
      ;;
    *"rate limit"* | *"http 429"*)
      # GitHub's rate limit says to wait; it does not mean the account may
      # not create projects, and nothing was created.
      stop_with_error "GitHub has paused answering your account for a while, because it was asked too often, so the script could not create the project. Nothing was created." \
        "Wait an hour, then start the script again with the command shown above." "$CREATE_ERR"
      ;;
    *"not accessible"* | *permission* | *forbidden* | *"http 403"*)
      guide_create_refused
      stop_at_guide
      ;;
  esac
  api_call "repos/$IN_OWNER/$IN_NAME"
  if [ "$API_STATUS" = 200 ]; then
    continue_after_create
    stop_with_error "gh (the GitHub command-line tool) reported an error while it created the project." \
      "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$CREATE_ERR"
  fi
  stop_with_error "gh (the GitHub command-line tool) could not create the project $IN_OWNER/$IN_NAME on GitHub." \
    "Open https://github.com/$IN_OWNER/$IN_NAME in your browser. If the project is not there, start the script again with the command shown above; if it is there, add --resume to that command. If the same thing happens again, ask for help and show the details below." \
    "$CREATE_ERR"
}

# guide_create_taken: the name check saw no project, but GitHub says the
# name is taken (#149 review, finding 7): most likely a private project
# the account cannot see. Nothing exists, so it is a plain new run.
guide_create_taken() {
  guide_begin "GitHub says that a project named $IN_OWNER/$IN_NAME already exists." \
    "The setup creates a new project, and GitHub gives each name to one project only. The check before could not see this one, so it is probably a private project that your account cannot see."
  guide_step "Choose another name: start the script again with the command shown below, with the name after --name changed (or --name and a new name added), such as --name $IN_NAME-2."
  guide_step "If the project is yours, sign in to GitHub in your browser with the account that owns it and open https://github.com/$IN_OWNER/$IN_NAME to see it."
  guide_end "the script says \"Done. The project\" with the new name and \"was created\"." \
    "if you do not know who owns the name, choose another one." \
    "it asks GitHub to create the project, and GitHub answers whether the name is free. It cannot check again in this run, so it stops here."
  guide_details "$CREATE_ERR"
}

# guide_create_refused: the account, or the key gh signs in with, may not
# create the project (spec, "Failed at create, step 2"). It keeps the
# promise of the fine-grained token warning: this step says so.
guide_create_refused() {
  guide_begin "GitHub did not let your account create the project $IN_OWNER/$IN_NAME." \
    "The setup starts by creating the project on GitHub, and GitHub refused: the account or the key that gh signs in with may not create projects there."
  if [ "$IN_OWNER" != "$GH_LOGIN" ]; then
    guide_step "The project would belong to the organisation $IN_OWNER. Ask one of its owners to let members create projects (on GitHub, in the organisation's Settings, under Member privileges), or to give you a role that may."
  fi
  if [ -z "$GH_SCOPES_SEEN" ]; then
    guide_step "gh signs in with a fine-grained token (a key made on GitHub with chosen permissions). Open https://github.com/settings/personal-access-tokens, edit that token, give it access to All repositories (every project of the account), and set Administration, Contents, Workflows and Pull requests to \"Read and write\"."
  fi
  guide_step "To see GitHub's own reason, open https://github.com/new in your browser and try to create a project for $IN_OWNER there."
  guide_step "Then start the script again with the command shown below."
  guide_end "the script says \"Done. The project $IN_OWNER/$IN_NAME was created\"." \
    "ask the person who manages your GitHub account or organisation, and show them the details below." \
    "it asks GitHub to create the project, and GitHub answers whether your account may. It cannot check again in this run, so it stops here."
  guide_details "$CREATE_ERR"
}

# wait_for_files: GitHub can copy the template's files after the project
# exists, so main and CHANGELOG.md are read until both are there,
# retrying only on 404, for up to POLL_TRIES waits of POLL_DELAY seconds.
wait_for_files() {
  local tries=0 what
  step_start "Waiting for GitHub to put the bootstrapper's files into the project"
  for what in branches/main contents/CHANGELOG.md; do
    while :; do
      api_call "repos/$IN_OWNER/$IN_NAME/$what"
      if [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; then
        break
      fi
      [ "$API_STATUS" = 404 ] || api_fail "check that the project's files are there"
      if [ "$tries" -ge "$POLL_TRIES" ]; then
        api_raw
        stop_with_error "GitHub has not finished putting the bootstrapper's files into the project $IN_OWNER/$IN_NAME after a minute." \
          "Wait a few minutes, then continue the setup with the command shown above; https://www.githubstatus.com shows whether GitHub has a known problem." \
          "$API_RAW"
      fi
      [ "$tries" -gt 0 ] || say "GitHub is still copying the files; the script checks again every $POLL_DELAY seconds, for up to a minute."
      tries=$((tries + 1))
      pause_for "$POLL_DELAY"
    done
  done
  step_end "The project's files are there."
}

# protect_main: spec step 3, straight after the files are there. A 403 is
# told apart by GitHub's message (the spec: not by the status alone): the
# plan (a private project on a plan without protection) or the key's
# permission; one that fits neither gets both explanations. Each stops at
# once with its guide, before anything else changes.
# classify_protect_403: PROTECT_PROBLEM for GitHub's 403 on the protection
# (empty for a rate limit, which is told apart at once).
classify_protect_403() {
  case "$(lower "$API_MESSAGE")" in
    *"rate limit"*) PROTECT_PROBLEM="" ;;
    *upgrade* | *"github pro"*) PROTECT_PROBLEM=plan ;;
    *"not accessible"* | *"access token"* | *integration*) PROTECT_PROBLEM=token ;;
    *) PROTECT_PROBLEM=unknown ;;
  esac
}

# VISIBILITY_FROM_GITHUB: IN_VISIBILITY was read from GitHub in this run
# (--resume reads it first; the first run reads it when it needs it).
VISIBILITY_FROM_GITHUB=""
# PROTECT_PRIVATE: the refusal does not say why, and GitHub says the project
# is private.
PROTECT_PRIVATE=""

# private_on_github: GitHub says the project is private (read once; the
# answer of the call before it, API_*, stays as it was). A call that fails
# counts as not private: the options below are offered only on a fact.
private_on_github() {
  local rc status headers body message err
  if [ -z "$VISIBILITY_FROM_GITHUB" ]; then
    rc="$API_RC" status="$API_STATUS" headers="$API_HEADERS" body="$API_BODY" message="$API_MESSAGE" err="$API_ERR"
    api_call "repos/$IN_OWNER/$IN_NAME" --jq .private
    if [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; then
      trim_into "$API_BODY"
      case "$TRIMMED" in
        true)
          IN_VISIBILITY=private
          VISIBILITY_FROM_GITHUB=1
          ;;
        false)
          IN_VISIBILITY=public
          VISIBILITY_FROM_GITHUB=1
          ;;
      esac
    fi
    API_RC="$rc" API_STATUS="$status" API_HEADERS="$headers" API_BODY="$body" API_MESSAGE="$message" API_ERR="$err"
  fi
  [ -n "$VISIBILITY_FROM_GITHUB" ] && [ "$IN_VISIBILITY" = private ]
}

# plan_limit_on_private: PROTECT_PROBLEM is the plan and GitHub says the
# project is private: the one refusal that --allow-unprotected, and
# making the project public, answer. A message that does not say why, or
# a public project, is the key's permission as far as anyone can tell.
plan_limit_on_private() {
  [ "$PROTECT_PROBLEM" = plan ] && private_on_github
}

protect_main() {
  step_start "Protecting the main version of the project"
  api_call -X PUT "repos/$IN_OWNER/$IN_NAME/branches/main/protection" --input - <<<"$PROTECT_BODY"
  if [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; then
    step_end "Its main version is protected: from now on every change comes as a proposed change, not straight into it."
    return 0
  fi
  if [ "$API_STATUS" = 403 ]; then
    classify_protect_403
    if [ -n "$PROTECT_PROBLEM" ]; then
      # A plan message on a project that is not private says nothing
      # about the plan.
      if [ "$PROTECT_PROBLEM" = plan ] && ! private_on_github; then PROTECT_PROBLEM=unknown; fi
      # A refusal that does not say why, on a private project, gets both
      # explanations (still not the option).
      PROTECT_PRIVATE=""
      if [ "$PROTECT_PROBLEM" = unknown ] && private_on_github; then PROTECT_PRIVATE=1; fi
      # --allow-unprotected is for a plan that cannot protect a private
      # project; a key without the permission, or a refusal that does not
      # say why, is another problem, and still stops.
      if [ -n "$OPT_ALLOW_UNPROTECTED" ] && [ "$PROTECT_PROBLEM" = plan ]; then
        UNPROTECTED=1
        api_raw
        say_note "GitHub does not protect the main version of this project on its plan; its answer is below."
        guide_details "$API_RAW"
        say_note "You chose to go on without protection with --allow-unprotected, so the script goes on, and writes that decision into the project's memory/decisions.md."
        step_end "Carrying on without protection: changes could go straight into the main version."
        return 0
      fi
      guide_protect
      offer_public
      stop_at_guide
    fi
  fi
  api_fail "protect the main version of the project" \
    "Open https://github.com/$IN_OWNER/$IN_NAME in your browser and check that the project has its files and that your account is one of its admins (who may change its settings); then continue the setup with the command shown above."
}

# UNPROTECTED: the setup goes on without protection (--allow-unprotected
# on a plan that cannot protect the project), and says so in the project.
UNPROTECTED=""

# offer_public: after the guide of a plan that cannot protect a private
# project, at a terminal only: the script offers to make the project
# public (the second way on). It runs only after its own yes typed at the
# terminal; --yes does not cover it and --non-interactive never asks.
offer_public() {
  local out err rc=0 raw
  [ "$PROTECT_PROBLEM" = plan ] || return 0
  [ "$IN_VISIBILITY" = private ] || return 0
  [ -z "$OPT_NON_INTERACTIVE" ] || return 0
  say_note "The script can make the project public for you, with the command shown above that starts with gh."
  ask_terminal "Making the project public lets anyone see it and its code, and it cannot be taken back by this script. It runs only if you type yes here; --yes does not cover it." \
    "Make the project public now? (yes or no)" || {
    say_log "Not made public."
    return 0
  }
  out="$(make_temp)"
  err="$(make_temp)"
  run_gh --to "$out" "$err" repo edit "$IN_OWNER/$IN_NAME" --visibility public --accept-visibility-change-consequences || rc=$?
  raw="$(cat "$out" "$err" | tr -d '\r')"
  rm -f "$out" "$err"
  if [ "$rc" -eq 0 ]; then
    IN_VISIBILITY=public
    say_note "The project $IN_OWNER/$IN_NAME is public now. Continue the setup with the command shown below."
    return 0
  fi
  [ -n "$raw" ] || raw="gh stopped with exit code $rc and no message."
  say_note "GitHub did not make the project public; its answer is below. Check on https://github.com/$IN_OWNER/$IN_NAME/settings that your account is one of the project's admins (who may change its settings), or run the command shown above that starts with gh yourself."
  guide_details "$raw"
}

# guide_protect: the 403 at step 3, by PROTECT_PROBLEM (plan, token or
# unknown). It cannot be fixed in this run, so it stops (spec: a
# post-create guide that does not retry); the three ways on for a plan
# without protection are those of the spec: upgrade the plan, make the
# project public (offer_public), or --resume --allow-unprotected.
guide_protect() {
  local title why
  case "$PROTECT_PROBLEM" in
    plan)
      title="GitHub cannot protect the main version of $IN_OWNER/$IN_NAME: protection for a private project needs a paid GitHub plan."
      why="Protection makes every change come as a proposed change, and GitHub offers it for private projects only on the Pro, Team and Enterprise plans."
      ;;
    token)
      title="GitHub did not let gh protect the main version of $IN_OWNER/$IN_NAME: the key that gh signs in with lacks a permission."
      why="Turning on protection needs the Administration permission set to \"Read and write\", and the fine-grained token (a key made on GitHub with chosen permissions) that gh signs in with does not have it."
      ;;
    *)
      title="GitHub refused to protect the main version of $IN_OWNER/$IN_NAME, and its message does not say why."
      if [ -n "$PROTECT_PRIVATE" ]; then
        why="Protection makes every change come as a proposed change. For a private project GitHub refuses it for one of two reasons, and the steps cover both: a plan without protection (it needs the Pro, Team or Enterprise plan), or a key that gh signs in with that lacks the Administration permission."
      else
        why="Protection makes every change come as a proposed change. The most likely cause is the key that gh signs in with: turning on protection needs its Administration permission set to \"Read and write\"."
      fi
      ;;
  esac
  guide_begin "$title" "$why"
  if [ "$PROTECT_PROBLEM" = plan ] || [ -n "$PROTECT_PRIVATE" ]; then
    guide_step "Upgrade your GitHub plan to Pro (or Team, for an organisation): open https://github.com/settings/billing, or the organisation's Settings and then Billing and plans. Then continue the setup with the command shown below."
    guide_step "Or make the project public, which needs no paid plan: anyone can then see the project and its code. This command does it; then continue the setup with the command shown below:"
    say_command "gh repo edit $IN_OWNER/$IN_NAME --visibility public --accept-visibility-change-consequences"
    if [ "$PROTECT_PROBLEM" = plan ]; then
      guide_step "Or carry on without protection: changes could then go straight into the main version, and the setup writes that decision into the project. Continue with this command:"
      shown_command_with_allow
      say_shown_command
    fi
  fi
  if [ "$PROTECT_PROBLEM" != plan ]; then
    guide_step "If gh signs in with a fine-grained token: open https://github.com/settings/personal-access-tokens in your browser, edit that token, and set Administration, Contents, Workflows and Pull requests to \"Read and write\"; for an organisation's project, one of its owners may have to approve the change. Then continue the setup with the command shown below."
  fi
  guide_end "the script says \"Done. Its main version is protected\" when you continue the setup." \
    "if you changed the plan or the token and still see this, wait a few minutes and continue again; if it goes on, ask for help and show the details below." \
    "it asks GitHub to turn on the protection, and GitHub answers whether it may. It cannot check again in this run, so it stops here."
  api_raw
  guide_details "$API_RAW"
}

# set_merge_settings: the end of step 3, gh repo edit: proposed changes
# are added as one change, and their line of work is deleted after.
set_merge_settings() {
  local out err rc=0 raw
  step_start "Setting how proposed changes are added to the project"
  out="$(make_temp)"
  err="$(make_temp)"
  run_gh --to "$out" "$err" repo edit "$IN_OWNER/$IN_NAME" --delete-branch-on-merge --enable-squash-merge || rc=$?
  raw="$(tr -d '\r' <"$err")"
  rm -f "$out" "$err"
  if [ "$rc" -ne 0 ]; then
    [ -n "$raw" ] || raw="gh stopped with exit code $rc and no message."
    stop_with_error "GitHub did not take the project's settings for adding proposed changes." \
      "Check on https://github.com/$IN_OWNER/$IN_NAME that your account is one of the project's admins (who may change its settings), then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  step_end "Each proposed change will be added as one change, and the line of work it was made on is deleted afterwards."
}

# ---- GitHub Actions turned on ----
# Right after step 3 (spec, post-create guides): GitHub Actions runs the
# project's checks, and an organisation or the project itself can turn
# it off. Then the setup's proposed change could never pass its checks,
# and the later wait for them would only run out of time. So the script
# asks GitHub first, before the copy on this computer and the push.
# The answer relied on (gh api repos/OWNER/NAME/actions/permissions, from
# the REST doc "Get GitHub Actions permissions for a repository"; not run
# against GitHub here): 200 with a JSON object whose "enabled" is true or
# false (--jq .enabled prints it). A 403 (the sign-in may not read the
# setting) or 404 (the endpoint not as expected), or an answer that is
# neither true nor false, does not stop the setup: the check only warns
# early, and the project's checks on the proposed change are the real
# test. Any other answer stops like every other call (api_fail).

ACTIONS_PROBLEM=""
ACTIONS_UNCHECKED=""
# ACTIONS_RAW: GitHub's answer, for support, below the local-only guide.
ACTIONS_RAW=""
check_actions_on() {
  ACTIONS_PROBLEM=""
  ACTIONS_UNCHECKED=""
  api_call "repos/$IN_OWNER/$IN_NAME/actions/permissions" --jq .enabled
  case "$API_STATUS" in
    200)
      trim_into "$API_BODY"
      case "$TRIMMED" in
        true) return 0 ;;
        false)
          ACTIONS_PROBLEM=off
          return 1
          ;;
      esac
      ACTIONS_UNCHECKED="HTTP 200: enabled is ${TRIMMED:-empty}"
      return 0
      ;;
    403 | 404)
      api_raw
      ACTIONS_UNCHECKED="$API_RAW"
      return 0
      ;;
  esac
  ACTIONS_PROBLEM=api
  return 1
}

# guide_actions_off: by ACTIONS_PROBLEM, GitHub Actions turned off (off,
# found right after step 3), or allowing only the project's own actions
# (local-only, found when build failed at step 15: the check after step 3
# passes then, because Actions is on; #156 review). Both are fixed on the
# same settings page; local-only also needs build run again on GitHub.
guide_actions_off() {
  case "$ACTIONS_PROBLEM" in
    off)
      guide_begin "GitHub Actions, the GitHub service that runs your project's checks, is turned off for the project $IN_OWNER/$IN_NAME." \
        "Every change to the project is checked on GitHub before it is added, and GitHub Actions runs those checks. While it is off, the setup's own change can never pass them."
      ;;
    local-only)
      guide_begin "GitHub Actions, the GitHub service that runs your project's checks, allows only actions from inside the project $IN_OWNER/$IN_NAME, so the check build failed: it uses actions made by GitHub." \
        "Every change to the project is checked on GitHub before it is added, and the check build uses actions (ready-made steps) that GitHub publishes. While only the project's own actions are allowed, the setup's own change can never pass it."
      ;;
    *) api_fail "check whether GitHub Actions is turned on for the project" ;;
  esac
  guide_step "Open https://github.com/$IN_OWNER/$IN_NAME/settings/actions in your browser: the project's Settings, then Actions, then General."
  guide_step "Under \"Actions permissions\", choose \"Allow all actions and reusable workflows\", then click Save."
  guide_step "If those choices cannot be changed, the organisation (or enterprise) that owns the project has turned off or limited GitHub Actions for its projects: ask one of its owners to allow it, in the organisation's Settings, under Actions, then General."
  if [ "$ACTIONS_PROBLEM" = local-only ]; then
    guide_step "Then run the check again: open $PR_URL in your browser, click Checks, then \"Re-run all jobs\", and wait until build shows a green tick."
    guide_step "Then continue the setup with the command shown below."
    guide_end "the page of the proposed change shows build with a green tick, and the script says \"Done. The check build passed\" when you continue the setup." \
      "if build fails again, click it on that page to see which step failed, and ask for help with what it shows." \
      "it asks GitHub which actions the project may use, and looks at the check build again when you continue the setup. The check has to run again on GitHub first, so the script stops here."
    guide_details "$ACTIONS_RAW"
    return 0
  fi
  guide_step "Then continue with the command shown below, or, if the script is waiting, come back to this window."
  guide_end "the script says \"Done. GitHub Actions is turned on for the project\"." \
    "if the page says that GitHub Actions is turned off by an organisation or an enterprise, ask one of its owners, and show them the page." \
    "it asks GitHub whether GitHub Actions is turned on for the project."
}

check_actions() {
  step_start "Checking that GitHub Actions, which runs the project's checks, is turned on for it"
  guided_check check_actions_on guide_actions_off
  if [ -n "$ACTIONS_UNCHECKED" ]; then
    say_note "The script could not check whether GitHub Actions is turned on for the project: GitHub did not say (its answer is below). This check only warns early, so the setup goes on."
    guide_details "$ACTIONS_UNCHECKED"
    step_end "Carrying on without this check. If GitHub Actions is off, the project's checks will not run on the proposed change."
    return 0
  fi
  step_end "GitHub Actions is turned on for the project, so its checks can run there."
}

# ---------- the copy on this computer ----------
# Spec steps 4, 5, 6 and 9: the copy (gh repo clone) and its version
# check, the git name and email in the copy's own settings, the line of
# work bootstrap-setup, the pack laid out over the copy (layout_into
# overlay, with the packs of the copy itself: the script the user runs
# sits alone, not next to them), and the tidy-up. Nothing is saved
# (committed) or sent (pushed) here; that is step 13, in "the
# self-check, saving, sending and proposing the change".

SETUP_BRANCH=bootstrap-setup
PACKS="node web python react-native"

# clone_project: spec step 4. gh repo clone gives no HTTP status, so a
# failure is read from gh's exit code (4: not signed in) and from git's
# text: when git could not sign in to GitHub, the guide of step 13 (gh
# auth setup-git) applies to the copy too (spec step 4); anything else is
# told plainly with gh's and git's text below. git may not ask for a name
# and password at the terminal (GIT_TERMINAL_PROMPT=0): it would wait
# there, or take the answers meant for the script. Then origin/main must
# hold CHANGELOG.md stamped with this script's version.
clone_project() {
  local err rc=0 raw changelog
  step_start "Making a copy of the project on this computer, in $IN_DIR"
  SIGN_IN_FOR="make the copy of the project on this computer"
  # A folder the script makes for the copy is removed if the copy fails
  # (also by the stop handling); one that was there already stays.
  if [ -e "$IN_DIR" ] || [ -L "$IN_DIR" ]; then MADE_DIR=""; else MADE_DIR="$IN_DIR"; fi
  guided_check try_clone guide_git_sign_in
  MADE_DIR=""
  CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, with only the bootstrapper's files in it, and a copy of it is on this computer in $IN_DIR."

  err="$(make_temp)"
  rc=0
  changelog="$(git -C "$IN_DIR" show origin/main:CHANGELOG.md 2>"$err")" || rc=$?
  raw="$(tr -d '\r' <"$err")"
  rm -f "$err"
  if [ "$rc" -ne 0 ] || ! read_published_version "$changelog"; then
    [ -n "$raw" ] || raw="No line with \", built from\" in CHANGELOG.md. Its first lines:$NL$(sed -n 1,5p <<<"$changelog")"
    stop_with_error "The copy of the project on this computer does not say which version of the bootstrapper it came from: its CHANGELOG.md file is missing or has no version in it." \
      "Open https://github.com/$IN_OWNER/$IN_NAME in your browser and check that the project has a CHANGELOG.md file. If it has none, the project was not made from the bootstrapper: ask for help and show the details below." \
      "$raw"
  fi
  if [ "$PUBLISHED_VERSION" != "$SCRIPT_VERSION" ]; then
    stop_with_error "The copy of the project on this computer is from version $PUBLISHED_VERSION of the bootstrapper, but this script is version $SCRIPT_VERSION." \
      "A new version of the bootstrapper came out while the script ran. Download the current script with the command from the README, then continue the setup with the command shown above." \
      "CHANGELOG.md in the copy: $(grep -F ', built from' <<<"$changelog" | sed -n 1p)"
  fi
  step_end "The copy is in $IN_DIR, with the files of version $SCRIPT_VERSION of the bootstrapper."
}

# try_clone: one try at the copy, for guided_check. Returns 0 when it is
# made, 1 when git could not sign in to GitHub (SIGN_IN_ERR holds git's
# text); stops on any other failure.
try_clone() {
  local out err rc=0 raw
  # What an earlier try left in the folder the script made goes first.
  if [ -n "$MADE_DIR" ] && [ -e "$MADE_DIR" ]; then rm -rf -- "$MADE_DIR"; fi
  out="$(make_temp)"
  err="$(make_temp)"
  GIT_TERMINAL_PROMPT=0 run_gh --to "$out" "$err" repo clone "$IN_OWNER/$IN_NAME" "$IN_DIR" || rc=$?
  raw="$(cat "$out" "$err" | tr -d '\r')"
  rm -f "$out" "$err"
  [ "$rc" -ne 0 ] || return 0
  [ -n "$raw" ] || raw="gh stopped with exit code $rc and no message."
  if [ "$rc" -eq 4 ]; then
    stop_with_error "gh (the GitHub command-line tool) is not signed in to your GitHub account, so the script could not make a copy of the project on this computer." \
      "$SIGN_IN_CONTINUE_NEXT" "$raw"
  fi
  if git_sign_in_failed "$raw"; then
    SIGN_IN_ERR="$raw"
    return 1
  fi
  stop_with_error "The script could not make a copy of the project on this computer, in $IN_DIR." \
    "Check that this computer is connected to the internet and that https://github.com/$IN_OWNER/$IN_NAME opens in your browser, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
    "$raw"
}

# in_copy <what the script was doing> <git arguments...>: runs git in the
# copy; a failure stops plainly, with git's text below.
in_copy() {
  local doing="$1" err rc=0 raw
  shift
  err="$(make_temp)"
  git -C "$IN_DIR" "$@" >/dev/null 2>"$err" || rc=$?
  raw="$(tr -d '\r' <"$err")"
  rm -f "$err"
  [ "$rc" -ne 0 ] || return 0
  [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
  stop_with_error "git could not $doing in the copy of the project on this computer." \
    "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
    "$raw"
}

# set_git_identity: right after the copy (spec, "Git identity"), the name
# and email from the questions go into the copy's own settings, never
# into the global ones.
set_git_identity() {
  step_start "Writing your name and email into the copy's own git settings"
  in_copy "write your name" config user.name "$IN_GIT_NAME"
  in_copy "write your email address" config user.email "$IN_GIT_EMAIL"
  step_end "git writes $IN_GIT_NAME, $IN_GIT_EMAIL into each change saved in this copy, and only in this copy; your other git settings are unchanged."
}

# start_setup_branch: spec step 5, from origin/main, following nothing on
# GitHub (the push in step 13 names where it goes).
start_setup_branch() {
  step_start "Starting a separate line of work for the setup, named $SETUP_BRANCH"
  in_copy "start the line of work $SETUP_BRANCH" checkout -q --no-track -b "$SETUP_BRANCH" origin/main
  step_end "The setup's changes go on the line of work $SETUP_BRANCH, not straight into the main version."
}

# lay_out_pack: spec step 6, with the packs of the copy itself.
lay_out_pack() {
  step_start "Adding the $IN_PACK language pack's files to the copy"
  layout_into "$IN_PACK" "$IN_DIR/languages" "$IN_DIR" overlay "$IN_WITH_DEPLOY"
  step_end "The $IN_PACK pack's files are in place, among them the file that runs the project's checks on GitHub."
}

# The heading of the README section the setup removes: the whole line.
SETUP_HEADING="## Finishing the setup"

# remove_setup_section <README.md>: deletes the section from its
# heading line (SETUP_HEADING, the whole line and nothing else) up to the
# next "## " heading (or the end of the file). Returns 1, changing
# nothing, when there is none.
remove_setup_section() {
  local tmp
  grep -qxF -- "$SETUP_HEADING" <"$1" || return 1
  tmp="$(make_temp)"
  SECTION_HEADING="$SETUP_HEADING" awk_run '$0 == ENVIRON["SECTION_HEADING"] { skip = 1; next }
    skip && /^## / { skip = 0 }
    !skip' <"$1" >"$tmp"
  cat "$tmp" >"$1"
  rm -f "$tmp"
}

# remove_pack_section <file> <pack>: deletes the section of that pack
# from a doc: from its heading, a "### " line that ends with
# "(`<pack>` pack)", up to the next line that starts with "### " or "## "
# outside a code block (``` lines), or the end of the file. Empty lines
# are written only before a line that stays, so none is left at the end.
# Returns 1, changing nothing, when there is none.
remove_pack_section() {
  local tmp
  tmp="$(make_temp)"
  if ! HEAD_END="(\`$2\` pack)" awk_run '
    /^ *```/ { fence = !fence }
    !fence && skip && (/^### / || /^## /) { skip = 0 }
    !fence && /^### / && substr($0, length($0) - length(ENVIRON["HEAD_END"]) + 1) == ENVIRON["HEAD_END"] { skip = 1; found = 1 }
    skip { next }
    /^$/ { blanks++; next }
    { while (blanks > 0) { print ""; blanks-- } print }
    END { exit !found }' <"$1" >"$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp" >"$1"
  rm -f "$tmp"
}

# check_setup_section: README.md has the section the setup removes, found
# by its whole heading line.
check_setup_section() {
  if ! grep -qxF -- "$SETUP_HEADING" "$IN_DIR/README.md" 2>/dev/null; then
    stop_with_error "The file README.md in the copy of the project has no section \"$SETUP_HEADING\", which the setup removes." \
      "$SETUP_BROKEN_NEXT" "No line \"$SETUP_HEADING\" in $IN_DIR/README.md."
  fi
}

# check_decisions_file: memory/decisions.md has the table the setup writes
# its decision into (only needed without protection).
check_decisions_file() {
  if ! grep -q '^|---' "$IN_DIR/memory/decisions.md" 2>/dev/null; then
    stop_with_error "The file memory/decisions.md in the copy of the project has no table of decisions, where the setup writes that the main version is not protected." \
      "$SETUP_BROKEN_NEXT" "No table in $IN_DIR/memory/decisions.md."
  fi
}

# check_copy_fits: everything the setup changes is in the copy, checked
# before the first change (a stop later leaves the copy as it was, so
# --resume goes on in the same copy): the README section, the CHANGELOG
# section, the files of the fill table, the licence text, and the file for
# the decision when the main version stays unprotected. The pack's own
# files are checked by the layout before it writes.
check_copy_fits() {
  step_start "Checking that the copy has everything the setup changes, before it changes anything"
  check_setup_section
  check_changelog_section
  check_fill_files early
  case "$IN_LICENSE" in
    none) ;;
    "$POLYFORM_KEY") check_polyform_text ;;
    *) fetch_licence_text ;;
  esac
  [ -z "$UNPROTECTED" ] || check_decisions_file
  step_end "The files the setup changes are all in the copy, so the setup does not stop half way through changing it."
}

# tidy_up: spec step 9. The README's setup section goes; languages/ keeps
# only the chosen pack's files that were not laid out (LP_KEPT); the
# sections of docs/DEV_INFRASTRUCTURE.md for the other packs go; the
# script's own copy and the bootstrapper's own README (.github/README.md)
# go; licenses/ and everything else stay.
tidy_up() {
  local keep f p
  step_start "Removing what only the setup needed from the copy"
  check_setup_section
  remove_setup_section "$IN_DIR/README.md"
  keep="$(make_temp -d)"
  for f in $LP_KEPT; do
    mv "$IN_DIR/languages/$IN_PACK/$f" "$keep/$f"
  done
  rm -rf "$IN_DIR/languages"
  mkdir -p "$IN_DIR/languages/$IN_PACK"
  for f in $LP_KEPT; do
    mv "$keep/$f" "$IN_DIR/languages/$IN_PACK/$f"
  done
  rmdir "$keep"
  for p in $PACKS; do
    [ "$p" != "$IN_PACK" ] || continue
    remove_pack_section "$IN_DIR/docs/DEV_INFRASTRUCTURE.md" "$p" || true
  done
  rm -f "$IN_DIR/bootstrap-project.sh" "$IN_DIR/.github/README.md"
  step_end "The setup section of README.md, the bootstrapper's own README (.github/README.md), the other language packs and the setup script itself are gone from the copy."
}

# ---------- filling in the placeholders ----------
# Spec step 8. The fill table is in one place: fill_rows (which file holds
# which text, per pack), fill_text (the exact text) and fill_value (what
# it becomes). The self-check before the commit (step 12) can reuse
# fill_rows and fill_text. The fill runs after the tidy-up (step 9): the
# result is the same, and the README's setup section is then removed
# before a description that starts with "## Finishing the setup" could
# be taken for it.

FILL_DATE=""

# fill_rows <pack> <with deploy: yes or empty>: FILL_ROWS is the table for
# that pack, one row per line, "<file> <key>", the file relative to the
# copy. Only the files named here are filled in: rules/ and RULES.md
# are never changed, and the kept languages/<pack>/ files keep their
# texts (react-native code-standards.md, the web wrangler.jsonc without
# --with-deploy).
FILL_ROWS=""
fill_rows() {
  FILL_ROWS="README.md name
README.md po
README.md readme-description
CLAUDE.md name
CHANGELOG.md name
docs/SPEC.md name
docs/SPEC.md date
docs/BACKLOG.md name
docs/BACKLOG.md po
docs/NEXT_SESSION.md name
docs/NEXT_SESSION.md date
memory/project.md name
memory/project.md owner-and-name
memory/project.md project-description"
  case "$1" in
    node | web | react-native) FILL_ROWS="$FILL_ROWS${NL}package.json package-description${NL}package.json package-name" ;;
  esac
  case "$1" in
    web)
      FILL_ROWS="$FILL_ROWS${NL}index.html title"
      [ "${2:-}" != yes ] || FILL_ROWS="$FILL_ROWS${NL}wrangler.jsonc package-name"
      ;;
    react-native) FILL_ROWS="$FILL_ROWS${NL}app.json name${NL}app.json slug" ;;
  esac
}

# fill_text <key>: FILL_TEXT is the exact text the key stands for. The
# description in memory/project.md is two lines, matched as one text.
fill_text() {
  case "$1" in
    name) FILL_TEXT='[PROJECT NAME]' ;;
    po) FILL_TEXT='[PO NAME]' ;;
    owner-and-name) FILL_TEXT='[OWNER/REPO]' ;;
    date) FILL_TEXT='[DATE]' ;;
    readme-description) FILL_TEXT='[One or two sentences: what this project is and who it is for.]' ;;
    project-description) FILL_TEXT="[What the project is, who it is for, and what problem${NL}it solves.]" ;;
    package-description) FILL_TEXT='[project-description]' ;;
    package-name | title) FILL_TEXT='[project-name]' ;;
    slug) FILL_TEXT='[project-slug]' ;;
    year) FILL_TEXT='[year]' ;;
    fullname) FILL_TEXT='[fullname]' ;;
    *) return 1 ;;
  esac
}

# fill_value <key>: FILL_VALUE is what the key's text becomes. The npm
# name and the Expo slug are the slug of the project name (lowercase, a
# . made a -); the web page title is the display name. year and fullname
# are the choosealicense.com placeholders of a GitHub licence (step 10):
# this year (of the fill's date) and the copyright holder. They are not
# rows of the fill table: only LICENSE has them, and only for a GitHub
# licence.
fill_value() {
  case "$1" in
    name | title) FILL_VALUE="$IN_PROJECT_NAME" ;;
    po) FILL_VALUE="$IN_PO_NAME" ;;
    owner-and-name) FILL_VALUE="$IN_OWNER/$IN_NAME" ;;
    date) FILL_VALUE="$FILL_DATE" ;;
    readme-description | project-description | package-description) FILL_VALUE="$IN_DESCRIPTION" ;;
    package-name | slug) FILL_VALUE="$IN_SLUG" ;;
    year) FILL_VALUE="${FILL_DATE%%-*}" ;;
    fullname) FILL_VALUE="$IN_COPYRIGHT_HOLDER" ;;
    *) return 1 ;;
  esac
}

# fill_file <file> <key...>: replaces the texts of the keys given in the
# file, literally and in one pass over the whole file (so a text over two
# lines is found, and a value holding another key's text is not filled
# in again): awk index() and substr(), the values passed through
# ENVIRON (never read as a pattern; no sed -i, which differs on macOS),
# bytes compared as bytes (LC_ALL=C). The file is read from stdin, never
# as an awk operand (a path such as a=b/x would be read as a setting).
# Line endings stay as they are, a file without a newline at the end
# stays without, and the file keeps its mode (it is rewritten in place).
# awk never sees a CR: some awks drop the CR of a CR LF line as they read
# it (Git for Windows' did), so each CR goes through awk as the byte 036
# (a control byte text files do not hold) and is turned back after. A
# file that holds that byte already is refused, as it would come back
# with a CR in its place.
fill_file() {
  local file="$1" tmp n=0 key ends_nl=""
  shift
  if LC_ALL=C grep -q "$(printf '\036')" "$file"; then
    ERR_HINT="fill_file, filling in the names in $file: it holds the control byte 036 (record separator), which the fill uses for CR"
    false
    return 1
  fi
  [ -n "$(tail -c 1 <"$file")" ] || ends_nl=yes
  tmp="$(make_temp)"
  (
    for key in "$@"; do
      n=$((n + 1))
      fill_text "$key"
      fill_value "$key"
      export "FILL_FROM_$n=$FILL_TEXT" "FILL_TO_$n=$FILL_VALUE"
    done
    export FILL_N="$n" FILL_NL="$ends_nl"
    LC_ALL=C tr '\r' '\036' <"$file" | LC_ALL=C awk_run 'BEGIN {
        n = ENVIRON["FILL_N"] + 0
        for (k = 1; k <= n; k++) { from[k] = ENVIRON["FILL_FROM_" k]; to[k] = ENVIRON["FILL_TO_" k] }
      }
      { s = (NR == 1) ? $0 : s "\n" $0 }
      END {
        out = ""
        while (1) {
          best = 0
          for (k = 1; k <= n; k++) {
            i = index(s, from[k])
            if (i > 0 && (best == 0 || i < best)) { best = i; bk = k }
          }
          if (best == 0) break
          out = out substr(s, 1, best - 1) to[bk]
          s = substr(s, best + length(from[bk]))
        }
        ORS = ""
        print out s
        if (NR > 0 && ENVIRON["FILL_NL"] == "yes") print "\n"
      }' | LC_ALL=C tr '\036' '\r' >"$tmp"
  ) || {
    # bash 3.2 does not stop for a failing ( ) by itself.
    ERR_HINT="awk, filling in the names in $file"
    false
  }
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

# check_fill_files [early]: every file of the fill table is in the copy
# (FILL_ROWS is the table); a missing one means the project GitHub made does not fit
# this script. Nothing is changed.
check_fill_files() {
  local file key files="" missing=""
  fill_rows "$IN_PACK" "$IN_WITH_DEPLOY"
  while read -r file key; do
    case " $files " in *" $file "*) continue ;; esac
    files="$files $file"
    # Before the pack is laid out, a file the pack brings (package.json,
    # app.json, index.html, wrangler.jsonc) is in the pack's folder.
    if [ "${1:-}" = early ] && [ -f "$IN_DIR/languages/$IN_PACK/$file" ]; then continue; fi
    [ -f "$IN_DIR/$file" ] || missing="$missing $file"
  done <<<"$FILL_ROWS"
  [ -n "$missing" ] || return 0
  missing="${missing# }"
  stop_with_error "The copy of the project on this computer has no ${missing// /, }, in which the setup fills in the project's name and other details." \
    "$SETUP_BROKEN_NEXT" "Missing in $IN_DIR: $missing"
}

# fill_placeholders: spec step 8 over the copy. Every file of the table
# must be there before the first one is changed; a missing one means the
# project GitHub made does not fit this script.
fill_placeholders() {
  local rows file f key keys files=""
  step_start "Filling in the project's name, description and product owner in its files"
  FILL_DATE="$(date +%Y-%m-%d)"
  check_fill_files
  rows="$FILL_ROWS"
  while read -r file key; do
    case " $files " in *" $file "*) continue ;; esac
    files="$files $file"
  done <<<"$rows"
  for file in $files; do
    keys="$(while read -r f key; do [ "$f" != "$file" ] || printf '%s ' "$key"; done <<<"$rows")"
    # shellcheck disable=SC2086 # the keys are single words
    fill_file "$IN_DIR/$file" $keys
  done
  step_end "The name $IN_PROJECT_NAME, the description, the product owner $IN_PO_NAME, the project's place on GitHub ($IN_OWNER/$IN_NAME) and today's date $FILL_DATE are filled in where the files asked for them."
}

# ---------- lockfile, licence and CHANGELOG ----------

# make_lockfile: spec step 7, for the npm packs: npm records the exact
# version of every tool in package-lock.json, without node_modules, with
# the same command the template's own test of the packs runs. It runs
# after the fill (step 8), so the lockfile names the project, not
# [project-name] (#153). npm's own text is shown only when it fails,
# below the plain message: no network (npm's ENOTFOUND, EAI_AGAIN,
# ETIMEDOUT, ECONNREFUSED, ECONNRESET or ENETUNREACH code) asks to check
# the connection; anything else gets the plain fallback.
make_lockfile() {
  local out rc=0 raw what next
  case "$IN_PACK" in
    node | web | react-native) ;;
    *) return 0 ;;
  esac
  step_start "Recording the exact versions of the $IN_PACK pack's tools in package-lock.json"
  out="$(make_temp)"
  # IN_DIR never starts with - (check_dir puts ./ before a relative one).
  (CDPATH='' cd "$IN_DIR" && run_npm install --package-lock-only --no-audit --no-fund) </dev/null >"$out" 2>&1 || rc=$?
  raw="$(tr -d '\r' <"$out")"
  rm -f "$out"
  if [ "$rc" -ne 0 ]; then
    [ -n "$raw" ] || raw="npm stopped with exit code $rc and no message."
    what="npm could not record the exact versions of the $IN_PACK pack's tools in package-lock.json."
    case "$raw" in
      *"code ENOTFOUND"* | *"code EAI_AGAIN"* | *"code ETIMEDOUT"* | *"code ECONNREFUSED"* | *"code ECONNRESET"* | *"code ENETUNREACH"*)
        next="Check that this computer is connected to the internet, then continue the setup with the command shown above."
        ;;
      *) next="Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." ;;
    esac
    stop_with_error "$what" "$next" "$raw"
  fi
  step_end "package-lock.json lists the exact version of every tool the project uses, so its checks on GitHub install the same ones."
}

# check_polyform_text: the PolyForm text is in the copy.
check_polyform_text() {
  if [ ! -f "$IN_DIR/$POLYFORM_TEXT" ]; then
    stop_with_error "The copy of the project on this computer has no $POLYFORM_TEXT, the text of the PolyForm Noncommercial licence." \
      "$SETUP_BROKEN_NEXT" "Missing in $IN_DIR: $POLYFORM_TEXT"
  fi
}

# fetch_licence_text: LICENCE_TEXT is the text of a GitHub licence, read
# from GitHub (once; also read before the copy is changed, so a licence
# GitHub cannot give stops the setup before anything is written and
# --resume can go on in the same copy with another --license).
LICENCE_TEXT=""
LICENCE_TEXT_OF=""
fetch_licence_text() {
  local body
  [ "$LICENCE_TEXT_OF" != "$IN_LICENSE" ] || return 0
  api_call "licenses/$IN_LICENSE" --jq .body
  if [ "$API_STATUS" = 404 ]; then
    api_raw
    stop_with_error "GitHub has no licence with the short name $IN_LICENSE, so the script could not add it." \
      "Find the licence on https://choosealicense.com/licenses/ (its page shows the short name, such as mit), then continue the setup with the command shown above, with --license and that name in place of --license $IN_LICENSE." \
      "$API_RAW"
  fi
  [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ] || api_fail "read the text of the licence $IN_LICENSE"
  body="$API_BODY"
  while [ "${body%"$NL"}" != "$body" ]; do body="${body%"$NL"}"; done
  if [ -z "$body" ]; then
    stop_with_error "GitHub sent an empty text for the licence $IN_LICENSE, so the script could not add it." \
      "Wait a few minutes, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "HTTP 200 with an empty body for licenses/$IN_LICENSE"
  fi
  LICENCE_TEXT="$body"
  LICENCE_TEXT_OF="$IN_LICENSE"
}

# add_licence: spec step 10. A GitHub licence: its text from GitHub, with
# [year] and [fullname] filled in by the fill of step 8 (literally);
# PolyForm Noncommercial: the text from licenses/, and a NOTICE at the
# root naming the copyright holder; none: no file, and a warning when the
# project is public. Every file is written with LF line endings.
POLYFORM_KEY=polyform-noncommercial-1.0.0
POLYFORM_TEXT=licenses/PolyForm-Noncommercial-1.0.0.md
add_licence() {
  step_start "Adding the project's licence"
  case "$IN_LICENSE" in
    none)
      if [ "$IN_VISIBILITY" != private ]; then
        say "$NO_LICENCE_WARNING"
      fi
      step_end "No licence file was added, because you chose none."
      ;;
    "$POLYFORM_KEY")
      check_polyform_text
      tr -d '\r' <"$IN_DIR/$POLYFORM_TEXT" >"$IN_DIR/LICENSE"
      cat <<<"Required Notice: Copyright $IN_COPYRIGHT_HOLDER" >"$IN_DIR/NOTICE"
      step_end "LICENSE holds the PolyForm Noncommercial licence, and NOTICE names $IN_COPYRIGHT_HOLDER as the copyright holder."
      ;;
    *)
      fetch_licence_text
      cat <<<"$LICENCE_TEXT" >"$IN_DIR/LICENSE"
      [ -n "$FILL_DATE" ] || FILL_DATE="$(date +%Y-%m-%d)"
      fill_file "$IN_DIR/LICENSE" year fullname
      step_end "LICENSE holds the licence $IN_LICENSE, in the name of $IN_COPYRIGHT_HOLDER."
      ;;
  esac
}

# check_changelog_section: CHANGELOG.md has the section the setup adds to.
check_changelog_section() {
  local file="$IN_DIR/CHANGELOG.md"
  if ! grep -qx '## Project created' <"$file" 2>/dev/null; then
    stop_with_error "The file CHANGELOG.md in the copy of the project has no section \"## Project created\", where the setup notes how the project was set up." \
      "$SETUP_BROKEN_NEXT" "No line \"## Project created\" in $file."
  fi
}

# note_setup_in_changelog: spec step 11. The pack, the licence and "set up
# by bootstrap-project.sh" go at the end of the "## Project created"
# section of CHANGELOG.md: after its last line that is not blank, before
# the blank lines and the next "## " heading when one follows. Without
# that heading it stops and changes nothing.
note_setup_in_changelog() {
  local file="$IN_DIR/CHANGELOG.md" tmp pack_line
  step_start "Noting the setup in CHANGELOG.md, the project's list of changes"
  check_changelog_section
  pack_line="- Language pack: $IN_PACK."
  [ "$IN_WITH_DEPLOY" != yes ] || pack_line="- Language pack: $IN_PACK, with the files that publish the website."
  tmp="$(make_temp)"
  CL_ADD="$pack_line$NL- Licence: $IN_LICENSE.$NL- Set up by bootstrap-project.sh." LC_ALL=C awk_run '
    BEGIN { add = ENVIRON["CL_ADD"] }
    function flush_add() { if (on) { print add; on = 0; done = 1 } }
    function flush_blanks() { while (blanks > 0) { print ""; blanks-- } }
    on && /^## / { flush_add() }
    on && /^$/ { blanks++; next }
    { flush_blanks() }
    !done && $0 == "## Project created" { print; on = 1; next }
    { print }
    END { flush_add(); flush_blanks() }' <"$file" >"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
  step_end "CHANGELOG.md says which pack and which licence the project was set up with."
}

# The start of the decision row, after the date: how the script tells the
# row is in memory/decisions.md.
UNPROTECTED_ROW_KEY="| The main version (main) is not protected |"
# DECISION_NOTED: memory/decisions.md of the project has that row.
DECISION_NOTED=""

# note_unprotected_decision: without protection (--allow-unprotected),
# one row at the end of the table in memory/decisions.md says that the
# main version is not protected, and why (spec, open decision 5).
note_unprotected_decision() {
  local file="$IN_DIR/memory/decisions.md" tmp row
  [ -n "$UNPROTECTED" ] || return 0
  step_start "Writing into memory/decisions.md that the main version is not protected"
  check_decisions_file
  [ -n "$FILL_DATE" ] || FILL_DATE="$(date +%Y-%m-%d)"
  row="| $FILL_DATE $UNPROTECTED_ROW_KEY The project is private and its GitHub plan cannot protect a private project, so the setup went on without protection because of --allow-unprotected. Any change can go straight into the main version. To protect it, move to a paid GitHub plan (Pro, Team or Enterprise) or make the project public, then turn protection on in the project's settings; docs/DEV_INFRASTRUCTURE.md says how. |"
  tmp="$(make_temp)"
  UD_ROW="$row" LC_ALL=C awk_run '{ line[NR] = $0; if ($0 ~ /^\|/) last = NR }
    END { for (i = 1; i <= NR; i++) { print line[i]; if (i == last) print ENVIRON["UD_ROW"] } }' <"$file" >"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
  step_end "memory/decisions.md says that the main version is not protected, because you chose to go on without protection."
}

# ---------- the self-check, saving, sending and proposing the change ----------
# Spec steps 12, 13 and 14. The self-check stops before anything is saved
# when a text of the fill table is left in its file, when git status
# shows a path the setup does not change, when the changes hold what
# looks like a GitHub key, or when a file has a carriage return. Then the
# git name and email are checked, the change "Set up <name>" is saved
# (committed) and sent (pushed) on bootstrap-setup, and proposed on GitHub
# (gh pr create, with its title and body given, so gh asks nothing).
#
# Signing in (step 13): for the push, git borrows gh's sign-in for that
# one command, through -c, so no git settings change: an empty
# credential.https://github.com.helper drops the helpers set before it,
# then gh's own helper. These are the two settings gh auth setup-git
# writes into the global git settings (gh 2.89.0, run once into a
# throwaway settings file), with the gh this script runs. When git still
# cannot sign in, guide_git_sign_in offers gh auth setup-git itself,
# which changes the global git settings: the guide says so, and it runs
# only after a yes typed at the terminal. Later tries then push without
# the -c settings, which would hide the helper gh auth setup-git (or the
# user) set. The copy (step 4) gets the same guide. git never asks at the
# terminal (GIT_TERMINAL_PROMPT=0): it would wait there, or read answers
# meant for the script.
#
# No key is ever shown, saved or written (spec, "No secrets"): the
# checks name the files that hold one, never the key, and the sign-in
# helper is a command, not a key.

SIGN_IN_FOR=""
SIGN_IN_ERR=""
SEND_TRIES=0
PR_URL=""
# What a GitHub key looks like: a classic one (ghp_, gho_, ghu_, ghs_,
# ghr_ and at least 20 letters or digits) or a fine-grained one.
KEY_PATTERN_CLASSIC='gh[pousr]_[A-Za-z0-9]{20,}'
KEY_PATTERN_FINE='github_pat_[A-Za-z0-9_]{20,}'

# git_sign_in_failed <git's text>: true when git says it could not sign
# in to GitHub (git's own words, which are stable across versions).
git_sign_in_failed() {
  case "$1" in
    *"could not read Username"* | *"could not read Password"* | *"Authentication failed"* | *"terminal prompts disabled"* | *"Invalid username or password"*) return 0 ;;
  esac
  return 1
}

# guide_git_sign_in: git could not sign in to GitHub to SIGN_IN_FOR.
guide_git_sign_in() {
  guide_begin "git could not sign in to GitHub to $SIGN_IN_FOR." \
    "git (the tool that keeps the project's history) needs your GitHub sign-in for this. The script lends it the sign-in of gh (the GitHub command-line tool) for this one step, and git still could not sign in."
  guide_step "Let gh sign git in to GitHub. This changes your global git settings (the settings git uses for every project on this computer): from then on, git signs in to GitHub through gh in every project, not only this one. This command does it:"
  say_command "gh auth setup-git"
  guide_step "Then come back here and press Enter: the script tries again."
  guide_end "the script says \"Done.\" after it tries again." \
    "check that gh is signed in: the command gh auth status shows your GitHub account. If it does not, sign in as in step 0 of the README; if it does and this still happens, ask for help and show the details below." \
    "it tries again, and git says whether GitHub let it in."
  guide_details "$SIGN_IN_ERR"
  OFFER=gh-setup-git
}

# fill_texts_left: LEFT lists the pairs of the fill table whose text is
# still in its file, one "<text> in <file>" per line (a text over two
# lines is written on one). A text that is part of a value the user gave
# (a display name such as "[PO NAME] App") is not left: each occurrence of
# such a value is covered first. Kept files are not rows of the table,
# so the texts they document stay (spec step 12).
LEFT=""
fill_texts_left() {
  local rows file key f k t v s keys mask
  mask="$(printf '\037')"
  LEFT=""
  fill_rows "$IN_PACK" "$IN_WITH_DEPLOY"
  rows="$FILL_ROWS"
  while read -r file key; do
    fill_text "$key"
    t="$FILL_TEXT"
    s="$(
      cat "$IN_DIR/$file"
      printf x # not-user-facing
    )"
    s="${s%x}"
    keys="$(while read -r f k; do [ "$f" != "$file" ] || printf '%s ' "$k"; done <<<"$rows")"
    for k in $keys; do
      fill_value "$k"
      v="$FILL_VALUE"
      case "$v" in *"$t"*) s="${s//"$v"/$mask}" ;; esac
    done
    case "$s" in *"$t"*) LEFT="$LEFT${t//$NL/ } in $file$NL" ;; esac
  done <<<"$rows"
  LEFT="${LEFT%"$NL"}"
}

# check_texts_left: stops when fill_texts_left finds any.
check_texts_left() {
  local raw
  fill_texts_left
  [ -n "$LEFT" ] || return 0
  raw="Left in their files:$NL$LEFT"
  stop_with_error "Some texts that the setup fills in are still in the copy of the project, so the script saved and sent nothing: ${LEFT//$NL/; }." \
    "$SETUP_BROKEN_NEXT" "$raw"
}

# expected_change <git status code> <path>: true when the setup changes
# that path that way: it deletes the script, the bootstrapper's own
# README (.github/README.md) and the languages/ files it does not keep,
# changes the bootstrapper's files it fills in or edits, and adds the
# pack's files, the lockfile and the licence files.
expected_change() {
  local code="$1" path="$2" f t
  case "$code" in
    "D ")
      [ "$path" != bootstrap-project.sh ] || return 0
      [ "$path" != .github/README.md ] || return 0
      case "$path" in
        languages/*)
          for f in $LP_KEPT; do [ "$path" != "languages/$IN_PACK/$f" ] || return 1; done
          return 0
          ;;
      esac
      ;;
    "M ")
      # A pack file the setup adds is new, never changed: a fill-table
      # file such as package.json is changed only when the bootstrapper
      # has it (ci.yml and .gitignore are the two the pack overlays).
      case " $LP_TARGETS " in
        *" $path "*) case "$path" in .github/workflows/ci.yml | .gitignore) ;; *) return 1 ;; esac ;;
      esac
      case " README.md CHANGELOG.md .gitignore .github/workflows/ci.yml docs/DEV_INFRASTRUCTURE.md ${UNPROTECTED:+memory/decisions.md }$FILL_FILES " in
        *" $path "*) return 0 ;;
      esac
      ;;
    "A ")
      for t in $LP_TARGETS; do
        case "$t" in
          */) case "$path" in "$t"*) return 0 ;; esac ;;
          *) [ "$path" != "$t" ] || return 0 ;;
        esac
      done
      case "$path" in
        package-lock.json) case "$IN_PACK" in node | web | react-native) return 0 ;; esac ;;
        LICENSE) [ "$IN_LICENSE" = none ] || return 0 ;;
        NOTICE) [ "$IN_LICENSE" != "$POLYFORM_KEY" ] || return 0 ;;
      esac
      ;;
  esac
  return 1
}

# check_changed_paths: with every change staged (git add -A), git status
# must show only changes the setup makes, and no file the setup adds may
# be ignored by git (a list of files to ignore in the global git settings
# would leave it out of the change without a word). CHANGED (an array)
# holds the paths added or changed, for the key check.
CHANGED=()
check_changed_paths() {
  local status err rc=0 raw entry code path f unexpected="" lines="" ignored="" ignored_lines=""
  fill_rows "$IN_PACK" "$IN_WITH_DEPLOY"
  FILL_FILES="$(while read -r f _; do printf '%s ' "$f"; done <<<"$FILL_ROWS")"
  status="$(make_temp)"
  err="$(make_temp)"
  git -C "$IN_DIR" status --porcelain -z --no-renames --untracked-files=all --ignored=traditional >"$status" 2>"$err" || rc=$?
  raw="$(tr -d '\r' <"$err")"
  if [ "$rc" -ne 0 ]; then
    rm -f "$status" "$err"
    [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
    stop_with_error "git could not list the setup's changes in the copy of the project on this computer." \
      "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  CHANGED=()
  while IFS= read -r -d '' entry; do
    code="${entry:0:2}"
    path="${entry:3}"
    if [ "$code" = "!!" ]; then
      if expected_change "A " "$path"; then
        ignored="$ignored, $path"
        ignored_lines="$ignored_lines$entry$NL"
      fi
      continue
    fi
    if ! expected_change "$code" "$path"; then
      unexpected="$unexpected, $path"
      lines="$lines$entry$NL"
    fi
    [ "$code" = "D " ] || CHANGED[${#CHANGED[@]}]="$path"
  done <"$status"
  rm -f "$status" "$err"
  if [ -n "$unexpected" ]; then
    stop_with_error "The copy of the project on this computer has changes that the setup did not make, so the script saved and sent nothing: ${unexpected#, }." \
      "Move those files out of $IN_DIR, or undo your changes to them, then continue the setup with the command shown above. If you did not make them, ask for help and show the details below." \
      "${lines%"$NL"}"
  fi
  [ -n "$ignored" ] || return 0
  stop_with_error "Some files that the setup adds are ignored by git, so they would be left out of the saved change, and the script saved and sent nothing: ${ignored#, }." \
    "Most likely your global git settings name a list of files to ignore (the setting core.excludesFile, or the file .config/git/ignore in your home folder) that matches them. Remove those lines from that list, then continue the setup with the command shown above. If you cannot find them, ask for help and show the details below." \
    "${ignored_lines%"$NL"}"
}

# check_no_key: no file the setup adds or changes holds what looks like a
# GitHub key, as staged. Only the files are named, never what matched.
check_no_key() {
  local out err rc=0 raw files
  [ "${#CHANGED[@]}" -gt 0 ] || return 0
  out="$(make_temp)"
  err="$(make_temp)"
  git --literal-pathspecs -C "$IN_DIR" grep --cached -l -E -e "$KEY_PATTERN_CLASSIC" -e "$KEY_PATTERN_FINE" -- "${CHANGED[@]}" \
    >"$out" 2>"$err" || rc=$?
  files="$(tr -d '\r' <"$out")"
  raw="$(tr -d '\r' <"$err")"
  rm -f "$out" "$err"
  case "$rc" in
    0)
      stop_with_error "The setup's changes hold what looks like a sign-in key for GitHub (a token), in ${files//$NL/, }, so the script saved and sent nothing." \
        "Remove the key from those files, then continue the setup with the command shown above. If it is a real key, also delete it on https://github.com/settings/tokens, because it may have been seen. If you did not put it there, ask for help and show the details below." \
        "Files with text of the form gh[pousr]_... or github_pat_...:$NL$files"
      ;;
    1) return 0 ;;
  esac
  [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
  stop_with_error "git could not check the setup's changes for sign-in keys." \
    "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
    "$raw"
}

# check_line_endings: every text file has LF line endings, with no
# carriage return, as the change will be saved: the check reads git's
# index (after git add), not the files on disk. The project's
# .gitattributes (eol=lf) makes git save a file with CR LF line endings
# with LF, so such a file is fine; a carriage return git keeps stops the
# setup. git grep -I leaves out files git takes for binary.
check_line_endings() {
  local out err rc=0 raw files
  out="$(make_temp)"
  err="$(make_temp)"
  git -C "$IN_DIR" grep --cached -I -l -e "$CR" >"$out" 2>"$err" || rc=$?
  files="$(tr -d '\r' <"$out")"
  raw="$(tr -d '\r' <"$err")"
  rm -f "$out" "$err"
  case "$rc" in
    0)
      stop_with_error "Some files in the copy of the project end their lines with a carriage return (as on Windows), so the script saved and sent nothing: ${files//$NL/, }." \
        "The project keeps LF line endings (as on macOS and Linux) in every file. If you changed those files, save them with LF line endings; otherwise ask for help and show the details below. Then continue the setup with the command shown above." \
        "Files with a carriage return:$NL$files"
      ;;
    1) return 0 ;;
  esac
  [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
  stop_with_error "git could not check the line endings of the files in the copy of the project." \
    "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
    "$raw"
}

# self_check: spec step 12, in the spec's order.
self_check() {
  step_start "Checking the setup's changes before saving them"
  check_texts_left
  in_copy "mark the setup's changes to be saved" add -A
  check_changed_paths
  check_no_key
  check_line_endings
  step_end "No text is left to fill in, only the files the setup changes have changed, none holds a sign-in key, and every file has LF line endings."
}

# git_ident_form <name or email>: IDENT_FORM is the text as git writes it
# into a change: git drops spaces and , : ; ' at both ends (the inputs
# refuse its other such characters, " < > and \).
git_ident_form() {
  local s="$1" crud=",:;$SQ"
  while :; do
    # shellcheck disable=SC2101 # [[:space:]$crud] is one bracket expression: the class and crud's characters
    case "$s" in
      [[:space:]$crud]*) s="${s#?}" ;;
      *[[:space:]$crud]) s="${s%?}" ;;
      *) break ;;
    esac
  done
  IDENT_FORM="$s"
}

# check_git_identity: spec step 13, before the commit. git var says under
# which name and email git would save the change, the copy's settings and
# anything that overrides them (the GIT_AUTHOR_* and GIT_COMMITTER_*
# settings of the terminal) taken together; both must be the ones given.
check_git_identity() {
  local which err rc ident want raw
  git_ident_form "$IN_GIT_NAME"
  want="$IDENT_FORM <"
  git_ident_form "$IN_GIT_EMAIL"
  want="$want$IDENT_FORM>"
  for which in AUTHOR COMMITTER; do
    err="$(make_temp)"
    rc=0
    ident="$(git -C "$IN_DIR" var "GIT_${which}_IDENT" 2>"$err")" || rc=$?
    raw="$(tr -d '\r' <"$err")"
    rm -f "$err"
    ident="${ident//$CR/}"
    if [ "$rc" -ne 0 ]; then
      [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
      stop_with_error "git could not tell under which name and email it would save the setup's changes." \
        "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
        "$raw"
    fi
    # "Name <email> <time> <zone>": the last two words go.
    ident="${ident% *}"
    ident="${ident% *}"
    if [ "$ident" != "$want" ]; then
      stop_with_error "git would save the setup's changes under $ident, not under the name and email you gave, $want." \
        "A setting of this terminal overrides the copy's own git settings: GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME or GIT_COMMITTER_EMAIL; so do the settings author.name, author.email, committer.name or committer.email in your global git settings. Open a new terminal window without the first, remove the others from your global git settings, or give the same name and email to the script, then continue the setup with the command shown above." \
        "git var GIT_${which}_IDENT: $ident"
    fi
  done
}

# save_change: spec step 13, the commit.
save_change() {
  step_start "Saving the setup's changes in the copy as one change, \"Set up $IN_NAME\""
  check_git_identity
  in_copy "save the setup's changes" commit -q -m "Set up $IN_NAME"
  CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, and the setup's changes are saved in its copy on this computer, in $IN_DIR, but not sent to GitHub yet."
  step_end "The changes are saved in the copy under $IN_GIT_NAME, $IN_GIT_EMAIL."
}

# with_gh_sign_in <stdout file> <stderr file> <git arguments...>: runs
# git with gh as its sign-in helper for GitHub, for this one command (see
# the top of this section), never asking at the terminal; git's output
# goes to the two files.
with_gh_sign_in() {
  local out="$1" err="$2"
  shift 2
  # The gh that run_gh runs, named here (not run) because git runs it as
  # its helper and reads its answer; the terminal never sees it.
  quote_word "${BOOTSTRAP_GH:-gh}" # not-user-facing
  GIT_TERMINAL_PROMPT=0 git -c credential.https://github.com.helper= \
    -c "credential.https://github.com.helper=!$QUOTED auth git-credential" "$@" >"$out" 2>"$err"
}

# try_push: one try at sending the change, for guided_check. The first
# try borrows gh's sign-in; a later one uses git's own settings. Returns
# 0 when it is sent, 1 when git could not sign in (SIGN_IN_ERR holds
# git's text); stops on any other failure.
try_push() {
  local out err rc=0 raw
  out="$(make_temp)"
  err="$(make_temp)"
  SEND_TRIES=$((SEND_TRIES + 1))
  if [ "$SEND_TRIES" -eq 1 ]; then
    with_gh_sign_in "$out" "$err" -C "$IN_DIR" push origin "$SETUP_BRANCH" || rc=$?
  else
    GIT_TERMINAL_PROMPT=0 git -C "$IN_DIR" push origin "$SETUP_BRANCH" >"$out" 2>"$err" || rc=$?
  fi
  raw="$(cat "$out" "$err" | tr -d '\r')"
  rm -f "$out" "$err"
  [ "$rc" -ne 0 ] || return 0
  [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
  if git_sign_in_failed "$raw"; then
    SIGN_IN_ERR="$raw"
    return 1
  fi
  case "$raw" in
    *"refusing to allow"*workflow*)
      stop_with_error "GitHub refused the setup's changes, because the sign-in that gh lends to git may not change the project's workflow files (the files that run its checks on GitHub)." \
        "Give gh that permission with the command gh auth refresh -h github.com -s workflow (if gh asks \"$GH_GIT_QUESTION_TEXT\", answer Yes), then continue the setup with the command shown above." \
        "$raw"
      ;;
    *"Could not resolve host"* | *"Failed to connect"* | *"Connection timed out"* | *"Could not connect"*)
      stop_with_error "git could not send the setup's changes to GitHub." \
        "Check that this computer is connected to the internet, then continue the setup with the command shown above." \
        "$raw"
      ;;
  esac
  stop_with_error "git could not send the setup's changes to GitHub." \
    "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
    "$raw"
}

# send_change: spec step 13, the push of bootstrap-setup.
send_change() {
  step_start "Sending the setup's changes to GitHub, on the line of work $SETUP_BRANCH"
  SIGN_IN_FOR="send the setup's changes"
  SEND_TRIES=0
  guided_check try_push guide_git_sign_in
  CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, and the setup's changes are saved in its copy on this computer, in $IN_DIR, and sent to GitHub on the line of work $SETUP_BRANCH."
  step_end "The changes are on GitHub, on the line of work $SETUP_BRANCH."
}

# pr_body: PR_BODY is the text of the proposed change, in plain words.
PR_BODY=""
pr_body() {
  local deploy="" licence
  [ "$IN_WITH_DEPLOY" != yes ] || deploy=", with the files that publish the website"
  if [ "$IN_LICENSE" = none ]; then
    licence="- Licence: none, so no licence file."
  else
    licence="- Licence: $IN_LICENSE, in the name of $IN_COPYRIGHT_HOLDER."
  fi
  PR_BODY="This proposed change sets up $IN_PROJECT_NAME. The setup script bootstrap-project.sh made it, from version $SCRIPT_VERSION of the bootstrapper.$NL$NL"
  PR_BODY="$PR_BODY- Language pack: the $IN_PACK language pack$deploy.$NL"
  PR_BODY="$PR_BODY- Filled in: the project's name, description and product owner, where its files asked for them.$NL"
  PR_BODY="$PR_BODY$licence$NL"
  case "$IN_PACK" in
    node | web | react-native) PR_BODY="$PR_BODY- package-lock.json: the exact version of every tool the project uses.$NL" ;;
  esac
  PR_BODY="$PR_BODY- Removed: the setup section of README.md, the bootstrapper's own README (.github/README.md), the other language packs and the setup script itself.$NL$NL"
  PR_BODY="${PR_BODY}Once the project's checks on GitHub pass, this change is added to the main version."
}

# propose_change: spec step 14. The body goes in a temporary file outside
# the copy. gh prints the link of the proposed change.
propose_change() {
  local body out err rc=0 raw
  step_start "Proposing the setup's changes on GitHub, where the project's checks run on them"
  pr_body
  body="$(make_temp)"
  out="$(make_temp)"
  err="$(make_temp)"
  cat <<<"$PR_BODY" >"$body"
  run_gh --to "$out" "$err" pr create --repo "$IN_OWNER/$IN_NAME" --base main --head "$SETUP_BRANCH" \
    --title "Set up $IN_NAME" --body-file "$body" || rc=$?
  PR_URL="$(tr -d '\r' <"$out" | grep -E '^https://[^ ]*/pull/[0-9]+$' | tail -1)" || PR_URL=""
  raw="$(cat "$out" "$err" | tr -d '\r')"
  rm -f "$body" "$out" "$err"
  if [ "$rc" -ne 0 ]; then
    [ -n "$raw" ] || raw="gh stopped with exit code $rc and no message."
    if [ "$rc" -eq 4 ]; then
      stop_with_error "gh (the GitHub command-line tool) is not signed in to your GitHub account, so the script could not propose the setup's changes on GitHub." \
        "$SIGN_IN_CONTINUE_NEXT" "$raw"
    fi
    case "$raw" in
      *"already exists"*)
        stop_with_error "GitHub already has a proposed change for the line of work $SETUP_BRANCH." \
          "Open the link below in your browser to see it, then continue the setup with the command shown above." \
          "$raw"
        ;;
    esac
    stop_with_error "gh (the GitHub command-line tool) could not propose the setup's changes on GitHub." \
      "Open https://github.com/$IN_OWNER/$IN_NAME/pulls in your browser to see whether the proposed change is there, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  if [ -z "$PR_URL" ]; then
    [ -n "$raw" ] || raw="gh stopped with exit code 0 and printed nothing."
    stop_with_error "gh (the GitHub command-line tool) did not say where the proposed change is." \
      "Open https://github.com/$IN_OWNER/$IN_NAME/pulls in your browser to see whether it is there, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, and the setup's changes are proposed there: $PR_URL"
  step_end "The proposed change is on GitHub: $PR_URL"
}

# say_left_for_clead: the texts the setup leaves for the first session
# with Clead (spec step 8), for the report at the end (step 19).
say_left_for_clead() {
  say "These parts of the project are left for your first session with Clead (Claude, the project's Tech Owner), who writes them with you:"
  say "  - the name of the first phase, [PHASE NAME], in docs/BACKLOG.md;"
  say "  - the goals, [Goal], and the rest of memory/project.md;"
  say "  - the questions in square brackets in the sections of docs/SPEC.md;"
  say "  - memory/context.md;"
  say "  - STATUS.md, where the project stands and what comes next."
}

# ---------- wait, require, add, finish and report ----------
# Spec steps 15 to 19, after the proposed change. Step 15 looks at the
# check named build (gh pr checks, every CHECKS_DELAY seconds, for up to
# --ci-timeout minutes); a failure stops with the proposed change left
# open. Step 16 PUTs the whole protection again with build required (a
# PUT replaces all of it) and reads it back field by field. Step 17 adds
# the change with gh pr merge --match-head-commit, run inside the copy so
# gh can also bring the copy to main; GitHub is then asked whether the
# change was added, which also gives the id of the new main. Step 18 does
# what gh did not already do, then checks the copy. Step 19 reports.
# What was relied on and not run against GitHub here: gh pr checks --json
# with the fields name, bucket and event (gh manual), GitHub's answers to
# GET .../branches/main/protection and GET .../pulls/N (REST docs); the
# test file runs these --jq expressions with jq on the documented shapes.

# The --jq expressions, and the step 16 body: the step 3 body with build
# required. The tests check that these are the ones they name.
BUILD_JQ='.[] | select(.name == "build") | "\(.event) \(.bucket)"'
READBACK_JQ='"contexts=\(.required_status_checks.contexts // [] | join(","))", "strict=\(.required_status_checks.strict)", "enforce_admins=\(.enforce_admins.enabled)", "approvals=\(.required_pull_request_reviews.required_approving_review_count)", "restrictions=\(.restrictions)", "allow_force_pushes=\(.allow_force_pushes.enabled)", "allow_deletions=\(.allow_deletions.enabled)"'
MERGED_JQ='"\(.merged) \(.merge_commit_sha)"'
REQUIRE_BODY='{"required_status_checks":{"strict":false,"contexts":["build"]},"enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}'
# What READBACK_JQ must print for REQUIRE_BODY, field by field.
REQUIRE_READBACK="contexts=build strict=false enforce_admins=true approvals=0 restrictions=null allow_force_pushes=false allow_deletions=false"
CHECKS_DELAY=15

PR_NUMBER=""
BUILD_STATE=""
BUILD_SEEN=""
READ_BACK=""
MERGED_SHA=""
# CHANGE_ADDED: --resume found the setup's changes in the main version
# already.
CHANGE_ADDED=""

# look_at_build: one look at build on the proposed change. BUILD_STATE is
# pass, fail or pending (running, or not reported yet); BUILD_SEEN is
# what gh printed, one "build: <event> <bucket>" per line, for support.
# The pull_request run counts; without one, any run of build (spec step
# 15). gh's exit code is not relied on for pending or failed checks (it
# differs with --json); only what it printed is read.
look_at_build() {
  local out err rc=0 lines raw line runs="" pr_runs="" b
  out="$(make_temp)"
  err="$(make_temp)"
  run_gh --to "$out" "$err" pr checks "$PR_NUMBER" --repo "$IN_OWNER/$IN_NAME" --json name,bucket,event --jq "$BUILD_JQ" || rc=$?
  lines="$(tr -d '\r' <"$out")"
  raw="$(tr -d '\r' <"$err")"
  rm -f "$out" "$err"
  if [ -z "$lines" ]; then
    if [ "$rc" -eq 4 ]; then
      stop_with_error "gh (the GitHub command-line tool) is not signed in to your GitHub account, so the script could not look at the project's checks on the proposed change." \
        "$SIGN_IN_CONTINUE_NEXT" "$raw"
    fi
    case "$rc $raw" in
      "0 "* | *"no checks reported"*)
        BUILD_STATE=pending
        BUILD_SEEN="build: not reported yet"
        return 0
        ;;
    esac
    [ -n "$raw" ] || raw="gh stopped with exit code $rc and no message."
    stop_with_error "gh (the GitHub command-line tool) could not look at the project's checks on the proposed change." \
      "Check that this computer is connected to the internet, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  BUILD_SEEN=""
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    BUILD_SEEN="${BUILD_SEEN:+$BUILD_SEEN$NL}build: $line"
    runs="$runs ${line#* }"
    case "$line" in "pull_request "*) pr_runs="$pr_runs ${line#* }" ;; esac
  done <<<"$lines"
  [ -z "$pr_runs" ] || runs="$pr_runs"
  BUILD_STATE=pass
  for b in $runs; do
    case "$b" in
      pass) ;;
      pending)
        BUILD_STATE=pending
        return 0
        ;;
      *) BUILD_STATE=fail ;;
    esac
  done
}

# build_failed: build failed. When GitHub Actions allows only the
# project's own actions, that is the cause (#156 review): its guide, and
# a stop (build has to run again on GitHub first). Otherwise a plain stop.
# Either way the proposed change stays open.
build_failed() {
  local seen="$BUILD_SEEN"
  api_call "repos/$IN_OWNER/$IN_NAME/actions/permissions" --jq .allowed_actions
  if [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; then
    trim_into "$API_BODY"
    if [ "$TRIMMED" = local_only ]; then
      ACTIONS_PROBLEM=local-only
      ACTIONS_RAW="allowed_actions: $TRIMMED"
      guide_actions_off
      stop_at_guide
    fi
  fi
  stop_with_error "The project's check build failed on the proposed change, so the script did not add the change to the main version. The proposed change stays open on GitHub." \
    "Open $PR_URL in your browser, click Checks, then build, to see which step failed. If you can fix it, click \"Re-run all jobs\" there once it is fixed, then continue the setup with the command shown above; otherwise ask for help and show the details below." \
    "$seen"
}

# The signs of life of the wait for build (E2E run 1, finding 9): each
# look after the first starts a line of its own, and on a terminal the
# line is followed by a line of stars, a * for each second of the wait
# after it: on a line of its own (r1h, Adam: easier to see), which stays
# open until the next line ends it. Without a terminal (a log, a pipe)
# there are no stars, and each wait is one pause of CHECKS_DELAY seconds.
# The lines of the wait and the stars are plain, never dim like the rest
# of the progress log (r1h: dim, they were hard to see).
# wait_line <text>: such a line, after the stars of the line before.
wait_line() { say_sign "$1"; }
# wait_with_signs: the wait of CHECKS_DELAY seconds between two looks.
wait_with_signs() {
  local i=0
  if ! stdout_is_terminal; then
    pause_for "$CHECKS_DELAY"
    return 0
  fi
  while [ "$i" -lt "$CHECKS_DELAY" ]; do
    pause_for 1
    say_open "*"
    i=$((i + 1))
  done
}

# wait_for_build: spec step 15. Each look after the first says the time
# waited so far against the limit (the waits counted, not the time gh
# takes to answer).
wait_for_build() {
  local tries=0 max limit
  PR_NUMBER="${PR_URL##*/}"
  duration_words $((IN_CI_TIMEOUT * 60))
  limit="$DURATION"
  step_start "Waiting for the project's check build to pass on the proposed change, for at most $limit"
  # The note says on its own what the limit is (end-to-end run 3, r3e):
  # it is in another colour than the line above it.
  say_note "The script waits at most $limit for build to pass. If build has not passed by then, the script stops, leaves the proposed change open and shows how to continue (--ci-timeout sets a different limit)."
  say_note "You can follow the check here: $PR_URL/checks"
  max=$((IN_CI_TIMEOUT * 60 / CHECKS_DELAY))
  while :; do
    look_at_build
    [ "$BUILD_STATE" != pass ] || break
    [ "$BUILD_STATE" != fail ] || build_failed
    if [ "$tries" -ge "$max" ]; then
      stop_with_error "The project's check build had not passed on the proposed change after $limit, so the script did not add the change to the main version. The proposed change stays open on GitHub." \
        "Open $PR_URL in your browser and click Checks to see whether build is still running. Then continue the setup with the command shown above; to wait longer, add --ci-timeout and a number of minutes to it, such as --ci-timeout 40." \
        "$BUILD_SEEN"
    fi
    [ "$tries" -gt 0 ] || wait_line "The check build has not finished yet; the script looks again every $CHECKS_DELAY seconds."
    wait_with_signs
    tries=$((tries + 1))
    duration_words $((tries * CHECKS_DELAY))
    wait_line "Checking the build status ($DURATION of at most $limit)"
  done
  step_end "The check build passed on the proposed change."
}

# read_back_protection: GitHub's protection of main, field by field
# (READ_BACK, one "field=value" per line), must be what REQUIRE_BODY
# set; each difference is listed below the stop.
read_back_protection() {
  local pair field want got line found diffs=""
  api_call "repos/$IN_OWNER/$IN_NAME/branches/main/protection" --jq "$READBACK_JQ"
  # No protection at all, and the user chose to go on without it: only
  # for a private project (the plan's limit), as GitHub says.
  if [ -n "$OPT_ALLOW_UNPROTECTED" ] && [ "$API_STATUS" = 404 ] && private_on_github; then
    UNPROTECTED=1
    return 0
  fi
  # A project set up already and not protected: said, and left as it is.
  if [ -n "$CHANGE_ADDED" ] && [ "$API_STATUS" = 404 ]; then
    api_raw
    stop_with_error "GitHub says the main version of the project has no protection, so nothing stops a change from going straight into it. The script changed nothing." \
      "Turn protection on for the main version: open https://github.com/$IN_OWNER/$IN_NAME/settings in your browser (docs/DEV_INFRASTRUCTURE.md in the project says how), then continue with the command shown above. Protection for a private project needs a paid GitHub plan, or the project made public." \
      "$API_RAW"
  fi
  { [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; } || api_fail "read back the protection of the main version"
  READ_BACK="$API_BODY"
  for pair in $REQUIRE_READBACK; do
    field="${pair%%=*}"
    want="${pair#*=}"
    found=""
    got=""
    while IFS= read -r line; do
      case "$line" in "$field="*)
        found=1
        got="${line#*=}"
        ;;
      esac
    done <<<"$READ_BACK"
    if [ -z "$found" ]; then
      if [ -n "$CHANGE_ADDED" ]; then diffs="$diffs$field: expected $want, GitHub reports nothing$NL"; else diffs="$diffs$field: the script set $want, GitHub reports nothing$NL"; fi
    elif [ "$got" != "$want" ]; then
      if [ -n "$CHANGE_ADDED" ]; then diffs="$diffs$field: expected $want, GitHub reports $got$NL"; else diffs="$diffs$field: the script set $want, GitHub reports $got$NL"; fi
    fi
  done
  [ -n "$diffs" ] || return 0
  if [ -n "$CHANGE_ADDED" ]; then
    stop_with_error "GitHub does not report the protection of the main version with the rules the setup gives it. The project is set up already, so the script changed nothing." \
      "Open https://github.com/$IN_OWNER/$IN_NAME/settings in your browser and look at the rule that protects the main version; the details below show what differs. Fix the rule there, then continue the setup with the command shown above. If you did not change that rule, ask for help and show the details below." \
      "${diffs%"$NL"}"
  fi
  stop_with_error "GitHub does not report the protection of the main version as the script set it, so the script did not add the setup's change to the main version. The proposed change stays open on GitHub." \
    "Open https://github.com/$IN_OWNER/$IN_NAME/settings in your browser and look at the rule that protects the main version; the details below show what differs. Then continue the setup with the command shown above. If you did not change that rule, ask for help and show the details below." \
    "${diffs%"$NL"}"
}

# read_back_value <field>: READ_BACK_VALUE is the value READ_BACK has
# for it (empty when it has none).
READ_BACK_VALUE=""
read_back_value() {
  local line
  READ_BACK_VALUE=""
  while IFS= read -r line; do
    case "$line" in "$1="*) READ_BACK_VALUE="${line#*=}" ;; esac
  done <<<"$READ_BACK"
}

# require_build: spec step 16, after build has passed.
require_build() {
  step_start "Making the check build required, so that from now on a change is added to the main version only after build passes"
  if [ -n "$UNPROTECTED" ]; then
    step_end "Not done: the main version is not protected, as you chose with --allow-unprotected, so no check can be made required."
    return 0
  fi
  api_call -X PUT "repos/$IN_OWNER/$IN_NAME/branches/main/protection" --input - <<<"$REQUIRE_BODY"
  if [ "$API_STATUS" = 403 ] && [ -n "$OPT_ALLOW_UNPROTECTED" ]; then
    classify_protect_403
    if plan_limit_on_private; then
      UNPROTECTED=1
      step_end "Not done: GitHub cannot protect the main version on this plan, and you chose to go on without protection with --allow-unprotected."
      return 0
    fi
  fi
  { [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; } || api_fail "make the check build required for the main version" \
    "Open https://github.com/$IN_OWNER/$IN_NAME in your browser and check that your account is one of its admins (who may change its settings); then continue the setup with the command shown above."
  read_back_protection
  step_end "GitHub reports the protection of the main version as the script set it, with build required."
}

# ensure_decision_in_change: without protection, the change is added to the
# main version only when memory/decisions.md in it says so (the row is
# written when the change is made; a resume that learns of the missing
# protection later finds the change without it).
ensure_decision_in_change() {
  local text
  [ -n "$UNPROTECTED" ] || return 0
  text="$(git -C "$IN_DIR" show "refs/heads/$SETUP_BRANCH:memory/decisions.md" 2>/dev/null)" || text=""
  case "$text" in
    *"$UNPROTECTED_ROW_KEY"*)
      DECISION_NOTED=1
      return 0
      ;;
  esac
  OPT_ALLOW_UNPROTECTED=""
  stop_with_error "The setup's change, proposed at $PR_URL, does not say in memory/decisions.md that the main version is not protected, and the script does not add a change to a main version without protection unless it says so. The proposed change stays open on GitHub." \
    "Protect the main version: move to a paid GitHub plan (Pro, Team or Enterprise) or make the project public, then continue the setup with the command shown above." \
    "memory/decisions.md on the line of work $SETUP_BRANCH has no row that starts with: $UNPROTECTED_ROW_KEY"
}

# merge_change: spec step 17. The id given is the change that was sent,
# so GitHub adds nothing else. Whatever gh says, GitHub is then asked
# whether the change was added (gh can fail after GitHub has added it).
merge_change() {
  local out err rc=0 raw sent state
  step_start "Adding the proposed change to the main version of the project"
  PR_NUMBER="${PR_URL##*/}"
  sent="$(git -C "$IN_DIR" rev-parse -q --verify "refs/heads/$SETUP_BRANCH" 2>/dev/null)" || sent=""
  if [ -z "$sent" ]; then
    stop_with_error "git could not tell which change the script sent to GitHub: the line of work $SETUP_BRANCH is missing from the copy of the project on this computer, in $IN_DIR. The proposed change stays open on GitHub." \
      "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "git rev-parse --verify refs/heads/$SETUP_BRANCH found nothing in $IN_DIR"
  fi
  out="$(make_temp)"
  err="$(make_temp)"
  # Run inside the copy, so gh can switch it to main (step 18 checks);
  # git, which gh runs there, may not ask at the terminal.
  (CDPATH='' cd -- "$IN_DIR" && GIT_TERMINAL_PROMPT=0 run_gh pr merge "$PR_NUMBER" --squash --delete-branch --match-head-commit "$sent") >"$out" 2>"$err" || rc=$?
  raw="$(cat "$out" "$err" | tr -d '\r')"
  rm -f "$out" "$err"
  if [ "$rc" -eq 4 ]; then
    stop_with_error "gh (the GitHub command-line tool) is not signed in to your GitHub account, so the script could not add the proposed change to the main version. The proposed change stays open on GitHub." \
      "$SIGN_IN_CONTINUE_NEXT" "$raw"
  fi
  api_call "repos/$IN_OWNER/$IN_NAME/pulls/$PR_NUMBER" --jq "$MERGED_JQ"
  { [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; } || api_fail "check whether the proposed change was added to the main version"
  trim_into "$API_BODY"
  state="$TRIMMED"
  # "true <id of the new main>" once added; anything else is not added.
  MERGED_SHA=""
  case "$state" in "true "*) MERGED_SHA="${state#true }" ;; esac
  # Once GitHub says the change is added, what exists is that.
  [ -z "$MERGED_SHA" ] || CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, and the setup's changes are in its main version there: $PR_URL"
  case "$MERGED_SHA" in
    *[!0-9a-f]*)
      stop_with_error "GitHub says the proposed change was added to the main version, but it did not give the id of the new main version, so the script cannot check the copy on this computer against it." \
        "Open $PR_URL in your browser to see that the change was added, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
        "GitHub reports for the proposed change: $state"
      ;;
  esac
  if [ -z "$MERGED_SHA" ]; then
    [ -n "$raw" ] || raw="gh stopped with exit code $rc and no message."
    stop_with_error "GitHub did not add the proposed change to the main version. The proposed change stays open on GitHub." \
      "Open $PR_URL in your browser: at the bottom of the page GitHub says what stops the change from being added. Then continue the setup with the command shown above. If it is not clear, ask for help and show the details below." \
      "$raw${NL}GitHub reports for the proposed change: $state"
  fi
  CREATED_NOTE="The project $IN_OWNER/$IN_NAME exists on GitHub, and the setup's changes are in its main version there: $PR_URL"
  step_end "The setup's changes are in the main version of the project on GitHub."
}

# finish_copy: spec step 18. gh pr merge may already have switched the
# copy to main, brought it up to date and deleted bootstrap-setup in it,
# so each action runs only when still needed; the update of main always
# runs, with --prune so GitHub's deleted line of work goes from the copy
# too. Then the copy must be at GitHub's new main with nothing unsaved.
KEPT_LINE_OF_WORK=""
finish_copy() {
  local out err rc=0 raw current head status
  step_start "Updating the copy on this computer to the new main version"
  current="$(git -C "$IN_DIR" symbolic-ref -q --short HEAD 2>/dev/null)" || current=""
  [ "$current" = main ] || in_copy "switch to the main version" checkout -q main
  out="$(make_temp)"
  err="$(make_temp)"
  with_gh_sign_in "$out" "$err" -C "$IN_DIR" pull -q --ff-only --prune || rc=$?
  raw="$(cat "$out" "$err" | tr -d '\r')"
  rm -f "$out" "$err"
  if [ "$rc" -ne 0 ]; then
    [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
    stop_with_error "git could not bring the copy of the project on this computer, in $IN_DIR, up to date with the main version on GitHub." \
      "Check that this computer is connected to the internet, then continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  # The line of work goes only when its files are those of the main
  # version (gh already deletes it after adding the change); one that holds
  # something else may be work of the user's, and stays.
  KEPT_LINE_OF_WORK=""
  if git -C "$IN_DIR" rev-parse -q --verify "refs/heads/$SETUP_BRANCH" >/dev/null 2>&1; then
    if [ "$(git -C "$IN_DIR" rev-parse -q --verify "refs/heads/$SETUP_BRANCH^{tree}" 2>/dev/null)" = "$(git -C "$IN_DIR" rev-parse -q --verify "HEAD^{tree}" 2>/dev/null)" ]; then
      in_copy "delete the line of work $SETUP_BRANCH" branch -q -D "$SETUP_BRANCH"
    else
      KEPT_LINE_OF_WORK=1
    fi
  fi
  head="$(git -C "$IN_DIR" rev-parse -q --verify HEAD 2>/dev/null)" || head=""
  if [ "$head" != "$MERGED_SHA" ]; then
    stop_with_error "The copy of the project on this computer, in $IN_DIR, is not at the main version that GitHub has now." \
      "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "the copy: ${head:-none}${NL}main on GitHub: $MERGED_SHA"
  fi
  status="$(git -C "$IN_DIR" status --porcelain --untracked-files=all 2>&1)" || status="git status failed: $status"
  if [ -n "$status" ]; then
    stop_with_error "The copy of the project on this computer, in $IN_DIR, has changes that are not saved after the update." \
      "Look at the files named below in $IN_DIR. If you did not change them, ask for help and show the details below." \
      "$status"
  fi
  step_end "The copy in $IN_DIR is on the main version, with the setup's changes, and nothing is left unsaved.${KEPT_LINE_OF_WORK:+ Its line of work $SETUP_BRANCH was kept: it holds changes that are not in the main version.}"
}

# say_what_next: the one next step and then, as the very last line the
# script prints, where to go when stuck (end-to-end run 1, finding 10).
# Between them, how to start that chat and its first message, the start
# line of the Rules' P-1 § 2 (5) with this project filled in, indented as
# text to copy (p2.9.0-b and -c, newcomer pre-check on v2.9.0). One text
# for every ending of report, so the endings cannot drift.
say_what_next() {
  say "What to do next: in the Claude app, create a Claude Project for this project (how: https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects), add the project on GitHub, https://github.com/$IN_OWNER/$IN_NAME, to that Claude Project, choosing all files (how: https://support.claude.com/en/articles/10167454-using-the-github-integration), and start a chat inside the Claude Project. The file CLAUDE.md in the project tells Claude the rest."
  say_note "To start that chat on a computer: click Projects in the menu on the left, choose the project, and type the first message in its input field. In the Claude app on an Android phone, open the menu at the top left, tap the projects entry, choose the project, tap the new-session button at the bottom right, and type the first message in the input field."
  say_note "As the first message, copy this line into the input field:"
  say "    Attach $IN_OWNER/$IN_NAME with push access, read its CLAUDE.md, rules/RULES.md and RULES.md, and run the session startup."
  say "If you ever feel stuck and do not know how to go on, Clead (Claude, the project's Tech Owner) is always there to help: just ask Clead for help, a recommendation or advice in the chat."
}

# HAVE_COPY: the copy of the project is on this computer (--resume found
# the setup already added and no copy, and does not make one).
HAVE_COPY=1

# report: spec step 19, in plain words, at the end.
report() {
  local deploy="" licence approvals checks
  [ "$IN_WITH_DEPLOY" != yes ] || deploy=", with the files that publish the website"
  if [ "$IN_LICENSE" = none ]; then
    licence="none, so no licence file"
  elif [ -n "$IN_COPYRIGHT_HOLDER" ]; then
    licence="$IN_LICENSE, in the name of $IN_COPYRIGHT_HOLDER"
  else
    licence="$IN_LICENSE"
  fi
  read_back_value approvals
  approvals="$READ_BACK_VALUE"
  read_back_value contexts
  checks="$READ_BACK_VALUE"
  # The other fields read back are fixed: read_back_protection stopped
  # unless each one is what the script set.
  say "The setup is finished."
  say "    The project on GitHub: https://github.com/$IN_OWNER/$IN_NAME"
  [ -z "$HAVE_COPY" ] || say "    Its copy on this computer: $IN_DIR"
  [ -z "$PR_URL" ] || say "    The proposed change with the setup: $PR_URL"
  [ -z "$IN_PACK" ] || say "    Language pack: $IN_PACK$deploy"
  [ -z "$IN_LICENSE" ] || say "    Licence: $licence"
  if [ -n "$UNPROTECTED" ]; then
    say "The main version is not protected:"
    if [ -n "$DECISION_NOTED" ]; then
      say "    - the main version is not protected: you chose to go on without protection (--allow-unprotected), and memory/decisions.md in the project says so"
    else
      say "    - the main version is not protected: you chose to go on without protection (--allow-unprotected), but memory/decisions.md in the project does not say so; add a row for it to the table there"
    fi
    say "    - to protect it, move to a paid GitHub plan or make the project public, then turn protection on in the project's settings"
  else
    say "The protection of the main version, as GitHub reports it:"
    say "    - every change comes as a proposed change; approvals needed before one is added: $approvals"
    say "    - a change is added only after these checks pass: ${checks//,/, }"
    say "    - these rules apply to the project's admins too"
    say "    - nobody may overwrite the history of the main version or delete it"
  fi
  [ -n "$CHANGE_ADDED" ] || say_left_for_clead
  say_what_next
}

# ---------- stops nobody planned for ----------
# catch_stops: from here on, a command that fails where the script has no
# message of its own, and Ctrl-C, end with a plain stop: what happened,
# what exists (the project, the line of work, the proposed change, the
# folder), the command to continue, and the command that failed below
# for support. A folder the script made for the copy is removed if it is
# not complete, and the temporary files go in every case. A deliberate
# stop (fail) sets CLEAN, so nothing is added to it.
MADE_DIR=""
ERR_HINT=""
UNEXPECTED_LOG=""
INTERRUPTED=""
ERR_CMD=""
ERR_RC=""
ERR_LINE=""
catch_stops() {
  set -E
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-project.XXXXXX")"
  STDERR_LOG="$WORK_DIR/stderr.log"
  trap 'ERR_RC=$?; ERR_CMD=${ERR_HINT:-$BASH_COMMAND}; ERR_HINT=""; ERR_LINE=$LINENO' ERR
  trap 'INTERRUPTED=1; exit 130' INT
  trap 'leave_script' EXIT
}

# leave_script: the EXIT handler of catch_stops.
leave_script() {
  local rc=$? work="$WORK_DIR"
  trap - EXIT INT ERR
  if [ -n "$AGAIN_TMP" ]; then rm -f -- "$AGAIN_TMP"; fi
  AGAIN_TMP=""
  restore_terminal_mode
  UNEXPECTED_LOG=""
  [ -z "$STDERR_LOG" ] || [ ! -s "$STDERR_LOG" ] || UNEXPECTED_LOG="$(tail -5 "$STDERR_LOG" | tr -d '\r')"
  WORK_DIR=""
  if [ -n "$MADE_DIR" ] && [ -d "$MADE_DIR" ]; then rm -rf -- "$MADE_DIR"; fi
  MADE_DIR=""
  if [ -n "$work" ]; then rm -rf -- "$work"; fi
  [ "$rc" -ne 0 ] || return 0
  [ -z "$CLEAN" ] || return 0
  unexpected_stop
}

# unexpected_stop: the plain stop for a failure the script did not plan
# for, or for Ctrl-C (exit 130).
unexpected_stop() {
  local what next raw
  if [ -n "$INTERRUPTED" ]; then
    STOP_CODE=130
    what="The script was stopped before it finished."
    raw="The script was stopped with Ctrl-C (or by a request to stop) while: ${CURRENT_STEP:-starting up}"
  else
    what="Something unexpected happened, so the script stopped while: ${CURRENT_STEP:-starting up}."
    raw="The command that failed: ${ERR_CMD:-not known} (exit code ${ERR_RC:-not known}, line ${ERR_LINE:-not known} of the script)"
    [ -z "$UNEXPECTED_LOG" ] || raw="$raw${NL}Its own message:$NL$UNEXPECTED_LOG"
  fi
  if [ -n "$CREATED_NOTE" ]; then
    next="Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below."
  else
    what="$what Nothing was created."
    next="Start the script again with the command shown above. If the same thing happens, ask for help and show the details below."
  fi
  stop_with_error "$what" "$next" "$raw"
}

# ---------- continuing a setup that stopped part way (--resume) ----------
# The state is worked out from GitHub and from the copy on this computer,
# never from a file of the script's own (spec, "Existing repo"):
#   not from this version of the bootstrapper   refused
#   the setup's changes are in main already     added: re-check the protection, report
#   an open proposed change from bootstrap-setup proposed: continue at the wait for build
#   bootstrap-setup on GitHub, no proposed change sent: continue at proposing
#   a saved change in the copy, not on GitHub   saved: continue at sending
#   the copy has none of the setup's changes    fresh: continue at step 3, in that copy
#   the template's files only                   template: continue at step 3
# A copy with changes not saved is refused: the script never discards work.

PULLS_JQ='.[] | "\(.state) \(.merged_at // "-") \(.html_url)"'
SETUP_MARK="- Set up by bootstrap-project.sh."
RESUME_STATE=""
GH_ADDED_MARK=""
GH_OPEN_URL=""
GH_MERGED_URL=""
GH_BRANCH_SHA=""
GH_MAIN_SHA=""
COPY_PRESENT=""
COPY_UNSAVED=""
COPY_SETUP_SHA=""
COPY_AHEAD=0
COPY_ORIGIN_MAIN=""

# github_main_sha: GH_MAIN_SHA is the id of the last change of main.
github_main_sha() {
  api_call "repos/$IN_OWNER/$IN_NAME/branches/main" --jq .commit.sha
  { [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; } || api_fail "read the main version of the project"
  trim_into "$API_BODY"
  GH_MAIN_SHA="$TRIMMED"
}

# set_state_note <state>: CREATED_NOTE says what exists in this state.
set_state_note() {
  local project="The project $IN_OWNER/$IN_NAME exists on GitHub"
  case "$1" in
    template) CREATED_NOTE="$project, with only the bootstrapper's files in it." ;;
    fresh) CREATED_NOTE="$project, with only the bootstrapper's files in it, and a copy of it is on this computer in $IN_DIR." ;;
    saved) CREATED_NOTE="$project, and the setup's changes are saved in its copy on this computer, in $IN_DIR, but not sent to GitHub yet." ;;
    sent) CREATED_NOTE="$project, and the setup's changes are saved in its copy on this computer, in $IN_DIR, and sent to GitHub on the line of work $SETUP_BRANCH." ;;
    proposed) CREATED_NOTE="$project, and the setup's changes are proposed there: $PR_URL" ;;
    added) CREATED_NOTE="$project, and it is set up already${PR_URL:+: $PR_URL}" ;;
  esac
}

# refuse_project <title> <why> [how checked]: a project the script will
# not continue; the command shown starts a new project. <how checked> is
# the guide's "How the script checks it"; without it, the CHANGELOG.md
# check of the version.
refuse_project() {
  FRESH_START=1
  CREATED_NOTE=""
  guide_begin "$1" "$2"
  guide_step "Set up a new project instead, with a name that is not taken: run the command shown below with the name after --name changed, such as --name $IN_NAME-2. The script never changes or deletes the project that is there."
  guide_step "Or, to finish this project yourself, open https://github.com/$IN_OWNER/$IN_NAME in your browser and do the steps that are still open; the project's docs/DEV_INFRASTRUCTURE.md says how to protect its main version by hand."
  guide_end "the script says \"Done.\" after the last step and shows the report." \
    "if you do not want the project that is there, rename or delete it on GitHub yourself (in its Settings); the script does not delete a project." \
    "${3:-it reads the file CHANGELOG.md of the project on GitHub, which says which version of the bootstrapper made the project.}"
  stop_at_guide
}

# guide_line_endings: README.md or CHANGELOG.md of a project not set up
# yet has a carriage return on GitHub (GH_README_CR, GH_CHANGELOG_CR).
# The setup's checks in the copy would stop on it only after the
# protection was set, so the stop comes before anything is written. The
# project is the user's to fix: the command shown continues the setup
# (--resume), FRESH_START stays unset.
guide_line_endings() {
  local files="" title
  [ -z "$GH_README_CR" ] || files="README.md"
  [ -z "$GH_CHANGELOG_CR" ] || files="${files:+$files and }CHANGELOG.md"
  case "$files" in
    *" and "*) title="The files $files of the project $IN_OWNER/$IN_NAME on GitHub each have a carriage return (as files saved on Windows do)." ;;
    *) title="The file $files of the project $IN_OWNER/$IN_NAME on GitHub has a carriage return (as files saved on Windows do)." ;;
  esac
  guide_begin "$title" \
    "The setup changes $files in a copy of the project, and every file of the project keeps LF line endings (as on macOS and Linux). Found later, a carriage return would stop the setup after it had already changed the project's settings on GitHub, so the script changes nothing in the project until then."
  guide_step "Save $files with LF line endings, in the main version of the project on GitHub. In Visual Studio Code, for example: open the file in a copy of the project, click \"CRLF\" in the bar at the bottom, choose \"LF\", save the file, and send the change to GitHub. If GitHub refuses to take the change straight into the main version (it is protected already), propose the change on GitHub and add it there."
  guide_step "Then continue the setup with the command shown below."
  guide_end "the script says \"Done.\" after \"Working out where the setup stopped\" and goes on with the setup." \
    "if the script stops here again, the file on GitHub still has a carriage return: check that the change with LF line endings is in the main version there. If it is, ask for help." \
    "it reads README.md and CHANGELOG.md of the project on GitHub, as GitHub stores them, and looks for a carriage return anywhere in them."
  stop_at_guide
}

# refuse_copy <title> <why>: the copy on this computer does not fit what
# GitHub has; nothing in it is touched.
refuse_copy() {
  guide_begin "$1" "$2"
  guide_step "Either move the folder $IN_DIR somewhere else yourself (for example in your file manager); nothing in it is deleted. Then continue the setup with the command shown below: the script makes a new copy from what GitHub has."
  guide_step "If you want to keep working in the folder, look at what it holds with git yourself, make it match GitHub, and then continue the setup with the command shown below."
  guide_end "the script says \"Done. The folder is new or empty\" and carries on." \
    "if you moved the folder and the script still finds it, check that nothing is left at $IN_DIR, hidden files included." \
    "it asks git for the changes not saved in the folder, and compares its line of work $SETUP_BRANCH with the one GitHub has."
  stop_at_guide
}

# resume_read_github: what GitHub has: whether the project is private, the
# bootstrapper's version in its CHANGELOG.md, its proposed changes from
# bootstrap-setup, and bootstrap-setup itself.
GH_TIDY="" GH_PACK="" GH_DEPLOY="" GH_LICENCE="" GH_HAS_SECTION="" GH_SECTION_CR="" GH_README_CR="" GH_CHANGELOG_CR=""
resume_read_github() {
  local line state merged url body
  api_call "repos/$IN_OWNER/$IN_NAME" --jq .private
  { [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; } || api_fail "read whether the project $IN_OWNER/$IN_NAME is private"
  trim_into "$API_BODY"
  case "$TRIMMED" in
    true)
      IN_VISIBILITY=private
      VISIBILITY_FROM_GITHUB=1
      ;;
    false)
      IN_VISIBILITY=public
      VISIBILITY_FROM_GITHUB=1
      ;;
  esac

  API_KEEP_CR=1 api_call -H "Accept: application/vnd.github.raw+json" "repos/$IN_OWNER/$IN_NAME/contents/CHANGELOG.md"
  if [ "$API_STATUS" = 404 ]; then
    # GitHub may still be copying the files into a project that was just
    # made; one with a main version but no CHANGELOG.md is not ours.
    api_call "repos/$IN_OWNER/$IN_NAME/branches/main"
    if [ "$API_STATUS" = 404 ]; then
      wait_for_files
      CURRENT_STEP="$RESUME_STEP"
    fi
    API_KEEP_CR=1 api_call -H "Accept: application/vnd.github.raw+json" "repos/$IN_OWNER/$IN_NAME/contents/CHANGELOG.md"
  fi
  body=""
  GH_CHANGELOG_CR=""
  case "$API_STATUS" in
    200)
      body="$API_BODY"
      case "$API_BODY_CR" in *"$CR"*) GH_CHANGELOG_CR=1 ;; esac
      ;;
    404) ;;
    *) api_fail "read the file CHANGELOG.md of the project" ;;
  esac
  if [ -z "$body" ] || ! read_published_version "$body"; then
    refuse_project "The project $IN_OWNER/$IN_NAME on GitHub was not made from the bootstrapper: the file CHANGELOG.md that the bootstrapper puts in each project is missing, or does not say which version made it." \
      "--resume continues a setup of a project made by this version of the bootstrapper, and it cannot tell what this project is."
  fi
  if [ "$PUBLISHED_VERSION" != "$SCRIPT_VERSION" ]; then
    refuse_project "The project $IN_OWNER/$IN_NAME was made with version $PUBLISHED_VERSION of the bootstrapper, and this script is version $SCRIPT_VERSION." \
      "Each version of the bootstrapper sets up a project in its own way, so this script finishes only projects made by the same version."
  fi
  GH_ADDED_MARK=""
  GH_PACK="" GH_DEPLOY="" GH_LICENCE=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//$CR/}"
    [ "$line" != "$SETUP_MARK" ] || GH_ADDED_MARK=1
    case "$line" in
      "- Language pack: "*)
        line="${line#- Language pack: }"
        line="${line%.}"
        case "$line" in
          *", with the files that publish the website")
            GH_DEPLOY=yes
            line="${line%, with the files that publish the website}"
            ;;
        esac
        GH_PACK="$line"
        ;;
      "- Licence: "*)
        line="${line#- Licence: }"
        GH_LICENCE="${line%.}"
        ;;
    esac
  done <<<"$body"

  # A project with no setup section in its README and no bootstrap-project.sh
  # was tidied up already: set up by this script or by hand. The heading
  # is matched whole and as stored, as the copy's check (grep -x) matches
  # it; one found only with its carriage return removed is GH_SECTION_CR.
  # GH_README_CR: a carriage return anywhere in the README, which the
  # copy's checks stop on after the protection was set (#169 review, N1).
  GH_TIDY=""
  API_KEEP_CR=1 api_call -H "Accept: application/vnd.github.raw+json" "repos/$IN_OWNER/$IN_NAME/contents/README.md"
  case "$API_STATUS" in
    200 | 404) ;;
    *) api_fail "read the file README.md of the project" ;;
  esac
  GH_HAS_SECTION=""
  GH_SECTION_CR=""
  GH_README_CR=""
  if [ "$API_STATUS" = 200 ]; then
    case "$API_BODY_CR" in *"$CR"*) GH_README_CR=1 ;; esac
    while IFS= read -r line || [ -n "$line" ]; do
      if [ "$line" = "$SETUP_HEADING" ]; then
        GH_HAS_SECTION=1
      elif [ "${line%"$CR"}" = "$SETUP_HEADING" ]; then
        GH_SECTION_CR=1
      fi
    done <<<"$API_BODY_CR"
  fi
  api_call -H "Accept: application/vnd.github.raw+json" "repos/$IN_OWNER/$IN_NAME/contents/bootstrap-project.sh"
  case "$API_STATUS" in
    200 | 404) ;;
    *) api_fail "look for the file bootstrap-project.sh in the project" ;;
  esac
  if [ -z "$GH_HAS_SECTION$GH_SECTION_CR" ] && [ "$API_STATUS" = 404 ]; then GH_TIDY=1; fi

  GH_OPEN_URL=""
  GH_MERGED_URL=""
  api_call "repos/$IN_OWNER/$IN_NAME/pulls?state=all&head=$IN_OWNER:$SETUP_BRANCH" --jq "$PULLS_JQ"
  { [ "$API_RC" -eq 0 ] && [ "$API_STATUS" = 200 ]; } || api_fail "look for the proposed change of the setup"
  while IFS=' ' read -r state merged url; do
    [ -n "$url" ] || continue
    if [ "$state" = open ] && [ -z "$GH_OPEN_URL" ]; then GH_OPEN_URL="$url"; fi
    if [ "$merged" != "-" ] && [ -z "$GH_MERGED_URL" ]; then GH_MERGED_URL="$url"; fi
  done <<<"$API_BODY"

  GH_BRANCH_SHA=""
  api_call "repos/$IN_OWNER/$IN_NAME/branches/$SETUP_BRANCH" --jq .commit.sha
  case "$API_STATUS" in
    200)
      trim_into "$API_BODY"
      GH_BRANCH_SHA="$TRIMMED"
      ;;
    404) ;;
    *) api_fail "look for the line of work $SETUP_BRANCH of the project" ;;
  esac
}

# resume_read_copy: what the copy on this computer has (check_target_dir
# has seen that a folder with files is this project's own copy).
resume_read_copy() {
  local err rc=0 raw
  COPY_PRESENT=""
  COPY_UNSAVED=""
  COPY_SETUP_SHA=""
  COPY_AHEAD=0
  COPY_ORIGIN_MAIN=""
  [ -d "$IN_DIR" ] && [ -n "$(ls -A "$IN_DIR" 2>/dev/null)" ] || return 0
  COPY_PRESENT=1
  err="$(make_temp)"
  COPY_UNSAVED="$(git -C "$IN_DIR" status --porcelain --untracked-files=all 2>"$err")" || rc=$?
  raw="$(tr -d '\r' <"$err")"
  rm -f "$err"
  if [ "$rc" -ne 0 ]; then
    [ -n "$raw" ] || raw="git stopped with exit code $rc and no message."
    stop_with_error "git could not look at the copy of the project on this computer, in $IN_DIR." \
      "Continue the setup with the command shown above. If the same thing happens, ask for help and show the details below." \
      "$raw"
  fi
  COPY_UNSAVED="${COPY_UNSAVED//$CR/}"
  COPY_SETUP_SHA="$(git -C "$IN_DIR" rev-parse -q --verify "refs/heads/$SETUP_BRANCH" 2>/dev/null)" || COPY_SETUP_SHA=""
  COPY_ORIGIN_MAIN="$(git -C "$IN_DIR" rev-parse -q --verify refs/remotes/origin/main 2>/dev/null)" || COPY_ORIGIN_MAIN=""
  if [ -n "$COPY_SETUP_SHA" ] && [ -n "$COPY_ORIGIN_MAIN" ]; then
    COPY_AHEAD="$(git -C "$IN_DIR" rev-list --count "$COPY_ORIGIN_MAIN..$COPY_SETUP_SHA" 2>/dev/null)" || COPY_AHEAD=0
  fi
}

# resume_decide: RESUME_STATE, from what GitHub and the copy have. A copy
# that does not fit what GitHub has is refused before anything changes.
resume_decide() {
  local subject
  if [ -n "$COPY_PRESENT" ] && [ -n "$COPY_UNSAVED" ]; then
    refuse_copy "The copy of the project in $IN_DIR has changes that are not saved." \
      "The script never discards your work, so it does not go on in a copy that holds changes it cannot tell from its own."
  fi
  PR_URL=""
  if [ -n "$GH_ADDED_MARK" ] || [ -n "$GH_MERGED_URL" ] || [ -n "$GH_TIDY" ]; then
    RESUME_STATE=added
    PR_URL="$GH_MERGED_URL"
  elif [ -n "$GH_OPEN_URL" ]; then
    RESUME_STATE=proposed
    PR_URL="$GH_OPEN_URL"
  elif [ -n "$GH_BRANCH_SHA" ]; then
    RESUME_STATE=sent
  elif [ -n "$COPY_PRESENT" ] && [ "$COPY_AHEAD" -gt 0 ]; then
    RESUME_STATE=saved
  elif [ -n "$COPY_PRESENT" ]; then
    RESUME_STATE=fresh
  else
    RESUME_STATE=template
  fi
  # Not set up yet, and README.md or CHANGELOG.md has a carriage return on
  # GitHub: the copy's checks would stop on it, and only after the
  # protection was set. A project set up already is only read, so its
  # line endings do not matter (S18a).
  if [ "$RESUME_STATE" != added ] && [ -n "$GH_README_CR$GH_CHANGELOG_CR" ]; then
    guide_line_endings
  fi
  # Not set up (the script is there) and not waiting for its setup (the
  # README has lost the setup section): it cannot be placed, so nothing is
  # written to it.
  if [ "$RESUME_STATE" != added ] && [ -z "$GH_HAS_SECTION" ]; then
    refuse_project "The project $IN_OWNER/$IN_NAME still has the bootstrapper's script, bootstrap-project.sh, but its README.md no longer has the setup section \"$SETUP_HEADING\"." \
      "--resume continues a project that is waiting for its setup, or one that is set up already, and this one is neither; the script changes nothing in a project it cannot place." \
      "it reads the files README.md and bootstrap-project.sh of the project on GitHub: bootstrap-project.sh is there, and README.md has no line that is exactly \"$SETUP_HEADING\"."
  fi
  [ -n "$COPY_PRESENT" ] || return 0
  case "$RESUME_STATE" in
    sent | proposed)
      if [ -z "$COPY_SETUP_SHA" ]; then
        refuse_copy "The copy of the project in $IN_DIR does not have the line of work $SETUP_BRANCH that GitHub has." \
          "The setup's changes are on GitHub on that line of work, and the script goes on from the copy only when the copy has the same changes."
      fi
      if [ -n "$GH_BRANCH_SHA" ] && [ "$COPY_SETUP_SHA" != "$GH_BRANCH_SHA" ]; then
        refuse_copy "The line of work $SETUP_BRANCH in the copy of the project in $IN_DIR is not the same as the one GitHub has." \
          "The script goes on from the copy only when it has the same changes as GitHub, and it never changes either one to match the other."
      fi
      ;;
    saved | fresh)
      github_main_sha
      if [ "$COPY_ORIGIN_MAIN" != "$GH_MAIN_SHA" ]; then
        refuse_copy "The copy of the project in $IN_DIR is not at the main version that GitHub has now." \
          "The script goes on from the copy only when it starts from the same main version as GitHub."
      fi
      ;;
  esac
  # What is sent is the one change "Set up NAME" the script saved.
  case "$RESUME_STATE" in
    saved | sent | proposed)
      subject="$(git -C "$IN_DIR" log -1 --format=%s "refs/heads/$SETUP_BRANCH" 2>/dev/null)" || subject=""
      if [ "$COPY_AHEAD" -ne 1 ] || [ "$subject" != "Set up $IN_NAME" ]; then
        refuse_copy "The line of work $SETUP_BRANCH in the copy of the project in $IN_DIR is not the single change \"Set up $IN_NAME\" that the script saves." \
          "The script sends only the one change it saved itself, and it never changes the copy to make it so."
      fi
      ;;
  esac
}

RESUME_STEP=""
# resume_plan: the step that works the state out and says where the setup
# goes on.
resume_plan() {
  RESUME_STEP="Working out where the setup stopped, from GitHub and from the copy on this computer"
  step_start "$RESUME_STEP"
  resume_read_github
  resume_read_copy
  resume_decide
  set_state_note "$RESUME_STATE"
  case "$RESUME_STATE" in
    template) step_end "The project has only the bootstrapper's files, and there is no copy of it on this computer yet: the setup continues by protecting its main version." ;;
    fresh) step_end "The project has only the bootstrapper's files, and its copy on this computer has none of the setup's changes: the setup continues by protecting its main version, then uses that copy." ;;
    saved) step_end "The setup's changes are saved in the copy on this computer but not sent to GitHub: the setup continues by sending them." ;;
    sent) step_end "The setup's changes are on GitHub, on the line of work $SETUP_BRANCH, but not proposed: the setup continues by proposing them." ;;
    proposed) step_end "The setup's changes are proposed on GitHub, at $PR_URL: the setup continues by waiting for the check build." ;;
    added) step_end "The project is set up already: the script only checks its protection, brings the copy on this computer up to date if there is one, and shows the report." ;;
  esac
}

# resume_deploy_choice: with --resume, the web pack's publishing files
# (end-to-end run 1, r1e). Before the pack is laid out (template, fresh)
# the choice is still open: the option given, else the question, asked
# only now that the state is known. Once the setup's change is saved
# (saved, sent, proposed), the files are in it or not: the choice is read
# from that change, in the copy (resume_decide has checked that it matches
# GitHub's), or on GitHub when there is no copy; an option that says
# otherwise is refused before anything changes. A project set up already
# (added) takes it from main with the pack and the licence (resume_added).
DEPLOY_WORKFLOW=.github/workflows/deploy.yml
resume_deploy_choice() {
  local laid
  [ "$IN_PACK" = web ] || return 0
  case "$RESUME_STATE" in
    template | fresh)
      [ -n "$IN_WITH_DEPLOY" ] || ask_deploy
      ;;
    saved | sent | proposed)
      if [ -n "$COPY_PRESENT" ]; then
        # Not <rev>:<path>: Git Bash rewrites a <rev>:.github/... as a path
        # list before git sees it (#239).
        if [ -n "$(git -C "$IN_DIR" ls-tree --name-only "refs/heads/$SETUP_BRANCH" -- "$DEPLOY_WORKFLOW" 2>/dev/null)" ]; then laid=yes; else laid=no; fi
      else
        api_call -H "Accept: application/vnd.github.raw+json" "repos/$IN_OWNER/$IN_NAME/contents/$DEPLOY_WORKFLOW?ref=$SETUP_BRANCH"
        case "$API_STATUS" in
          200) laid=yes ;;
          404) laid=no ;;
          *) api_fail "look for the files that publish the website in the setup's changes on GitHub" ;;
        esac
      fi
      if [ -n "$IN_WITH_DEPLOY" ] && [ "$IN_WITH_DEPLOY" != "$laid" ]; then
        if [ "$laid" = yes ]; then
          add_problem --without-deploy "The setup's changes already have the files that publish the website, so this setup cannot leave them out now. Remove this option, or put --with-deploy in its place."
        else
          add_problem --with-deploy "The setup's changes do not have the files that publish the website, so this setup cannot add them now; you can add them to the project later. Remove this option, or put --without-deploy in its place."
        fi
        stop_if_problems
      fi
      IN_WITH_DEPLOY="$laid"
      ;;
  esac
}

# use_setup_branch: a copy with none of the setup's changes goes on in its
# line of work bootstrap-setup if it has one, else starts it.
use_setup_branch() {
  if [ -z "$COPY_SETUP_SHA" ]; then
    start_setup_branch
    return 0
  fi
  step_start "Going on in the line of work $SETUP_BRANCH of the copy"
  in_copy "switch to the line of work $SETUP_BRANCH" checkout -q "$SETUP_BRANCH"
  step_end "The setup's changes go on the line of work $SETUP_BRANCH, not straight into the main version."
}

# resume_copy: the later steps need the copy; make it if it is not there,
# on the line of work GitHub has.
resume_copy() {
  if [ -z "$COPY_PRESENT" ]; then
    clone_project
    set_git_identity
    step_start "Switching the copy to the line of work $SETUP_BRANCH, as GitHub has it"
    in_copy "switch to the line of work $SETUP_BRANCH" checkout -q --no-track -b "$SETUP_BRANCH" "origin/$SETUP_BRANCH"
    step_end "The copy is on the line of work $SETUP_BRANCH, with the setup's changes."
    COPY_PRESENT=1
  fi
  set_state_note "$RESUME_STATE"
}

# resume_added: the setup's changes are in main already: the protection is
# read back, the copy (if there is one) is brought up to date, and the
# report follows.
resume_added() {
  CHANGE_ADDED=1
  step_start "Checking the protection of the main version"
  read_back_protection
  step_end "$([ -n "$UNPROTECTED" ] && echo "The main version is not protected, as you chose with --allow-unprotected." || echo "GitHub reports the protection of the main version with build required.")"
  if [ -n "$UNPROTECTED" ]; then
    # The report says the decision is written down only if main has it.
    api_call -H "Accept: application/vnd.github.raw+json" "repos/$IN_OWNER/$IN_NAME/contents/memory/decisions.md"
    if [ "$API_STATUS" = 200 ]; then
      case "$API_BODY" in *"$UNPROTECTED_ROW_KEY"*) DECISION_NOTED=1 ;; esac
    fi
  fi
  # The pack and the licence are what the project says, not this run's answers.
  IN_PACK="$GH_PACK"
  IN_WITH_DEPLOY="${GH_DEPLOY:-no}"
  IN_LICENSE="$GH_LICENCE"
  IN_COPYRIGHT_HOLDER=""
  if [ -n "$COPY_PRESENT" ]; then
    github_main_sha
    MERGED_SHA="$GH_MAIN_SHA"
    finish_copy
  else
    HAVE_COPY=""
  fi
}

# run_steps <state>: the steps of the setup from where the state says.
run_steps() {
  case "$1" in
    template | fresh)
      protect_main
      set_merge_settings
      check_actions
      if [ "$1" = template ]; then
        clone_project
        set_git_identity
        start_setup_branch
      else
        set_git_identity
        use_setup_branch
        set_state_note fresh
      fi
      check_copy_fits
      lay_out_pack
      tidy_up
      fill_placeholders
      make_lockfile
      add_licence
      note_setup_in_changelog
      note_unprotected_decision
      self_check
      save_change
      send_change
      propose_change
      ;;
    saved)
      send_change
      propose_change
      ;;
    sent)
      resume_copy
      propose_change
      ;;
    proposed)
      resume_copy
      ;;
    added)
      resume_added
      report
      return 0
      ;;
  esac
  wait_for_build
  require_build
  ensure_decision_in_change
  merge_change
  finish_copy
  report
}

# stop_on_macos: macOS is not supported for now, so on a Mac the setup
# stops at once, before it changes anything. It comes straight after
# detect_os, before the checks, the colour key and every preflight; all
# three ways in (the plain command, --again, --resume) reach it. Exit 1:
# exit 3 promises a command to start again, which does not help on a Mac.
# No option skips it. The macOS branches of the guides stay, with their
# tests, which fake uname.
stop_on_macos() {
  [ "$OS_KIND" != macos ] || fail 1 "$MACOS_WHAT" "$MACOS_NEXT"
}

# cmd_setup <options...>: the setup. The options are checked first, then
# the checks that need no answer (the tools, the GitHub sign-in and the
# current version), so that nothing is asked in vain; the npm, folder,
# permission and name checks need answers, so they follow the questions.
# Then a new setup shows its plan, asks "Proceed?" and creates the
# project; --resume works out where the setup stopped and goes on from
# there (resume_plan, run_steps).
cmd_setup() {
  catch_stops
  parse_args "$@"
  GIVEN_LICENSE="$IN_LICENSE"
  if [ -n "$SCRIPT_PIPED" ] && [ -z "$OPT_NON_INTERACTIVE" ]; then
    fail 2 "The script was piped into bash, so it cannot ask its questions: they would read the script itself." \
      "Run the command from the README, which saves the script to a file first and then runs that file."
  fi
  remember_command "$@"
  detect_os
  stop_on_macos
  if [ -n "$OPT_NON_INTERACTIVE" ] && [ -z "$OPT_YES$OPT_DRY_RUN" ]; then
    add_problem --yes "With --non-interactive the script asks nothing, so it cannot ask \"Proceed?\" before it creates the project: add --yes to go ahead, or --dry-run to only see the plan."
  fi
  check_options
  show_colour_key
  preflight_tools
  preflight_github_account
  preflight_published_version
  collect_inputs
  preflight_npm
  preflight_target_dir
  preflight_github_permissions
  preflight_project_absent
  preflight_license
  if [ -n "$OPT_RESUME" ]; then
    resume_plan
    resume_deploy_choice
    plan_steps "$RESUME_STATE"
    if [ -n "$OPT_DRY_RUN" ]; then
      say "This was a dry run (--dry-run): the checks passed, and nothing was changed."
      exit 0
    fi
    confirm_plan
    show_advance_command
    run_steps "$RESUME_STATE"
    remove_again
    return 0
  fi
  show_plan
  if [ -n "$OPT_DRY_RUN" ]; then
    say "This was a dry run (--dry-run): the checks passed, and nothing was created."
    exit 0
  fi
  confirm_plan
  show_advance_command
  create_project
  wait_for_files
  run_steps template
  remove_again
}

# ---------- main ----------

main() {
  START_DIR="$(pwd 2>/dev/null)" || START_DIR=""
  case "${1:-}" in
    layout-pack)
      shift
      cmd_layout_pack "$@"
      ;;
    --again)
      # The saved answers come first, the options after --again follow
      # them (r2l), so an option given again wins.
      shift
      find_again_dir
      read_again
      set -- "${AGAIN_ARGS[@]}" "$@"
      cmd_setup "$@"
      ;;
    *)
      find_again_dir
      cmd_setup "$@"
      ;;
  esac
}

# Run unless sourced. Piped into bash there is no BASH_SOURCE: run too,
# and remember it (the questions cannot read stdin then).
SCRIPT_PIPED=""
if [ -z "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_PIPED=1
  main "$@"
elif [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
