const express = require(“express”);
const cors = require(“cors”);
const path = require(“path”);
const { Resend } = require(“resend”);

const app = express();
app.use(cors({ origin: “*”, methods: [“GET”, “POST”, “OPTIONS”] }));
app.options(”*”, cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, “public”)));

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Health ────────────────────────────────────────────────────────────────────
app.get(”/health”, (req, res) => {
res.json({ status: “ok”, version: “3.0.0” });
});

// ── SCRAPE: Reddit ─────────────────────────────────────────────────────────────
async function scrapeReddit() {
const subreddits = [“UGCcreators”, “forhire”, “hiring”, “socialmediamarketing”];
const keywords = [“ugc”, “user generated content”, “content creator”, “ugc creator”, “video creator”];
const techKeywords = [“app”, “saas”, “software”, “tech”, “startup”, “platform”, “tool”, “ai”, “mobile”];
const excludeKeywords = [“product”, “supplement”, “fashion”, “food”, “beauty”, “skincare”, “clothing”, “ecommerce”, “amazon”, “physical”];

const leads = [];
const seen = new Set();

for (const sub of subreddits) {
try {
const url = `https://www.reddit.com/r/${sub}/new.json?limit=50`;
const res = await fetch(url, {
headers: { “User-Agent”: “UGCPipelineBot/1.0” }
});
if (!res.ok) continue;
const data = await res.json();
const posts = data?.data?.children || [];

```
  for (const post of posts) {
    const p = post.data;
    const text = ((p.title || "") + " " + (p.selftext || "")).toLowerCase();

    // Must mention UGC or creator
    const hasUGC = keywords.some(k => text.includes(k));
    if (!hasUGC) continue;

    // Must mention tech
    const hasTech = techKeywords.some(k => text.includes(k));
    if (!hasTech) continue;

    // Must not be physical product
    const hasExclude = excludeKeywords.some(k => text.includes(k));
    if (hasExclude) continue;

    const key = p.title;
    if (seen.has(key)) continue;
    seen.add(key);

    // Extract contact info
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    const handleMatch = text.match(/@[\w]+/);

    // Determine category
    let category = "saas";
    if (text.includes("app") || text.includes("mobile")) category = "app";
    if (text.includes("ai") || text.includes("artificial intelligence")) category = "ai-tool";
    if (text.includes("fintech") || text.includes("finance") || text.includes("payment")) category = "fintech";

    // Score based on signals
    let score = 5;
    if (emailMatch) score += 2;
    if (p.created_utc > Date.now() / 1000 - 86400 * 3) score += 2; // posted in last 3 days
    else if (p.created_utc > Date.now() / 1000 - 86400 * 7) score += 1; // last 7 days
    if (text.includes("paid") || text.includes("budget") || text.includes("compensation")) score += 1;
    if (text.includes("ugc") && text.includes("app")) score += 1;
    score = Math.min(score, 10);

    const postedRecently = p.created_utc > Date.now() / 1000 - 86400 * 7;

    leads.push({
      company: extractCompany(p.title, p.selftext) || "Reddit Post",
      category,
      source: "Reddit r/" + sub,
      sourceUrl: "https://reddit.com" + p.permalink,
      contactEmail: emailMatch ? emailMatch[0] : null,
      contactHandle: handleMatch ? handleMatch[0] : ("u/" + p.author),
      needsContent: extractNeedsContent(text),
      rawDescription: p.title,
      postedRecently,
      score,
      scoreReason: buildScoreReason(emailMatch, postedRecently, text),
    });
  }
} catch (e) {
  console.error(`Reddit scrape failed for r/${sub}:`, e.message);
}
```

}

return leads;
}

// ── SCRAPE: Product Hunt ───────────────────────────────────────────────────────
async function scrapeProductHunt() {
const leads = [];

try {
const query = `{ posts(first: 30, order: NEWEST) { edges { node { id name tagline description url website topics { edges { node { name } } } makers { id username twitterUsername } } } } }`;

```
const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + (process.env.PRODUCT_HUNT_TOKEN || ""),
  },
  body: JSON.stringify({ query })
});

if (!res.ok) throw new Error("Product Hunt API error " + res.status);
const data = await res.json();
const posts = data?.data?.posts?.edges || [];

const techTopics = ["saas", "productivity", "developer tools", "artificial intelligence", "tech", "mobile", "fintech", "edtech", "health"];
const excludeTopics = ["fashion", "food", "beauty", "gaming", "lifestyle"];

for (const edge of posts) {
  const p = edge.node;
  const topics = (p.topics?.edges || []).map(t => t.node.name.toLowerCase());
  const hasTech = topics.some(t => techTopics.some(k => t.includes(k)));
  const hasExclude = topics.some(t => excludeTopics.some(k => t.includes(k)));
  if (!hasTech || hasExclude) continue;

  const maker = p.makers?.[0];
  const twitterHandle = maker?.twitterUsername ? "@" + maker.twitterUsername : null;

  // Guess contact email from website domain
  let contactEmail = null;
  try {
    const domain = new URL(p.website || p.url).hostname.replace("www.", "");
    contactEmail = "hello@" + domain;
  } catch (e) {}

  let category = "saas";
  if (topics.some(t => t.includes("mobile") || t.includes("app"))) category = "app";
  if (topics.some(t => t.includes("artificial intelligence") || t.includes("ai"))) category = "ai-tool";
  if (topics.some(t => t.includes("fintech"))) category = "fintech";

  leads.push({
    company: p.name,
    category,
    source: "Product Hunt",
    sourceUrl: p.url,
    contactEmail,
    contactHandle: twitterHandle,
    needsContent: "Launch content and app demos",
    rawDescription: p.tagline || p.description || "",
    postedRecently: true,
    score: 7,
    scoreReason: "Newly launched app — prime time for UGC content",
  });
}
```

} catch (e) {
console.error(“Product Hunt scrape failed:”, e.message);
}

return leads;
}

// ── SCRAPE: Google (via SerpAPI or direct) ────────────────────────────────────
async function scrapeGoogle() {
const leads = [];
// Only runs if SERPAPI_KEY is set
if (!process.env.SERPAPI_KEY) return leads;

const queries = [
“"looking for UGC creators" app OR saas 2025”,
“"UGC creator" wanted tech startup 2025”,
“"content creator" wanted "mobile app" paid 2025”,
];

for (const q of queries) {
try {
const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}&num=10`;
const res = await fetch(url);
if (!res.ok) continue;
const data = await res.json();
const results = data.organic_results || [];

```
  for (const r of results) {
    const text = ((r.title || "") + " " + (r.snippet || "")).toLowerCase();
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    leads.push({
      company: r.title?.split("|")[0]?.split("-")[0]?.trim() || "Company",
      category: "saas",
      source: "Google Search",
      sourceUrl: r.link,
      contactEmail: emailMatch ? emailMatch[0] : null,
      contactHandle: null,
      needsContent: "UGC content for tech brand",
      rawDescription: r.snippet || "",
      postedRecently: true,
      score: 6,
      scoreReason: "Found via Google UGC search — active opportunity",
    });
  }
} catch (e) {
  console.error("Google scrape failed:", e.message);
}
```

}

return leads;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractCompany(title, body) {
const text = title + “ “ + (body || “”);
const match = text.match(/(?:for|at|with|from)\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)/);
if (match) return match[1].trim();
const wordMatch = title.match(/[([^]]+)]/) || title.match(/^([A-Z][a-zA-Z0-9.]+)/);
return wordMatch ? wordMatch[1] : null;
}

function extractNeedsContent(text) {
if (text.includes(“testimonial”)) return “Testimonial videos”;
if (text.includes(“demo”) || text.includes(“walkthrough”)) return “App demo videos”;
if (text.includes(“unboxing”)) return “Unboxing content”;
if (text.includes(“review”)) return “Review videos”;
if (text.includes(“social”)) return “Social media content”;
return “UGC video content”;
}

function buildScoreReason(emailMatch, postedRecently, text) {
const parts = [];
if (postedRecently) parts.push(“posted recently”);
if (emailMatch) parts.push(“email contact available”);
if (text.includes(“paid”) || text.includes(“budget”)) parts.push(“paid opportunity”);
if (text.includes(“app”) || text.includes(“saas”)) parts.push(“tech/app brand”);
return parts.length > 0 ? parts.join(”, “) : “UGC opportunity found”;
}

// ── SCRAPE endpoint ────────────────────────────────────────────────────────────
app.get(”/scrape”, async (req, res) => {
console.log(”[SCRAPE] Starting…”);
try {
const [redditLeads, phLeads, googleLeads] = await Promise.all([
scrapeReddit(),
scrapeProductHunt(),
scrapeGoogle(),
]);

```
const all = [...redditLeads, ...phLeads, ...googleLeads];
const sorted = all.sort((a, b) => b.score - a.score);
const deduped = sorted.filter((lead, i, arr) =>
  arr.findIndex(l => l.company === lead.company) === i
);

console.log(`[SCRAPE] Done — ${redditLeads.length} Reddit, ${phLeads.length} Product Hunt, ${googleLeads.length} Google = ${deduped.length} total`);
res.json({ leads: deduped, sources: { reddit: redditLeads.length, productHunt: phLeads.length, google: googleLeads.length } });
```

} catch (e) {
console.error(”[SCRAPE] Error:”, e.message);
res.status(500).json({ error: e.message });
}
});

// ── SEND BATCH ─────────────────────────────────────────────────────────────────
app.post(”/send-batch”, async (req, res) => {
const { emails } = req.body;
if (!emails || !Array.isArray(emails) || emails.length === 0) {
return res.status(400).json({ error: “emails array required” });
}
const fromAddr = process.env.FROM_EMAIL || “onboarding@resend.dev”;
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
console.log(`UGC Pipeline API v3 running on port ${PORT}`);
console.log(`Resend key: ${process.env.RESEND_API_KEY ? "✓ set" : "✗ missing"}`);
console.log(`Product Hunt token: ${process.env.PRODUCT_HUNT_TOKEN ? "✓ set" : "✗ not set (optional)"}`);
console.log(`SerpAPI key: ${process.env.SERPAPI_KEY ? "✓ set" : "✗ not set (optional)"}`);
});
