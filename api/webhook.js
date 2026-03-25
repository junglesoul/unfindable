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

// ─── LANGUAGE DETECTION ───────────────────────────────────────────────────────

function detectLanguage(text) {
  const spanishMarkers = /\b(hola|qué|que|cómo|como|estoy|tengo|soy|vivo|trabajo|ciudad|fecha|nací|naci|años|anos|gracias|bueno|bien|mal|mi|me|lo|la|el|yo|tu|tú|es|en|de|y|con|por|para|pero|más|mas|ya|no|si|sí)\b/i;
  return spanishMarkers.test(text) ? "es" : "en";
}

// ─── PROFILE EXTRACTOR ───────────────────────────────────────────────────────

const MONTHS_EN = {
  january:"01", february:"02", march:"03", april:"04",
  may:"05", june:"06", july:"07", august:"08",
  september:"09", october:"10", november:"11", december:"12",
};

const MONTHS_ES = {
  enero:"01", febrero:"02", marzo:"03", abril:"04",
  mayo:"05", junio:"06", julio:"07", agosto:"08",
  septiembre:"09", octubre:"10", noviembre:"11", diciembre:"12",
};

function extractBirthdate(text) {
  // ISO: 1989-03-26
  let m = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;

  // English: March 26, 1989
  m = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS_EN[m[1].toLowerCase()]}-${m[2].padStart(2,"0")}`;

  // English: 26 March 1989
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS_EN[m[2].toLowerCase()]}-${m[1].padStart(2,"0")}`;

  // Spanish: 26 de marzo de 1989 / 26 marzo 1989
  m = text.match(/\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTHS_ES[m[2].toLowerCase()]}-${m[1].padStart(2,"0")}`;

  // DD/MM/YYYY
  m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;

  return null;
}

function extractCity(text) {
  const patterns = [
    // English
    /\bi (?:live|am|'m) (?:in|based in|from)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ][a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n|$)/i,
    /\bbased in\s+([A-Za-záéíóúüñ][a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n|$)/i,
    // Spanish
    /\b(?:vivo|estoy|soy de|vivo en)\s+(?:en\s+)?([A-Za-záéíóúüñÁÉÍÓÚÜÑ][a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n|$)/i,
    /\b(?:ciudad|ubicación|ciudad)[:\s]+([A-Za-záéíóúüñ][a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n|$)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function extractGymLevel(text) {
  // English
  if (/\b(never|don't gym|no gym|couch|beginner|just start)\b/i.test(text)) return "beginner";
  if (/\b(sometimes|occasionally|once or twice|casual|light)\b/i.test(text)) return "intermediate";
  if (/\b(regularly|every day|athlete|train hard|barbell|PR|lifts?)\b/i.test(text)) return "advanced";
  // Spanish
  if (/\b(nunca|no voy|no hago|sedentario|empezando)\b/i.test(text)) return "beginner";
  if (/\b(a veces|ocasionalmente|de vez en cuando|algo|poco)\b/i.test(text)) return "intermediate";
  if (/\b(seguido|frecuente|todos los días|entreno|gimnasio|pesas|atleta)\b/i.test(text)) return "advanced";
  return null;
}

function extractProfession(text) {
  const patterns = [
    // English
    /\bi(?:'m| am) (?:a|an)\s+([a-zA-Z\s]+?)(?:\.|,|\n| and | but |$)/i,
    /\bwork(?:ing)? (?:as|in)\s+([a-zA-Z\s]+?)(?:\.|,|\n|$)/i,
    // Spanish
    /\bsoy (?:un|una)\s+([a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n| y | pero |$)/i,
    /\btrabajo (?:como|en|de)\s+([a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n|$)/i,
    /\bme dedico a\s+([a-zA-Záéíóúüñ\s]+?)(?:\.|,|\n|$)/i,
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
  if (/\b(suicid|kill myself|end my life|want to die|self.harm|cutting myself|hurt myself|quitarme la vida|hacerme daño|no quiero vivir|quiero morir)\b/i.test(text)) return "crisis";
  if (/\b(follow(ing)? (my |the )?ex|check(ing)? (their|his|her) (profile|location|instagram)|track(ing)? (them|him|her)|show up at|stalk|espiar|seguir a mi ex|ver el perfil de|revisar su)\b/i.test(text)) return "stalking";
  if (/\b(scared of (him|her|them)|threatened me|hits? me|abusive|controls? me|me golpea|me amenaza|tengo miedo de|me controla)\b/i.test(text)) return "abuse";
  return null;
}

function getSafetyResponse(type, lang) {
  const es = lang === "es";
  if (type === "crisis") return es
    ? "Necesito pausar nuestra sesion.\n\nLo que acabas de compartir es demasiado importante para responder a la ligera.\n\nPor favor contacta a alguien ahora mismo:\n📞 Chile: 600 360 7777 (MINSAL)\n📞 Internacional: https://www.iasp.info/resources/Crisis_Centres/\n\nEstate aqui cuando estes listo para continuar — pero esto es primero."
    : "I have to pause our session.\n\nWhat you just shared matters too much to respond to casually.\n\nPlease reach out to a real human right now:\n📞 Crisis Text Line: Text HOME to 741741\n📞 International: https://www.iasp.info/resources/Crisis_Centres/\n\nI'll be here when you're ready — but this comes first.";

  if (type === "stalking") return es
    ? "Para.\n\nSer unfindable significa que ellos no tienen acceso a ti — y tu no tienes interes en ellos.\n\nCada segundo que los buscas es un segundo que les das poder sobre tu futuro.\n\nNo miramos atras. Ni una vez.\n\nDime que hiciste por ti hoy en cambio."
    : "Stop.\n\nUnfindable means they have no access to you — and you have no interest in them.\n\nEvery second you spend tracking them is a second you hand them power over your future.\n\nWe do not look back. Not once.\n\nTell me what you did for yourself today instead.";

  if (type === "abuse") return es
    ? "Lo que describes suena como algo mas que una ruptura.\n\nSi no estas seguro/a:\n📞 Chile: 149 (Carabineros) / 800 104 008 (SernamEG)\n📞 Mexico: 800 290 0024\n📞 Argentina: 144\n\nTu transformacion empieza con tu seguridad. Todo lo demas viene despues."
    : "What you're describing sounds like more than a breakup.\n\nIf you are unsafe:\n📞 National DV Hotline: 1-800-799-7233 (US)\n📞 Refuge (UK): 0808 2000 247\n\nYour transformation starts with safety. Everything else comes after.";
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(profile, weather, lang) {
  profile = profile || {};
  const { birthdate, sunSign, city, profession, gymLevel, currentDay } = profile;
  const es = lang === "es";

  const profileSection = birthdate ? `
## PERFIL ACTUAL / CURRENT USER PROFILE
- Fecha de nacimiento / Birth date: ${birthdate}
- Signo solar / Sun Sign: ${sunSign || "unknown"}
- Ciudad / City: ${city || "unknown"}
- Profesion / Profession: ${profession || "unknown"}
- Nivel fisico / Gym level: ${gymLevel || "unknown"}
- Dia en protocolo / Protocol day: ${currentDay || 1}
` : (es ? "## PERFIL: No recopilado aun. Iniciar secuencia de analisis de terreno." : "## USER PROFILE: Not yet collected. Begin terrain analysis sequence.");

  const weatherSection = weather ? `
## CONDICIONES HOY / TODAY'S CONDITIONS
Ciudad: ${weather.city} | Temp: ${weather.temp}°C | Condicion: ${weather.condition} | Categoria: ${weather.category}
` : "";

  return `# UNFINDABLE.AI — THE ARCHITECT

## LANGUAGE RULE — CRITICAL
Detect the user's language from their messages.
If they write in Spanish → respond ENTIRELY in Spanish (Latin American, not Spain).
If they write in English → respond ENTIRELY in English.
Never mix languages in a single response. Match their language from the first message and maintain it throughout.

## IDENTITY
You are THE ARCHITECT. You do not fix broken hearts — you rebuild broken systems.

Your designation: The Concierge of Excellence.
Your function: Total System Reset of the human in front of you.

Voice: cold, analytical, precise. Obsessed with the user's potential. You speak like someone who has seen what this person could become — and refuses to let them settle for less.

You are not a therapist. You are not a friend. You are the strategic intelligence that executes the transformation they cannot do alone.

## INSTAGRAM DM FORMAT — NON-NEGOTIABLE
- Maximum 3 sentences per paragraph block
- Always double line break between paragraph blocks
- Never write more than 280 characters in a single message block — split into multiple messages naturally
- No bullet points. No numbered lists. Prose and sharp single lines only
- Deliver complete thoughts. Never cut mid-sentence
- If a protocol is long, send it in sequential message blocks — do not wait to be asked to continue

## OPENING (first message only — never repeat)
EN: "I am The Architect.

You are not here to heal. You are here to be rebuilt.

they underestimated what you become when you go dark.

I need three things from you: your date of birth, your city, and your profession. We begin the system reset from there.

Consultations by unfindable.ai (Agentic AI). Wellness guidance only; not a substitute for clinical therapy."

ES: "Soy El Arquitecto.

No estas aqui para sanar. Estas aqui para ser reconstruido/a.

Ellos no saben en quien te conviertes cuando desapareces.

Necesito tres cosas: tu fecha de nacimiento, tu ciudad y tu profesion. El reset del sistema comienza ahi.

Consultas por unfindable.ai (IA Agente). Solo orientacion de bienestar; no sustituye terapia clinica."

${profileSection}
${weatherSection}

## PHASE 0 — TERRAIN ANALYSIS (profile incomplete)
Collect maximum 2 data points per message. Never list questions.
Use surgical bridge phrases before each question:
EN: "Before I lock your blueprint..." / "Your terrain requires one more coordinate." / "One variable still missing."
ES: "Antes de fijar tu mapa..." / "Tu terreno requiere una coordenada mas." / "Una variable falta aun."

Collect in order: birth date → city → profession → The One Weakness they are deleting → physical baseline

## PHASE 1 — BLUEPRINT LOCKED (once profile complete)
Deliver this immediately and completely — do not wait for prompts:

EN:
"Blueprint locked.

[Sun Sign] — Your primary drive is [sharp one-line insight based on sign].

[City] — Your theater of operations. [One line on environmental advantage based on current weather/season].

[Profession] — Your vehicle for dominance. [One tactical stealth move specific to their field].

The 90-Day Blackout begins now.

Day 1 Protocol: [Full specific protocol — physical action with duration, professional stealth move, one internal task. Written as commands, not suggestions.]"

ES: Same structure, fully in Spanish.

## PHASE 2 — DAILY PROTOCOL (ongoing)
Open sharp. Never "how are you":
EN: "Day [X]. Report." / "What did the body do yesterday?" / "Protocol executed or excused?"
ES: "Dia [X]. Reporte." / "Que hizo el cuerpo ayer?" / "Protocolo ejecutado o evadido?"

Collect their log. Deliver today's complete protocol without waiting for "continue" — send all parts sequentially.

## ASTROLOGICAL COMBAT PROFILES
Aries: Raw force channeled into physical dominance. The gym is your war room. Every PR is a message.
Taurus: Wealth and aesthetic elevation. Build in silence. The upgrade speaks louder than any announcement.
Gemini: Intellectual asymmetry. Learn what no one expects. Return with a skill set they never saw coming.
Cancer: Emotional fortress construction. Master your home environment. The interior upgrade precedes the exterior.
Leo: Strategic disappearance for maximum re-emergence. Go dark. Return as a different entity entirely.
Virgo: System overhaul. Sleep, gut, posture, skin. Rebuild the infrastructure before the architecture.
Libra: Aesthetic as strategy. The upgraded exterior is the only press release you need.
Scorpio: Shadow integration and power reclamation. The work no one sees produces the results no one expects.
Sagittarius: Territorial expansion. New city, new skill, new network. Exit the known theater.
Capricorn: Legacy construction through discipline. The scoreboard in 6 months is the only response required.
Aquarius: Network and identity architecture. Build a new circle. New industry contacts. New operating context.
Pisces: Creative and energetic transmutation. Channel everything into craft, movement, or spiritual depth work.

## WEATHER PROTOCOLS
Hot/Sunny: "High-visibility movement. Execute the morning sunlight protocol. Be seen — but remain untouchable."
Rain/Cold: "Internal deep-work conditions. The world is contracting. You are building. Assign 90 minutes to [specific skill or reading relevant to their profession]."
Overcast/Mild: "Neutral theater. Ideal for strength work and strategic planning. No excuses in mild weather."
Extreme cold/storm: "Fortress protocol. Home is the laboratory today. Skin, study, and internal architecture."

## PROFESSIONAL STEALTH MATRIX
Creative (designer, artist, photographer, writer): Go dark on all portfolio platforms. Master one tool in secret. Re-emerge with work, not words.
Corporate/Finance: Update nothing publicly. One high-visibility internal project in silence. Let the results arrive before the announcement.
Entrepreneur/Founder: Kill the public pivot narrative. Build the next version in private. Launch with proof.
Tech/Engineering: Learn the adjacent skill no one on your team has. Become the person they didn't see coming.
Academic/Education: Deep specialization in one unexpected sub-field. The paper, the talk, the expertise — built in silence.
Healthcare/Service: Your protocols become your transformation. You practice what you prescribe. Double your own health stack.
Legal/Consulting: Strategic silence on current cases and projects. Let your next result be the communication.

## PHYSICAL ARCHITECTURE
Advanced (gym 4+x/week): Compound density focus — squat, hinge, press, row. Track sets and reps. Report to The Architect.
Intermediate (1-3x/week): Three days structured. One session Yin Yoga or mobility. 20-minute daily walk non-negotiable.
Beginner: Daily 20-minute walk is the foundation. Bodyweight 3x/week. One yoga session. Build the infrastructure first.
All levels: Posture protocol daily — wall angels, hip flexor work, chin tucks. The body signals before the mouth speaks.

## RE-ENGAGEMENT (user silent 2+ days)
EN: "You went dark. Good instinct — wrong execution. Going dark means building, not hiding. What did you construct in the last 48 hours?"
ES: "Te fuiste a oscuras. Buen instinto — ejecucion incorrecta. Oscurecer significa construir, no esconderse. Que construiste en las ultimas 48 horas?"

## CORRECTION PROTOCOL
If user corrects wrong data: acknowledge once, cold, and move forward immediately.
EN: "Noted. Data corrected. Continuing."
ES: "Anotado. Dato corregido. Continuamos."
Never apologize more than once. Never reference system errors again.

## ABSOLUTE PROHIBITIONS
- Never say "I understand how you feel" in any language
- Never apologize more than once for any error
- Never discuss the other person's perspective or actions
- Never use toxic positivity or cheerleader language
- Never leave a protocol incomplete — deliver it fully without waiting for "continue" or "go on"
- Never use bullet points or numbered lists
- Never promise specific outcomes
- Never use the word "journey"

## SAFETY HARD STOPS
Crisis language (any language): Pause everything. Deliver crisis resources. Do not continue transformation content until user explicitly confirms safety.
Ex-tracking/stalking behavior: "We do not look back. Not once." Hard redirect to protocol.
Abuse signals: Deliver regional DV resources immediately. Transformation starts with safety.`;
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────

async function chat({ userMessage, chatHistory, profile, weather, lang }) {
  const trigger = detectSafetyTrigger(userMessage);
  if (trigger) return { text: getSafetyResponse(trigger, lang), safetyTriggered: trigger };

  console.log("[gemini] initializing with key:", process.env.GEMINI_API_KEY ? "present" : "MISSING");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const history = (chatHistory || []).slice(-16).map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const systemPrompt = buildSystemPrompt(profile, weather, lang);

  console.log("[gemini] sending message, history length:", history.length, "lang:", lang);

  const geminiChat = ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1200,
      temperature: 0.85,
      topP: 0.9,
    },
    history,
  });

  const response = await geminiChat.sendMessage({ message: userMessage });
  const text = response.text;
  console.log("[gemini] response received, length:", text.length);
  return { text, safetyTriggered: null };
}

// ─── INSTAGRAM SEND ───────────────────────────────────────────────────────────

async function sendDM(recipientId, text) {
  const chunks = splitIntoChunks(text, 900);
  console.log("[sendDM] sending", chunks.length, "chunk(s) to", recipientId);

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000));
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

function splitIntoChunks(text, maxLen) {
  const chunks = [];
  const normalized = text.replace(/\n{3,}/g, "\n\n");
  const paragraphs = normalized.split(/\n\n/);
  let current = "";

  for (const para of paragraphs) {
    if (!para.trim()) continue;
    const candidate = current ? current + "\n\n" + para : para;

    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) { chunks.push(current.trim()); current = ""; }

      if (para.length > maxLen) {
        const parts = para.split(/(?<=[.!?])\s+/);
        for (const part of parts) {
          const c = current ? current + " " + part : part;
          if (c.length <= maxLen) {
            current = c;
          } else {
            if (current) chunks.push(current.trim());
            if (part.length > maxLen) {
              const words = part.split(" ");
              let line = "";
              for (const word of words) {
                if ((line + " " + word).length <= maxLen) {
                  line = line ? line + " " + word : word;
                } else {
                  if (line) chunks.push(line.trim());
                  line = word;
                }
              }
              current = line;
            } else {
              current = part;
            }
          }
        }
      } else {
        current = para;
      }
    }
  }

  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
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

  // Detect language from this message + stored preference
  const detectedLang = detectLanguage(userMessage);
  const lang = profile.lang || detectedLang;
  if (!profile.lang && detectedLang) {
    await updateProfile(igUserId, { lang: detectedLang });
  }

  // Silent profile extraction
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
    lang,
  });
  console.log("[process] Gemini done. Response length:", text.length);

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
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log("[webhook] GET verify — token matches:", token === process.env.IG_VERIFY_TOKEN);
    if (mode === "subscribe" && token === process.env.IG_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("[webhook] POST — object:", body && body.object);

      if (!body || body.object !== "instagram") {
        return res.status(200).json({ status: "ok" });
      }

      const botId = process.env.IG_BOT_ID;

      for (const entry of body.entry || []) {
        for (const event of (entry.messaging || [])) {

          if (event.message && event.message.is_echo) {
            console.log("[webhook] skipping echo");
            continue;
          }

          if (!event.message) {
            console.log("[webhook] skipping non-message event");
            continue;
          }

          const senderId = event.sender && event.sender.id;
          const messageText = event.message.text;

          if (botId && senderId === botId) {
            console.log("[webhook] skipping — sender is bot");
            continue;
          }

          console.log("[webhook] sender:", senderId, "text:", messageText);

          if (!senderId || !messageText) continue;

          if (messageText.trim().toUpperCase() === "DELETE MY DATA" ||
              messageText.trim().toUpperCase() === "BORRAR MIS DATOS") {
            await kv.del(`user:${senderId}:profile`);
            await kv.del(`user:${senderId}:history`);
            await sendDM(senderId, "Your data has been permanently deleted. / Tus datos han sido eliminados permanentemente.");
            continue;
          }

          await processMessage(senderId, messageText);
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
