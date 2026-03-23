// api/status.js
// Health check endpoint → /api/status

export default function handler(req, res) {
  res.status(200).json({
    status: "operational",
    service: "unfindable.ai",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    disclaimer:
      "Consultations by unfindable.ai (Agentic AI). For wellness guidance only; not a substitute for clinical therapy. EU AI Act 2026 compliant.",
  });
}
