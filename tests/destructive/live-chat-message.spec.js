const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  createWafProbe,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  maybeSkipWaf,
  waitForUiSettled,
  waitForHomeContent,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'live-chat');
const TEST_MESSAGE = process.env.PW_LIVE_CHAT_MESSAGE || 'test';
const GUEST_NAME = process.env.PW_LIVE_CHAT_NAME || 'Autotest Sidebar';
const GUEST_EMAIL = process.env.PW_LIVE_CHAT_EMAIL || 'autotest-sidebar@example.test';
const REPLY_TIMEOUT_MS =
  Number.parseInt(process.env.PW_LIVE_CHAT_REPLY_TIMEOUT || '45000', 10) || 45_000;
const LIVE_CHAT_FRAME_URL_RE = /livechatinc|livechat|lc\.chat|chat-widget/i;
const LIVE_CHAT_IFRAME_SELECTOR =
  'iframe[title*="livechat" i], iframe[src*="livechat" i], iframe[src*="lc.chat" i], iframe[name*="chat-widget" i]';

function compactText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return compactText(value).toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTransientNetworkError(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  return (
    message.includes('internet connection appears to be offline') ||
    message.includes('net::err_internet_disconnected') ||
    message.includes('net::err_network_changed') ||
    message.includes('net::err_timed_out')
  );
}

function writeArtifact(payload, fileName = 'guest-live-chat-message.json') {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const filePath = path.join(ARTIFACT_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

async function waitForChatFrame(page, timeoutMs = 20_000) {
  let frame = null;
  await expect
    .poll(
      async () => {
        frame =
          page.frame({ name: 'chat-widget' }) ||
          page.frames().find((item) => {
            const frameName = typeof item.name === 'function' ? item.name() : '';
            const frameUrl = typeof item.url === 'function' ? item.url() : '';
            return LIVE_CHAT_FRAME_URL_RE.test(`${frameName} ${frameUrl}`);
          }) ||
          null;
        if (!frame) {
          const hasLiveChatIframe = await page
            .locator(LIVE_CHAT_IFRAME_SELECTOR)
            .first()
            .isVisible({ timeout: 500 })
            .catch(() => false);
          if (hasLiveChatIframe) {
            frame =
              page.frame({ name: 'chat-widget' }) ||
              page.frames().find((item) => {
                const frameName = typeof item.name === 'function' ? item.name() : '';
                const frameUrl = typeof item.url === 'function' ? item.url() : '';
                return LIVE_CHAT_FRAME_URL_RE.test(`${frameName} ${frameUrl}`);
              }) ||
              null;
          }
        }
        return Boolean(frame);
      },
      { timeout: timeoutMs, intervals: [300, 500, 800] }
    )
    .toBeTruthy()
    .catch(() => null);
  return frame;
}

async function collectRowTexts(frame) {
  return frame
    .locator('[role="grid"] [role="row"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
    .catch(() => []);
}

async function collectBodyText(frame) {
  return compactText(
    await frame
      .locator('body')
      .textContent()
      .catch(() => '')
  );
}

function findReplyRow(rows, baselineRows, sentMessage) {
  const baseline = new Set((baselineRows || []).map((row) => normalizeText(row)));
  const sentNormalized = normalizeText(sentMessage);
  const sentRegex = sentNormalized
    ? new RegExp(`(^|\\b)${escapeRegExp(sentNormalized)}(\\b|$)`)
    : null;

  return (
    rows.find((row) => {
      const normalized = normalizeText(row);
      const normalizedWithoutRead = normalized
        .replace(/\b(read|seen|delivered|sent)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!normalized) return false;
      if (baseline.has(normalized)) return false;
      if (sentNormalized && normalizedWithoutRead === sentNormalized) return false;
      if (
        sentRegex &&
        sentRegex.test(normalizedWithoutRead) &&
        normalizedWithoutRead.length <= sentNormalized.length + 16
      ) {
        return false;
      }
      if (/^read$/i.test(normalized)) return false;
      if (/is typing/i.test(normalized)) return false;
      if (normalized.length < 6) return false;
      return true;
    }) || ''
  );
}

test('Live chat destructive: guest sends "test" and receives support reply', async ({
  browser,
}, testInfo) => {
  if (process.env.PW_INCLUDE_LIVE_CHAT !== '1') {
    testInfo.annotations.push({
      type: 'gated',
      description: 'Live chat destructive test is gated. Set PW_INCLUDE_LIVE_CHAT=1 to enable it.',
    });
    return;
  }
  test.setTimeout(REPLY_TIMEOUT_MS + 120_000);

  const payload = {
    source: 'tests/destructive/live-chat-message.spec.js',
    generatedAt: new Date().toISOString(),
    message: TEST_MESSAGE,
    messageSent: false,
    replyReceived: false,
    blockedByWaf: false,
    replyTimeoutMs: REPLY_TIMEOUT_MS,
    guestIdentity: {
      name: GUEST_NAME,
      email: GUEST_EMAIL,
    },
    status: 'started',
  };

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
    locale: 'en-US',
  });

  const page = await context.newPage();
  const wafProbe = createWafProbe(page);

  try {
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      if (isTransientNetworkError(err)) {
        payload.status = 'blocked';
        payload.reason = `Network instability while opening homepage: ${String(err.message || err)}`;
        markBlocked(testInfo, payload.reason);
        return;
      }
      throw err;
    }
    await dismissOverlays(page);
    await waitForHomeContent(page);
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) {
      payload.status = 'blocked';
      payload.blockedByWaf = true;
      payload.reason =
        (await detectCloudflare(page).catch(() => null)) ||
        'Cloudflare/WAF blocked guest live chat scenario.';
      return;
    }

    const trigger = page
      .locator('[data-testid="sidebar-liveChat-button"], [data-testid="online-chat-button"]')
      .first();
    const triggerVisible = await trigger.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!triggerVisible) {
      payload.status = 'blocked';
      payload.reason = 'Live chat trigger is not visible in current brand layout.';
      markBlocked(testInfo, payload.reason);
      return;
    }
    await trigger.click({ timeout: 10_000 });

    const frame = await waitForChatFrame(page);
    if (!frame) {
      payload.status = 'blocked';
      payload.reason = 'Live chat frame did not appear after opening the widget.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    const nameInput = frame.locator('input[type="text"]').first();
    const emailInput = frame.locator('input[type="email"]').first();
    const startButton = frame.getByRole('button', { name: /start the chat/i }).first();

    const prechatReady = await Promise.all([
      nameInput.isVisible({ timeout: 15_000 }).catch(() => false),
      emailInput.isVisible({ timeout: 15_000 }).catch(() => false),
      startButton.isVisible({ timeout: 15_000 }).catch(() => false),
    ]);
    if (!prechatReady.every(Boolean)) {
      payload.status = 'blocked';
      payload.reason = 'Live chat pre-chat form is not fully visible.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    await nameInput.fill(GUEST_NAME);
    await emailInput.fill(GUEST_EMAIL);
    await startButton.click({ timeout: 10_000 });

    const composer = frame
      .locator(
        'textarea[aria-label*="Write a message" i], textarea[placeholder*="Write a message" i]'
      )
      .first();
    const sendButton = frame.getByRole('button', { name: /send a message/i }).first();

    const chatReady = await Promise.all([
      composer.isVisible({ timeout: 20_000 }).catch(() => false),
      sendButton.isVisible({ timeout: 20_000 }).catch(() => false),
    ]);
    if (!chatReady.every(Boolean)) {
      payload.status = 'blocked';
      payload.reason = 'Live chat composer/send controls are unavailable.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    payload.rowsBeforeSend = await collectRowTexts(frame);
    payload.bodyBeforeSend = await collectBodyText(frame);

    await composer.fill(TEST_MESSAGE);
    payload.composerValue = await composer.inputValue().catch(() => '');
    expect(payload.composerValue, 'Live chat composer should contain the outgoing message.').toBe(
      TEST_MESSAGE
    );

    await sendButton.click({ timeout: 10_000 });

    let rowsAfterSend = [];
    await expect
      .poll(
        async () => {
          rowsAfterSend = await collectRowTexts(frame);
          return rowsAfterSend.some((row) =>
            normalizeText(row).includes(normalizeText(TEST_MESSAGE))
          );
        },
        { timeout: 15_000, intervals: [400, 800, 1200] }
      )
      .toBeTruthy();
    payload.messageSent = true;

    payload.rowsAfterSend = rowsAfterSend;
    payload.bodyAfterSend = await collectBodyText(frame);
    expect(
      rowsAfterSend.some((row) => normalizeText(row).includes(normalizeText(TEST_MESSAGE))),
      'Outgoing live chat message should appear in the conversation history.'
    ).toBeTruthy();

    let replyText = '';
    let replyRows = rowsAfterSend;
    let typingObserved = false;
    await expect
      .poll(
        async () => {
          replyRows = await collectRowTexts(frame);
          replyText = findReplyRow(replyRows, rowsAfterSend, TEST_MESSAGE);
          if (replyText) return true;
          const bodyText = await collectBodyText(frame);
          if (/is typing/i.test(bodyText)) typingObserved = true;
          return false;
        },
        { timeout: REPLY_TIMEOUT_MS, intervals: [1500, 2500, 3000] }
      )
      .toBeTruthy()
      .catch(() => null);

    payload.replyRows = replyRows;
    payload.replyText = replyText;
    payload.replyReceived = Boolean(replyText);
    payload.typingObserved = typingObserved;
    payload.finalBody = await collectBodyText(frame);

    if (!replyText) {
      payload.status = 'blocked';
      payload.reason = `No support reply was detected within ${REPLY_TIMEOUT_MS} ms after sending "${TEST_MESSAGE}".`;
      markBlocked(testInfo, payload.reason);
      if (typingObserved) {
        testInfo.annotations.push({
          type: 'debug',
          description:
            'Typing indicator was observed, but no completed reply message arrived in time.',
        });
      }
      return;
    }

    payload.status = 'passed';
    await waitForUiSettled(page, 1200);
    expect(payload.replyText.length, 'Support reply text should not be empty.').toBeGreaterThan(0);
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) {
      payload.status = 'blocked';
      payload.blockedByWaf = true;
      payload.reason =
        (await detectCloudflare(page).catch(() => null)) ||
        String(err && err.message ? err.message : err);
      return;
    }
    throw err;
  } finally {
    if (payload.status === 'started') {
      payload.status = 'blocked';
      payload.reason =
        payload.reason ||
        'Scenario did not reach a terminal status (message/reply validation did not finish).';
    }
    const artifactPath = writeArtifact(payload);
    await testInfo.attach('guest-live-chat-message.json', {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'artifact', description: artifactPath });
    await context.close();
  }
});
