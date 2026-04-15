const baseUrlRaw = process.env.BASE_URL || 'https://gt.bet';
const baseUrl = baseUrlRaw.endsWith('/') ? baseUrlRaw.slice(0, -1) : baseUrlRaw;

module.exports = {
  ci: {
    collect: {
      numberOfRuns: 1,
      settings: {
        chromeFlags:
          '--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --no-zygote',
      },
      url: [`${baseUrl}/`, `${baseUrl}/casino/`, `${baseUrl}/live-casino/`, `${baseUrl}/sports/`],
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.3 }],
        'categories:accessibility': ['warn', { minScore: 0.8 }],
        'categories:best-practices': ['warn', { minScore: 0.75 }],
        'categories:seo': ['warn', { minScore: 0.75 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './artifacts/lighthouse',
    },
  },
};
