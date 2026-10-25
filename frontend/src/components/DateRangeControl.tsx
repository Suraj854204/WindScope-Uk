import { addDays } from '@/lib/time'
import { useFilters } from '@/state/filters'
import { Button } from './ui/Button'
import { TextField } from './ui/Field'

/** Date range (London delivery dates) shared by every page; restricted to the analysis period. */
export function DateRangeControl() {
  const { dateFrom, dateTo, bounds, setDateRange } = useFilters()
  const presets = [
    { label: 'Full period', from: bounds.min, to: bounds.max },
    {
      label: 'First half',
      from: bounds.min,
      to: addDays(bounds.min, 14) > bounds.max ? bounds.max : addDays(bounds.min, 14),
    },
    {
      label: 'Second half',
      from: addDays(bounds.min, 15) > bounds.max ? bounds.max : addDays(bounds.min, 15),
      to: bounds.max,
    },
    {
      label: 'Last 7 days',
      from: addDays(bounds.max, -6) < bounds.min ? bounds.min : addDays(bounds.max, -6),
      to: bounds.max,
    },
  ]
  return (
    <div className="flex flex-wrap items-end gap-3">
      <TextField
        label="From (delivery date)"
        type="date"
        min={bounds.min}
        max={dateTo}
        value={dateFrom}
        onChange={(e) => e.target.value && setDateRange(e.target.value, dateTo)}
        wrapperClassName="w-40"
      />
      <TextField
        label="To (delivery date)"
        type="date"
        min={dateFrom}
        max={bounds.max}
        value={dateTo}
        onChange={(e) => e.target.value && setDateRange(dateFrom, e.target.value)}
        wrapperClassName="w-40"
      />
      <div className="flex flex-wrap gap-1.5 pb-px" role="group" aria-label="Date range presets">
        {presets.map((p) => (
          <Button
            key={p.label}
            size="sm"
            className="h-9"
            onClick={() => setDateRange(p.from, p.to)}
            aria-pressed={dateFrom === p.from && dateTo === p.to}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
