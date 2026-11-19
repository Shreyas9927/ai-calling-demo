// Simple, explainable lead scoring (0-100) so the client can see WHY a lead is Hot.
// Every rule adds points; the dashboard shows the breakdown.

function scoreLead(lead) {
  const q = lead.qualification || {};
  const reasons = [];
  let score = 0;
  const add = (pts, why) => { score += pts; reasons.push(`+${pts} ${why}`); };

  if (q.interestLevel === 'not_interested') {
    return { score: 5, tier: 'Cold', reasons: ['Lead said not interested'] };
  }

  if (q.budgetLakhs || q.budgetText) add(15, 'budget shared');
  if (q.location) add(10, 'preferred location shared');
  if (q.propertyType || q.bhk) add(10, 'property type / BHK known');

  const m = Number(q.timelineMonths);
  if (!Number.isNaN(m) && q.timelineMonths !== undefined && q.timelineMonths !== null) {
    if (m <= 3) add(25, 'buying within 3 months');
    else if (m <= 6) add(15, 'buying within 6 months');
    else add(5, 'buying later than 6 months');
  }

  if (q.interestLevel === 'hot') add(15, 'agent rated interest: hot');
  else if (q.interestLevel === 'warm') add(8, 'agent rated interest: warm');

  if (lead.siteVisit) add(25, 'site visit booked');

  score = Math.min(score, 100);
  const tier = score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold';
  return { score, tier, reasons };
}

function statusFor(lead) {
  const q = lead.qualification || {};
  if (lead.callInProgress) return 'Calling';
  if (q.interestLevel === 'not_interested') return 'Not interested';
  if (lead.siteVisit) return 'Site visit booked';
  if (!(lead.calls && lead.calls.length)) return 'New'; // form details alone don't make a lead "qualified"
  if (lead.tier === 'Hot' || lead.tier === 'Warm') return 'Qualified';
  if (q.interestLevel === 'callback') return 'Callback requested';
  return lead.calls && lead.calls.length ? 'Contacted' : 'New';
}

module.exports = { scoreLead, statusFor };
