import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('defaults apply when nothing is set', () => {
  assert.equal(loadConfig({}).taxRate, 0.2);
  assert.equal(loadConfig({}).currency, 'EUR');
});

test('env overrides the tax rate', () => {
  assert.equal(loadConfig({ TALLY_TAX_RATE: '0.25' }).taxRate, 0.25);
});
