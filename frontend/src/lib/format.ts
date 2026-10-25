/** Number/ratio formatting. `null`/`undefined` always renders as an em dash - never as 0. */

export const MISSING = '—'

const intFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const oneDp = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDp = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatInt(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? MISSING : intFmt.format(v)
}

export function formatMw(v: number | null | undefined, decimals: 0 | 1 = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return MISSING
  return decimals === 0 ? intFmt.format(v) : oneDp.format(v)
}

/** Signed value with an explicit sign and a true minus (U+2212): "+12.5" / "−7.0". */
export function formatSignedMw(v: number | null | undefined, decimals: 0 | 1 = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return MISSING
  const body = (decimals === 0 ? intFmt : oneDp).format(Math.abs(v))
  if (v > 0) return `+${body}`
  if (v < 0) return `−${body}`
  return body
}

/** Ratio (0..1) as a percentage. */
export function formatPercent(ratio: number | null | undefined, decimals = 1): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return MISSING
  return `${(decimals === 0 ? intFmt : decimals === 2 ? twoDp : oneDp).format(ratio * 100)}%`
}

export type BiasDirectionLabel = 'over-forecast' | 'under-forecast' | 'no net bias'

export function biasDirection(bias: number | null | undefined): BiasDirectionLabel | null {
  if (bias === null || bias === undefined) return null
  if (bias > 0) return 'over-forecast'
  if (bias < 0) return 'under-forecast'
  return 'no net bias'
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatInt(n)} ${n === 1 ? singular : pluralForm}`
}
