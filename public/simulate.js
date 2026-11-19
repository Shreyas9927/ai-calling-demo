/* Simulated call: a scripted conversation that calls the SAME backend tools as the real AI.
   Use it as a backup if Wi-Fi or the voice API misbehaves during the live demo. */
(function () {
  let cancelled = false;
  let listings = null;

  const LOCATIONS = ['Whitefield', 'Sarjapur Road', 'Electronic City', 'Hebbal', 'Yelahanka', 'JP Nagar', 'HSR Layout'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const price = (n) => (n >= 100 ? `${(n / 100).toFixed(2).replace(/\.?0+$/, '')} crore` : `${n} lakhs`);

  function nextWeekendDay() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    while (d.getDay() !== 6 && d.getDay() !== 0) d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function understand(lead) {
    const t = lead.enquiry.toLowerCase();
    const type = t.includes('villa') ? 'villa' : t.includes('plot') ? 'plot' : 'apartment';
    const bhkMatch = t.match(/(\d)\s*bhk/);
    const bhk = type === 'plot' ? null : bhkMatch ? Number(bhkMatch[1]) : type === 'villa' ? 4 : 2;
    let location = LOCATIONS.find((l) => t.includes(l.toLowerCase().split(' ')[0]));
    if (!location && t.includes('airport')) location = type === 'plot' ? 'Yelahanka' : 'Hebbal';
    if (!location && t.includes('south')) location = 'JP Nagar';
    if (!location && type === 'villa') location = 'Sarjapur Road';
    if (!location && type === 'plot') location = 'Yelahanka';
    return { type, bhk, location: location || 'Whitefield', investment: t.includes('invest') || t.includes('rental') };
  }

  function pickTarget(need) {
    const ok = (p) => p.type === need.type && (!need.bhk || p.bhk === need.bhk);
    return listings.find((p) => ok(p) && p.location === need.location) || listings.find(ok) || listings[0];
  }

  // ---- speech ----
  function voices() { return window.speechSynthesis ? speechSynthesis.getVoices() : []; }
  function pickVoice(role) {
    const v = voices(); if (!v.length) return null;
    const inEn = v.filter((x) => /en[-_]IN/i.test(x.lang));
    const en = v.filter((x) => /^en/i.test(x.lang));
    const pool = inEn.length >= 2 ? inEn : en.length ? en : v;
    const female = pool.find((x) => /female|veena|heera|priya|samantha|zira|google uk english female/i.test(x.name));
    if (role === 'agent') return female || pool[0];
    return pool.find((x) => x !== (female || pool[0])) || pool[0];
  }
  function speak(text, role) {
    return new Promise((resolve) => {
      const canSpeak = window.speechSynthesis && voices().length > 0;
      // If the browser can't speak, pace the text like reading speed; otherwise wait for speech to finish.
      const fallback = setTimeout(resolve, canSpeak ? text.length * 95 + 2000 : Math.max(1400, text.length * 45));
      if (!canSpeak) return;
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(role); if (v) u.voice = v;
      u.rate = role === 'agent' ? 1.05 : 1.1; u.pitch = role === 'agent' ? 1.1 : 0.9;
      u.onend = () => { clearTimeout(fallback); resolve(); };
      u.onerror = () => { clearTimeout(fallback); resolve(); };
      speechSynthesis.speak(u);
    });
  }
  async function say(role, text) {
    if (cancelled) return;
    const D = window.LeadDesk;
    D.state.call.partial = null;
    D.addTurn(role, text);
    const vol = setInterval(() => { const el = document.getElementById('vol'); if (el) el.style.width = `${20 + Math.random() * 70}%`; }, 120);
    await speak(text, role);
    clearInterval(vol);
    const el = document.getElementById('vol'); if (el) el.style.width = '0%';
    await sleep(350);
  }
  async function tool(lead, name, args) {
    if (cancelled) return {};
    const D = window.LeadDesk;
    D.addToolChip(`AI used ${name.replace(/_/g, ' ')}`);
    await sleep(500);
    return D.api('/api/simulate/tool', { method: 'POST', body: { leadId: lead.id, name, args } });
  }

  window.stopSimulatedCall = function () {
    cancelled = true;
    if (window.speechSynthesis) speechSynthesis.cancel();
    window.LeadDesk.finishCall('ended-by-user');
  };

  window.runSimulatedCall = async function (lead) {
    const D = window.LeadDesk;
    if (D.state.call) return D.toast('A call is already in progress');
    cancelled = false;
    if (lead.language && lead.language !== 'en') D.toast('The simulated call plays in English; live AI calls use the chosen language');
    if (!listings) listings = await D.api('/api/listings');
    const firm = D.state.config.firmName || 'Prime Nest Realty';
    const agent = D.state.config.agentName || 'Priya';
    const first = lead.name.split(' ')[0];
    const need = understand(lead);
    const target = pickTarget(need);
    const budget = Math.ceil(target.priceLakhs / 5) * 5 + 5;
    const budgetSpoken = budget >= 100 ? `around ${price(budget)}` : `around ${budget - 10} to ${budget} lakhs`;
    const what = need.type === 'plot' ? 'a plot' : need.type === 'villa' ? `a ${need.bhk}BHK villa` : `a ${need.bhk}BHK apartment`;
    const visitDay = nextWeekendDay();

    D.beginCall(lead.id, 'simulated');
    D.state.call.status = 'ringing'; D.render();
    await sleep(1200);
    if (cancelled) return;
    D.callLive();

    await say('agent', `Hi ${first}, this is ${agent}, an AI assistant from ${firm}. I'm calling about the property enquiry you made on ${lead.source}. Is this a good time for a quick two-minute chat?`);
    await say('customer', 'Yes, sure. Go ahead.');
    await say('agent', `Great, thank you! Is ${need.location} your preferred location, or are you open to nearby areas?`);
    await say('customer', `${need.location} mainly. It's close to my office.`);
    await say('agent', need.type === 'plot' ? 'Got it. And you are looking for a residential plot, correct?' : 'Got it. What kind of property are you looking for, and how many bedrooms?');
    await say('customer', need.type === 'plot' ? 'Yes, a plot, around thirty by fifty.' : `${what.replace(/^a /, 'A ')}.`);
    await say('agent', 'And what budget range are you comfortable with?');
    await say('customer', `${budgetSpoken.charAt(0).toUpperCase() + budgetSpoken.slice(1)}.`);

    const found = await tool(lead, 'search_properties', { location: need.location, propertyType: need.type, bhk: need.bhk, maxBudgetLakhs: budget });
    const p = (found.items && found.items[0]) || target;
    await say('agent', `I have a good match: ${p.project} in ${p.location}, ${p.bhk ? p.bhk + 'BHK ' : ''}${p.type === 'plot' ? 'plots' : p.type} at ${price(p.priceLakhs)}, ${p.possession.toLowerCase()}. ${p.highlights}.`);
    await say('customer', 'Okay, that sounds interesting.');
    await say('agent', 'When are you planning to buy, and is it for self-use or investment?');
    const purpose = need.investment ? 'investment' : 'self-use';
    await say('customer', `For ${purpose === 'investment' ? 'investment' : 'my family'}. Ideally in the next two or three months. I'll need a home loan.`);

    await tool(lead, 'save_lead_details', {
      budgetLakhs: budget, budgetText: budgetSpoken.replace('around ', ''), location: need.location, propertyType: need.type,
      bhk: need.bhk || undefined, timeline: 'within 3 months', timelineMonths: 3, purpose, loanNeeded: true, interestLevel: 'hot',
      notes: 'Wants to see the property soon; needs home loan assistance',
    });
    await say('agent', `Perfect. Would you like to see it in person? I can book a site visit on ${visitDay}, at 10 AM, 12 PM or 4 PM.`);
    await say('customer', `${visitDay.split(',')[0]} at 10 AM works for me.`);
    const booked = await tool(lead, 'book_site_visit', { propertyId: p.id, date: visitDay, timeSlot: '10:00 AM' });
    if (booked && booked.text && booked.text.startsWith('Booked')) {
      await say('agent', `Done! You're booked for ${p.project} on ${visitDay} at 10 AM. You'll get a WhatsApp confirmation with the location shortly. Thank you, ${first}, have a great day!`);
    } else {
      await say('agent', `Thank you, ${first}. Our consultant will confirm the visit on WhatsApp shortly. Have a great day!`);
    }
    await say('customer', 'Thanks, bye!');
    if (!cancelled) D.finishCall('assistant-ended-call');
  };

  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => voices();
})();
