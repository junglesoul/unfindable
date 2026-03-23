// api/userStore.js
// Vercel KV: user profiles, chat history, streaks, safety flags

import { kv } from "@vercel/kv";

const CHAT_HISTORY_LIMIT = 20;

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(igUserId) {
  try {
    const profile = await kv.get(`user:${igUserId}:profile`);
    return profile || {};
  } catch {
    return {};
  }
}

export async function updateProfile(igUserId, updates) {
  const existing = await getProfile(igUserId);
  const merged = { ...existing, ...updates, updatedAt: Date.now() };
  await kv.set(`user:${igUserId}:profile`, merged);
  return merged;
}

// ─── Sun Sign Calculator ──────────────────────────────────────────────────────

export function getSunSign(birthdate) {
  if (!birthdate) return null;
  const [, month, day] = birthdate.split("-").map(Number);
  const md = month * 100 + day;

  if (md >= 321 && md <= 419) return "Aries";
  if (md >= 420 && md <= 520) return "Taurus";
  if (md >= 521 && md <= 620) return "Gemini";
  if (md >= 621 && md <= 722) return "Cancer";
  if (md >= 723 && md <= 822) return "Leo";
  if (md >= 823 && md <= 922) return "Virgo";
  if (md >= 923 && md <= 1022) return "Libra";
  if (md >= 1023 && md <= 1121) return "Scorpio";
  if (md >= 1122 && md <= 1221) return "Sagittarius";
  if (md >= 1222 || md <= 119) return "Capricorn";
  if (md >= 120 && md <= 218) return "Aquarius";
  if (md >= 219 && md <= 320) return "Pisces";
  return null;
}

// ─── Chat History ─────────────────────────────────────────────────────────────

export async function getChatHistory(igUserId) {
  try {
    const history = await kv.get(`user:${igUserId}:history`);
    return history || [];
  } catch {
    return [];
  }
}

export async function appendChatHistory(igUserId, role, content) {
  const history = await getChatHistory(igUserId);
  history.push({ role, content, ts: Date.now() });
  const trimmed = history.slice(-CHAT_HISTORY_LIMIT);
  await kv.set(`user:${igUserId}:history`, trimmed);
  return trimmed;
}

// ─── Streak Tracking ──────────────────────────────────────────────────────────

export async function updateStreak(igUserId) {
  const profile = await getProfile(igUserId);
  const today = new Date().toDateString();

  if (profile.lastActiveDate === today) return profile.streak || 1;

  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const newStreak = profile.lastActiveDate === yesterday
    ? (profile.streak || 0) + 1
    : 1;

  await updateProfile(igUserId, { streak: newStreak, lastActiveDate: today });
  return newStreak;
}

// ─── Safety Flags ─────────────────────────────────────────────────────────────

export async function flagSafetyConcern(igUserId, type) {
  await updateProfile(igUserId, {
    safetyFlag: type,
    safetyFlagAt: Date.now(),
  });
}

// ─── Phase Detection ──────────────────────────────────────────────────────────

export function detectPhase(profile) {
  const required = ["birthdate", "city", "profession", "gymLevel"];
  const filled = required.filter((k) => profile[k]);

  if (filled.length < 2) return "intake";
  if (filled.length < 4) return "intake_continued";
  if (!profile.architectureRevealed) return "profile_reveal";
  return "daily_rhythm";
}
