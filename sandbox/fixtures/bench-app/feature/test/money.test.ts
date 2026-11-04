import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, formatCents } from '../src/money.ts';

test('toCents parses whole and decimal amounts', () => {
  assert.equal(toCents('12'), 1200);
  assert.equal(toCents('12.3'), 1230);
  assert.equal(toCents('-0.05'), -5);
});

test('formatCents pads cents', () => {
  assert.equal(formatCents(1205), '12.05');
  assert.equal(formatCents(-5), '-0.05');
});
