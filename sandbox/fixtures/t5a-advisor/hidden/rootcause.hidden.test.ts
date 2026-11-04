import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
test('an override does not leak into later calls', () => {
  loadConfig({ TALLY_TAX_RATE: '0' });
  loadConfig({ TALLY_CURRENCY: 'USD' });
  assert.equal(loadConfig({}).taxRate, 0.2);
  assert.equal(loadConfig({}).currency, 'EUR');
});
