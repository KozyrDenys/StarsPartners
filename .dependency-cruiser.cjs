module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make runners and helpers difficult to initialize safely.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'runtime-does-not-import-test-suites',
      severity: 'error',
      from: { path: '^(scripts|analyze)(/|$)' },
      to: { path: '^tests/(?!helpers/)' },
    },
    {
      name: 'helpers-do-not-import-test-suites',
      severity: 'error',
      from: { path: '^tests/helpers/' },
      to: { path: '^tests/(critical|destructive|smoke|visual|localization|ai)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)node_modules/' },
    moduleSystems: ['cjs', 'es6'],
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
