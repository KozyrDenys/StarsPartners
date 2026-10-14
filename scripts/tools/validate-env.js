#!/usr/bin/env node

const { loadProjectEnv } = require('../lib/env');

const result = loadProjectEnv();
console.log(`Environment is valid (${result.loaded ? result.filePath : 'no .env file found'}).`);
