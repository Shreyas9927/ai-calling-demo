/* Public lead capture page: posts to /api/capture; the dashboard auto-calls the new lead */
(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const price = (n) => (n >= 100 ? `₹${(n / 100).toFixed(2).replace(/\.?0+$/, '')} Cr` : `₹${n} L`);

  try {
    const { firmName } = await (await fetch('/api/public-config')).json();
    document.title = `${firmName} · Find your home in Bangalore`;
    $('#firm').textContent = firmName;
    document.querySelectorAll('.firmName').forEach((el) => { el.textContent = firmName; });
  } catch (_) { /* keep default name */ }

  // A few featured listings (same dummy inventory the agent searches)
  try {
    const listings = await (await fetch('/api/listings')).json();
    const featured = ['P101', 'P104', 'P108'].map((id) => listings.find((p) => p.id === id)).filter(Boolean);
    $('#listings').innerHTML = featured.map((p) => `
      <div class="listing"><div><b>${esc(p.project)}</b>
        <div class="meta">${p.bhk ? p.bhk + ' BHK ' : ''}${esc(p.type)} · ${esc(p.location)} · ${esc(p.possession)}</div></div>
        <div class="price">${price(p.priceLakhs)}</div></div>`).join('');
  } catch (_) { /* listings are decoration only */ }

  const form = $('#form');
  form.propertyType.onchange = () => { $('#bhkField').style.visibility = form.propertyType.value === 'plot' ? 'hidden' : 'visible'; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#error');
    err.hidden = true;
    const body = {
      name: form.name.value.trim(), phone: form.phone.value.trim(), location: form.location.value,
      budget: form.budget.value, propertyType: form.propertyType.value, bhk: form.bhk.value,
      language: form.language.value, consent: form.consent.checked,
    };
    if (!body.name || !body.phone) { err.textContent = 'Please enter your name and mobile number.'; err.hidden = false; return; }
    if (!body.consent) { err.textContent = 'Please tick the box so we can call you about your enquiry.'; err.hidden = false; return; }
    $('#submit').disabled = true;
    try {
      const r = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Something went wrong');
      const first = body.name.split(' ')[0];
      const msg = {
        en: [`Thank you, ${first}!`, 'Our assistant will call you in about a minute to understand your needs and share matching homes.'],
        hi: [`धन्यवाद, ${first}!`, 'हमारी असिस्टेंट लगभग एक मिनट में आपको कॉल करेगी।'],
        kn: [`ಧನ್ಯವಾದಗಳು, ${first}!`, 'ನಮ್ಮ ಸಹಾಯಕಿ ಸುಮಾರು ಒಂದು ನಿಮಿಷದಲ್ಲಿ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತಾರೆ.'],
      }[body.language] || [];
      $('#doneTitle').textContent = msg[0];
      $('#doneText').textContent = msg[1];
      $('#formCard').hidden = true;
      $('#done').hidden = false;
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      $('#submit').disabled = false;
    }
  };
})();
