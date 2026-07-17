import test from "node:test";
import assert from "node:assert/strict";
import { createNotifier } from "../src/server/notifications/index.js";

test("notification health reports unconfigured channels without exposing secrets", () => {
  const notifier = createNotifier();
  const status = notifier.status();
  for (const channel of ["email", "telegram", "sms", "webhook"]) {
    assert.equal(status.channels[channel].state, "not_configured");
    assert.equal(status.channels[channel].configured, false);
    assert.ok(Array.isArray(status.channels[channel].requirements));
  }
});

test("testing an unconfigured channel returns a clear skipped result", async () => {
  const notifier = createNotifier();
  const result = await notifier.testChannel("email");
  assert.equal(result.delivery.skipped, true);
  assert.equal(result.status.state, "not_configured");
  assert.equal(result.status.lastTest.message, "Channel is not configured.");
});
