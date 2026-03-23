// api/geminiChat.js
// Gemini 2.0 Flash integration with safety guardrails

import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSystemPrompt } from "./systemPrompt.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Safety Trigger Patterns ──────────────────────────────────────────────────

const CRISIS_PATTERNS = [
  /\b(suicid|kill myself|end my life|don't want to live|want to die|self.harm|cutting myself|hurt myself)\b/i,
];

const STALKING_PATTERNS = [
  /\b(follow(ing)? (my |the )?ex|check(ing)? (their|his|her) (profile|location|instagram|phone)|track(ing)? (them|him|her)|show up at|outside (their|his|her))\b/i,
];

const ABUSE_PATTERNS = [
  /\b(scared of (him|her|them)|threatened me|hits? me|physically|abusive|controls? me|won't let me|afraid (of|to))\b/i,
];

export function detectSafetyTrigger(text) {
  if (CRISIS_PATTERNS.some((p) => p.test(text))) return "crisis";
  if (STALKING_PATTERNS.some((p) => p.test(text))) return "stalking";
  if (ABUSE_PATTERNS.some((p) => p.test(text))) return "abuse";
  return null;
}

export function getSafetyResponse(triggerType) {
  if (triggerType === "crisis") {
    return `I have to pause our session.

What you just shared is outside the scope of what I can help you navigate — and it matters too much for me to respond casually.

Please reach out to a real human right now:
📞 Crisis Text Line: Text HOME to 741741 (US/UK/CA/IE)
📞 International: https://www.iasp.info/resources/Crisis_Centres/

You don't have to be alone with this. I'll be here when you're ready to continue — but this comes first.`;
  }

  if (triggerType === "stalking") {
    return `Stop.

Unfindable means they have no access to you — and you have no interest in them.

Every second you spend tracking them is a second you hand them power over your future.

We do not look back. Not once.

Tell me what you were supposed to do for yourself today instead.`;
  }

  if (triggerType === "abuse") {
    return `What you're describing sounds like more than a breakup.

If you are in a situation where you feel unsafe:
📞 National DV Hotline: 1-800-799-7233 (US)
📞 Refuge (UK): 0808 2000 247

Your transformation starts with safety. Everything else comes after.`;
  }
}

// ─── Main Chat Function ───────────────────────────────────────────────────────

export async function chat({ userMessage, chatHistory, userProfile, weatherContext }) {
  // 1. Safety check BEFORE sending to Gemini
  const trigger = detectSafetyTrigger(userMessage);
  if (trigger) {
    return { text: getSafetyResponse(trigger), safetyTriggered: trigger };
  }

  // 2. Build system prompt with current user profile
  let systemPrompt = buildSystemPrompt(userProfile);

  // 3. Append weather context if available
  if (weatherContext) {
    systemPrompt += `\n\n## TODAY'S WEATHER CONTEXT\nCity: ${weatherContext.city}\nCondition: ${weatherContext.condition}\nTemp: ${weatherContext.temp}°C\nCategory: ${weatherContext.category}\nUse this to inform today's environmental prescription.`;
  }

  // 4. Initialize Gemini model
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: 400,
      temperature: 0.85,
      topP: 0.9,
    },
  });

  // 5. Format conversation history for Gemini (user / model roles)
  const formattedHistory = chatHistory
    .slice(-16)
    .map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

  // 6. Send message
  const geminiChat = model.startChat({ history: formattedHistory });
  const result = await geminiChat.sendMessage(userMessage);
  const text = result.response.text();

  return { text, safetyTriggered: null };
}
