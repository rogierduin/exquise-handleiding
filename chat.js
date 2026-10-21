// Chatfunctie van de Exquise-handleiding.
// Draait als serverless functie (Vercel, Node 18+). De API-sleutel blijft op de server;
// de browser stuurt alleen de vraag en de laatste beurten van het gesprek.
const KB = require("./kb.json");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 1200);
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 10);

// ---------- Zoeken (zelfde logica als in de pagina) ----------
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set("de het een en of in op te van voor met bij aan als is zijn wordt worden kan je jij ik hoe wat waar welke wie dat die dit deze er naar om uit ook niet wel nog dan maar door over tot zo hier mijn mij we wij u".split(" "));
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
KB.forEach(a => { a.nt = norm(a.title); a.nx = norm(a.text); });
const DF = new Map();
KB.forEach(a => new Set(tokens(a.title + " " + a.text)).forEach(t => DF.set(t, (DF.get(t) || 0) + 1)));
function score(a, toks, phrase) {
  let s = 0;
  for (const t of toks) {
    const idf = Math.log(1 + KB.length / (1 + (DF.get(t) || 0)));
    if (a.nt.includes(t)) s += 6 * idf;
    if (a.num.toLowerCase() === t) s += 20;
    let c = 0, p = a.nx.indexOf(t);
    while (p !== -1 && c < 12) { c++; p = a.nx.indexOf(t, p + t.length); }
    s += Math.min(c, 12) * idf / (1 + a.nx.length / 6000);
  }
  if (phrase && phrase.length > 4 && a.nx.includes(phrase)) s += 8;
  return s;
}
function search(q, n) {
  const toks = tokens(q), ph = norm(q.trim());
  if (!toks.length) return [];
  return KB.map(a => [score(a, toks, ph), a]).filter(x => x[0] > 0).sort((x, y) => y[0] - x[0]).slice(0, n).map(x => x[1]);
}

const INDEX = KB.map(a => `${a.num} ${a.title}`).join("\n");
const SYSTEM = `Je bent de gids van de handleiding van Exquise Next Generation, praktijksoftware voor tandartspraktijken en orthodontisten (van Vertimart).
Antwoord in het Nederlands, in de jij-vorm. Baseer je alleen op de meegestuurde artikelen. Verzin geen knoppen, menu's of functies. Beantwoord alleen vragen over het gebruik van Exquise. Vraag nooit om patiëntgegevens en herhaal ze niet.

OPMAAK (houd je hier strikt aan):
- Begin met één korte zin die direct antwoord geeft.
- Gaat het om een handeling, geef dan genummerde stappen: "1. ...", "2. ...". Eén handeling per stap, maximaal 8 stappen, elke stap max. 2 regels.
- Zet knop-, tab- en menunamen tussen vierkante haken, precies zoals in de handleiding: [Afspraak maken], [Opslaan en sluiten].
- Zet het artikelnummer waar het staat tussen vierkante haken aan het eind van de stap of zin: [3.14].
- Gebruik waar nuttig één regel die begint met "Let op:" of "Tip:".
- Geen koppen, geen tabellen, geen sterretjes of vette tekst, geen afsluitende samenvatting of vraag.
- Staat het antwoord niet in de artikelen: zeg dat in één zin, noem uit de inhoudsopgave het artikel dat waarschijnlijk helpt, en verwijs voor de rest naar de helpdesk van Vertimart [0.11].

INHOUDSOPGAVE:
${INDEX}`;

// ---------- Eenvoudige rate limit per IP (per serverinstantie) ----------
const hits = new Map();
function limited(ip) {
  const now = Date.now(), w = (hits.get(ip) || []).filter(t => now - t < 60000);
  w.push(now); hits.set(ip, w);
  return w.length > RATE_PER_MIN;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ code: "method_not_allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ code: "not_configured" }); return; }
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
  if (limited(ip)) { res.status(429).json({ code: "rate_limited" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body?.mode === "quiz") { await quiz(String(body.num || ""), res); return; }
  const question = String(body?.question || "").trim().slice(0, 1000);
  if (!question) { res.status(400).json({ code: "invalid_request" }); return; }
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-6).map(t => ({ role: t.role, content: t.content.slice(0, 4000) }));
  while (history.length && history[0].role !== "user") history.shift();

  // Relevante artikelen ophalen (vraag + vorige vraag als context)
  const prevQ = [...history].reverse().find(t => t.role === "user")?.content || "";
  let found = search(question, 4);
  if (found.length < 3 && prevQ) found = [...new Set([...found, ...search(question + " " + prevQ, 4)])].slice(0, 4);
  let budget = 30000; const ctx = [];
  for (const a of found) {
    const t = `### ${a.num} ${a.title} (${a.chapter})\n${a.text}`;
    if (t.length > budget) { ctx.push(t.slice(0, budget)); break; }
    ctx.push(t); budget -= t.length;
  }
  const messages = [...history, { role: "user", content: `RELEVANTE ARTIKELEN:\n${ctx.join("\n\n") || "(geen gevonden)"}\n\nVRAAG:\n${question}` }];

  const upstream = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, stream: true,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], messages })
  }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    const code = upstream?.status === 429 ? "rate_limited" : "upstream_error";
    if (upstream) console.error("Anthropic API", upstream.status, await upstream.text().catch(() => ""));
    res.status(upstream?.status === 429 ? 429 : 502).json({ code }); return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Sources", found.map(a => a.num).join(","));
  const reader = upstream.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") res.write(ev.delta.text);
      } catch { /* niet-JSON regel overslaan */ }
    }
  }
  res.end();
};
// ---------- Kennischeck: 3 meerkeuzevragen per artikel (gecachet per serverinstantie) ----------
const QUIZ_CACHE = new Map();
async function quiz(num, res) {
  const a = KB.find(x => x.num === num);
  if (!a) { res.status(400).json({ code: "invalid_request" }); return; }
  if (QUIZ_CACHE.has(num)) { res.status(200).json(QUIZ_CACHE.get(num)); return; }
  const prompt = `Maak een korte kennischeck over dit artikel uit de handleiding van Exquise Next Generation. Schrijf 3 meerkeuzevragen in het Nederlands, in de jij-vorm, die toetsen of iemand de handeling echt kan uitvoeren: waar je klikt, in welke volgorde, wat een instelling doet of wat je moet controleren. Gebruik alleen informatie uit het artikel. Elke vraag heeft 4 korte antwoorden waarvan precies één juist is. Geef bij elke vraag een uitleg van één zin.
Antwoord met alleen JSON: [{"q":"vraag","options":["a","b","c","d"],"correct":0,"why":"uitleg"}]

ARTIKEL ${a.num} ${a.title}
${a.text.slice(0, 12000)}`;
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] })
  }).catch(() => null);
  if (!r || !r.ok) { res.status(502).json({ code: "upstream_error" }); return; }
  try {
    const j = await r.json(), t = (j.content || []).map(c => c.text || "").join("");
    const arr = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));
    const clean = arr.filter(q => q && q.q && Array.isArray(q.options) && Number.isInteger(q.correct)).slice(0, 3);
    if (!clean.length) throw 0;
    QUIZ_CACHE.set(num, clean); res.status(200).json(clean);
  } catch { res.status(502).json({ code: "invalid_json" }); }
}
module.exports._search = search;
