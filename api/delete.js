// api/delete.js
// Handles two things:
// 1. GET  /api/delete — Human-readable data deletion instructions page (for Meta's "instructions URL")
// 2. POST /api/delete — Meta's signed deletion callback (for Meta's "callback URL")

import { kv } from "@vercel/kv";
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return handleInstructionsPage(req, res);
  }
  if (req.method === "POST") {
    return handleDeletionCallback(req, res);
  }
  return res.status(405).json({ error: "Method not allowed" });
}

// ─── GET: Human-readable instructions page ────────────────────────────────────

function handleInstructionsPage(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Data Deletion — unfindable.ai</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #0a0a0a;
      color: #c8c8c8;
      font-family: 'Georgia', serif;
      line-height: 1.8;
      padding: 60px 24px;
    }

    .container {
      max-width: 680px;
      margin: 0 auto;
    }

    .logo {
      font-size: 13px;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 60px;
    }

    h1 {
      font-size: 28px;
      font-weight: normal;
      color: #f0f0f0;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .subtitle {
      font-size: 13px;
      color: #444;
      margin-bottom: 48px;
      letter-spacing: 0.05em;
    }

    h2 {
      font-size: 13px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #888;
      margin-top: 40px;
      margin-bottom: 12px;
      font-weight: normal;
    }

    p {
      font-size: 15px;
      color: #999;
      margin-bottom: 16px;
    }

    .step {
      display: flex;
      gap: 20px;
      margin-bottom: 24px;
      align-items: flex-start;
    }

    .step-number {
      font-size: 11px;
      letter-spacing: 0.15em;
      color: #333;
      padding-top: 3px;
      min-width: 24px;
    }

    .step-text {
      font-size: 15px;
      color: #999;
    }

    .highlight {
      background: #111;
      border: 1px solid #1e1e1e;
      border-radius: 4px;
      padding: 16px 20px;
      font-size: 14px;
      color: #777;
      margin: 24px 0;
      font-family: monospace;
      letter-spacing: 0.05em;
    }

    .note {
      font-size: 13px;
      color: #444;
      margin-top: 40px;
      padding-top: 32px;
      border-top: 1px solid #1a1a1a;
    }

    a { color: #666; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">

    <div class="logo">unfindable.ai</div>

    <h1>Data Deletion</h1>
    <p class="subtitle">How to request removal of your personal data</p>

    <p>When you use unfindable.ai via Instagram, we store your coaching profile and conversation history to deliver a personalised experience. You have the right to request complete deletion of this data at any time.</p>

    <h2>Option 1 — Delete via DM (fastest)</h2>

    <div class="step">
      <span class="step-number">01</span>
      <span class="step-text">Open Instagram and go to your Direct Messages with <strong style="color:#777">@unfindable.ai</strong></span>
    </div>
    <div class="step">
      <span class="step-number">02</span>
      <span class="step-text">Send exactly the following message:</span>
    </div>

    <div class="highlight">DELETE MY DATA</div>

    <div class="step">
      <span class="step-number">03</span>
      <span class="step-text">The system will confirm deletion and permanently remove your profile, conversation history, and all associated data within <strong style="color:#777">24 hours</strong>.</span>
    </div>

    <h2>Option 2 — Delete via Email</h2>

    <p>Send a deletion request to <a href="mailto:privacy@unfindable.ai">privacy@unfindable.ai</a> from the email address associated with your Instagram account. Include your Instagram username in the message. We will confirm deletion within <strong style="color:#777">7 days</strong>.</p>

    <h2>What Gets Deleted</h2>

    <div class="step">
      <span class="step-number">◾</span>
      <span class="step-text">Your coaching profile (birth date, city, profession, goals)</span>
    </div>
    <div class="step">
      <span class="step-number">◾</span>
      <span class="step-text">Your full conversation history</span>
    </div>
    <div class="step">
      <span class="step-number">◾</span>
      <span class="step-text">Your progress streak and protocol tracking</span>
    </div>
    <div class="step">
      <span class="step-number">◾</span>
      <span class="step-text">Any safety flags or session notes</span>
    </div>

    <p style="margin-top: 24px;">We do not retain backups of individual user data. Deletion is permanent and irreversible.</p>

    <h2>Revoking Instagram Permissions</h2>

    <p>To also revoke unfindable.ai's access to your Instagram account:</p>

    <div class="step">
      <span class="step-number">01</span>
      <span class="step-text">Go to Instagram → Settings → Security → Apps and Websites</span>
    </div>
    <div class="step">
      <span class="step-number">02</span>
      <span class="step-text">Find <strong style="color:#777">unfindable.ai</strong> and tap <strong style="color:#777">Remove</strong></span>
    </div>

    <p class="note">
      For any questions about your data, contact us at <a href="mailto:privacy@unfindable.ai">privacy@unfindable.ai</a><br/><br/>
      Consultations by unfindable.ai (Agentic AI). For wellness guidance only; not a substitute for clinical therapy. EU AI Act 2026 compliant.
    </p>

  </div>
</body>
</html>`);
}

// ─── POST: Meta's signed deletion callback ────────────────────────────────────
// Meta sends a signed_request param when a user removes the app from Facebook/Instagram
// We verify the signature, decode the user ID, delete their data, and return a status URL

async function handleDeletionCallback(req, res) {
  try {
    const { signed_request } = req.body;

    if (!signed_request) {
      return res.status(400).json({ error: "Missing signed_request" });
    }

    // Decode and verify Meta's signed request
    const userId = verifyAndDecodeSignedRequest(
      signed_request,
      process.env.META_APP_SECRET
    );

    if (!userId) {
      return res.status(400).json({ error: "Invalid signed_request" });
    }

    // Delete all user data from KV
    await deleteUserData(userId);

    // Meta requires a confirmation_code and status_url in the response
    const confirmationCode = `unfindable_deleted_${userId}_${Date.now()}`;

    return res.status(200).json({
      url: `https://${req.headers.host}/api/delete?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  } catch (err) {
    console.error("Deletion callback error:", err);
    return res.status(500).json({ error: "Deletion failed" });
  }
}

// ─── Verify Meta's signed_request ────────────────────────────────────────────

function verifyAndDecodeSignedRequest(signedRequest, appSecret) {
  try {
    const [encodedSig, payload] = signedRequest.split(".");

    const sig = Buffer.from(
      encodedSig.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );

    const expectedSig = crypto
      .createHmac("sha256", appSecret)
      .update(payload)
      .digest();

    if (!crypto.timingSafeEqual(sig, expectedSig)) {
      console.error("Signature mismatch");
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, "base64").toString("utf8")
    );

    return data.user_id;
  } catch (err) {
    console.error("signed_request decode error:", err);
    return null;
  }
}

// ─── Delete all KV data for a user ───────────────────────────────────────────

async function deleteUserData(igUserId) {
  await Promise.all([
    kv.del(`user:${igUserId}:profile`),
    kv.del(`user:${igUserId}:history`),
  ]);
  console.log(`Data deleted for user: ${igUserId}`);
}
