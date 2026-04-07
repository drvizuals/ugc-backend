const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "UGC Pipeline API", version: "1.0.0" });
});

// ── Send single email ─────────────────────────────────────────────────────────
app.post("/send", async (req, res) => {
  const { to, from, subject, body, company } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields: to, subject, body" });
  }

  const fromAddr = from || process.env.FROM_EMAIL || "outreach@resend.dev";

  try {
    const result = await resend.emails.send({
      from: fromAddr,
      to: [to],
      subject: subject,
      text: body,
    });

    console.log(`[SENT] ${company || to} → ${result.data?.id}`);
    res.json({ success: true, id: result.data?.id, company });

  } catch (err) {
    console.error(`[FAIL] ${company || to} →`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Send batch emails ─────────────────────────────────────────────────────────
app.post("/send-batch", async (req, res) => {
  const { emails, from } = req.body;

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "emails array required" });
  }

  const fromAddr = from || process.env.FROM_EMAIL || "outreach@resend.dev";
  const results = [];

  for (const email of emails) {
    try {
      const result = await resend.emails.send({
        from: fromAddr,
        to: [email.to],
        subject: email.subject,
        text: email.body,
      });

      console.log(`[SENT] ${email.company} → ${result.data?.id}`);
      results.push({ company: email.company, success: true, id: result.data?.id });

    } catch (err) {
      console.error(`[FAIL] ${email.company} →`, err.message);
      results.push({ company: email.company, success: false, error: err.message });
    }

    // Small delay between sends to respect rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`[BATCH] Done — ${sent} sent, ${failed} failed`);
  res.json({ results, summary: { sent, failed, total: emails.length } });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UGC Pipeline API running on port ${PORT}`);
  console.log(`Resend key: ${process.env.RESEND_API_KEY ? "✓ set" : "✗ missing"}`);
  console.log(`From email: ${process.env.FROM_EMAIL || "using resend.dev default"}`);
});
