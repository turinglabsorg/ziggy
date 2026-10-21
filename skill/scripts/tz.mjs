/**
 * The tenant's clock. `tz` is a fixed offset ("+02:00", "-05:00", "Z") or an IANA name
 * ("Europe/Rome"): an IANA zone's offset depends on the instant, so DST moves the clock.
 * No imports — round, daily and report all read local time from here.
 */

const isIANATz = (tz) => tz && !tz.startsWith("+") && !tz.startsWith("-") && tz !== "Z";

/**
 * Get UTC offset in milliseconds for a timezone at a specific time.
 * Supports both fixed offsets ("+02:00", "Z") and IANA names ("Europe/Rome").
 */
export const offsetOf = (tz, atMs = Date.parse("2000-01-01T00:00:00Z")) => {
  if (isIANATz(tz)) {
    // IANA timezone: use Intl to get DST-correct offset
    const utcDate = new Date(atMs);
    const tzDate = new Date(utcDate.toLocaleString("en-US", { timeZone: tz }));
    const utcMs = Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate(),
                           utcDate.getUTCHours(), utcDate.getUTCMinutes(), utcDate.getUTCSeconds());
    const tzMs = Date.UTC(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(),
                          tzDate.getHours(), tzDate.getMinutes(), tzDate.getSeconds());
    return tzMs - utcMs;
  }
  // Fixed offset: "+02:00", "-05:00", "Z"
  return Date.parse("2000-01-01T00:00:00Z") - Date.parse(`2000-01-01T00:00:00${tz}`);
};

/**
 * Get the local date (YYYY-MM-DD) at a given UTC timestamp in a timezone.
 * Supports both fixed offsets and IANA names with DST.
 */
export const localDay = (ms, tz) => {
  if (isIANATz(tz)) {
    return new Date(ms).toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
  }
  return new Date(ms + offsetOf(tz)).toISOString().slice(0, 10);
};

/** A calendar date `n` days on: the day of a DST change is 23 or 25 hours long, not 24. */
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/**
 * Parse a local time (day + HH:MM) in a timezone to UTC milliseconds.
 * Supports both fixed offsets and IANA names with DST.
 */
export const localAt = (day, hm, tz) => {
  const time = hm.length === 5 ? `${hm}:00` : hm;
  if (isIANATz(tz)) {
    // the wall clock read as UTC, less the zone's offset at that moment
    const wall = Date.parse(`${day}T${time}Z`);
    return wall - offsetOf(tz, wall);
  }
  return Date.parse(`${day}T${time}${tz}`);
};

/** "HH:MM" on the tenant's clock for an ISO instant; "?" when there is no valid instant. */
export function localClock(iso, tz) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "?";
  const local = ms + offsetOf(tz, ms);
  return Number.isFinite(local) ? new Date(local).toISOString().slice(11, 16) : "?";
}

/** "16:00" today, "13/10 09:00" on another day — the operator reads local time. */
export function localLabel(ms, tz, now) {
  if (isIANATz(tz)) {
    const iso = new Date(ms).toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
                                                        hour: "2-digit", minute: "2-digit", hour12: false }).replace(", ", "T");
    const [date, time] = iso.split("T");
    return localDay(ms, tz) === localDay(now, tz) ? time : `${date.slice(8, 10)}/${date.slice(5, 7)} ${time}`;
  }
  const iso = new Date(ms + offsetOf(tz, ms)).toISOString();
  return localDay(ms, tz) === localDay(now, tz) ? iso.slice(11, 16) : `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}
