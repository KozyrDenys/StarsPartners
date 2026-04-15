function compactText(value, maxLength = 220) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function safeIsoNow() {
  return new Date().toISOString();
}

function safeFramePreview(payload, maxLength = 320) {
  if (payload == null) return '';
  if (typeof payload === 'string') return compactText(payload, maxLength);

  try {
    if (typeof payload === 'object' && payload !== null && typeof payload.byteLength === 'number') {
      return `[binary:${payload.byteLength}]`;
    }
  } catch {
    // ignore
  }

  return compactText(String(payload), maxLength);
}

function createWsCapture(page, options = {}) {
  const envEnabled = process.env.PW_WS_CAPTURE !== '0';
  const enabled = options.enabled !== false && envEnabled;
  const sampleLimit = Math.max(1, toNumber(options.sampleLimit) || 20);
  const framePreviewLength = Math.max(64, toNumber(options.framePreviewLength) || 320);
  const sockets = [];
  const indexByUrl = new Map();

  if (!enabled) {
    return {
      enabled: false,
      summarize(meta = {}) {
        return {
          enabled: false,
          reason: 'WebSocket capture disabled (PW_WS_CAPTURE=0).',
          generatedAt: safeIsoNow(),
          meta,
          sockets: [],
          totals: {
            sockets: 0,
            opened: 0,
            closed: 0,
            sentFrames: 0,
            receivedFrames: 0,
            errors: 0,
          },
        };
      },
    };
  }

  function getSocketRecord(ws) {
    const url = String(typeof ws.url === 'function' ? ws.url() : ws.url || '').trim();
    const normalized = normalizeId(url) || `ws-${sockets.length + 1}`;

    if (indexByUrl.has(normalized)) {
      return sockets[indexByUrl.get(normalized)];
    }

    const record = {
      id: `ws-${sockets.length + 1}`,
      url,
      urlKey: normalized,
      openedAt: safeIsoNow(),
      closedAt: '',
      sentFrames: 0,
      receivedFrames: 0,
      sentSamples: [],
      receivedSamples: [],
      errors: [],
    };

    sockets.push(record);
    indexByUrl.set(normalized, sockets.length - 1);
    return record;
  }

  page.on('websocket', (ws) => {
    const record = getSocketRecord(ws);

    ws.on('framesent', (event) => {
      const payload =
        event && Object.prototype.hasOwnProperty.call(event, 'payload') ? event.payload : event;
      record.sentFrames += 1;
      if (record.sentSamples.length < sampleLimit) {
        record.sentSamples.push({
          at: safeIsoNow(),
          payload: safeFramePreview(payload, framePreviewLength),
        });
      }
    });

    ws.on('framereceived', (event) => {
      const payload =
        event && Object.prototype.hasOwnProperty.call(event, 'payload') ? event.payload : event;
      record.receivedFrames += 1;
      if (record.receivedSamples.length < sampleLimit) {
        record.receivedSamples.push({
          at: safeIsoNow(),
          payload: safeFramePreview(payload, framePreviewLength),
        });
      }
    });

    ws.on('socketerror', (error) => {
      if (record.errors.length >= sampleLimit) return;
      record.errors.push({
        at: safeIsoNow(),
        message: compactText(error && error.message ? error.message : error, 260),
      });
    });

    ws.on('close', () => {
      record.closedAt = safeIsoNow();
    });
  });

  return {
    enabled: true,
    summarize(meta = {}) {
      const totals = {
        sockets: sockets.length,
        opened: sockets.length,
        closed: sockets.filter((item) => Boolean(item.closedAt)).length,
        sentFrames: sockets.reduce((sum, item) => sum + Number(item.sentFrames || 0), 0),
        receivedFrames: sockets.reduce((sum, item) => sum + Number(item.receivedFrames || 0), 0),
        errors: sockets.reduce((sum, item) => sum + (item.errors || []).length, 0),
      };

      return {
        enabled: true,
        generatedAt: safeIsoNow(),
        meta,
        totals,
        sockets,
      };
    },
  };
}

module.exports = {
  createWsCapture,
};
