const express = require("express");
const cors = require("cors");
const path = require("path");
const { Resend } = require("resend");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.options("*", cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const resend = new Resend(process.env.RESEND_API_KEY);

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "UGC Pipeline API", version: "2.0.0" });
});

app.post("/send-batch", async (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "emails array required" });
  }
  const fromAddr = process.env.FROM_EMAIL || "onboarding@resend.dev";
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
    await new Promise(r => setTimeout(r, 300));
  }
  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`[BATCH] Done — ${sent} sent, ${failed} failed`);
  res.json({ results, summary: { sent, failed, total: emails.length } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UGC Pipeline running on port ${PORT}`);
  console.log(`Dashboard: https://ugc-backend-production-5137.up.railway.app`);
  console.log(`Resend key: ${process.env.RESEND_API_KEY ? "✓ set" : "✗ missing"}`);
  console.log(`From email: ${process.env.FROM_EMAIL}`);
});
