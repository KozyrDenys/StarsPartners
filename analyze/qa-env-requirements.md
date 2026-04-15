# Test Environment Requirements

**Purpose**
Provide stable conditions for UI automation on `https://gt.bet/` (or a staging mirror) without WAF false negatives.

**Access & Security**

- Allowlist automation IPs or provide a dedicated environment without Cloudflare/WAF challenges.
- If WAF must stay, provide a stable bypass (turnstile test keys or automation allowlist rules).
- Disable geo-blocking for the automation IPs (or document allowed regions).

**Frontend Resources**

- Ensure `/_nuxt/*` JS/CSS/fonts are accessible without 403 for automation sessions.
- Ensure static assets (images/fonts) are served with correct MIME types (no HTML fallback).

**API Availability**

- All `/api/*` endpoints needed by the homepage and registration must be reachable (no 403/blocked).
- Provide predictable responses for:
  - Home page data (banners, games lists, nav content).
  - Registration endpoints.

**Test Data**

- Allow creation of new player accounts with predictable rules.
- Provide a cleanup/reset policy or a test-only domain/email aliasing rules.
- If phone/SMS is mandatory, provide a test stub or a bypass (e.g., fixed phone + no OTP).

**Environment Variables**

- `BASE_URL` for target domain.
- `PW_STORAGE_STATE` for stored session when needed.
- `PW_USE_CHROME_CHANNEL=1` for real Chrome (reduces WAF flags).
- `PW_PRECHECK_SOFT=1` when running diagnostics in blocked environments.

**Stability & Observability**

- Stable deploy windows or release notes when UI changes significantly.
- Access to logs for failed signup or blocked requests (optional but recommended).
