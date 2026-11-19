// Tiny JSON-file "database". Good enough for a demo; swap for DynamoDB/RDS later.
const fs = require('fs');
const path = require('path');
const { scoreLead, statusFor } = require('./scoring');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const SEED_FILE = path.join(DATA_DIR, 'leads.seed.json');
const LISTINGS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'listings.json'), 'utf8'));

let leads = [];
const listeners = new Set(); // SSE subscribers

function normalise(lead) {
  return {
    status: 'New', score: 0, tier: '-', language: 'en', qualification: {}, siteVisit: null,
    summary: '', transcript: [], calls: [], activity: [],
    ...lead,
  };
}

function reset() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const now = Date.now();
  leads = seed.map((l) => {
    const { minutesAgo = 0, ...rest } = l;
    const lead = normalise({ ...rest, createdAt: new Date(now - minutesAgo * 60000).toISOString() });
    lead.calls = (lead.calls || []).map(({ minutesAgo: m = 0, ...c }) => ({ ...c, at: new Date(now - m * 60000).toISOString() }));
    return lead;
  });
  save();
  emit({ type: 'reset' });
}

function load() {
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')).map(normalise); return; } catch (_) { /* fall through */ }
  }
  reset();
}

function save() { fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2)); }

function emit(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(data);
}

function all() { return leads.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); }
function get(id) { return leads.find((l) => l.id === id); }

const LANGS = ['en', 'hi', 'kn'];

// autoCall: dashboards with "Auto-call new leads" on will start the AI call within seconds
function create({ name, phone, source, enquiry, language, qualification, consent, autoCall = false }) {
  const n = leads.reduce((max, l) => Math.max(max, parseInt(l.id.slice(1), 10) || 0), 0) + 1;
  const lead = normalise({
    id: 'L' + String(n).padStart(3, '0'), name, phone, source, enquiry,
    language: LANGS.includes(language) ? language : 'en',
    qualification: qualification || {},
    consent: consent || null,
    createdAt: new Date().toISOString(),
  });
  log(lead, `New enquiry from ${source}${consent ? ' (call + WhatsApp consent given)' : ''}`);
  leads.push(lead);
  save();
  emit({ type: 'new-lead', lead, autoCall });
  return lead;
}

function setLanguage(id, language) {
  if (!LANGS.includes(language)) return null;
  return update(id, (l) => { l.language = language; }, null);
}

function log(lead, text) {
  lead.activity = lead.activity || [];
  lead.activity.unshift({ at: new Date().toISOString(), text });
}

// Apply a change, re-score, persist and push to dashboards.
function update(id, mutate, activityText) {
  const lead = get(id);
  if (!lead) return null;
  mutate(lead);
  const { score, tier, reasons } = scoreLead(lead);
  const contacted = (lead.calls && lead.calls.length) || lead.callInProgress;
  // Not scored until the AI has spoken to them (form details alone are not qualification)
  lead.score = contacted ? score : 0; lead.tier = contacted ? tier : '-'; lead.scoreReasons = contacted ? reasons : [];
  lead.status = statusFor(lead);
  if (activityText) log(lead, activityText);
  lead.updatedAt = new Date().toISOString();
  save();
  emit({ type: 'lead', lead });
  return lead;
}

module.exports = { load, reset, all, get, create, update, setLanguage, emit, listeners, LISTINGS };
