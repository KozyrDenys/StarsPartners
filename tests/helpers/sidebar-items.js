const GUEST_ITEMS = [
  { label: 'Sign up', route: '/', kind: 'signup-modal', position: 'top' },
  { label: 'Log in', route: '/', kind: 'login-modal', position: 'top' },
  {
    label: 'Search',
    placeholder: 'Search',
    route: '/',
    kind: 'search-input',
    position: 'top',
    query: 'coin',
  },
  { label: 'Promo', route: '/', kind: 'nav', position: 'middle', expectedPaths: ['/promotions/'] },
  { label: 'VIP', route: '/', kind: 'nav', position: 'middle', expectedPaths: ['/vip/'] },
  { label: 'Casino', route: '/', kind: 'nav', position: 'middle', expectedPaths: ['/casino/'] },
  {
    label: 'Live',
    route: '/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/livecasino/', '/live/'],
  },
  { label: 'Sports', route: '/', kind: 'nav', position: 'middle', expectedPaths: ['/sports/'] },
  {
    label: 'Collections',
    route: '/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/collections/'],
  },
  {
    label: 'Invite & Earn',
    route: '/',
    kind: 'guest-referral-gate',
    position: 'bottom',
    expectedPaths: ['/referral/', '#signup'],
  },
  { label: 'Live chat', route: '/', kind: 'chat', position: 'bottom' },
  { label: 'English', route: '/', kind: 'language', position: 'bottom' },
];

const LANGUAGE_LABEL_PATTERN =
  /english|français|español|italiano|ελλάδα|deutsch|português|русский|українська/i;

const AUTH_HOME_ITEMS = [
  { label: 'My profile', route: '/', kind: 'nav', position: 'top', expectedPaths: ['/profile/'] },
  { label: 'Missions', route: '/', kind: 'gamification', position: 'top' },
  { label: 'Wheel', route: '/', kind: 'gamification', position: 'top' },
  { label: 'Races', route: '/', kind: 'gamification', position: 'top' },
  { label: 'Achieves', route: '/', kind: 'gamification', position: 'top' },
  { label: 'Store', route: '/', kind: 'gamification', position: 'top' },
];

const AUTH_ASSETS_ITEMS = [
  {
    label: 'Search',
    placeholder: 'Search',
    route: '/assets/',
    kind: 'search-input',
    position: 'top',
    query: 'coin',
  },
  {
    label: 'Promo',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/promotions/'],
  },
  { label: 'VIP', route: '/assets/', kind: 'nav', position: 'middle', expectedPaths: ['/vip/'] },
  {
    label: 'Casino',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/casino/'],
  },
  {
    label: 'Live',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/livecasino/', '/live/'],
  },
  {
    label: 'Sports',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/sports/'],
  },
  {
    label: 'My bonuses',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/promotions/bonuses/'],
  },
  {
    label: 'Recent',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/recent/'],
  },
  {
    label: 'Favourites',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/favorites/', '/favourites/'],
  },
  {
    label: 'Collections',
    route: '/assets/',
    kind: 'nav',
    position: 'middle',
    expectedPaths: ['/collections/'],
  },
  {
    label: 'Invite & Earn',
    route: '/assets/',
    kind: 'nav',
    position: 'bottom',
    expectedPaths: ['/referral/'],
  },
  { label: 'Live chat', route: '/assets/', kind: 'chat', position: 'bottom' },
  { label: 'English', route: '/assets/', kind: 'language', position: 'bottom' },
];

const GUEST_NAV_ITEMS = GUEST_ITEMS.filter((item) => item.kind === 'nav');
const GUEST_SERVICE_ITEMS = GUEST_ITEMS.filter((item) => item.kind !== 'nav');
const AUTH_ASSETS_NAV_ITEMS = AUTH_ASSETS_ITEMS.filter((item) => item.kind === 'nav');
const AUTH_ASSETS_SERVICE_ITEMS = AUTH_ASSETS_ITEMS.filter((item) => item.kind !== 'nav');
const GUEST_SERVICE_AUTH_ITEMS = GUEST_SERVICE_ITEMS.filter((item) =>
  ['signup-modal', 'login-modal', 'search-input', 'guest-referral-gate'].includes(item.kind)
);
const GUEST_SERVICE_UTILITY_ITEMS = GUEST_SERVICE_ITEMS.filter((item) =>
  ['chat', 'language'].includes(item.kind)
);
const GUEST_NAV_PRIMARY_ITEMS = GUEST_NAV_ITEMS.filter((item) =>
  ['Promo', 'VIP', 'Casino'].includes(item.label)
);
const GUEST_NAV_SECONDARY_ITEMS = GUEST_NAV_ITEMS.filter((item) =>
  ['Live', 'Sports', 'Collections'].includes(item.label)
);
const GUEST_MODAL_ITEMS = GUEST_SERVICE_AUTH_ITEMS.filter((item) =>
  ['signup-modal', 'login-modal'].includes(item.kind)
);
const GUEST_SEARCH_ITEMS = GUEST_SERVICE_AUTH_ITEMS.filter((item) => item.kind === 'search-input');
const GUEST_REFERRAL_ITEMS = GUEST_SERVICE_AUTH_ITEMS.filter(
  (item) => item.kind === 'guest-referral-gate'
);
const GUEST_LIVE_ITEMS = GUEST_NAV_SECONDARY_ITEMS.filter((item) => item.label === 'Live');
const GUEST_SPORTS_ITEMS = GUEST_NAV_SECONDARY_ITEMS.filter((item) => item.label === 'Sports');
const GUEST_COLLECTION_ITEMS = GUEST_NAV_SECONDARY_ITEMS.filter(
  (item) => item.label === 'Collections'
);
const AUTH_NAV_PRIMARY_ITEMS = AUTH_ASSETS_NAV_ITEMS.filter((item) =>
  ['Promo', 'VIP', 'Casino', 'Live', 'Sports'].includes(item.label)
);
const AUTH_NAV_SECONDARY_ITEMS = AUTH_ASSETS_NAV_ITEMS.filter((item) =>
  ['My bonuses', 'Recent', 'Favourites', 'Collections', 'Invite & Earn'].includes(item.label)
);

module.exports = {
  AUTH_ASSETS_ITEMS,
  AUTH_ASSETS_SERVICE_ITEMS,
  AUTH_HOME_ITEMS,
  AUTH_NAV_PRIMARY_ITEMS,
  AUTH_NAV_SECONDARY_ITEMS,
  GUEST_COLLECTION_ITEMS,
  GUEST_ITEMS,
  GUEST_LIVE_ITEMS,
  GUEST_MODAL_ITEMS,
  GUEST_NAV_PRIMARY_ITEMS,
  GUEST_REFERRAL_ITEMS,
  GUEST_SEARCH_ITEMS,
  GUEST_SERVICE_UTILITY_ITEMS,
  GUEST_SPORTS_ITEMS,
  LANGUAGE_LABEL_PATTERN,
};
