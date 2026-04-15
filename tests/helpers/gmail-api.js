const { URL } = require('url');

const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function stripPlusAddress(email) {
  const source = normalizeEmail(email);
  const at = source.indexOf('@');
  if (at <= 0) return source;
  const local = source.slice(0, at);
  const domain = source.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus <= 0) return source;
  return `${local.slice(0, plus)}@${domain}`;
}

function decodeBase64Url(value) {
  const source = String(value || '');
  if (!source) return '';
  const normalized = source.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  try {
    return globalThis.Buffer.from(normalized + padding, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function collectMimeBodies(node, out) {
  if (!node || typeof node !== 'object') return;
  const mimeType = String(node.mimeType || '').toLowerCase();
  const data = node.body && typeof node.body.data === 'string' ? node.body.data : '';
  const text = data ? decodeBase64Url(data) : '';
  if (text) {
    if (mimeType.includes('text/plain')) out.plain.push(text);
    else if (mimeType.includes('text/html')) out.html.push(text);
  }
  if (Array.isArray(node.parts)) {
    for (const part of node.parts) collectMimeBodies(part, out);
  }
}

function stripHtml(html) {
  return oneLine(
    String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
  );
}

function extractLinks(source) {
  const text = String(source || '');
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const cleaned = matches
    .map((item) =>
      String(item)
        .replace(/[),.;]+$/g, '')
        .trim()
    )
    .filter(Boolean)
    .filter((item) => !/^https?:\/\/mail\.google\.com\//i.test(item));
  return [...new Set(cleaned)];
}

function buildHeaderMap(headers) {
  const map = {};
  for (const header of headers || []) {
    const name = oneLine(header && header.name).toLowerCase();
    const value = oneLine(header && header.value);
    if (!name) continue;
    map[name] = value;
  }
  return map;
}

function parseMessage(payload) {
  const parsed = {
    id: payload && payload.id ? String(payload.id) : '',
    threadId: payload && payload.threadId ? String(payload.threadId) : '',
    internalDate: Number(payload && payload.internalDate ? payload.internalDate : 0),
    snippet: oneLine(payload && payload.snippet ? payload.snippet : ''),
    subject: '',
    from: '',
    to: '',
    date: '',
    text: '',
    links: [],
  };

  const messagePayload = payload && payload.payload ? payload.payload : {};
  const headers = buildHeaderMap(messagePayload.headers || []);
  parsed.subject = headers.subject || '';
  parsed.from = headers.from || '';
  parsed.to = headers.to || '';
  parsed.date = headers.date || '';

  const bodies = { plain: [], html: [] };
  collectMimeBodies(messagePayload, bodies);
  const plainText = oneLine(bodies.plain.join('\n'));
  const htmlText = oneLine(bodies.html.join('\n'));
  const htmlAsText = stripHtml(htmlText);
  parsed.text = oneLine([plainText, htmlAsText, parsed.snippet].filter(Boolean).join(' '));
  parsed.links = [...new Set([...extractLinks(plainText), ...extractLinks(htmlText)])];

  return parsed;
}

function scoreLink(link, baseUrl) {
  const url = String(link || '');
  if (!url) return -1;

  let score = 0;
  if (/reset|forgot|recover|restore|password|new-password|change-password/i.test(url)) score += 6;
  if (/[?&](token|code|hash|key)=/i.test(url)) score += 2;
  if (/^https:\/\//i.test(url)) score += 1;

  try {
    const target = new URL(url);
    const baseHost = new URL(baseUrl).hostname.toLowerCase();
    const host = target.hostname.toLowerCase();
    if (host === baseHost || host.endsWith(`.${baseHost}`)) score += 8;
  } catch {
    // keep baseline score for malformed urls
  }

  return score;
}

function pickBestLink(links, baseUrl) {
  if (!Array.isArray(links) || !links.length) return '';
  const ranked = links
    .map((link) => ({ link, score: scoreLink(link, baseUrl) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0 ? ranked[0].link : links[0];
}

function buildSearchQuery({ targetEmail, afterTsMs, subjectHints }) {
  const email = normalizeEmail(targetEmail);
  const plainEmail = stripPlusAddress(email);
  const toQuery =
    plainEmail && plainEmail !== email
      ? `(to:${email} OR to:${plainEmail})`
      : email
        ? `to:${email}`
        : '';
  const afterUnix = Math.max(0, Math.floor((Number(afterTsMs || Date.now()) - 120_000) / 1000));
  const subjectTokens = (subjectHints || [])
    .map((token) => oneLine(token).toLowerCase())
    .filter(Boolean);
  const subjectQuery = subjectTokens.length
    ? `(${subjectTokens.map((token) => `subject:${token}`).join(' OR ')})`
    : '(subject:password OR subject:reset OR subject:recover OR subject:forgot)';
  return [toQuery, `after:${afterUnix}`, subjectQuery, 'in:inbox'].filter(Boolean).join(' ');
}

function getGmailApiConfigFromEnv(env = process.env) {
  const config = {
    user: oneLine(env.GMAIL_USER || env.GOOGLE_GMAIL_USER),
    clientId: oneLine(env.GMAIL_CLIENT_ID || env.GOOGLE_CLIENT_ID),
    clientSecret: oneLine(env.GMAIL_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET),
    refreshToken: oneLine(env.GMAIL_REFRESH_TOKEN || env.GOOGLE_REFRESH_TOKEN),
  };
  const missing = [];
  if (!config.user) missing.push('GMAIL_USER');
  if (!config.clientId) missing.push('GMAIL_CLIENT_ID');
  if (!config.clientSecret) missing.push('GMAIL_CLIENT_SECRET');
  if (!config.refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
  return {
    ...config,
    ok: missing.length === 0,
    missing,
  };
}

async function fetchAccessToken(config) {
  const body = new globalThis.URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const reason = oneLine(payload.error_description || payload.error || response.statusText);
    throw new Error(`Gmail access token request failed (${response.status}): ${reason}`);
  }
  return String(payload.access_token);
}

async function gmailApiGet(pathName, accessToken, searchParams = {}) {
  const url = new URL(`${GMAIL_API_BASE}${pathName}`);
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (value === null || typeof value === 'undefined' || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = oneLine(
      (payload && payload.error && payload.error.message) || payload.error_description || ''
    );
    throw new Error(`Gmail API request failed (${response.status}): ${reason}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForResetLink({
  config,
  targetEmail,
  baseUrl,
  afterTsMs,
  timeoutMs = 180_000,
  pollIntervalMs = 5_000,
  subjectHints = ['password', 'reset', 'recover', 'forgot'],
}) {
  const startedAt = Date.now();
  const query = buildSearchQuery({
    targetEmail,
    afterTsMs,
    subjectHints,
  });
  const seen = new Set();

  while (Date.now() - startedAt <= Math.max(10_000, Number(timeoutMs) || 180_000)) {
    const accessToken = await fetchAccessToken(config);
    const list = await gmailApiGet('/messages', accessToken, {
      q: query,
      maxResults: 10,
      includeSpamTrash: false,
    });
    const messages = Array.isArray(list.messages) ? list.messages : [];

    for (const item of messages) {
      const id = String(item && item.id ? item.id : '');
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const full = await gmailApiGet(`/messages/${id}`, accessToken, { format: 'full' });
      const parsed = parseMessage(full);
      const link = pickBestLink(parsed.links, baseUrl);
      if (!link) continue;
      return {
        found: true,
        link,
        message: {
          id: parsed.id,
          threadId: parsed.threadId,
          internalDate: parsed.internalDate,
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          date: parsed.date,
          snippet: parsed.snippet,
          linksCount: parsed.links.length,
          chosenLink: link,
        },
        query,
      };
    }

    await sleep(Math.max(1000, Number(pollIntervalMs) || 5000));
  }

  return {
    found: false,
    link: '',
    message: null,
    query,
  };
}

module.exports = {
  getGmailApiConfigFromEnv,
  normalizeEmail,
  pollForResetLink,
  stripPlusAddress,
};
