import test from "node:test";
import assert from "node:assert/strict";
import { canTrigger, evaluateAlert } from "../src/server/evaluator.js";

test("price crossing rules only match after the threshold is crossed", () => {
  const alert = { metric: "last_price", operator: "crosses_above", target: 300, lastValue: 299 };
  assert.equal(evaluateAlert(alert, { last_price: 301 }).matches, true);
  assert.equal(evaluateAlert({ ...alert, lastValue: 301 }, { last_price: 302 }).matches, false);
});

test("all supported quote metrics can be evaluated", () => {
  const quote = { last_price: 301, percent_change: 2.4, change: 7.1, volume: 900000, oi: 45000 };
  const cases = [
    ["last_price", "above", 300],
    ["percent_change", "at_or_above", 2.4],
    ["change", "below", 8],
    ["volume", "at_or_above", 900000],
    ["oi", "crosses_below", 50000, 51000]
  ];

  for (const [metric, operator, target, lastValue] of cases) {
    assert.equal(evaluateAlert({ metric, operator, target, lastValue }, quote).matches, true, metric);
  }
});

test("cooldown prevents duplicate notifications until it expires", () => {
  const now = Date.now();
  const alert = { cooldownMinutes: 15, lastTriggeredAt: new Date(now - 5 * 60 * 1000).toISOString() };
  assert.equal(canTrigger(alert, now), false);
  assert.equal(canTrigger({ ...alert, lastTriggeredAt: new Date(now - 16 * 60 * 1000).toISOString() }, now), true);
});
