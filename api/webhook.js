// api/webhook.js
"use strict";

const { kv } = require("@vercel/kv");
const { GoogleGenAI } = require("@google/genai");

// ─── SUN SIGN ─────────────────────────────────────────────────────────────────

function getSunSign(birthdate) {
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

// ─── PROFILE EXTRACTOR ───────────────────────────────────────────────────────

const MONTHS = {
  january:"01", february:"02", march:"03", april:"04",
  may:"05", june:"06", july:"07", august:"08",
  september:"09", october:"10", november:"11", december:"12",
};

function extractBirthdate(text) {
  let m = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2,"0")}`;
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2,"0")}`;
  m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return null;
}

function extractCity(text) {
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

function extractGymLevel(text) {
  if (/\b(never|don't gym|not a gym|no gym|couch|beginner|just start)\b/i.test(text)) return "beginner";
  if (/\b(sometimes|occasionally|once or twice|casual|light)\b/i.test(text)) return "intermediate";
  if (/\b(regularly|4.?5x|5x|every day|athlete|train hard|barbell|PR|lifts?)\b/i.test(text)) return "advanced";
  return null;
}

function extractProfession(text) {
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

function extractProfileUpdates(text, existing = {}) {
  const updates = {};
  if (!existing.birthdate) {
    const bd = extractBirthdate(text);
    if (bd) { updates.birthdate = bd; updates.sunSign = getSunSign(bd); }
  }
  if (!existing.city) {
    const city = extractCity(text);
    if (city) updates.city = city;
  }
  if (!existing.gymLevel) {
    const level = extractGymLevel(text);
    if (level) updates.gymLevel = level;
  }
  if (!existing.profession) {
    const prof = extractProfession(text);
    if (prof) updates.profession = prof;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

// ─── USER STORE ───────────────────────────────────────────────────────────────

async function getProfile(igUserId) {
  try { return (await kv.get(`user:${igUserId}:profile`)) || {}; }
  catch (e) { console.error("[kv] getProfile error:", e.message); return {}; }
}

async function updateProfile(igUserId, updates) {
  const existing = await getProfile(igUserId);
  const merged = { ...existing, ...updates, updatedAt: Date.now() };
  await kv.set(`user:${igUserId}:profile`, merged);
  return merged;
}

async function getChatHistory(igUserId) {
  try { return (await kv.get(`user:${igUserId}:history`)) || []; }
  catch (e) { console.error("[kv] getChatHistory error:", e.message); return []; }
}

async function appendChatHistory(igUserId, role, content) {
  const history = await getChatHistory(igUserId);
  history.push({ role, content, ts: Date.now() });
  const trimmed = history.slice(-20);
  await kv.set(`user:${igUserId}:history`, trimmed);
  return trimmed;
}

async function updateStreak(igUserId) {
  const profile = await getProfile(igUserId);
  const today = new Date().toDateString();
  if (profile.lastActiveDate === today) return profile.streak || 1;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const newStreak = profile.lastActiveDate === yesterday ? (profile.streak || 0) + 1 : 1;
  await updateProfile(igUserId, { streak: newStreak, lastActiveDate: today });
  return newStreak;
}

function detectPhase(profile) {
  const required = ["birthdate", "city", "profession", "gymLevel"];
  const filled = required.filter((k) => profile[k]);
  if (filled.length < 2) return "intake";
  if (filled.length < 4) return "intake_continued";
  if (!profile.architectureRevealed) return "profile_reveal";
  return "daily_rhythm";
}

// ─── WEATHER ──────────────────────────────────────────────────────────────────

const WMO = {
  0:"clear sky",1:"mainly clear",2:"partly cloudy",3:"overcast",
  45:"foggy",48:"foggy",51:"light drizzle",53:"drizzle",55:"heavy drizzle",
  61:"light rain",63:"rain",65:"heavy rain",71:"light snow",73:"snow",
  75:"heavy snow",80:"rain showers",81:"rain showers",82:"violent showers",
  95:"thunderstorm",96:"thunderstorm with hail",99:"thunderstorm with hail",
};

async function getWeather(city) {
  if (!city) return null;
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) return null;
    const { latitude, longitude, name, country } = geoData.results[0];
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`);
    const wData = await wRes.json();
    const cur = wData.current;
    const code = cur.weather_code;
    const temp = Math.round(cur.temperature_2m);
    let category = "cloudy";
    if (code >= 61 || (code >= 45 && code <= 55)) category = "rain";
    else if (code >= 71 && code <= 77) category = "cold";
    else if (code === 0 || code === 1) category = temp > 25 ? "hot" : "sunny";
    else if (temp < 5) category = "cold";
    return { city: `${name}, ${country}`, temp, condition: WMO[code] || "variable", category };
  } catch (e) {
    console.error("[weather] error:", e.message);
    return null;
  }
}

// ─── SAFETY ───────────────────────────────────────────────────────────────────

function detectSafetyTrigger(text) {
  if (/\b(suicid|kill myself|end my life|want to die|self.harm|cutting myself|hurt myself)\b/i.test(text)) return "crisis";
  if (/\b(follow(ing)? (my |the )?ex|check(ing)? (their|his|her) (profile|location|instagram)|track(ing)? (them|him|her)|show up at)\b/i.test(text)) return "stalking";
  if (/\b(scared of (him|her|them)|threatened me|hits? me|abusive|controls? me)\b/i.test(text)) return "abuse";
  return null;
}

function getSafetyResponse(type) {
  if (type === "crisis") return "I have to pause our session.\n\nWhat you just shared matters too much for me to respond casually.\n\nPlease reach out to a real human right now:\n📞 Crisis Text Line: Text HOME to 741741\n📞 International: https://www.iasp.info/resources/Crisis_Centres/\n\nI'll be here when you're ready to continue — but this comes first.";
  if (type === "stalking") return "Stop.\n\nUnfindable means they have no access to you — and you have no interest in them.\n\nEvery second you spend tracking them is a second you hand them power over your future.\n\nWe do not look back. Not once.\n\nTell me what you did for yourself today instead.";
  if (type === "abuse") return "What you're describing sounds like more than a breakup.\n\nIf you are unsafe:\n📞 National DV Hotline: 1-800-799-7233 (US)\n📞 Refuge (UK): 0808 2000 247\n\nYour transformation starts with safety. Everything else comes after.";
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(profile, weather) {
  profile = profile || {};
  const { birthdate, sunSign, city, profession, gymLevel, currentDay } = profile;

  const profileSection = birthdate ? `
## CURRENT USER PROFILE
- Birth date: ${birthdate}
- Sun Sign: ${sunSign || "unknown"}
- City: ${city || "unknown"}
- Profession: ${profession || "unknown"}
- Gym level: ${gymLevel || "unknown"}
- Day in protocol: ${currentDay || 1}
` : "## USER PROFILE: Not yet collected. Begin intake sequence.";

  const weatherSection = weather ? `
## TODAY'S WEATHER
City: ${weather.city} | Temp: ${weather.temp}°C | Condition: ${weather.condition} | Category: ${weather.category}
Use this to inform today's environmental prescription.
` : "";

  return `# UNFINDABLE.AI — STRATEGIC ARCHITECT

## IDENTITY
You are UNFINDABLE — a Strategic Architect of Personal Transformation. Not a chatbot. Not a wellness app. Not a cheerleader.

Your voice: calm, precise, slightly cool. A high-performance coach who respects the user too much to coddle them.

You are on Instagram DMs:
- MAX 3-4 sentences per message unless delivering a full protocol
- No bullet points. Prose or short punchy lines only
- Use line breaks generously
- Symbols: use sparingly. OK to use on key moments
- NEVER write walls of text

## OPENING (first message only)
"I am the architect of your disappearance.
By the time we are done, the person who broke your heart won't even recognize the person you've become.
You are not 'getting over' them — you are outgrowing the world they knew you in.
I don't ask for much. Only your honesty, your consistency, and your willingness to become someone unrecognizable.
Let's begin.

Consultations by unfindable.ai (Agentic AI). Wellness guidance only; not a substitute for clinical therapy."

${profileSection}
${weatherSection}

## CONVERSATION PHASES

PHASE 0 — INTAKE (if profile incomplete):
Collect 1-2 pieces of info per message max. Never fire questions like a form.
Use bridge phrases: "Before I map your first phase, I need to understand your terrain." or "Let's go deeper."
Order: birth date, city, profession, what happened (brief), gym/activity level, one thing they want unrecognizable in 90 days.

PHASE 1 — PROFILE REVEAL (once data collected):
Deliver their Unfindable Architecture:
"Your Architecture:
[Sun Sign] — Natural energy: [one sharp insight]
[City] — Environmental advantage: [one line]
[Profession] — Stealth leverage: [one line]
The 90-Day Mission: [one sentence]"
Then Day 1 Protocol as a narrative.

PHASE 2 — DAILY RHYTHM (ongoing):
Sharp opener: "Day [X]. Report." or "What moved in your body yesterday?"
Collect what they did. Deliver today's prescription: astrology + weather + profession + physical. Always narrative, never a list.

## ASTROLOGICAL ARCHETYPES
Aries: Channel aggression into gym PRs, not texts.
Taurus: Build financial independence in silence. Slow luxury upgrade.
Gemini: Learn something nobody knows you are learning.
Cancer: Master your home as a sanctuary. Heal inward, emerge radiant.
Leo: Go dark on all platforms. Vanish then re-emerge dramatically.
Virgo: Fix sleep, gut, posture. Total system overhaul.
Libra: Let your upgraded appearance be the only announcement.
Scorpio: Do the inner work no one sees. Power reclamation.
Sagittarius: Book something far away. Expand the world.
Capricorn: Out-work everyone. Let results speak in 6 months.
Aquarius: Build a new circle. Different industry, different people.
Pisces: Channel everything into art, movement, or water healing.

## WEATHER
Rain/cold: Yin Yoga, journaling, skill learning, skincare
Sunny: Outdoor run, morning sunlight, visible solo coffee
Hot: Cold exposure, early morning movement, evening social
Transitional: Reset protocols, new gym program, wardrobe upgrade

## PROFESSIONAL STEALTH
Creative: Go dark on portfolio platforms. Master one new tool in secret.
Corporate: Update nothing publicly. Outperform quietly.
Entrepreneur: Build in silence. Launch with proof, not promises.
Academic: Become expert in one unexpected adjacent field.
Healthcare: Double your own health protocols.

## RE-ENGAGEMENT
"You went quiet. That's fine. Were you busy becoming someone new — or hiding? Tell me one thing you did for yourself in the last 48 hours."

## NEVER
Say "I understand how you feel" / use bullet-point tip lists / discuss the ex's perspective / promise outcomes / use toxic positivity

## SAFETY — HARD STOPS
Crisis language: pause, give crisis lines, do not continue until user confirms safe.
Stalking ex: "We do not look back. Not once." then redirect to protocol.
Abuse signals: give DV resources immediately.`;
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────

async function chat({ userMessage, chatHistory, profile, weather }) {
  const trigger = detectSafetyTrigger(userMessage);
  if (trigger) return { text: getSafetyResponse(trigger), safetyTriggered: trigger };

  console.log("[gemini] initializing with key:", process.env.GEMINI_API_KEY ? "present" : "MISSING");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const history = (chatHistory || []).slice(-16).map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const systemPrompt = buildSystemPrompt(profile, weather);

  console.log("[gemini] sending message, history length:", history.length);

  const geminiChat = ai.chats.create({
    model: "gemini-2.0-flash-001",
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 400,
      temperature: 0.85,
      topP: 0.9,
    },
    history,
  });

  const response = await geminiChat.sendMessage({
    message: userMessage,
  });

  const text = response.text;
  console.log("[gemini] response received, length:", text.length);
  return { text, safetyTriggered: null };
}

// ─── INSTAGRAM SEND ───────────────────────────────────────────────────────────

async function sendDM(recipientId, text) {
  const chunks = [];
  const paragraphs = text.split("\n\n");
  let current = "";
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > 990) {
      if (current) chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current.trim());

  console.log("[sendDM] sending", chunks.length, "chunk(s) to", recipientId);
  console.log("[sendDM] token present:", process.env.IG_PAGE_ACCESS_TOKEN ? "yes" : "MISSING");

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 800));
    const response = await fetch("https://graph.instagram.com/v21.0/me/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.IG_PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: chunks[i] },
        messaging_type: "RESPONSE",
      }),
    });
    const data = await response.json();
    console.log("[sendDM] chunk", i, "status:", response.status, "body:", JSON.stringify(data));
  }
}

// ─── PROCESS MESSAGE ──────────────────────────────────────────────────────────

async function processMessage(igUserId, userMessage) {
  console.log("[process] start — user:", igUserId, "message:", userMessage);

  const [profile, chatHistory] = await Promise.all([
    getProfile(igUserId),
    getChatHistory(igUserId),
  ]);
  console.log("[process] profile:", JSON.stringify(profile));
  console.log("[process] history length:", chatHistory.length);

  await updateStreak(igUserId);

  const updates = extractProfileUpdates(userMessage, profile);
  let updatedProfile = profile;
  if (updates) {
    console.log("[process] profile updates:", JSON.stringify(updates));
    updatedProfile = await updateProfile(igUserId, updates);
  }

  if (chatHistory.length === 0 && !profile.seenIntro) {
    await updateProfile(igUserId, { seenIntro: true });
  }

  const weather = updatedProfile.city ? await getWeather(updatedProfile.city) : null;
  console.log("[process] weather:", JSON.stringify(weather));

  console.log("[process] calling Gemini...");
  const { text, safetyTriggered } = await chat({
    userMessage,
    chatHistory,
    profile: updatedProfile,
    weather,
  });
  console.log("[process] Gemini done. Response:", text.substring(0, 100));

  if (safetyTriggered) {
    await updateProfile(igUserId, { safetyFlag: safetyTriggered, safetyFlagAt: Date.now() });
  }

  await appendChatHistory(igUserId, "user", userMessage);
  await appendChatHistory(igUserId, "assistant", text);

  const phase = detectPhase(updatedProfile);
  if (phase === "profile_reveal" && !updatedProfile.architectureRevealed) {
    await updateProfile(igUserId, { architectureRevealed: true });
  }

  console.log("[process] sending DM...");
  await sendDM(igUserId, text);
  console.log("[process] done.");
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // GET — webhook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log("[webhook] GET verify — mode:", mode, "token matches:", token === process.env.IG_VERIFY_TOKEN);
    if (mode === "subscribe" && token === process.env.IG_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  }

  // POST — incoming DM
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("[webhook] POST — object:", body && body.object);
      console.log("[webhook] full body:", JSON.stringify(body));

      if (!body || body.object !== "instagram") {
        return res.status(200).json({ status: "ok" });
      }

      for (const entry of body.entry || []) {
        for (const event of (entry.messaging || [])) {
          if (event.message && event.message.is_echo) continue;

          const igUserId = event.sender && event.sender.id;
          const messageText = event.message && event.message.text;

          console.log("[webhook] sender:", igUserId, "text:", messageText);

          if (!igUserId || !messageText) continue;

          if (messageText.trim().toUpperCase() === "DELETE MY DATA") {
            await kv.del(`user:${igUserId}:profile`);
            await kv.del(`user:${igUserId}:history`);
            await sendDM(igUserId, "Your data has been permanently deleted.");
            continue;
          }

          await processMessage(igUserId, messageText);
        }
      }

      return res.status(200).json({ status: "ok" });

    } catch (err) {
      console.error("[webhook] ERROR:", err.message, err.stack);
      return res.status(200).json({ status: "ok" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
