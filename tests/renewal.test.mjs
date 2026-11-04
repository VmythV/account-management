import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRenewal, renewalRule } from '../public/timeline.js';

const monthly = { status: 'active', renewalCycle: 'monthly', renewalDay: 31, renewalMonth: null };
const annual = { status: 'active', renewalCycle: 'yearly', renewalDay: 29, renewalMonth: 2 };

function check(event, now, expected, days) {
  const result = nextRenewal(event, new Date(...now));
  assert.deepEqual([result.date.getFullYear(), result.date.getMonth(), result.date.getDate()], expected);
  assert.equal(result.days, days);
}

test('monthly reminders include today, clamp month ends, and roll into the next month or year', () => {
  check(monthly, [2025, 1, 1, 12], [2025, 1, 28], 27);
  check(monthly, [2024, 1, 28, 23, 59], [2024, 1, 29], 1);
  check(monthly, [2025, 1, 28, 23, 59], [2025, 1, 28], 0);
  check(monthly, [2025, 2, 1], [2025, 2, 31], 30);
  check({ ...monthly, renewalDay: 15 }, [2025, 11, 16], [2026, 0, 15], 30);
  check({ ...monthly, renewalDay: 15 }, [2025, 0, 16], [2025, 1, 15], 30);
  assert.equal(renewalRule(monthly), '每月 31 日');
});

test('annual reminders handle February 29, today and year rollover', () => {
  check(annual, [2025, 1, 27], [2025, 1, 28], 1);
  check(annual, [2024, 1, 28], [2024, 1, 29], 1);
  check(annual, [2024, 1, 29, 23, 59], [2024, 1, 29], 0);
  check(annual, [2027, 2, 1], [2028, 1, 29], 365);
  check({ ...annual, renewalMonth: 1, renewalDay: 1 }, [2025, 11, 31], [2026, 0, 1], 1);
  assert.equal(renewalRule(annual), '每年 2 月 29 日');
});

test('countdowns use local calendar days, including daylight-saving boundaries', () => {
  check({ ...monthly, renewalDay: 10 }, [2026, 2, 7, 23, 59], [2026, 2, 10], 3);
  check({ ...monthly, renewalDay: 3 }, [2026, 9, 31, 23, 59], [2026, 10, 3], 3);
  check({ ...monthly, renewalDay: 16 }, [2026, 9, 15, 23, 59], [2026, 9, 16], 1);
  check({ ...monthly, renewalDay: 16 }, [2026, 9, 16, 0, 1], [2026, 9, 16], 0);
});

test('reminders are optional and only run for active or trial subscriptions', () => {
  assert.equal(nextRenewal(null), null);
  assert.equal(nextRenewal({ status: 'active' }), null);
  assert.equal(nextRenewal({ ...monthly, renewalCycle: 'none' }), null);
  for (const status of ['paused', 'cancelled', 'expired', 'banned']) assert.equal(nextRenewal({ ...monthly, status }), null);
  assert.ok(nextRenewal({ ...monthly, status: 'trial' }));
  assert.equal(renewalRule({ renewalCycle: 'none' }), '未设置');
});
