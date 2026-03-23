// api/webhook.js
// Instagram DM Webhook Handler for unfindable.ai
// Handles verification + incoming messages

import {
  getProfile,
  updateProfile,
  getChatHistory,
  appendChatHistory,
  updateStreak,
  flagSafetyConcern,
  detectPhase,
} from "./userStore.js";
import { chat } from "./geminiChat.js";
import { getWeatherForCity } from "./weather.js";
import { extractProfileUpdates } from "./profileExtractor.js";

const IG_API = "https://graph.instagram.com/v21.0";

// ─── Webhook Verification (GET) ───────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === "GET") {
    return handleVerification(req, res);
  }
  if (req.method === "POST") {
    return handleMessage(req, res);
  }
  return res.status(405).json({ error: "Method not allowed" });
}

function handleVerification(req, res) {
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;

  if (mode === "subscribe" && token === process.env.IG_VERIFY_TOKEN) {
    console.log("Webhook verified ✓");
    return res.status(200).send(challenge);
  }

  console.error("Webhook verification failed");
  return res.status(403).json({ error: "Verification failed" });
}

// ─── Incoming Message Handler (POST) ─────────────────────────────────────────

async function handleMessage(req, res) {
  // Always respond 200 immediately to Instagram (required within 20s)
  res.status(200).json({ status: "ok" });

  try {
    const body = req.body;

    if (body.object !== "instagram") return;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        // Skip echoes (our own messages)
        if (event.message?.is_echo) continue;

        const igUserId = event.sender.id;
        const messageText = event.message?.text;

        if (!messageText) continue;

        await processMessage(igUserId, messageText);
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
}

// ─── Core Message Processing ──────────────────────────────────────────────────

async function processMessage(igUserId, userMessage) {
  // 1. Load user state
  const [profile, chatHistory] = await Promise.all([
    getProfile(igUserId),
    getChatHistory(igUserId),
  ]);

  // 2. Update streak
  await updateStreak(igUserId);

  // 3. Extract profile data from message (background, silent)
  const profileUpdates = extractProfileUpdates(userMessage, profile);
  let updatedProfile = profile;
  if (profileUpdates) {
    updatedProfile = await updateProfile(igUserId, profileUpdates);
  }

  // 4. Get weather if we have a city
  let weatherContext = null;
  if (updatedProfile.city) {
    weatherContext = await getWeatherForCity(updatedProfile.city);
  }

  // 5. Check if this is the very first message
  const isFirstMessage = chatHistory.length === 0 && !profile.seenIntro;
  if (isFirstMessage) {
    await updateProfile(igUserId, { seenIntro: true });
  }

  // 6. Generate AI response
  const { text: aiResponse, safetyTriggered } = await chat({
    userMessage,
    chatHistory,
    userProfile: updatedProfile,
    weatherContext,
    isFirstMessage,
  });

  // 7. Flag safety if triggered
  if (safetyTriggered) {
    await flagSafetyConcern(igUserId, safetyTriggered);
  }

  // 8. Save conversation to history
  await appendChatHistory(igUserId, "user", userMessage);
  await appendChatHistory(igUserId, "assistant", aiResponse);

  // 9. Update phase if profile just completed
  const phase = detectPhase(updatedProfile);
  if (phase === "profile_reveal" && !updatedProfile.architectureRevealed) {
    await updateProfile(igUserId, { architectureRevealed: true });
  }

  // 10. Send response back via Instagram API
  await sendInstagramMessage(igUserId, aiResponse);
}

// ─── Instagram Send Message ───────────────────────────────────────────────────

async function sendInstagramMessage(recipientId, text) {
  const chunks = splitMessage(text, 990);

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await delay(800);

    await fetch(`${IG_API}/me/messages`, {
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

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  const paragraphs = text.split("\n\n");
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
