import test from "node:test";
import assert from "node:assert/strict";
import { isServiceOpen } from "../lib/service-schedule.mjs";

const schedule = [
  { day: "monday", enabled: true, start: "09:00", end: "13:00" },
  { day: "tuesday", enabled: false, start: "09:00", end: "13:00" },
  { day: "wednesday", enabled: false, start: "09:00", end: "13:00" },
  { day: "thursday", enabled: false, start: "09:00", end: "13:00" },
  { day: "friday", enabled: false, start: "09:00", end: "13:00" },
  { day: "saturday", enabled: false, start: "09:00", end: "13:00" },
  { day: "sunday", enabled: false, start: "09:00", end: "13:00" },
];

test("service opens at the configured start in Moscow", () => {
  assert.equal(isServiceOpen(schedule, new Date("2026-08-31T06:00:00Z")), true);
});

test("service closes exactly at the configured end in Moscow", () => {
  assert.equal(isServiceOpen(schedule, new Date("2026-08-31T10:00:00Z")), false);
});

test("service stays closed on a disabled day", () => {
  assert.equal(isServiceOpen(schedule, new Date("2026-09-01T07:00:00Z")), false);
});

test("malformed or missing schedule is closed by default", () => {
  assert.equal(isServiceOpen([], new Date("2026-08-31T07:00:00Z")), false);
  assert.equal(isServiceOpen([{ day: "monday", enabled: true, start: "13:00", end: "09:00" }], new Date("2026-08-31T07:00:00Z")), false);
});
