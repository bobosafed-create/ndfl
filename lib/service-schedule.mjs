const MOSCOW_WEEKDAYS = {
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
};

const MOSCOW_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Moscow",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function minutesFromClock(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isServiceOpen(schedule, now = new Date()) {
  if (!Array.isArray(schedule) || Number.isNaN(now.getTime())) return false;
  const parts = Object.fromEntries(MOSCOW_CLOCK.formatToParts(now).map(({ type, value }) => [type, value]));
  const day = MOSCOW_WEEKDAYS[parts.weekday];
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const entry = schedule.find((item) => item?.day === day);
  const startMinutes = minutesFromClock(entry?.start);
  const endMinutes = minutesFromClock(entry?.end);
  return entry?.enabled === true
    && startMinutes !== null
    && endMinutes !== null
    && startMinutes < endMinutes
    && currentMinutes >= startMinutes
    && currentMinutes < endMinutes;
}
