import type { CatchResponse } from "@aloft/shared";
import {
  clearPendingCatch,
  entryFromCatch,
  getPendingCatch,
  saveCatch,
  setPendingCatch,
  type PendingCatch,
} from "../features/hangar/db";
import { ensurePlayer, playerHeaders } from "./player";
import { SKY_URL } from "../state/planes";

export type SubmitOutcome =
  | { status: "caught"; body: Extract<CatchResponse, { ok: true }>; localSaveFailed: boolean }
  | { status: "rejected"; reason: string }
  | { status: "queued" };

/**
 * Sends a capture to the tower, retrying once with a refreshed identity if
 * the token turns out to be stale, and storing it for later if the network
 * is gone. A lock the player actually earned should never evaporate.
 */
export async function submitCatch(pending: PendingCatch): Promise<SubmitOutcome> {
  try {
    let res = await postCatch(pending);

    if (res.status === 401) {
      // The device's token is no longer accepted (server data reset, or a
      // rotated identity). Re-register and try once more before giving up —
      // otherwise every future catch fails the same way with no recovery.
      await ensurePlayer();
      res = await postCatch(pending);
    }

    const body = (await res.json()) as CatchResponse;
    if (!body.ok) {
      await clearPendingCatch();
      return { status: "rejected", reason: body.reason };
    }

    // The tower has recorded it. A failure to write our own copy must not be
    // reported as a failed catch — the catch happened.
    let localSaveFailed = false;
    try {
      await saveCatch(entryFromCatch(body.catch));
    } catch (err) {
      localSaveFailed = true;
      console.warn("[catch] recorded with the tower but not saved on this device:", err);
    }
    await clearPendingCatch();
    return { status: "caught", body, localSaveFailed };
  } catch {
    await setPendingCatch(pending).catch(() => {});
    return { status: "queued" };
  }
}

function postCatch(pending: PendingCatch): Promise<Response> {
  return fetch(`${SKY_URL}/catch`, {
    method: "POST",
    headers: { "content-type": "application/json", ...playerHeaders() },
    body: JSON.stringify(pending),
  });
}

/**
 * Retries a queued capture. Called at launch and whenever the network comes
 * back; resolves to the outcome so the caller can surface a confirmation.
 */
export async function flushPendingCatch(): Promise<SubmitOutcome | null> {
  const pending = await getPendingCatch().catch(() => null);
  if (!pending) return null;
  // A capture too old to validate server-side is dropped rather than retried
  // forever; the server rejects it and clearPendingCatch runs in submitCatch.
  return submitCatch(pending);
}
