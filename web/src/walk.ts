// The guided first-run flag, shared by Design and Prep so both agree on one key
// with no duplicated string literal. The walk is done at first success, which is
// the first started run (Prep), not at lock (Design).

export const WALK_DONE_KEY = "bk_walk_done";

export function isWalkDone(): boolean {
  return localStorage.getItem(WALK_DONE_KEY) === "1";
}

export function markWalkDone(): void {
  localStorage.setItem(WALK_DONE_KEY, "1");
}
