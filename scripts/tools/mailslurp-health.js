#!/usr/bin/env node

const { Configuration, InboxControllerApi } = require('mailslurp-client');

async function main() {
  const apiKey = String(process.env.MAILSLURP_API_KEY || '').trim();
  if (!apiKey) {
    console.error('Missing MAILSLURP_API_KEY');
    process.exit(2);
  }

  const config = new Configuration({ apiKey });
  const inboxApi = new InboxControllerApi(config);
  const page = await inboxApi.getAllInboxes({ page: 0, size: 1 }).catch((error) => {
    throw new Error(
      `MailSlurp API request failed: ${error && error.message ? error.message : String(error)}`
    );
  });

  const total = Number(
    page && typeof page.totalElements !== 'undefined' ? page.totalElements : 0
  );
  const latest = Array.isArray(page && page.content) && page.content.length > 0 ? page.content[0] : null;

  console.log(`MailSlurp OK: inboxes=${total}`);
  if (latest) {
    console.log(`Latest inbox: ${latest.emailAddress || latest.id || 'unknown'}`);
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
