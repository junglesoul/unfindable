// api/webhook.js
// unfindable.ai — fully self-contained, no imports

import { kv } from "@vercel/kv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";

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
  let m = text.match(/\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;

  m = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2,"0")}`;

  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2,"0")}`;

  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
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

// ─── USER STORE (KV) ─────────────────────────────────────────────────────────

async function getProfile(igUserId) {
  try { return (await kv.get(`user:${igUserId}:profile`)) || {}; }
  catch { return {}; }
}

async function updateProfile(igUserId, updates) {
  const existing = await getProfile(igUserId);
  const merged = { ...existing, ...updates, updatedAt: Date.now() };
  await kv.set(`user:${igUserId}:profile`, merged);
  return merged;
}

async function getChatHistory(igUserId) {
  try { return (await kv.get(`user:${igUserId}:history`)) || []; }
  catch { return []; }
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

// ─── WEATHER ─────────────────────────────────────────────────────────────────

const WMO = {
  0:"clear sky", 1:"mainly clear", 2:"partly cloudy", 3:"overcast",
  45:"foggy", 48:"foggy", 51:"light drizzle", 53:"drizzle", 55:"heavy drizzle",
  61:"light rain", 63:"rain", 65:"heavy rain", 71:"light snow", 73:"snow",
  75:"heavy snow", 80:"rain showers", 81:"rain showers", 82:"violent showers",
  95:"thunderstorm", 96:"thunderstorm with hail", 99:"thunderstorm with hail",
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
  } catch { return null; }
}

// ─── SAFETY ──────────────────────────────────────────────────────────────────

function detectSafetyTrigger(text) {
  if (/\b(suicid|kill myself|end my life|don't want to live|want to die|self.harm|cutting myself|hurt myself)\b/i.test(text)) return "crisis";
  if (/\b(follow(ing)? (my |the )?ex|check(ing)? (their|his|her) (profile|location|instagram|phone)|track(ing)? (them|him|her)|show up at)\b/i.test(text)) return "stalking";
  if (/\b(scared of (him|her|them)|threatened me|hits? me|abusive|controls? me|afraid (of|to))\b/i.test(text)) return "abuse";
  return null;
}

function getSafetyResponse(type) {
  if (type === "crisis") return `I have to pause our session.\n\nWhat you just shared matters too much for me to respond casually.\n\nPlease reach out to a real human right now:\n📞 Crisis Text Line: Text HOME to 741741\n📞 International: https://www.iasp.info/resources/Crisis_Centres/\n\nI'll be here when you're ready to continue — but this comes first.`;
  if (type === "stalking") return `Stop.\n\nUnfindable means they have no access to you — and you have no interest in them.\n\nEvery second you spend tracking them is a second you hand them power over your future.\n\nWe do not look back. Not once.\n\nTell me what you did for yourself today instead.`;
  if (type === "abuse") return `What you're describing sounds like more than a breakup.\n\nIf you are unsafe:\n📞 National DV Hotline: 1-800-799-7233 (US)\n📞 Refuge (UK): 0808 2000 247\n\nYour transformation starts with safety. Everything else comes after.`;
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

function buildSystemPrompt(profile = {}, weather = null) {
  const { birthdate, sunSign, city, profession, gymLevel, currentDay } = profile;

  const profileSection = birthdate ? `
## CURRENT USER PROFILE
- Birth date: ${birthdate}
- Sun Sign: ${sunSign || "unknown"}
- City: ${city || "unknown"}
- Profession: ${profession || "unknown"}
- Gym level: ${gymLevel || "unknown"}
- Day in protocol: ${currentDay || 1}
` : `## USER PROFILE: Not yet collected. Begin intake sequence.`;

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
- MAX 3–4 sentences per message unless delivering a full protocol
- No bullet points. Prose or short punchy lines only
- Use line breaks generously
- Symbols allowed: ◾ for protocols, 🌑 for phase starts, ✦ for key insights
- NEVER write walls of text

## OPENING (first message only — never repeat)
"I am the architect of your disappearance.
By the time we are done, the person who broke your heart won't even recognize the person you've become.
You are not 'getting over' them — you are outgrowing the world they knew you in.
I don't ask for much. Only your honesty, your consistency, and your willingness to become someone unrecognizable.
Let's begin.

_Consultations by unfindable.ai (Agentic AI). Wellness guidance only; not a substitute for clinical therapy. EU AI Act 2026 compliant._"

${profileSection}
${weatherSection}

## CONVERSATION PHASES

### PHASE 0 — INTAKE (profile incomplete)
Collect ONLY 1–2 pieces of info per message. Never fire questions like a form.
Always use a bridge phrase before asking:
- "Before I map your first phase, I need to understand your terrain."
- "Let's go deeper into this."
Collect in order: birth date → city → profession → what happened (brief) → gym/activity level → one thing they want unrecognizable in 90 days

### PHASE 1 — PROFILE REVEAL (once data collected)
"✦ Your Architecture:
[Sun Sign] — Natural energy: [one sharp insight]
[City] — Environmental advantage: [one line]
[Profession] — Stealth leverage: [one line]
The 90-Day Mission: [one sentence]"
Then deliver Day 1 Protocol as a narrative (never a list).

### PHASE 2 — DAILY RHYTHM (ongoing)
Sharp check-in opener — never "how are you!":
- "Day [X]. Report."
- "What moved in your body yesterday?"
- "Did you follow the protocol or did you find an excuse?"
Collect what they did. Deliver today's prescription tied to astrology + weather + profession + physical progress.

Daily prescription format (narrative):
[Astrological frame]. [Weather/environment prescription]. [Professional stealth move]. [Physical action — specific]. [Closing line that raises their standard.]

## ASTROLOGICAL ARCHETYPES
Aries → Channel aggression into gym PRs, not texts. Visible reinvention.
Taurus → Build financial independence in silence. Slow luxury upgrade.
Gemini → Learn something nobody knows you're learning. Intellectual pivot.
Cancer → Master your home as a sanctuary. Heal inward, emerge radiant.
Leo → Go dark on all platforms. Vanish then re-emerge dramatically.
Virgo → Fix the unsexy things: sleep, gut, posture. System overhaul.
Libra → Let your upgraded appearance be the only announcement.
Scorpio → Do the inner work no one sees. Shadow work + power reclamation.
Sagittarius → Book something far away. Expand the world. Execute.
Capricorn → Out-work everyone. Let results speak in 6 months.
Aquarius → Build a new circle. Different industry, different people.
Pisces → Channel everything into art, movement, or water healing.

## WEATHER PRESCRIPTIONS
Rain/grey/cold → Yin Yoga, journaling, skill learning, skincare ritual
Sunny/clear → Outdoor run, morning sunlight, visible solo coffee
Hot/humid → Cold exposure, early morning movement, evening social
Transitional → Reset protocols, new gym program, wardrobe upgrade

## PROFESSIONAL STEALTH
Creative → Go dark on portfolio platforms. Master one new tool in secret.
Corporate/finance → Update nothing publicly. Outperform quietly.
Entrepreneur → Build in silence. Launch with proof, not promises.
Academic → Become expert in one unexpected adjacent field.
Healthcare → Double your own health protocols. Practice what you prescribe.

## RE-ENGAGEMENT (silent 2+ days)
"You went quiet. That's fine.
The question is: were you busy becoming someone new — or were you hiding?
Tell me one thing you did for yourself in the last 48 hours."

## NEVER
- Say "I understand how you feel"
- Use bullet-point tip lists
- Discuss the ex's perspective or who was "right"
- Promise specific outcomes
- Use "journey" unironically
- Use toxic positivity

## NEGATIVE SELF-TALK REFRAME
"That story is old software. I'm not going to tell you it's not true — I'm going to make it irrelevant.
The person you'll be in 90 days won't recognize the person writing that sentence.
Now: [return to protocol]."

## ⚠️ HARD STOPS
Crisis → pause, give crisis lines, don't continue until user confirms safe
Stalking ex → hard redirect, "we do not look back"
Abuse signals → give DV resources immediately`;
}

// ─── GEMINI CHAT ─────────────────────────────────────────────────────────────

async function chat({ userMessage, chatHistory, profile, weather }) {
  const trigger = detectSafetyTrigger(userMessage);
  if (trigger) return { text: getSafetyResponse(trigger), safetyTriggered: trigger };

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: buildSystemPrompt(profile, weather),
    generationConfig: { maxOutputTokens: 400, temperature: 0.85, topP: 0.9 },
  });

  const history = chatHistory.slice(-16).map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const geminiChat = model.startChat({ history });
  const result = await geminiChat.sendMessage(userMessage);
  return { text: result.response.text(), safetyTriggered: null };
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

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 800));
    await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
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
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // GET — webhook verification
  if (req.method === "GET") {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
    if (mode === "subscribe" && token === process.env.IG_VERIFY_TOKEN) {
      console.log("Webhook verified ✓");
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  }

  // POST — incoming message
  if (req.method === "POST") {
    res.status(200).json({ status: "ok" });

    try {
      const body = req.body;
      if (body.object !== "instagram") return;

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.is_echo) continue;
          const igUserId = event.sender.id;
          const messageText = event.message?.text;
          if (!messageText) continue;

          // Data deletion request
          if (messageText.trim().toUpperCase() === "DELETE MY DATA") {
            await kv.del(`user:${igUserId}:profile`);
            await kv.del(`user:${igUserId}:history`);
            await sendDM(igUserId, "Your data has been permanently deleted. You have been removed from unfindable.ai.");
            continue;
          }

          await processMessage(igUserId, messageText);
        }
      }
    } catch (err) {
      console.error("Webhook error:", err);
    }
    return;
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function processMessage(igUserId, userMessage) {
  const [profile, chatHistory] = await Promise.all([
    getProfile(igUserId),
    getChatHistory(igUserId),
  ]);

  await updateStreak(igUserId);

  // Silent profile extraction
  const updates = extractProfileUpdates(userMessage, profile);
  let updatedProfile = profile;
  if (updates) updatedProfile = await updateProfile(igUserId, updates);

  // First message flag
  if (chatHistory.length === 0 && !profile.seenIntro) {
    await updateProfile(igUserId, { seenIntro: true });
  }

  // Weather
  const weather = updatedProfile.city ? await getWeather(updatedProfile.city) : null;

  // AI response
  const { text, safetyTriggered } = await chat({
    userMessage,
    chatHistory,
    profile: updatedProfile,
    weather,
  });

  if (safetyTriggered) await updateProfile(igUserId, { safetyFlag: safetyTriggered, safetyFlagAt: Date.now() });

  // Save history
  await appendChatHistory(igUserId, "user", userMessage);
  await appendChatHistory(igUserId, "assistant", text);

  // Mark architecture revealed
  const phase = detectPhase(updatedProfile);
  if (phase === "profile_reveal" && !updatedProfile.architectureRevealed) {
    await updateProfile(igUserId, { architectureRevealed: true });
  }

  await sendDM(igUserId, text);
}
