#!/usr/bin/env bash
# Checks that a Rules edition folder is an unchanged build output.
#
# Usage:
#   check-rules-edition.sh <dir>              project mode
#   check-rules-edition.sh --template <dir>   template mode
#
# The edition is built elsewhere and never edited in this repository.
# <dir>/EDITION names it: line 1 the edition id (YYYY-MM-DD-<7 hex>), then
# one "<sha256>  <path>" line per file of the edition (lower-case hex, two
# spaces), sorted by path in byte order, paths relative to <dir>. EDITION
# does not list itself.
#
# Both modes recompute the SHA-256 of every listed file and fail on a
# mismatch, a missing file, a file in <dir> that EDITION does not list,
# or a malformed EDITION. Every problem is named.
#
# Project mode: an absent <dir> or <dir>/EDITION fails, so deleting the
# folder does not pass. No git is needed.
#
# Template mode (the template's own CI, on bootstrap/stubs/rules):
#   - an absent <dir> means there is no edition yet: nothing to check,
#     unless <dir> exists at the merge base, so the change deletes it,
#     which fails (once taken, an edition is only replaced by a newer one);
#   - a change that touches <dir> and any file outside it fails, so a
#     change of the edition is purely a build output. Deleted and renamed
#     files count on both sides.
#   <dir> is a plain path relative to the repository root. The change is
#   `git diff` from the merge base of <base> and HEAD, where <base> is, in
#   this order: $EDITION_BASE if set (local runs and tests); on
#   pull_request, origin/$GITHUB_BASE_REF; on a push to a branch other
#   than main, origin/main; on a push to main, none: that part is skipped
#   with a notice, since main changes only through pull requests, which
#   were checked. Any other event needs EDITION_BASE.
#   A local run: git fetch origin && EDITION_BASE=origin/main bash <this file> --template bootstrap/stubs/rules
#
# What this cannot tell: whether the edition matches its source. Someone
# who edits a file and rewrites EDITION to match passes; the build's own
# compare run covers that.
#
# Exit codes: 0 pass, 1 the edition or the change is wrong, 2 the check
# could not run (never a silent pass).
set -euo pipefail

NAME=check-rules-edition

usage() {
  echo "usage: $NAME [--template] <dir>" >&2
  exit 2
}
die2() {
  echo "::error::$NAME: $*"
  exit 2
}

TEMPLATE=false
DIR=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --template) TEMPLATE=true ;;
    -*) usage ;;
    *)
      [ -z "$DIR" ] || usage
      DIR="$1"
      ;;
  esac
  shift
done
[ -n "$DIR" ] || usage

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PROBLEMS=0
problem() {
  echo "::error::$NAME: $*"
  PROBLEMS=$((PROBLEMS + 1))
}

# Escape what GitHub reads as a workflow command (a path may hold a
# newline or a percent sign).
escape() {
  local s="$1"
  s="${s//\%/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
  die2 "neither sha256sum nor shasum is installed"

# ---------- template mode: what the change touches ----------

# check_change <repo-relative dir>
check_change() {
  local rel="$1" base="${EDITION_BASE:-}" f inside=0 outside="$WORK/outside" n
  if [ -z "$base" ]; then
    case "${GITHUB_EVENT_NAME:-}" in
      pull_request)
        [ -n "${GITHUB_BASE_REF:-}" ] || die2 "pull_request event without GITHUB_BASE_REF; set EDITION_BASE"
        base="origin/$GITHUB_BASE_REF"
        ;;
      push)
        if [ "${GITHUB_REF_NAME:-}" = main ]; then
          echo "::notice::$NAME: push to main: whether the change touches $rel/ alone is not checked; main changes only through pull requests, which are."
          return 0
        fi
        base=origin/main
        ;;
      *)
        die2 "cannot tell what to compare with (event '${GITHUB_EVENT_NAME:-none}'); set EDITION_BASE, for example EDITION_BASE=origin/main"
        ;;
    esac
  fi
  if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
    die2 "the checkout is shallow, so the base cannot be compared: checkout needs fetch-depth: 0"
  fi
  git rev-parse --verify --quiet "$base^{commit}" >/dev/null ||
    die2 "base '$base' not found: checkout needs fetch-depth: 0 (and a fetch of the base branch)"
  if ! git diff -z --name-only --no-renames "$base...HEAD" >"$WORK/changed" 2>"$WORK/err"; then
    cat "$WORK/err"
    die2 "git diff against '$base' failed (no common history? checkout needs fetch-depth: 0)"
  fi
  MERGE_BASE="$(git merge-base "$base" HEAD)" ||
    die2 "no merge base of '$base' and HEAD (checkout needs fetch-depth: 0)"
  : >"$outside"
  while IFS= read -r -d '' f; do
    case "$f" in
      "$rel"/*) inside=$((inside + 1)) ;;
      *) printf '%s\n' "$(escape "$f")" >>"$outside" ;;
    esac
  done <"$WORK/changed"
  n="$(grep -c . "$outside" || true)"
  if [ "$inside" -gt 0 ] && [ "$n" -gt 0 ]; then
    problem "this change changes $rel/ together with other files; a change of the edition changes nothing else. The other files ($n):"
    sed 's/^/  /' "$outside"
  fi
}

if [ "$TEMPLATE" = true ]; then
  case "$DIR" in
    /* | . | ./* | .. | ../* | */../* | */.. | */./* | */. | *//*)
      die2 "in template mode, <dir> is a plain path relative to the repository root: '$DIR'"
      ;;
  esac
  DIR="${DIR%/}"
  git rev-parse --git-dir >/dev/null 2>&1 || die2 "not inside a git repository"
  TOP="$(git rev-parse --show-toplevel)" || die2 "not inside a work tree"
  cd "$TOP"
  MERGE_BASE=""
  check_change "$DIR"
  if [ ! -e "$DIR" ]; then
    # Once an edition is taken, the folder is replaced whole, never removed.
    if [ -n "$MERGE_BASE" ] && git cat-file -e "$MERGE_BASE:$DIR" 2>/dev/null; then
      problem "this change deletes $DIR/: once an edition is taken, the folder is replaced by a newer edition, never removed"
    fi
    if [ "$PROBLEMS" -gt 0 ]; then exit 1; fi
    echo "$NAME: no $DIR/: no edition taken yet, nothing to check"
    exit 0
  fi
fi

# ---------- the edition ----------

if [ ! -d "$DIR" ]; then
  problem "no folder $DIR: the Rules edition is missing"
  exit 1
fi
ED="$DIR/EDITION"
if [ ! -f "$ED" ]; then
  problem "no EDITION in $DIR: the Rules edition is missing or incomplete"
  exit 1
fi

# Parse EDITION; on any format problem, stop before the hashes.
malformed() { problem "EDITION is malformed: $*"; }
bad=0
if [ ! -s "$ED" ]; then
  malformed "the file is empty"
  exit 1
fi
if LC_ALL=C grep -q "$(printf '\r')" "$ED"; then
  malformed "it holds a carriage return (line ends must be LF)"
  bad=1
fi
if [ -n "$(tail -c 1 "$ED")" ]; then
  malformed "it does not end with a newline"
  bad=1
fi
[ "$bad" -eq 0 ] || exit 1

ID="$(head -n 1 "$ED")"
LC_ALL=C grep -Eqx '[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{7}' <<<"$ID" ||
  {
    malformed "line 1: not an edition id (YYYY-MM-DD-<7 hex>): '$(escape "$ID")'"
    bad=1
  }

: >"$WORK/listed"
: >"$WORK/pairs"
n=1
prev=""
while IFS= read -r line; do
  n=$((n + 1))
  if ! LC_ALL=C grep -Eqx '[0-9a-f]{64}  .+' <<<"$line"; then
    malformed "line $n: not '<sha256>  <path>' (64 lower-case hex digits, two spaces, a path): '$(escape "$line")'"
    bad=1
    continue
  fi
  path="${line#*  }"
  case "/$path/" in
    //* | */./* | */../* | *//*)
      malformed "line $n: not a plain relative path: '$(escape "$path")'"
      bad=1
      continue
      ;;
  esac
  if [ "$path" = EDITION ]; then
    malformed "line $n: it lists EDITION itself"
    bad=1
    continue
  fi
  if [ -n "$prev" ] && ! [ "$(printf '%s\n%s\n' "$prev" "$path" | LC_ALL=C sort | sed -n 1p)" = "$prev" ] ||
    [ "$prev" = "$path" ]; then
    malformed "line $n: not sorted by path (byte order, each path once): '$(escape "$path")' after '$(escape "$prev")'"
    bad=1
  fi
  prev="$path"
  printf '%s\n' "$path" >>"$WORK/listed"
  printf '%s\n' "$line" >>"$WORK/pairs"
done < <(tail -n +2 "$ED")
if [ "$n" -eq 1 ]; then
  malformed "it lists no file"
  bad=1
fi
[ "$bad" -eq 0 ] || exit 1

# The hashes.
while IFS= read -r line; do
  want="${line%%  *}"
  path="${line#*  }"
  if [ -L "$DIR/$path" ] || [ ! -f "$DIR/$path" ]; then
    problem "missing: $(escape "$path") (listed in EDITION, not a file in $DIR)"
  elif [ "$(sha256_of "$DIR/$path")" != "$want" ]; then
    problem "changed: $(escape "$path") (its SHA-256 differs from EDITION)"
  fi
done <"$WORK/pairs"

# Files EDITION does not list (anything but a folder, symlinks included).
(cd "$DIR" && find . ! -type d ! -path ./EDITION) | sed 's|^\./||' | LC_ALL=C sort >"$WORK/present"
LC_ALL=C sort "$WORK/listed" >"$WORK/listed.sorted"
LC_ALL=C comm -23 "$WORK/present" "$WORK/listed.sorted" >"$WORK/extra"
while IFS= read -r path; do
  problem "not in EDITION: $(escape "$path") (a file in $DIR that the edition does not list)"
done <"$WORK/extra"

if [ "$PROBLEMS" -gt 0 ]; then
  echo "$NAME: $DIR is not the edition its EDITION names ($PROBLEMS problem(s), above). The edition is built elsewhere and replaced whole, never edited here."
  exit 1
fi
echo "$NAME: $DIR is edition $ID, unchanged ($(wc -l <"$WORK/pairs" | tr -d ' ') files)"
