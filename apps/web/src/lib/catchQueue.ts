import type { CatchResponse } from "@aloft/shared";
import {
  enqueuePendingCatch,
  entryFromCatch,
  listPendingCatches,
  removePendingCatch,
  saveCatch,
  type PendingCatch,
} from "../features/hangar/db";
import { ensurePlayer, playerHeaders } from "./player";
import { SKY_URL } from "../state/planes";

export type SubmitOutcome =
  | { status: "caught"; body: Extract<CatchResponse, { ok: true }>; isNew: boolean; localSaveFailed: boolean }
  | { status: "rejected"; reason: string }
  | { status: "queued" };

/**
 * Sends a capture to the tower, retrying once with a refreshed identity if the
 * token turns out to be stale, and keeping it queued for later if the network
 * is gone or the server errors transiently. A lock the player actually earned
 * should never evaporate.
 *
 * The catch is persisted *before* the first request: if the app is backgrounded
 * or killed while the POST is in flight — common on mobile right after a
 * capture — the earned catch still survives to be flushed on next launch.
 */
export async function submitCatch(pending: PendingCatch): Promise<SubmitOutcome> {
  await enqueuePendingCatch(pending).catch(() => {});
  try {
    let res = await postCatch(pending);

    if (res.status === 401) {
      // The device's token is no longer accepted (server data reset, or a
      // rotated identity). Re-register and try once more before giving up.
      await ensurePlayer();
      res = await postCatch(pending);
    }

    if (!res.ok) {
      // A 4xx won't change on retry, so stop looping on it and surface the
      // reason. A 5xx (or any other) may be transient — leave it queued to
      // retry, without parsing a body that may not be JSON.
      if (res.status >= 400 && res.status < 500) {
        const reason = await reasonFrom(res);
        await removePendingCatch(pending).catch(() => {});
        return { status: "rejected", reason };
      }
      return { status: "queued" };
    }

    const body = (await res.json()) as CatchResponse;
    if (!body.ok) {
      await removePendingCatch(pending).catch(() => {});
      return { status: "rejected", reason: body.reason };
    }

    // The tower has recorded it. A failure to write our own copy must not be
    // reported as a failed catch — the catch happened.
    let localSaveFailed = false;
    let isNew = true;
    try {
      ({ isNew } = await saveCatch(entryFromCatch(body.catch)));
    } catch (err) {
      localSaveFailed = true;
      console.warn("[catch] recorded with the tower but not saved on this device:", err);
    }
    await removePendingCatch(pending).catch(() => {});
    return { status: "caught", body, isNew, localSaveFailed };
  } catch {
    // Network error, or a 2xx whose body failed to parse — keep it queued.
    return { status: "queued" };
  }
}

async function reasonFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { reason?: unknown };
    if (typeof body?.reason === "string") return body.reason;
  } catch {
    // Non-JSON error body — fall through to a generic message.
  }
  return "the tower rejected this catch";
}

function postCatch(pending: PendingCatch): Promise<Response> {
  return fetch(`${SKY_URL}/catch`, {
    method: "POST",
    headers: { "content-type": "application/json", ...playerHeaders() },
    body: JSON.stringify(pending),
  });
}

let flushing: Promise<SubmitOutcome[]> | null = null;

/**
 * Retries every queued capture. Called at launch and whenever the network
 * comes back. Concurrent calls (a launch flush racing an `online` event)
 * coalesce onto a single in-flight pass, so a catch can't be read, submitted
 * and cleared twice.
 */
export function flushPendingCatches(): Promise<SubmitOutcome[]> {
  if (flushing) return flushing;
  flushing = (async () => {
    const pending = await listPendingCatches().catch(() => [] as PendingCatch[]);
    const outcomes: SubmitOutcome[] = [];
    for (const p of pending) outcomes.push(await submitCatch(p));
    return outcomes;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
