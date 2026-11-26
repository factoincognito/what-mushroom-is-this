/**
 * The start of the app (docs/SPEC.md 3.10, item 7): what opens by itself is decided at most once
 * at each start of the app, when its process starts. A process loads this module once, so what it
 * holds lasts as long as the process does: when the app's screens are shown anew while the
 * process lives, the start is already taken, and nothing is decided again.
 */
let taken = false;

/** Takes the start of this run of the app: true the first time it is asked, and false after. */
export function takeAppStart(): boolean {
  if (taken) {
    return false;
  }
  taken = true;
  return true;
}
