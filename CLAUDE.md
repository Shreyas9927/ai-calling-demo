# AI Calling Demo – project notes for Claude Code

Demo for a property consulting client (Saturday). Part 3 of the pitch: an AI voice agent that calls a new lead,
qualifies them (budget, location, property type/BHK, timeline, purpose, loan) and books a site visit.

## Stack
- Node.js + Express (`server/`), plain HTML/CSS/JS dashboard (`public/`), JSON file store (`data/leads.json`).
- Voice: Vapi web SDK (`@vapi-ai/web`, bundled to `public/vendor/vapi.bundle.js` via `npm run build:sdk`).
- The assistant config is built per lead in `server/agent.js` and sent from the browser (transient assistant).
- The AI's tools hit `POST /vapi/webhook` → `server/tools.js`. The simulated call (`public/simulate.js`) uses the same tools via `/api/simulate/tool`.

- Lead sources: `public/enquire.html` → `POST /api/capture` (consent required); Meta lead ads → `POST /webhooks/meta-lead`.
  New leads are announced on `/api/events` as `new-lead`; the dashboard auto-calls them.
- Languages: `en`, `hi`, `kn` per lead (`lead.language`); voice/transcriber/prompt per language in `server/agent.js` (LANGS).
- Requests via ngrok (X-Forwarded-For) may only reach PUBLIC_PATHS in `server/index.js`.

## Rules
- Demo only: dummy listings (`data/listings.json`) and fake leads (`data/leads.seed.json`). Never real customer data.
- Keep the agent prompt short-turn and phone-friendly; the agent must disclose it is an AI.
- Scoring lives in `server/scoring.js`; keep it explainable (each rule adds points with a reason).
- Lead fields must stay compatible with the WhatsApp agent's dashboard (teammate's part):
  name, phone, source, enquiry, status, tier, score, qualification{...}, siteVisit{...}.
- Don't add a build step for the frontend; keep it plain JS.

## Run
npm install && cp .env.example .env && npm start  → http://localhost:3000
