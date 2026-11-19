require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const store = require('./store');
const tools = require('./tools');
const { buildAssistant } = require('./agent');

const app = express();
app.use(express.json({ limit: '2mb' }));
// Requests through the public ngrok URL carry X-Forwarded-For. From the internet we only expose
// the lead capture page, its API, the Meta webhook and the Vapi webhook; the dashboard stays local.
const PUBLIC_PATHS = ['/enquire.html', '/enquire.js', '/styles-enquire.css', '/api/capture', '/api/listings', '/api/public-config', '/webhooks/meta-lead', '/vapi/webhook', '/favicon.ico'];
app.use((req, res, next) => {
  if (!req.headers['x-forwarded-for']) return next();
  if (req.path === '/') return res.redirect('/enquire.html');
  if (PUBLIC_PATHS.includes(req.path)) return next();
  res.status(403).send('This page is only available on the demo laptop.');
});
app.use(express.static(path.join(__dirname, '..', 'public')));

store.load();
let activeLeadId = null; // demo runs one call at a time; used if the AI forgets leadId

// ---------- helpers ----------
function leadIdFrom(args, message) {
  return (args && args.leadId) ||
    message?.call?.assistant?.metadata?.leadId ||
    message?.call?.metadata?.leadId ||
    message?.assistant?.metadata?.leadId ||
    activeLeadId;
}

function autoSummary(lead) {
  const q = lead.qualification || {};
  if (q.interestLevel === 'not_interested') return `Not interested${q.notes ? ': ' + q.notes : ''}.`;
  const parts = [];
  if (q.propertyType || q.bhk) parts.push(`Looking for ${q.bhk ? q.bhk + 'BHK ' : ''}${q.propertyType || 'property'}`);
  if (q.location) parts.push(`in ${q.location}`);
  let s = parts.join(' ');
  if (q.budgetText || q.budgetLakhs) s += `, budget ${q.budgetText || q.budgetLakhs + ' lakhs'}`;
  if (q.timeline) s += `, timeline ${q.timeline}`;
  if (q.purpose) s += `, for ${q.purpose}`;
  if (q.loanNeeded !== undefined) s += q.loanNeeded ? ', needs a home loan' : ', no loan needed';
  s += '.';
  if (lead.siteVisit) s += ` Site visit booked at ${lead.siteVisit.project} on ${lead.siteVisit.date}, ${lead.siteVisit.timeSlot}.`;
  if (q.notes) s += ` Notes: ${q.notes}`;
  return s.trim() === '.' ? 'Call completed; no qualification details captured.' : s;
}

// Both the browser and Vapi's webhook may report the same call; merge by callId.
// source 'vapi' (webhook) is authoritative; the browser report only fills gaps.
function recordCall(leadId, { transcript, summary, ...call }, source = 'browser') {
  const lead = store.get(leadId);
  if (!lead) return null;
  const existing = call.callId && (lead.calls || []).find((c) => c.callId === call.callId);
  const clean = Object.fromEntries(Object.entries(call).filter(([, v]) => v !== undefined && v !== null));
  return store.update(leadId, (l) => {
    l.calls = l.calls || [];
    if (existing) {
      if (source === 'vapi') Object.assign(existing, clean);
      else for (const [k, v] of Object.entries(clean)) if (existing[k] === undefined) existing[k] = v;
    } else l.calls.push(clean);
    const haveLonger = existing && (l.transcript || []).length > (transcript || []).length;
    if (transcript && transcript.length && !haveLonger) l.transcript = transcript;
    if (summary) { l.summary = summary; l.summarySource = 'ai'; }
    else if (l.summarySource !== 'ai') l.summary = autoSummary(l);
    l.callInProgress = false;
  }, existing ? null : `${call.mode === 'simulated' ? 'Simulated' : 'AI'} call ended (${call.endedReason || 'completed'})`);
}

// ---------- dashboard API ----------
app.get('/api/config', (req, res) => {
  res.json({
    vapiPublicKey: process.env.VAPI_PUBLIC_KEY || '',
    publicServerUrl: process.env.PUBLIC_SERVER_URL || '',
    firmName: process.env.FIRM_NAME || 'Prime Nest Realty',
    agentName: process.env.AGENT_NAME || 'Priya',
    phoneCallsEnabled: Boolean(process.env.VAPI_PRIVATE_KEY && process.env.VAPI_PHONE_NUMBER_ID),
  });
});

app.get('/api/public-config', (req, res) => res.json({ firmName: process.env.FIRM_NAME || 'Prime Nest Realty' }));
app.get('/api/leads', (req, res) => res.json(store.all()));
app.get('/api/listings', (req, res) => res.json(store.LISTINGS));

app.post('/api/leads', (req, res) => {
  const { name, phone, source, enquiry, language, autoCall } = req.body || {};
  if (!name || !enquiry) return res.status(400).json({ error: 'name and enquiry are required' });
  res.json(store.create({ name, phone: phone || '', source: source || 'Website form', enquiry, language, autoCall: Boolean(autoCall) }));
});

app.patch('/api/leads/:id/language', (req, res) => {
  const lead = store.setLanguage(req.params.id, req.body?.language);
  if (!lead) return res.status(400).json({ error: 'unknown lead or language (use en, hi, kn)' });
  res.json(lead);
});

// ---------- lead sources ----------
// 1) Public lead capture page (public/enquire.html) posts here.
const BUDGETS = {
  50: 'under 50 lakhs', 80: '50 to 80 lakhs', 120: '80 lakhs to 1.2 crore', 200: '1.2 to 2 crore', 300: 'above 2 crore',
};
app.post('/api/capture', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const phone = String(b.phone || '').trim();
  if (!name || !phone) return res.status(400).json({ error: 'Please enter your name and mobile number.' });
  if (b.consent !== true) return res.status(400).json({ error: 'Please agree to be contacted so we can call you.' });
  const type = ['apartment', 'villa', 'plot'].includes(b.propertyType) ? b.propertyType : undefined;
  const bhk = Number(b.bhk) || undefined;
  const budgetLakhs = BUDGETS[b.budget] ? Number(b.budget) : undefined;
  const what = type === 'plot' ? 'Plot' : `${bhk ? bhk + 'BHK ' : ''}${type || 'property'}`;
  const enquiry = `${what}${b.location ? ' in ' + b.location : ''}${budgetLakhs ? ', budget ' + BUDGETS[b.budget] : ''}`;
  const lead = store.create({
    name, phone, source: 'Website form', enquiry, language: b.language,
    qualification: { location: b.location || undefined, propertyType: type, bhk: type === 'plot' ? undefined : bhk,
      budgetLakhs, budgetText: budgetLakhs ? BUDGETS[b.budget] : undefined },
    consent: { call: true, whatsapp: true, at: new Date().toISOString(), text: 'Agreed on website form to calls (incl. AI assistant) and WhatsApp about this enquiry' },
    autoCall: true,
  });
  res.json({ ok: true, id: lead.id });
});

// 2) Meta (Facebook/Instagram) lead ads webhook.
//    Production: Meta sends only a leadgen_id; you then fetch the lead from the Graph API.
//    Demo: we accept the lead's field_data directly (same shape the Graph API returns).
app.get('/webhooks/meta-lead', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === (process.env.META_VERIFY_TOKEN || 'demo-verify-token');
  return ok ? res.send(req.query['hub.challenge']) : res.sendStatus(403);
});
app.post('/webhooks/meta-lead', (req, res) => {
  const body = req.body || {};
  const data = body.field_data || body.entry?.[0]?.changes?.[0]?.value?.field_data || [];
  const f = Object.fromEntries(data.map((d) => [d.name, (d.values || [])[0]]));
  const name = f.full_name || f.name;
  if (!name) return res.status(400).json({ error: 'field_data must include full_name' });
  const lang = { hindi: 'hi', kannada: 'kn', english: 'en' }[String(f.preferred_language || '').toLowerCase()] || f.preferred_language;
  const what = [f.property_type, f.preferred_location && 'in ' + f.preferred_location].filter(Boolean).join(' ');
  const enquiry = [what, f.budget && 'budget ' + f.budget].filter(Boolean).join(', ') || `Enquiry from ad "${body.ad_name || 'property campaign'}"`;
  const lead = store.create({
    name, phone: f.phone_number || '', source: 'Meta lead ad', enquiry, language: lang,
    qualification: { location: f.preferred_location || undefined, budgetText: f.budget || undefined },
    consent: { call: true, whatsapp: true, at: new Date().toISOString(), text: 'Meta lead form consent' },
    autoCall: true,
  });
  res.json({ ok: true, id: lead.id });
});

app.post('/api/reset', (req, res) => { store.reset(); res.json({ ok: true }); });

// Live updates to the dashboard (Server-Sent Events)
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('data: {"type":"hello"}\n\n');
  store.listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); store.listeners.delete(res); });
});

// Assistant config for a web call with this lead
app.get('/api/leads/:id/assistant', (req, res) => {
  const lead = store.get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  activeLeadId = lead.id;
  store.update(lead.id, (l) => { l.callInProgress = true; }, 'AI call started');
  res.json(buildAssistant(lead));
});

// Browser reports the call ended (backup in case the webhook isn't reachable)
app.post('/api/leads/:id/call-ended', (req, res) => {
  const { callId, transcript, durationSec, endedReason, mode } = req.body || {};
  const lead = recordCall(req.params.id, {
    callId, at: new Date().toISOString(), mode: mode || 'ai', durationSec, endedReason: endedReason || 'completed',
    transcript,
  });
  res.json(lead || { error: 'lead not found' });
});

// Simulated call uses the exact same tool code as the real AI
app.post('/api/simulate/tool', (req, res) => {
  const { leadId, name, args } = req.body || {};
  activeLeadId = leadId;
  const l = store.get(leadId);
  if (l && !l.callInProgress) store.update(leadId, (x) => { x.callInProgress = true; }, 'Simulated call started');
  res.json(tools.run(name, { ...args, leadId }, leadId));
});

// Optional: real outbound phone call through Vapi (needs a Vapi phone number)
app.post('/api/leads/:id/phone-call', async (req, res) => {
  const lead = store.get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  if (!process.env.VAPI_PRIVATE_KEY || !process.env.VAPI_PHONE_NUMBER_ID) {
    return res.status(400).json({ error: 'Set VAPI_PRIVATE_KEY and VAPI_PHONE_NUMBER_ID in .env to place real calls' });
  }
  const number = String(req.body?.number || lead.phone).replace(/\s/g, '');
  activeLeadId = lead.id;
  try {
    const r = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assistant: buildAssistant(lead), phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, customer: { number, name: lead.name } }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: body.message || body });
    store.update(lead.id, (l) => { l.callInProgress = true; }, `Phone call placed to ${number}`);
    res.json({ ok: true, callId: body.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Vapi webhook (tool calls + end-of-call report) ----------
app.post('/vapi/webhook', (req, res) => {
  const message = req.body?.message || {};
  const type = message.type;

  if (type === 'tool-calls') {
    const results = (message.toolCallList || []).map((tc) => {
      let args = tc.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (_) { args = {}; } }
      const leadId = leadIdFrom(args, message);
      const out = tools.run(tc.function?.name, args, leadId);
      store.emit({ type: 'tool', leadId, name: tc.function?.name, args, result: out.text });
      console.log(`[tool] ${tc.function?.name}`, JSON.stringify(args), '->', out.text);
      return { toolCallId: tc.id, result: out.text };
    });
    return res.json({ results });
  }

  if (type === 'end-of-call-report') {
    const leadId = leadIdFrom({}, message);
    const transcript = (message.artifact?.messages || [])
      .filter((m) => ['user', 'assistant', 'bot'].includes(m.role) && m.message)
      .map((m) => ({ role: m.role === 'user' ? 'customer' : 'agent', text: m.message }));
    const call = message.call || {};
    const started = call.startedAt ? new Date(call.startedAt) : null;
    const ended = call.endedAt ? new Date(call.endedAt) : null;
    if (leadId) {
      recordCall(leadId, {
        callId: call.id, at: new Date().toISOString(), mode: 'ai', endedReason: message.endedReason,
        durationSec: started && ended ? Math.round((ended - started) / 1000) : undefined,
        recordingUrl: message.artifact?.recording?.url || message.artifact?.recordingUrl || call.recordingUrl,
        transcript, summary: message.analysis?.summary,
      }, 'vapi');
    }
    console.log(`[end-of-call] lead=${leadId} reason=${message.endedReason}`);
    return res.json({ ok: true });
  }

  if (type === 'status-update') console.log(`[status] ${message.status}`);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  AI Calling demo running:  http://localhost:${PORT}`);
  console.log(`  Vapi public key:          ${process.env.VAPI_PUBLIC_KEY ? 'set' : 'MISSING (only simulated calls will work)'}`);
  console.log(`  Public webhook URL:       ${process.env.PUBLIC_SERVER_URL ? process.env.PUBLIC_SERVER_URL + '/vapi/webhook' : 'MISSING (AI can talk but cannot save/book)'}\n`);
});
