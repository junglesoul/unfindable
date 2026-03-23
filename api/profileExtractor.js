// api/profileExtractor.js
// Silently extracts profile data from user messages to update KV

import { getSunSign } from "./userStore.js";

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

// ─── Birthdate ─────────────────────────────────────────────────────────────────

export function extractBirthdate(text) {
  // ISO: 1993-03-15
  let m = text.match(/\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  // "March 15, 1993" or "15 March 1993"
  m = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (m) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;

  m = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i
  );
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;

  // MM/DD/YYYY
  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  return null;
}

// ─── City ─────────────────────────────────────────────────────────────────────

export function extractCity(text) {
  const patterns = [
    /\bi (?:live|am|'m) (?:in|based in|from)\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|\n|$)/i,
    /\bbased in\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|\n|$)/i,
    /\b(?:city|location)[:\s]+([A-Z][a-zA-Z\s]+?)(?:\.|,|\n|$)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

// ─── Gym Level ────────────────────────────────────────────────────────────────

export function extractGymLevel(text) {
  if (/\b(never|don't gym|not a gym|no gym|couch|beginner|just start)\b/i.test(text)) return "beginner";
  if (/\b(sometimes|occasionally|once or twice|casual|light)\b/i.test(text)) return "intermediate";
  if (/\b(regularly|4.?5x|5x|every day|athlete|train hard|barbell|PR|lifts?)\b/i.test(text)) return "advanced";
  return null;
}

// ─── Profession ───────────────────────────────────────────────────────────────

export function extractProfession(text) {
  const patterns = [
    /\bi(?:'m| am) (?:a|an)\s+([a-zA-Z\s]+?)(?:\.|,|\n| and | but |$)/i,
    /\bwork(?:ing)? (?:as|in)\s+([a-zA-Z\s]+?)(?:\.|,|\n|$)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1].split(" ").length <= 5) return m[1].trim();
  }
  return null;
}

// ─── Main Extractor ───────────────────────────────────────────────────────────

export function extractProfileUpdates(text, existingProfile = {}) {
  const updates = {};

  if (!existingProfile.birthdate) {
    const bd = extractBirthdate(text);
    if (bd) {
      updates.birthdate = bd;
      updates.sunSign = getSunSign(bd);
    }
  }

  if (!existingProfile.city) {
    const city = extractCity(text);
    if (city) updates.city = city;
  }

  if (!existingProfile.gymLevel) {
    const level = extractGymLevel(text);
    if (level) updates.gymLevel = level;
  }

  if (!existingProfile.profession) {
    const prof = extractProfession(text);
    if (prof) updates.profession = prof;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}
