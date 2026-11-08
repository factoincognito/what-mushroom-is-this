#!/usr/bin/env bash
# Fails a pull request that changes code without changing a test.
#
# Usage:
#   require-test-change.sh --code PATTERN... --test PATTERN... [--ignore PATTERN...]
#
# Each flag takes one or more patterns and may be repeated. A pattern is a
# bash `case` pattern matched against the repo-relative path, where `*`
# also matches `/` (so 'src/*' covers everything under src/).
#
# A changed file is classified in this order:
#   1. matches --test    -> a test
#   2. matches --ignore  -> ignored (prose and the like)
#   3. matches --code    -> code
#   4. anything else     -> other (not code: it never needs a test)
#
# Which files changed: `git diff` from the merge base of <base> and HEAD.
# Added, copied, modified and renamed files count; deleted files and type
# changes count for neither side (deleting a test is not changing one).
#
# <base> is, in this order:
#   - $TEST_FIRST_BASE, if set (local runs and tests);
#   - pull_request: origin/$GITHUB_BASE_REF;
#   - push to a branch other than main: origin/main, so a branch push and
#     its pull request give the same verdict;
#   - push to main: the check passes with a notice, because main only
#     changes through pull requests that were already checked.
# Any other event needs TEST_FIRST_BASE. The branch name `main` is fixed.
# A local run: git fetch origin && TEST_FIRST_BASE=origin/main bash <this file> ...
#
# Way out for a change no test can check: a commit in the pull request
# with a non-empty `Test-exempt: <reason>` trailer. The reason is shown in
# the log and the job summary; a reviewer judges it.
#
# What this cannot tell: whether the test came first, or whether the test
# exercises the changed code. It sees file names only. Review covers that.
#
# Exit codes: 0 pass, 1 code changed without a test, 2 the check could not
# run (never a silent pass).
set -euo pipefail

code_pats=()
test_pats=()
ignore_pats=()

err() { echo "::error::require-test-change: $*"; }
die2() {
  err "$*"
  exit 2
}

# ---------- arguments ----------

mode=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --code | --test | --ignore)
      mode="$1"
      shift
      ;;
    --*) die2 "unknown flag: $1" ;;
    *)
      [ -n "$1" ] || die2 "empty pattern after $mode: it would match nothing (is a variable unset?)"
      case "$mode" in
        --code) code_pats+=("$1") ;;
        --test) test_pats+=("$1") ;;
        --ignore) ignore_pats+=("$1") ;;
        *) die2 "pattern '$1' has no flag before it (use --code, --test or --ignore)" ;;
      esac
      shift
      ;;
  esac
done
[ "${#code_pats[@]}" -gt 0 ] || die2 "--code is required (the patterns for source files)"
[ "${#test_pats[@]}" -gt 0 ] || die2 "--test is required (the patterns for test files)"

# ---------- where we are ----------

git rev-parse --git-dir >/dev/null 2>&1 || die2 "not inside a git repository"
# Always see the whole repository, whatever directory this runs from (and
# whatever diff.relative says).
top="$(git rev-parse --show-toplevel)" || die2 "not inside a work tree (a bare repository has no files to compare)"
cd "$top"

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"; fi
}

base="${TEST_FIRST_BASE:-}"
if [ -z "$base" ]; then
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request)
      [ -n "${GITHUB_BASE_REF:-}" ] || die2 "pull_request event without GITHUB_BASE_REF; set TEST_FIRST_BASE"
      base="origin/$GITHUB_BASE_REF"
      ;;
    push)
      if [ "${GITHUB_REF_NAME:-}" = "main" ]; then
        echo "::notice::require-test-change: push to main is not checked; main only changes through pull requests, which are."
        summary "### Test-first check" "Push to main: not checked."
        exit 0
      fi
      base="origin/main"
      ;;
    *)
      die2 "cannot tell what to compare with (event '${GITHUB_EVENT_NAME:-none}'); set TEST_FIRST_BASE, for example TEST_FIRST_BASE=origin/main"
      ;;
  esac
fi

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  die2 "the checkout is shallow, so the base cannot be compared: checkout needs fetch-depth: 0"
fi
git rev-parse --verify --quiet "$base^{commit}" >/dev/null ||
  die2 "base '$base' not found: checkout needs fetch-depth: 0 (and a fetch of the base branch)"

# ---------- what changed ----------

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.err"' EXIT

if ! git diff -z --name-only --diff-filter=ACMR "$base...HEAD" >"$tmp" 2>"$tmp.err"; then
  cat "$tmp.err"
  die2 "git diff against '$base' failed (no common history? checkout needs fetch-depth: 0)"
fi

matches() {
  local f="$1" p
  shift
  for p in "$@"; do
    # shellcheck disable=SC2254 # the pattern is meant to be a glob
    case "$f" in $p) return 0 ;; esac
  done
  return 1
}

code_files=()
test_files=()
ignored_files=()
other_files=()
while IFS= read -r -d '' f; do
  if matches "$f" "${test_pats[@]}"; then
    test_files+=("$f")
  elif [ "${#ignore_pats[@]}" -gt 0 ] && matches "$f" "${ignore_pats[@]}"; then
    ignored_files+=("$f")
  elif matches "$f" "${code_pats[@]}"; then
    code_files+=("$f")
  else
    other_files+=("$f")
  fi
done <"$tmp"

reasons=()
if ! trailers="$(git log --format='%(trailers:key=Test-exempt,valueonly)' "$base..HEAD" 2>"$tmp.err")"; then
  cat "$tmp.err"
  die2 "git log against '$base' failed"
fi
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [ -z "$line" ] || reasons+=("$line")
done <<<"$trailers"

# ---------- report ----------

# Escape what GitHub reads as a workflow command: a file name may hold
# a newline, and "::warning::..." at the start of a line would run.
escape() {
  local s="$1"
  s="${s//\%/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}

report() {
  local f r
  for f in ${code_files[@]+"${code_files[@]}"}; do echo "code: $(escape "$f")"; done
  for f in ${test_files[@]+"${test_files[@]}"}; do echo "test: $(escape "$f")"; done
  for f in ${ignored_files[@]+"${ignored_files[@]}"}; do echo "ignored: $(escape "$f")"; done
  for f in ${other_files[@]+"${other_files[@]}"}; do echo "other: $(escape "$f")"; done
  for r in ${reasons[@]+"${reasons[@]}"}; do echo "exempt: $(escape "$r")"; done
}
report_out="$(report)"
[ -z "$report_out" ] || printf '%s\n' "$report_out"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Test-first check"
    echo "Compared with \`$base\`."
    if [ -n "$report_out" ]; then
      echo '```'
      printf '%s\n' "$report_out"
      echo '```'
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

# ---------- verdict ----------

if [ "${#code_files[@]}" -eq 0 ]; then
  echo "no code changed: nothing to require a test for"
  exit 0
fi
if [ "${#test_files[@]}" -gt 0 ]; then
  echo "code and a test changed"
  exit 0
fi
if [ "${#reasons[@]}" -gt 0 ]; then
  joined=""
  for r in "${reasons[@]}"; do joined="${joined:+$joined; }$r"; done
  echo "::notice::require-test-change: code changed without a test; exempt, reason: $(escape "$joined")"
  exit 0
fi

err "code changed without a test (${#code_files[@]} file(s), listed above)"
echo "Two ways out:"
echo "  1. add a test (a file matching a --test pattern, changed or new), and run it red before the code;"
echo "  2. if no test can check this change, record why in a commit on this branch:"
echo '     git commit --allow-empty -m "Test-exempt: <reason>" --trailer "Test-exempt: <reason>"'
exit 1
