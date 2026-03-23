// Root placeholder — unfindable.ai runs entirely via /api functions
export default function handler(req, res) {
  res.status(200).json({ service: "unfindable.ai", status: "operational" });
}
