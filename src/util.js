'use strict';

const CATEGORIES = [
  { id: 'create_video', label: 'Create a Video' },
  { id: 'create_content', label: 'Create Content' },
  { id: 'design', label: 'Design' },
  { id: 'writing', label: 'Writing' },
  { id: 'other', label: 'Other' },
];

// Currency config — single source of truth so the label can flip from the
// interim USDG-denominated credit to the real $CHALLENGE token after launch
// on long.xyz without touching every view.
const CURRENCY = {
  symbol: 'USDG',
  futureSymbol: 'CHALLENGE',
  disclaimer:
    "Balances here are an internal platform credit denominated 1:1 with USDG for accounting purposes only " +
    "— this is NOT a live transfer of the real USDG stablecoin, and this platform is not affiliated with, " +
    "endorsed by, or connected to Global Dollar Network, Paxos, or Robinhood. Real payouts are planned in " +
    "$CHALLENGE once the token launches on long.xyz.",
};

function categoryLabel(id) {
  const c = CATEGORIES.find((c) => c.id === id);
  return c ? c.label : id;
}

const FEE_RATE = 0.1; // 10% platform fee on top of the reward, escrowed at creation time
function computeFee(reward) {
  const fee = Math.ceil(reward * FEE_RATE);
  return Math.max(fee, reward > 0 ? 1 : 0);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

module.exports = { CATEGORIES, categoryLabel, computeFee, escapeHtml, CURRENCY };
