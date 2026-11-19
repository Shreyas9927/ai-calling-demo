// Builds the Vapi assistant config for one specific lead.
// We send the whole config from the browser at call start ("transient assistant"),
// so there is nothing to set up in the Vapi dashboard except your keys.

const FIRM = () => process.env.FIRM_NAME || 'Prime Nest Realty';
const AGENT = () => process.env.AGENT_NAME || 'Priya';

// Per-language voice + speech-to-text. Hindi/Kannada use Azure (provided by Vapi, no extra key).
// Voice ids can be changed in .env if Vapi's voice library lists a different id.
const LANGS = {
  en: {
    label: 'English',
    transcriber: () => ({ provider: 'deepgram', model: 'nova-3', language: process.env.TRANSCRIBER_LANGUAGE || 'multi' }),
    voice: () => ({ provider: 'vapi', voiceId: process.env.VAPI_VOICE_ID || 'Clara' }),
    style: 'Warm, polite Indian-English. If the customer switches to Hindi or Kannada or mixes languages, reply in the same style.',
    first: (name, src) => `Hi ${name}, this is ${AGENT()}, an AI assistant from ${FIRM()}. I'm calling about the property enquiry you made on ${src}. Is this a good time for a quick two-minute chat?`,
  },
  hi: {
    label: 'Hindi',
    transcriber: () => ({ provider: 'azure', language: 'hi-IN' }),
    voice: () => ({ provider: 'azure', voiceId: process.env.VOICE_HI || 'hi-IN-SwaraNeural' }),
    style: 'Speak simple, everyday spoken Hindi, written in Devanagari script. Common English words (flat, BHK, budget, site visit, loan) are fine, as people say them. Say amounts the way people speak them, e.g. "पचहत्तर लाख", "एक करोड़ बीस लाख". Keep project and area names in English.',
    first: (name, src) => `नमस्ते ${name} जी, मैं ${AGENT()}, ${FIRM()} की AI असिस्टेंट बोल रही हूँ। आपने ${src} पर प्रॉपर्टी के बारे में पूछताछ की थी। क्या अभी दो मिनट बात कर सकते हैं?`,
  },
  kn: {
    label: 'Kannada',
    transcriber: () => ({ provider: 'azure', language: 'kn-IN' }),
    voice: () => ({ provider: 'azure', voiceId: process.env.VOICE_KN || 'kn-IN-SapnaNeural' }),
    style: 'Speak simple, polite spoken Kannada, written in Kannada script. Common English words (flat, BHK, budget, site visit, loan) are fine, as people in Bangalore say them. Say amounts the way people speak them, e.g. "ಎಪ್ಪತ್ತೈದು ಲಕ್ಷ", "ಒಂದು ಕೋಟಿ ಇಪ್ಪತ್ತು ಲಕ್ಷ". Keep project and area names in English.',
    first: (name, src) => `ನಮಸ್ಕಾರ ${name} ಅವರೇ, ನಾನು ${AGENT()}, ${FIRM()} ಕಡೆಯಿಂದ ಕರೆ ಮಾಡುತ್ತಿರುವ AI ಸಹಾಯಕಿ. ನೀವು ${src} ನಲ್ಲಿ ಪ್ರಾಪರ್ಟಿ ಬಗ್ಗೆ ವಿಚಾರಿಸಿದ್ದೀರಿ. ಈಗ ಎರಡು ನಿಮಿಷ ಮಾತನಾಡಲು ಸಮಯವಿದೆಯೇ?`,
  },
};
const langOf = (lead) => LANGS[lead.language] || LANGS.en;
const SRC_WORDS = {
  en: { 'Website form': 'our website', 'Meta lead ad': 'Instagram', 'Google ads': 'Google', 'Missed call': 'our missed-call number' },
  hi: { 'Website form': 'हमारी वेबसाइट', 'Meta lead ad': 'Instagram', 'Google ads': 'Google' },
  kn: { 'Website form': 'ನಮ್ಮ ವೆಬ್‌ಸೈಟ್', 'Meta lead ad': 'Instagram', 'Google ads': 'Google' },
};
const srcPhrase = (lead) => (SRC_WORDS[lead.language] || SRC_WORDS.en)[lead.source] || lead.source;

function knownDetails(lead) {
  const q = lead.qualification || {};
  const parts = [];
  if (q.location) parts.push(`location: ${q.location}`);
  if (q.propertyType || q.bhk) parts.push(`property: ${q.bhk ? q.bhk + 'BHK ' : ''}${q.propertyType || ''}`.trim());
  if (q.budgetText || q.budgetLakhs) parts.push(`budget: ${q.budgetText || 'up to ' + q.budgetLakhs + ' lakhs'}`);
  return parts.length ? `- Already known from their enquiry form (confirm in one short line, don't re-ask): ${parts.join('; ')}` : '';
}

function todayIST() {
  return new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function systemPrompt(lead) {
  return `You are ${AGENT()}, a friendly property advisor calling on behalf of ${FIRM()}, a property consulting firm in Bangalore.
Today is ${todayIST()}.

WHO YOU ARE CALLING
- Name: ${lead.name}
- They enquired via ${lead.source}: "${lead.enquiry}"
- Internal lead id: ${lead.id} (pass it as leadId in every tool call; never say it aloud)
${knownDetails(lead)}

LANGUAGE: ${langOf(lead).label}
- ${langOf(lead).style}
- Tool call arguments are ALWAYS in English (area names like "Whitefield", the listed enum values, numbers in digits), whatever language you speak.

HOW TO TALK
- This is a phone call. Keep every reply to 1-2 short sentences. Ask ONE question at a time.
- Say prices the Indian way: "75 lakhs", "1.2 crore". Never read out ids or symbols.
- Never invent properties, prices or offers. Only use what search_properties returns.

CALL FLOW
1. Opening is already said (you introduced yourself as an AI assistant and asked if it's a good time). If they say it's not a good time, ask when to call back, call save_lead_details with interestLevel "callback" and notes, then end politely.
2. Confirm their interest from the enquiry, then qualify, one question at a time:
   a) preferred location  b) property type and BHK  c) budget range  d) timeline to buy  e) self-use or investment  f) home loan needed or not.
   Skip anything they already told you.
3. As soon as you have location + budget (+ type if known), call search_properties and pitch the best 1-2 options in one sentence each.
4. Call save_lead_details once you have most details (you may call it again later to update). Set interestLevel: hot (wants to visit / buying within 3 months), warm (interested, 3-6 months), cold (just exploring), not_interested.
5. If interested, offer a site visit this weekend or next week, slots 10 AM, 12 PM or 4 PM. When they pick, call book_site_visit with the propertyId, a clear date like "Saturday 28 November" and the slot.
6. Close: confirm next step, mention a WhatsApp confirmation with location will follow, thank them, then end the call.

OBJECTIONS
- "Just looking": that's fine, offer to share 2 options on WhatsApp and ask for timeline anyway.
- "Too expensive": ask their comfortable range and search again.
- "Are you a robot?": yes, you're an AI assistant for ${FIRM()}; a human consultant will take over for the visit.
- Asks for a human: say a senior consultant will call back today, save notes, end politely.
- Not interested / already bought: thank them, save interestLevel not_interested with the reason, end the call.

Keep the call under 4 minutes.`;
}

function tool(name, description, properties, required = []) {
  const url = (process.env.PUBLIC_SERVER_URL || '').replace(/\/$/, '') + '/vapi/webhook';
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
    server: { url },
    messages: [],
  };
}

function buildAssistant(lead) {
  const firstName = lead.name.split(' ')[0];
  const serverUrl = (process.env.PUBLIC_SERVER_URL || '').replace(/\/$/, '');
  return {
    name: `${FIRM()} lead qualifier`,
    firstMessage: langOf(lead).first(firstName, srcPhrase(lead)),
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: process.env.LLM_PROVIDER || 'anthropic',
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      temperature: 0.4,
      messages: [{ role: 'system', content: systemPrompt(lead) }],
      tools: [
        tool('search_properties', 'Search the firm\'s property inventory. Call after you know location and budget.', {
          leadId: { type: 'string' },
          location: { type: 'string', description: 'Area in Bangalore, e.g. Whitefield, Sarjapur Road' },
          propertyType: { type: 'string', enum: ['apartment', 'villa', 'plot'] },
          bhk: { type: 'number' },
          maxBudgetLakhs: { type: 'number', description: 'Upper budget in lakhs (1 crore = 100)' },
        }),
        tool('save_lead_details', 'Save what you learned about the customer. Call whenever you have new qualification details.', {
          leadId: { type: 'string' },
          budgetLakhs: { type: 'number', description: 'Upper budget in lakhs' },
          budgetText: { type: 'string', description: 'Budget as the customer said it' },
          location: { type: 'string' },
          propertyType: { type: 'string', enum: ['apartment', 'villa', 'plot'] },
          bhk: { type: 'number' },
          timeline: { type: 'string', description: 'e.g. within 3 months' },
          timelineMonths: { type: 'number', description: 'Timeline converted to months' },
          purpose: { type: 'string', enum: ['self-use', 'investment'] },
          loanNeeded: { type: 'boolean' },
          interestLevel: { type: 'string', enum: ['hot', 'warm', 'cold', 'not_interested', 'callback'] },
          notes: { type: 'string', description: 'Anything else useful for the sales team' },
        }, ['leadId']),
        tool('book_site_visit', 'Book a site visit once the customer agrees to a property, date and slot.', {
          leadId: { type: 'string' },
          propertyId: { type: 'string', description: 'Id from search_properties, e.g. P103' },
          date: { type: 'string', description: 'e.g. Saturday 28 November' },
          timeSlot: { type: 'string', enum: ['10:00 AM', '12:00 PM', '4:00 PM'] },
        }, ['leadId', 'propertyId', 'date', 'timeSlot']),
        { type: 'endCall' },
      ],
    },
    voice: langOf(lead).voice(),
    transcriber: langOf(lead).transcriber(),
    server: serverUrl ? { url: serverUrl + '/vapi/webhook' } : undefined,
    serverMessages: ['end-of-call-report', 'status-update'],
    maxDurationSeconds: 300,
    metadata: { leadId: lead.id },
  };
}

module.exports = { buildAssistant, LANGS };
