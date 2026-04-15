const { URL } = require('url');

const DEFAULT_CAPABILITIES = {
  optional: {
    casinoSearch: false,
    casinoFilter: false,
    casinoCatalogCards: false,
    liveCasinoRoute: false,
    guestSidebarAuthEntries: false,
    sportsEventDetails: false,
  },
};

const BRAND_CAPABILITIES = {
  'gt.bet': {
    optional: {
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
  'booms.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
  'likes.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
  'nix.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
  'igo.bet': {
    optional: {
      casinoSearch: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
  'chacha.bet': {
    optional: {
      casinoSearch: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
  'starzino.com': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      sportsEventDetails: true,
    },
  },
};

const BLOCKED_REASON_CAPABILITY_RULES = [
  {
    key: 'casinoSearch',
    re: /search modal\/input not visible|search.*not visible|search trigger not found/i,
  },
  {
    key: 'casinoFilter',
    re: /filter panel not visible|filter panel failed to open|filter toggle not found|clear button is not available in filter panel/i,
  },
  {
    key: 'casinoCatalogCards',
    re: /no game cards found|catalog entries are unavailable|category chips are not discoverable/i,
  },
  {
    key: 'liveCasinoRoute',
    re: /live casino route is not available in current session|resolved to "\/casino\/?"/i,
  },
  {
    key: 'guestSidebarAuthEntries',
    re: /guest sidebar does not expose explicit login\/signup entries/i,
  },
  {
    key: 'sportsEventDetails',
    re: /sports event card is not clickable in current render|could not open event details for odds interaction|could not open event details for betslip control checks/i,
  },
];

function resolveHostname(baseUrl = process.env.BASE_URL || 'https://gt.bet/') {
  try {
    return new URL(String(baseUrl || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function mergeCapabilities(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  const brand = BRAND_CAPABILITIES[host] || {};
  const merged = {
    optional: {
      ...DEFAULT_CAPABILITIES.optional,
      ...(brand.optional || {}),
    },
  };
  return merged;
}

function getBrandCapabilities(baseUrl = process.env.BASE_URL || 'https://gt.bet/') {
  return mergeCapabilities(resolveHostname(baseUrl));
}

function inferCapabilityFromBlockedReason(reason) {
  const source = String(reason || '');
  if (!source) return null;
  for (const rule of BLOCKED_REASON_CAPABILITY_RULES) {
    if (rule.re.test(source)) return rule.key;
  }
  return null;
}

function isCapabilityOptionalForBrand(baseUrl, capabilityKey) {
  const capabilities = getBrandCapabilities(baseUrl);
  return Boolean(capabilities.optional && capabilities.optional[capabilityKey] === true);
}

module.exports = {
  DEFAULT_CAPABILITIES,
  BRAND_CAPABILITIES,
  BLOCKED_REASON_CAPABILITY_RULES,
  getBrandCapabilities,
  inferCapabilityFromBlockedReason,
  isCapabilityOptionalForBrand,
};
