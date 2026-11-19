# AI Calling Agent: demo for a property lead-generation client

An AI voice agent that **calls a new property lead within seconds** and asks about budget, location,
property type and timeline. If the lead is interested, it **books a site visit**. Everything shows up live on a lead dashboard
with a Hot/Warm/Cold score.

There are two ways to run a call:

| Mode | What happens | Needs |
|---|---|---|
| **AI call** (the real thing) | A live AI voice agent talks to you through your laptop mic and speaker. You play the customer. | Vapi account + ngrok |
| **Simulate** (backup) | A scripted call plays out using the same backend tools. Use it if Wi-Fi or the voice API fails during the demo. | Nothing |

---

## 1. Setup (one time, about 15 minutes)

**Prerequisites:** Node.js 18 or newer (`node --version`), a free [Vapi](https://vapi.ai) account and a free [ngrok](https://ngrok.com) account.

```bash
cd ai-calling-demo
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

**Get the Vapi public key:** Vapi dashboard → *API Keys* → copy the **Public key** → paste it into `.env` as `VAPI_PUBLIC_KEY=`.

**Expose your laptop so Vapi can reach your tools.** Open a second terminal:
```bash
ngrok config add-authtoken <your-ngrok-token>   # first time only
ngrok http 3000
```
Copy the `https://....ngrok-free.app` URL into `.env` as `PUBLIC_SERVER_URL=` (no trailing slash).

> Each time you restart ngrok you may get a new URL. Update `.env` and restart `npm start`.

**Run the app:**
```bash
npm start
```
Open **http://localhost:3000** in Chrome. Both chips in the top-right should be green.

---

## What's new in v2

- **Lead capture page** (`/enquire.html`): a public "Enquire now" page with a consent checkbox. A submitted lead gets an **AI call within about 3 seconds**.
  On your ngrok URL the root (`https://<your-domain>.ngrok-free.dev`) opens this page, so the client can fill it in **on their own phone**. Only this page and the webhooks are reachable from the internet; the dashboard stays on your laptop.
- **Meta lead-ads webhook** (`POST /webhooks/meta-lead`): run `npm run meta-lead` (or `npm run meta-lead -- kn`) to send a sample Facebook/Instagram lead.
- **Hindi and Kannada calls**: pick the language on the capture page, in "+ New enquiry", or in the dropdown next to **Start AI call**. Hindi/Kannada use Azure voices through Vapi (`VOICE_HI`, `VOICE_KN` in `.env`).
- **Auto-call new leads** toggle in the header.

> Free ngrok shows a one-time "You are about to visit…" warning page to browsers. Click **Visit Site**. It doesn't affect Vapi or the webhooks.

---

## 2. Test it (do this on Friday before the dry run)

1. Click **Simulate** on *Rahul Sharma*. You'll see the conversation play out, the "Captured by AI" fields fill in, and a site visit get booked.
2. Click **AI call** on *Arjun Menon*. Allow microphone access. The agent (Priya) speaks first. Reply as the customer,
   for example: *"Yes, go ahead… JP Nagar… 3BHK… around 1.4 crore… within 2 months, for my family… yes, Saturday 4 PM works."*
3. Open **Lead capture page ↗**, fill the form, tick consent, submit. Within seconds the dashboard starts the AI call.
4. Select a lead, switch the dropdown to **ಕನ್ನಡ** or **हिन्दी**, and click **Start AI call**. Ask a Kannada/Hindi speaker to check the wording.
5. Watch the terminal for `[tool] ...` lines. They mean the AI is calling your backend. The dashboard updates live.
6. Click **Reset demo** to restore the starting data.

---

## 3. Saturday demo script (about 3 minutes)

1. **The problem (talk):** "Leads from 99acres or Meta ads often wait hours for a call. By then they've spoken to 3 other brokers."
2. **Where leads come from:** show the **lead capture page** on your ngrok URL (or let the client open it on their phone), fill it in and submit.
   Within about 3 seconds the AI starts calling. *"Speed to lead: seconds, not hours."* Mention that Meta ads, portals and missed calls feed in the same way (`npm run meta-lead`).
3. **Local language:** run one call in **Kannada** or **Hindi** to show it can talk the way their buyers do.
4. **Live conversation:** answer as the customer. Try one objection, such as *"It's a bit expensive"*, so the client sees the agent handle it.
5. **Point at the right panel:** the budget, location, timeline and loan fields fill in by themselves. Then the site visit is booked, a WhatsApp confirmation is queued, and the score and reasons appear.
6. **Close:** "Every lead gets called, qualified and scored automatically. Your sales team only spends time on the Hot ones."

If the AI call fails on the day, say *"let me show the recorded flow"* and click **Simulate** on any lead.

---

## 4. How it works

```
Dashboard (browser) ──"AI call"──► Vapi web call (speech-to-text → Claude → text-to-speech)
                                         │ tool calls during the call
                                         ▼
           ngrok ──► POST /vapi/webhook ──► search_properties / save_lead_details / book_site_visit
                                         │
                                         ▼
                    data/leads.json → live update to dashboard (Server-Sent Events)
```

| File | What it does |
|---|---|
| `server/agent.js` | The agent's **prompt**, voice, LLM and tool definitions (built per lead) |
| `server/tools.js` | What the tools actually do (search dummy listings, save details, book a visit) |
| `server/scoring.js` | Explainable lead score (0–100) → Hot / Warm / Cold |
| `server/index.js` | Express API, Vapi webhook, live updates |
| `data/listings.json` | 12 dummy Bangalore properties |
| `data/leads.seed.json` | Fake leads (restored by **Reset demo**) |
| `public/simulate.js` | Backup scripted call (English only) |
| `public/enquire.html` | Public lead capture page |
| `scripts/send-meta-lead.js` | Sends a sample Meta lead-ads webhook |

**Change the firm or agent name:** set `FIRM_NAME` and `AGENT_NAME` in `.env`.
**Change the voice:** set `VAPI_VOICE_ID` (try other Vapi voices from the dashboard).

### Optional: a real phone call
Buy or import a number in Vapi, then set `VAPI_PRIVATE_KEY` and `VAPI_PHONE_NUMBER_ID` in `.env`. A **Call phone** button appears.
Vapi's free numbers are US numbers, so calling Indian mobiles may not work. Treat this as optional and try it on Friday.

---

## 5. From demo to production (for the "how it works" slide)

- **Telephony in India:** Exotel or Plivo Indian numbers. Promotional calls must use the TRAI 140-series under TCCCPR, and the system must respect DND.
- **Voice AI:** Vapi, Retell or Bolna. Bolna is the India-first option, with Hindi/Kannada voices and INR pricing.
- **Backend on AWS:** API Gateway + Lambda (webhook), DynamoDB (leads), S3 (recordings), CloudWatch (logs).
- **Lead sources:** Meta lead ads (webhook), 99acres / MagicBricks / Housing.com (email parser or API on business plans), website forms, missed-call number.
- **Compliance:** call only people who enquired (consent), disclose that it's an AI, record consent under the DPDP Act.

## Troubleshooting

| Problem | Fix |
|---|---|
| "AI call" button is greyed out | `VAPI_PUBLIC_KEY` is missing in `.env`. Restart `npm start` after editing. |
| AI talks but nothing fills in on the right | `PUBLIC_SERVER_URL` is wrong, or ngrok stopped. Check the terminal for `[tool]` lines. |
| No sound / mic blocked | Use Chrome on `http://localhost:3000` and allow the mic (padlock icon → Microphone). |
| Voice AI error toast | Check credits in the Vapi dashboard. Use **Simulate** as a fallback. |
| Model error | Set `LLM_PROVIDER=openai` and `LLM_MODEL=gpt-4o` in `.env`. |
| Hindi/Kannada call errors or wrong voice | Open the Vapi **Voice Library**, filter Azure + Hindi/Kannada, copy the voice id into `VOICE_HI` / `VOICE_KN`, restart. |
| Capture page doesn't auto-call | Keep the dashboard open in Chrome with **Auto-call new leads** ticked; only one call runs at a time. |
