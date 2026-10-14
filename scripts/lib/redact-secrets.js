const { Buffer } = require('buffer');

const SENSITIVE_KEY_RE =
  /(?:password|passphrase|secret|token|authorization|cookie|api[_-]?key|client[_-]?secret|player[_-]?id|socket[_-]?id|__cf_chl.*)$/i;

const DEFAULT_MAX_INLINE_ATTACHMENT_CHARS = 1024 * 1024;

function findJsonStringEnd(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    const quoteIndex = source.indexOf('"', cursor);
    if (quoteIndex === -1) return -1;

    let slashCount = 0;
    for (let index = quoteIndex - 1; index >= start && source[index] === '\\'; index -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return quoteIndex;
    cursor = quoteIndex + 1;
  }
  return -1;
}

function omitOversizedAttachmentBodies(value, maxChars = DEFAULT_MAX_INLINE_ATTACHMENT_CHARS) {
  const source = String(value == null ? '' : value);
  const safeLimit = Math.max(1024, Number(maxChars) || DEFAULT_MAX_INLINE_ATTACHMENT_CHARS);
  if (source.length <= safeLimit) return source;

  const chunks = [];
  let searchFrom = 0;
  let copyFrom = 0;

  while (searchFrom < source.length) {
    const keyIndex = source.indexOf('"body"', searchFrom);
    if (keyIndex === -1) break;

    let cursor = keyIndex + '"body"'.length;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (source[cursor] !== ':') {
      searchFrom = cursor + 1;
      continue;
    }
    cursor += 1;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (source[cursor] !== '"') {
      searchFrom = cursor + 1;
      continue;
    }

    const valueStart = cursor + 1;
    const valueEnd = findJsonStringEnd(source, valueStart);
    if (valueEnd === -1) break;
    const valueLength = valueEnd - valueStart;
    if (valueLength > safeLimit) {
      chunks.push(source.slice(copyFrom, valueStart));
      chunks.push(`[OMITTED_OVERSIZED_ATTACHMENT:${valueLength}_CHARS]`);
      copyFrom = valueEnd;
    }
    searchFrom = valueEnd + 1;
  }

  if (chunks.length === 0) return source;
  chunks.push(source.slice(copyFrom));
  return chunks.join('');
}

function maskEmail(value) {
  const source = String(value || '').trim();
  const match = source.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!match) return source;
  const local = match[1];
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${match[2]}`;
}

function redactText(value) {
  let text = String(value == null ? '' : value);
  text = text
    .replace(
      /((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)?\s*)[^\s,;"']+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /((?:password|passphrase|secret|auth|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization|api[_-]?key|client[_-]?secret|player[_-]?id|socket[_-]?id)\s*["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /([?&](?:token|access_token|refresh_token|auth_token|api_key|key|__cf_chl[^=]*)=)[^&#\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(/((?:cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}(?:\.{3})?/g, '[REDACTED]')
    .replace(/(wss?:\/\/[^\s"']+\/app\/)[^/?\s"']+/gi, '$1[REDACTED]')
    .replace(/private-user\.\d+/gi, 'private-user.[REDACTED]');

  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email));
}

function redactObject(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => redactObject(item, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  const namedSecret = /token|auth|session|cookie|csrf|^__cf|clearance/i.test(
    String(value.name || '')
  );
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      SENSITIVE_KEY_RE.test(key) || (namedSecret && key === 'value')
        ? '[REDACTED]'
        : redactObject(item, seen);
  }
  seen.delete(value);
  return result;
}

function redactSerializedText(value) {
  const source = omitOversizedAttachmentBodies(value);
  try {
    return JSON.stringify(redactObject(JSON.parse(source)), null, 2);
  } catch {
    return redactText(source);
  }
}

module.exports = {
  maskEmail,
  omitOversizedAttachmentBodies,
  redactObject,
  redactSerializedText,
  redactText,
};
