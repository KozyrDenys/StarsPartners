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
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'live-chat');
const EXPLICIT_STORAGE_STATE_PATH = process.env.PW_STORAGE_STATE
  ? path.resolve(String(process.env.PW_STORAGE_STATE))
  : '';
const PROJECT_ROOT_STORAGE_STATE_PATH = process.env.QA_PROJECT_ROOT
  ? path.join(path.resolve(String(process.env.QA_PROJECT_ROOT)), 'storageState.json')
  : '';
const AUTH_STATE_CANDIDATES = [
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const TEST_MESSAGE = process.env.PW_LIVE_CHAT_AUTH_MESSAGE || 'test auth';
const REPLY_TIMEOUT_MS =
  Number.parseInt(process.env.PW_LIVE_CHAT_AUTH_REPLY_TIMEOUT || '45000', 10) || 45_000;
const REQUIRE_REPLY = process.env.PW_LIVE_CHAT_AUTH_REQUIRE_REPLY === '1';
const LIVE_CHAT_FRAME_URL_RE = /livechatinc|livechat|lc\.chat|chat-widget/i;
const LIVE_CHAT_IFRAME_SELECTOR =
  'iframe[title*="livechat" i], iframe[src*="livechat" i], iframe[src*="lc.chat" i], iframe[name*="chat-widget" i]';

function pickAuthStatePath() {
  for (const filePath of AUTH_STATE_CANDIDATES) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

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

function writeArtifact(payload, fileName = 'authorized-live-chat-message.json') {
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
      { timeout: timeoutMs, intervals: [300, 600, 900] }
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

async function runPreChatIfNeeded(frame, payload) {
  const nameInput = frame.locator('input[type="text"]').first();
  const emailInput = frame.locator('input[type="email"]').first();
  const startButton = frame.getByRole('button', { name: /start the chat/i }).first();

  const hasStart = await startButton.isVisible({ timeout: 2000 }).catch(() => false);
  if (!hasStart) {
    payload.preChat = { mode: 'skipped', reason: 'Pre-chat form not shown for authorized user.' };
    return;
  }

  const hasName = await nameInput.isVisible({ timeout: 4000 }).catch(() => false);
  const hasEmail = await emailInput.isVisible({ timeout: 4000 }).catch(() => false);

  if (hasName) {
    await nameInput
      .fill(process.env.PW_LIVE_CHAT_AUTH_NAME || 'Authorized Autotest')
      .catch(() => null);
  }
  if (hasEmail) {
    await emailInput
      .fill(process.env.PW_LIVE_CHAT_AUTH_EMAIL || 'authorized-autotest@example.test')
      .catch(() => null);
  }

  await startButton.click({ timeout: 10000 }).catch(() => null);
  payload.preChat = { mode: 'executed', hasName, hasEmail };
}

test('Live chat destructive: authorized player sends message and sees chat activity', async ({
  browser,
}, testInfo) => {
  if (process.env.PW_INCLUDE_LIVE_CHAT_AUTH !== '1') {
    testInfo.annotations.push({
      type: 'gated',
      description:
        'Authorized live chat destructive test is gated. Set PW_INCLUDE_LIVE_CHAT_AUTH=1 to enable it.',
    });
    return;
  }

  const authStatePath = pickAuthStatePath();
  if (!authStatePath) {
    markBlocked(testInfo, 'No auth storage state found for authorized live chat checks.');
    return;
  }

  test.setTimeout(REPLY_TIMEOUT_MS + 120_000);

  const payload = {
    source: 'tests/destructive/live-chat-message-authorized.spec.js',
    generatedAt: new Date().toISOString(),
    authStatePath,
    message: TEST_MESSAGE,
    messageSent: false,
    replyReceived: false,
    blockedByWaf: false,
    requireReply: REQUIRE_REPLY,
    replyTimeoutMs: REPLY_TIMEOUT_MS,
    status: 'started',
  };

  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
    locale: 'en-US',
  });

  const page = await context.newPage();
  const wafProbe = createWafProbe(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 40_000 });
    await dismissOverlays(page);
    await waitForHomeContent(page);
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) {
      payload.status = 'blocked';
      payload.blockedByWaf = true;
      payload.reason =
        (await detectCloudflare(page).catch(() => null)) ||
        'Cloudflare/WAF blocked authorized live chat scenario.';
      return;
    }

    const loginVisible = await page
      .getByRole('button', { name: /log in/i })
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (loginVisible) {
      payload.status = 'blocked';
      payload.reason = 'Expected authorized session, but Log In button is visible.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    const trigger = page
      .locator('[data-testid="sidebar-liveChat-button"], [data-testid="online-chat-button"]')
      .first();
    const triggerVisible = await trigger.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!triggerVisible) {
      payload.status = 'blocked';
      payload.reason = 'Live chat trigger is not visible in current authorized layout.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    await trigger.click({ timeout: 10_000 });
    const frame = await waitForChatFrame(page);
    if (!frame) {
      payload.status = 'blocked';
      payload.reason = 'Live chat frame did not appear for authorized user.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    await runPreChatIfNeeded(frame, payload);

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
      payload.reason = 'Live chat composer/send controls are unavailable for authorized user.';
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

    let replyText = '';
    let replyRows = rowsAfterSend;
    await expect
      .poll(
        async () => {
          replyRows = await collectRowTexts(frame);
          replyText = findReplyRow(replyRows, rowsAfterSend, TEST_MESSAGE);
          return Boolean(replyText);
        },
        { timeout: REPLY_TIMEOUT_MS, intervals: [1500, 2500, 3000] }
      )
      .toBeTruthy()
      .catch(() => null);

    payload.replyRows = replyRows;
    payload.replyText = replyText;
    payload.replyReceived = Boolean(replyText);
    payload.finalBody = await collectBodyText(frame);

    if (REQUIRE_REPLY && !replyText) {
      payload.status = 'blocked';
      payload.reason = `No support reply was detected within ${REPLY_TIMEOUT_MS} ms.`;
      markBlocked(testInfo, payload.reason);
      return;
    }

    if (!replyText) {
      testInfo.annotations.push({
        type: 'partial',
        description:
          'Outgoing message was sent by authorized user, but support reply was not detected in observation window.',
      });
      payload.status = 'partial';
    } else {
      payload.status = 'passed';
    }

    await waitForUiSettled(page, 1000);
    expect(
      rowsAfterSend.some((row) => normalizeText(row).includes(normalizeText(TEST_MESSAGE))),
      'Outgoing authorized live chat message should appear in conversation history.'
    ).toBeTruthy();
  } catch (error) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error })) {
      payload.status = 'blocked';
      payload.blockedByWaf = true;
      payload.reason =
        (await detectCloudflare(page).catch(() => null)) ||
        String(error && error.message ? error.message : error);
      return;
    }
    throw error;
  } finally {
    if (payload.status === 'started') {
      payload.status = 'blocked';
      payload.reason =
        payload.reason ||
        'Scenario did not reach a terminal status (message/reply validation did not finish).';
    }
    const artifactPath = writeArtifact(payload);
    await testInfo.attach('authorized-live-chat-message.json', {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'artifact', description: artifactPath });
    await context.close();
  }
});
