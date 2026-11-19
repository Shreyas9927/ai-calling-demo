// Sends a sample Meta (Facebook/Instagram) lead-ad webhook to the local server.
// Usage:  npm run meta-lead            (English)
//         npm run meta-lead -- kn      (Kannada)   |   npm run meta-lead -- hi  (Hindi)
const lang = (process.argv[2] || 'en').toLowerCase();
const names = { en: 'Deepak Iyer', hi: 'Neha Verma', kn: 'Manjunath Hegde' };
const port = process.env.PORT || 3000;

const payload = {
  ad_name: 'Whitefield 2BHK - Diwali offer',
  form_name: 'Site visit enquiry',
  field_data: [
    { name: 'full_name', values: [names[lang] || names.en] },
    { name: 'phone_number', values: ['+91 98450 66778'] },
    { name: 'preferred_location', values: ['Whitefield'] },
    { name: 'property_type', values: ['2BHK apartment'] },
    { name: 'budget', values: ['70 to 85 lakhs'] },
    { name: 'preferred_language', values: [{ en: 'English', hi: 'Hindi', kn: 'Kannada' }[lang] || 'English'] },
  ],
};

fetch(`http://localhost:${port}/webhooks/meta-lead`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
  .then(async (r) => console.log(r.status, await r.text()))
  .catch((e) => console.error('Is the server running (npm start)?', e.message));
