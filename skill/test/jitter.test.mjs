import assert from "node:assert/strict";
import { test } from "node:test";

import { slotHeld, freeSlotTimes } from "../scripts/daily.mjs";
import { SCHEDULE_JITTER_MIN_SEC, SCHEDULE_JITTER_MAX_SEC, applyPublishJitter } from "../scripts/publish.mjs";

const BASE = "2030-01-01T10:00:00.000Z";

test("jitter is a whole number of seconds from 120 through 600 inclusive", () => {
  const t0 = Date.parse(BASE);
  assert.equal(SCHEDULE_JITTER_MIN_SEC, 120);
  assert.equal(SCHEDULE_JITTER_MAX_SEC, 600);
  assert.equal(Date.parse(applyPublishJitter(BASE, { random: () => 0 })) - t0, 120_000);
  assert.equal(Date.parse(applyPublishJitter(BASE, { random: () => 0.999999 })) - t0, 600_000);
  assert.equal(Date.parse(applyPublishJitter(BASE, { random: () => 1 })) - t0, 600_000);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const delay = Date.parse(applyPublishJitter(BASE)) - t0;
    assert.ok(delay >= 120_000 && delay <= 600_000 && delay % 1000 === 0, String(delay));
    seen.add(delay);
  }
  assert.ok(seen.size > 10, `spread too narrow: ${seen.size}`);
});

test("a missing or invalid time is left alone", () => {
  assert.equal(applyPublishJitter(undefined), undefined);
  assert.equal(applyPublishJitter(""), "");
  assert.equal(applyPublishJitter("not-a-date"), "not-a-date");
});

test("a post up to 600s after a slot still holds it", () => {
  const slot = Date.parse("2026-10-07T05:30:00.000Z");
  assert.equal(slotHeld(slot, new Set([slot])), true);
  assert.equal(slotHeld(slot, new Set([slot + 120_000])), true);
  assert.equal(slotHeld(slot, new Set([slot + 600_000])), true);
  assert.equal(slotHeld(slot, new Set([slot + 601_000])), false);
  assert.equal(slotHeld(slot, new Set([slot - 1])), false);
  const taken = new Set([slot + 137_000]);
  assert.deepEqual(
    freeSlotTimes(["07:30", "13:00"], "+02:00", { from: new Date("2026-10-06T19:00:00Z"), taken }),
    ["2026-10-07T11:00:00.000Z"],
  );
});
