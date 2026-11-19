// The "hands" of the voice agent. The AI calls these functions mid-conversation
// (Vapi -> POST /vapi/webhook -> here). The simulated call reuses the same code.
const store = require('./store');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function searchProperties(args = {}) {
  const loc = norm(args.location);
  const type = norm(args.propertyType);
  const bhk = Number(args.bhk) || null;
  const max = Number(args.maxBudgetLakhs) || null;

  let matches = store.LISTINGS.filter((p) => {
    if (loc && !norm(p.location).includes(loc) && !loc.includes(norm(p.location))) return false;
    if (type && norm(p.type) !== type) return false;
    if (bhk && p.type !== 'plot' && p.bhk !== bhk) return false;
    if (max && p.priceLakhs > max * 1.1) return false; // allow 10% stretch
    return true;
  });

  // Nothing exact? Relax location so the agent always has something to offer.
  let relaxed = false;
  if (!matches.length) {
    relaxed = true;
    matches = store.LISTINGS.filter((p) => (!max || p.priceLakhs <= max * 1.1) && (!type || norm(p.type) === type));
  }

  const top = matches.sort((a, b) => a.priceLakhs - b.priceLakhs).slice(0, 3);
  if (!top.length) return { text: 'No matching properties in inventory. Offer to have a consultant share options on WhatsApp.', items: [] };

  const fmt = (p) => `${p.id}: ${p.project}, ${p.location}, ${p.bhk ? p.bhk + 'BHK ' : ''}${p.type}, ${p.priceLakhs >= 100 ? (p.priceLakhs / 100).toFixed(2) + ' crore' : p.priceLakhs + ' lakhs'}, ${p.possession}. ${p.highlights}`;
  return {
    text: (relaxed ? 'No exact match for that location; closest options: ' : 'Matching options: ') + top.map(fmt).join(' | '),
    items: top,
  };
}

function saveLeadDetails(leadId, args = {}) {
  const fields = ['budgetLakhs', 'budgetText', 'location', 'propertyType', 'bhk', 'timeline', 'timelineMonths', 'purpose', 'loanNeeded', 'interestLevel', 'notes'];
  const lead = store.update(leadId, (l) => {
    l.qualification = l.qualification || {};
    for (const f of fields) if (args[f] !== undefined && args[f] !== null && args[f] !== '') l.qualification[f] = args[f];
  }, 'AI captured qualification details');
  if (!lead) return { text: 'Lead not found; continue the conversation normally.' };
  return { text: `Saved. Lead is currently ${lead.tier} (${lead.score}/100).`, lead };
}

function bookSiteVisit(leadId, args = {}) {
  const prop = store.LISTINGS.find((p) => p.id === String(args.propertyId || '').toUpperCase());
  if (!prop) return { text: `Unknown propertyId ${args.propertyId}. Use an id returned by search_properties.` };
  if (!args.date || !args.timeSlot) return { text: 'Need both a date and a time slot to book. Ask the customer.' };
  const lead = store.update(leadId, (l) => {
    l.siteVisit = { propertyId: prop.id, project: prop.project, location: prop.location, date: args.date, timeSlot: args.timeSlot, bookedAt: new Date().toISOString() };
  }, `Site visit booked: ${prop.project}, ${args.date} ${args.timeSlot}`);
  if (!lead) return { text: 'Lead not found.' };
  // Hand-off point to the WhatsApp agent (teammate's part). For the demo we just log it.
  store.update(leadId, () => {}, `WhatsApp confirmation queued: "${prop.project}, ${args.date} at ${args.timeSlot}. Location pin + RM contact to follow."`);
  return { text: `Booked ${prop.project} (${prop.location}) on ${args.date} at ${args.timeSlot}. A WhatsApp confirmation with the location pin will be sent.`, lead };
}

// Dispatcher used by both the Vapi webhook and the simulator.
function run(name, args, leadId) {
  switch (name) {
    case 'search_properties': return searchProperties(args);
    case 'save_lead_details': return saveLeadDetails(leadId, args);
    case 'book_site_visit': return bookSiteVisit(leadId, args);
    default: return { text: `Unknown tool ${name}` };
  }
}

module.exports = { run, searchProperties };
