import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, localAt, localClock, localDay, offsetOf } from "../scripts/tz.mjs";
import * as round from "../scripts/round.mjs";

// Rome: +02:00 until 03:00 on 25 October 2026, +01:00 after; +01:00 → +02:00 on 29 March 2026

test("an IANA zone reads each instant at its own offset: DST moves the clock", () => {
  assert.equal(localClock("2026-10-21T07:00:00Z", "Europe/Rome"), "09:00");
  assert.equal(localClock("2026-10-26T06:00:00Z", "Europe/Rome"), "07:00");
  assert.equal(localClock("2026-10-25T00:30:00Z", "Europe/Rome"), "02:30");
  assert.equal(localClock("2026-10-25T01:30:00Z", "Europe/Rome"), "02:30");
  assert.equal(offsetOf("Europe/Rome", Date.parse("2026-10-24T12:00:00Z")), 2 * 3600_000);
  assert.equal(offsetOf("Europe/Rome", Date.parse("2026-10-26T12:00:00Z")), 3600_000);
});

test("UTC and fixed offsets keep their clock all year", () => {
  assert.equal(localClock("2026-10-21T07:00:00Z", "Z"), "07:00");
  assert.equal(localClock("2026-10-26T06:00:00Z", "Z"), "06:00");
  assert.equal(localClock("2026-10-21T07:00:00Z", "+02:00"), "09:00");
  assert.equal(localClock("2026-10-26T06:00:00Z", "+02:00"), "08:00");
  assert.equal(localClock("2026-10-26T06:00:00Z", "-05:00"), "01:00");
  assert.equal(localClock("2026-10-21T09:00:00+02:00", "Z"), "07:00");
});

test("a missing or broken time reads as ? and never throws", () => {
  for (const tz of ["Europe/Rome", "Z", "+02:00"]) {
    for (const iso of [null, undefined, "", "soon", "2026-13-45T99:00:00Z"]) assert.equal(localClock(iso, tz), "?", `${tz} ${iso}`);
  }
  assert.equal(localClock("2026-10-21T07:00:00Z", "+2"), "?");
});

test("calendar days step by date, not by 24 hours", () => {
  assert.equal(addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  // 00:30 on the 25-hour day: 24 hours on is still 25 October
  assert.equal(localDay(Date.parse("2026-10-24T22:30:00Z") + 86400_000, "Europe/Rome"), "2026-10-25");
  assert.equal(new Date(localAt("2026-10-25", "07:00", "Europe/Rome")).toISOString(), "2026-10-25T06:00:00.000Z");
  assert.equal(new Date(localAt("2026-10-24", "07:00", "Europe/Rome")).toISOString(), "2026-10-24T05:00:00.000Z");
  assert.equal(new Date(localAt("2026-03-29", "07:30", "Europe/Rome")).toISOString(), "2026-03-29T05:30:00.000Z");
});

test("round still exports the clock helpers it always had", () => {
  for (const name of ["offsetOf", "localDay", "localAt", "localLabel"]) assert.equal(typeof round[name], "function", name);
  const cfg = { tz: "Europe/Rome", freshness: "next-day" };
  // a story at 00:30 on the 25-hour day: its deadline is the end of 26 October, not of the 25th
  assert.equal(new Date(round.storyDeadline(cfg, "2026-10-24T22:30:00Z")).toISOString(), "2026-10-26T22:59:00.000Z");
});
