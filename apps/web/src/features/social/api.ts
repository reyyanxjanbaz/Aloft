import type {
  ActivityItem,
  FriendSummary,
  LeaderboardRow,
  PlayerProfile,
  PlayerStats,
  SharedCatch,
} from "@aloft/shared";
import { playerHeaders } from "../../lib/player";
import { SKY_URL } from "../../state/planes";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SKY_URL}${path}`, { headers: playerHeaders() });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchFriends(): Promise<FriendSummary[]> {
  return (await get<{ friends: FriendSummary[] }>("/friends")).friends;
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  return (await get<{ rows: LeaderboardRow[] }>("/leaderboard")).rows;
}

export async function fetchActivity(): Promise<ActivityItem[]> {
  return (await get<{ items: ActivityItem[] }>("/activity")).items;
}

export async function fetchMyStats(): Promise<PlayerStats | null> {
  try {
    return (await get<{ stats: PlayerStats }>("/player/me")).stats;
  } catch {
    return null;
  }
}

export async function fetchFriendHangar(
  targetId: string
): Promise<{ player: PlayerProfile; catches: SharedCatch[] }> {
  return await get<{ player: PlayerProfile; catches: SharedCatch[] }>(`/player/${targetId}/hangar`);
}

export async function addFriend(code: string): Promise<{ ok: boolean; reason?: string; friend?: FriendSummary }> {
  const res = await fetch(`${SKY_URL}/friends/add`, {
    method: "POST",
    headers: { "content-type": "application/json", ...playerHeaders() },
    body: JSON.stringify({ code }),
  });
  return (await res.json()) as { ok: boolean; reason?: string; friend?: FriendSummary };
}

export async function removeFriend(friendId: string): Promise<void> {
  await fetch(`${SKY_URL}/friends/remove`, {
    method: "POST",
    headers: { "content-type": "application/json", ...playerHeaders() },
    body: JSON.stringify({ friendId }),
  });
}
