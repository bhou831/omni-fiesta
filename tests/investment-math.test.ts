import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investmentPayout } from '../src/server/games/investment-math.js';

test('investment returns use exact decimal arithmetic and cap losses at principal', () => {
  assert.equal(investmentPayout(600, 20, '100', '101'), 720);
  assert.equal(investmentPayout(600, 20, '100', '99'), 480);
  assert.equal(investmentPayout(600, 20, '100', '95'), 0);
  assert.equal(investmentPayout(600, 20, '100', '92'), 0);
  assert.equal(investmentPayout(600, 20, '0.00000001', '1.01e-8'), 720);
  assert.equal(investmentPayout(1, 20, '3', '3.01'), 1);
});

test('investment payout rejects invalid prices and unsafe amounts', () => {
  for (const price of ['0', '-1', 'NaN', 'Infinity', '1e999'])
    assert.throws(() => investmentPayout(600, 20, price, '1'));
  assert.throws(() => investmentPayout(600, 20, '1', '1e100'));
  assert.throws(() => investmentPayout(0, 20, '1', '1'));
});
