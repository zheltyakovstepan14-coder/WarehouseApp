const assert = require('assert');

process.env.JWT_SECRET = 'test-secret';
process.env.PORT = '4010';
process.env.AUTO_CREATE_SCHEMA = 'false';
process.env.AUTO_SEED_DATA = 'true';

const {
  config,
  parseEnvFile,
  getBooleanEnv,
  getNumberEnv
} = require('../config/app-config');

assert.deepStrictEqual(
  parseEnvFile('A=1\nB = two\n# comment\nC=\"three four\"'),
  { A: '1', B: 'two', C: 'three four' }
);

assert.strictEqual(getBooleanEnv('AUTO_CREATE_SCHEMA', true), false);
assert.strictEqual(getBooleanEnv('AUTO_SEED_DATA', false), true);
assert.strictEqual(getNumberEnv('PORT', 3002), 4010);

assert.strictEqual(config.auth.jwtSecret, 'test-secret');
assert.strictEqual(config.port, 4010);
assert.strictEqual(config.startup.autoCreateSchema, false);
assert.strictEqual(config.startup.autoSeed, true);

console.log('app-config test passed');
