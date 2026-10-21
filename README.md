# Exquise Handleiding: online zetten met chatfunctie

De handleiding is één webpagina met een kleine serverfunctie voor de chat. De pagina zelf staat in `public/index.html` en bevat alle 390 artikelen, de zoekfunctie, het rolfilter en de schema's. De chatfunctie draait in `api/chat.js`. Die zoekt per vraag de relevante artikelen op en stuurt ze met de vraag naar Claude via de Anthropic API. De API-sleutel blijft daarbij altijd op de server en komt nooit in de browser.

```
public/index.html   de handleiding (statisch)
api/chat.js         chatfunctie (serverless, Node 18+)
api/kb.json         artikeltekst voor de chat
server.js           alternatief: eigen Node-server / lokaal testen
vercel.json         instellingen voor Vercel
```

## 1. Anthropic API-sleutel regelen

1. Maak een organisatie aan op console.anthropic.com. Doe dat bij voorkeur op naam van Vertimart, omdat zij de kosten dragen.
2. Zet onder **Billing** een betaalmethode en een maandlimiet, bijvoorbeeld € 50, zodat de kosten nooit verrassen.
3. Maak onder **API keys** een sleutel aan met de naam `handleiding-productie`.

**Kosten.** Een vraag kost ongeveer 30.000 tokens invoer (de gevonden artikelen) en 500 tokens antwoord. De vaste instructie en inhoudsopgave worden gecachet, dus herhaalde vragen zijn goedkoper. De actuele prijs per model staat op anthropic.com/pricing. Met het standaardmodel (een snel Haiku-model) blijft dit voor een helpdeskvolume in de orde van centen per vraag.

## 2. Online zetten via Vercel (aanbevolen, ±15 minuten)

1. Zet deze map in een (privé) GitHub-repository.
2. Ga naar vercel.com, kies **Add New → Project** en importeer de repository. Laat Framework Preset op **Other** staan; de instellingen staan al in `vercel.json`.
3. Voeg onder **Environment Variables** `ANTHROPIC_API_KEY` toe met de sleutel uit stap 1.
4. Klik op **Deploy**. Na een minuut staat de handleiding op `https://<project>.vercel.app`.
5. **Eigen domein:** voeg onder **Settings → Domains** `handleiding.exquise.nl` toe en zet bij de DNS-beheerder het CNAME-record dat Vercel toont (meestal `cname.vercel-dns.com`). HTTPS regelt Vercel zelf.

Zonder GitHub kan het ook met de command line: `npm i -g vercel`, dan `vercel` in deze map en daarna `vercel env add ANTHROPIC_API_KEY`.

**Optionele variabelen**

| Variabele | Standaard | Wat het doet |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Het model. Kies een actuele naam uit docs.claude.com/en/docs/about-claude/models. Een Sonnet-model geeft betere antwoorden, maar is duurder en trager. |
| `MAX_TOKENS` | `1200` | Maximale lengte van een antwoord. |
| `RATE_PER_MIN` | `10` | Maximaal aantal vragen per minuut per bezoeker. |

## 3. Andere hosting

- **Eigen server of Azure/AWS met Node 18+:** `ANTHROPIC_API_KEY=... PORT=8080 node server.js`. De server serveert de pagina en `/api/chat`; zet er een reverse proxy met HTTPS voor.
- **Netlify of Cloudflare:** de pagina kan er statisch op. `api/chat.js` moet dan als Netlify Function of Worker worden aangeboden. De code gebruikt alleen `fetch` en heeft geen dependencies, dus dat is een kleine aanpassing.
- **HubSpot CMS:** de pagina kan als bestand of pagina in HubSpot. De chat heeft echter een serverfunctie nodig. HubSpot serverless functions vereisen Content Hub Enterprise, dus de praktische route is de pagina in HubSpot en `/api/chat` op Vercel. Zet in dat geval in `public/index.html` de URL van de fetch (`"/api/chat"`) op het volledige Vercel-adres en voeg een CORS-header toe in `api/chat.js`.

## 4. Lokaal testen

```
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

Open daarna http://localhost:3000.

## 5. Privacy en veiligheid

- **Geen patiëntgegevens:** het chatvenster zegt dit expliciet, en de assistent is geïnstrueerd om ze niet te vragen of te herhalen. Er wordt niets opgeslagen; `api/chat.js` logt alleen foutcodes.
- **Gegevensverwerking:** Anthropic gebruikt API-gegevens standaard niet voor training. Een verwerkersovereenkomst (DPA) is via Anthropic beschikbaar. Laat de FG/DPO van Vertimart dit afstemmen voordat de chat live gaat voor klanten.
- **Bescherming tegen misbruik:** de sleutel staat alleen op de server. Er is een rate limit per IP en een maximale vraaglengte, en de assistent beantwoordt alleen vragen over Exquise. De maandlimiet in de Anthropic-console is het vangnet.

## 6. Inhoud bijwerken

De artikelen staan in `public/index.html` (voor de pagina) en `api/kb.json` (voor de chat). Wijzigt de handleiding, dan genereert BONANA beide bestanden opnieuw uit de bron en zet je ze over de oude heen. Daarna volgt een nieuwe deploy; bij Vercel gebeurt dat automatisch bij een push naar GitHub.

Schermafbeeldingen zitten nog niet in deze versie. Elk artikel linkt naar de originele pagina. Zodra Vertimart de afbeeldingen aanlevert, kunnen ze per artikel worden opgenomen.
