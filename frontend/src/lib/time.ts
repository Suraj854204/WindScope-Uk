/** Time display helpers. Stored instants are always UTC ISO strings; display is Europe/London or UTC. */

export type TimeZoneMode = 'Europe/London' | 'UTC'

const cache = new Map<string, Intl.DateTimeFormat>()

function fmt(tz: TimeZoneMode, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz}|${JSON.stringify(options)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...options })
    cache.set(key, f)
  }
  return f
}

function toDate(iso: string | number | null | undefined): Date | null {
  if (iso === null || iso === undefined) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "01 Jan 2026, 09:00 GMT" (London shows GMT/BST; UTC shows UTC). */
export function formatInstant(iso: string | number | null | undefined, tz: TimeZoneMode): string {
  const d = toDate(iso)
  if (!d) return '—'
  return fmt(tz, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
    .format(d)
    .replace(',', '')
}

/** "09:00" */
export function formatClock(iso: string | number | null | undefined, tz: TimeZoneMode): string {
  const d = toDate(iso)
  return d ? fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(d) : '—'
}

/** Zone abbreviation in effect at the instant: "GMT" / "BST" for London, "UTC" for UTC. */
export function zoneAbbr(iso: string | number | null | undefined, tz: TimeZoneMode): string {
  const d = toDate(iso)
  if (!d) return ''
  return (
    fmt(tz, { timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? ''
  )
}

/** Adds whole days to a YYYY-MM-DD string (calendar arithmetic, no timezone involved). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** "Thu 01 Jan" */
export function formatDay(iso: string | number | null | undefined, tz: TimeZoneMode): string {
  const d = toDate(iso)
  return d ? fmt(tz, { weekday: 'short', day: '2-digit', month: 'short' }).format(d).replace(',', '') : '—'
}

/** "01 Jan" */
export function formatShortDate(iso: string | number | null | undefined, tz: TimeZoneMode): string {
  const d = toDate(iso)
  return d ? fmt(tz, { day: '2-digit', month: 'short' }).format(d) : '—'
}

/** Local calendar date (YYYY-MM-DD) of an instant in the given zone. */
export function localDate(iso: string | number, tz: TimeZoneMode): string {
  const d = toDate(iso)
  if (!d) return ''
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** "01 Jan 2026" from a plain YYYY-MM-DD string (no timezone shifting). */
export function formatDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "01 – 31 Jan 2026" style range from YYYY-MM-DD strings. */
export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatDateOnly(from)
  const a = formatDateOnly(from).split(' ')
  const b = formatDateOnly(to).split(' ')
  if (a[1] === b[1] && a[2] === b[2]) return `${a[0]} – ${b[0]} ${b[1]} ${b[2]}`
  return `${formatDateOnly(from)} – ${formatDateOnly(to)}`
}

/**
 * Tick positions (epoch ms) for a time axis: the first point of each local calendar day, thinned to
 * roughly `maxTicks`. Based on local dates, so it stays correct across daylight-saving changes.
 */
export function dayTicks(times: number[], tz: TimeZoneMode, maxTicks = 8): number[] {
  const ticks: number[] = []
  let last = ''
  for (const t of times) {
    const d = localDate(t, tz)
    if (d !== last) {
      ticks.push(t)
      last = d
    }
  }
  const step = Math.max(1, Math.ceil(ticks.length / maxTicks))
  return ticks.filter((_, i) => i % step === 0)
}
