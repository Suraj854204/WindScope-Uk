import type { ReactNode } from 'react'
import { useConfig } from '@/api/hooks'
import { PageHeader } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/Skeleton'
import { METRIC_DEFINITIONS } from '@/lib/definitions'
import { ALL_REASONS, REASON_HELP, REASON_LABEL } from '@/lib/reasons'
import { formatDateRange } from '@/lib/time'

const SECTIONS = [
  ['purpose', 'What this app answers'],
  ['sources', 'Source datasets'],
  ['vintage', 'Forecast vintage selection'],
  ['cutoff', 'The decision cutoff (assumption)'],
  ['time', 'Timestamps, timezone and daylight saving'],
  ['matching', 'Matching and deduplication'],
  ['exclusions', 'Missing data and exclusions'],
  ['metrics', 'Metrics and formulas'],
  ['facts', 'Data facts vs derived metrics'],
  ['limits', 'Limitations'],
  ['repro', 'Reproducibility'],
] as const

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-24 border-t border-line pt-6 first:border-0 first:pt-0"
    >
      <h2 id={`${id}-h`} className="text-base font-semibold text-ink-900">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink-700 [&_code]:rounded [&_code]:bg-canvas-sunken [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[13px] [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink-900">
        {children}
      </div>
    </section>
  )
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="scroll-thin overflow-x-auto rounded-md border border-line bg-navy-900 px-3 py-2.5 font-mono text-[13px] text-cyan-300">
      {children}
    </pre>
  )
}

export function MethodologyPage() {
  const { data: cfg, isPending } = useConfig()
  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden lg:block">
        <ul className="sticky top-20 space-y-1 text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block rounded px-2 py-1 text-ink-600 transition-colors hover:bg-canvas-sunken hover:text-ink-900"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 max-w-3xl space-y-6 pb-10">
        <PageHeader
          title="Methodology"
          description="Exactly how the numbers on every page are produced, in plain English."
        />

        <Section id="purpose" title="What this app answers">
          <p>
            A day-ahead trading team buys power before delivery using the wind forecast available{' '}
            <em>at that moment</em>. This app asks:{' '}
            <strong>
              how far was the latest wind forecast available at the purchase decision from what actually
              happened?
            </strong>{' '}
            It measures forecast error between the latest WINDFOR forecast available at the decision cutoff
            and actual national wind generation (FUELHH, WIND) for{' '}
            {cfg ? formatDateRange(cfg.period.date_from, cfg.period.date_to) : 'the analysis period'}.
          </p>
          <p>
            <strong>
              It assesses wind-forecast uncertainty. It does not calculate additional electricity procurement
            </strong>
            , because that needs demand and market-price data, which are deliberately out of scope. No demand,
            price, thermal or other external dataset is used.
          </p>
        </Section>

        <Section id="sources" title="Source datasets">
          <ul>
            <li>
              <strong>FUELHH</strong> (Elexon): half-hourly generation outturn by fuel type. Only records with{' '}
              <code>fuelType = WIND</code> are used (also re-checked in the app, so any other fuel type is
              discarded). This is the <em>actual</em>, in MW.
            </li>
            <li>
              <strong>WINDFOR</strong> (Elexon): wind generation forecasts. Each record has a{' '}
              <code>startTime</code> (the delivery half-hour), a <code>publishTime</code> (when that forecast
              version was published) and a generation value in MW. Many versions exist for the same delivery
              time.
            </li>
          </ul>
          <p>
            Data is downloaded from the Elexon <code>/datasets/FUELHH/stream</code> and{' '}
            <code>/datasets/WINDFOR/stream</code> endpoints in small date windows, with throttling, retries
            with backoff (honouring <code>Retry-After</code>), timeouts and a size cap. Each successful
            response is cached on disk, so the analysis is reproducible and restarts do not re-download.
            Failed windows are reported, never hidden or filled in.
          </p>
        </Section>

        <Section id="vintage" title="Forecast vintage selection">
          <p>
            For each delivery half-hour <code>startTime</code> the app picks{' '}
            <strong>the latest WINDFOR record whose publishTime is at or before the decision cutoff</strong>.
            Forecasts published after the cutoff are never used, even though they would be more accurate,
            because the trader could not have seen them.
          </p>
          <ul>
            <li>
              The cutoff comparison is inclusive: a forecast published exactly at the cutoff is eligible.
            </li>
            <li>
              If the latest eligible forecast has no usable value, the interval is excluded. The app does{' '}
              <strong>not</strong> fall back to an older version, since the rule is “latest available at
              decision time”.
            </li>
            <li>
              A forecast with no publishTime is dropped: we cannot prove it was available, so we never assume
              it was.
            </li>
            <li>
              Open any interval in the Forecast Explorer to see every vintage considered and which one was
              selected.
            </li>
          </ul>
        </Section>

        <Section id="cutoff" title="The decision cutoff (assumption)">
          <p>
            <strong>
              The exact purchase-decision cutoff has not been specified by the client, so this is an
              assumption.
            </strong>{' '}
            The default is{' '}
            <strong>
              {isPending
                ? '…'
                : (cfg?.default_cutoff.description ?? '09:00 Europe/London on the day before delivery')}
            </strong>
            : a conservative proxy for a day-ahead process, chosen to sit before typical day-ahead auction
            gate closures. Confirm the real time with your trading desk.
          </p>
          <p>
            The cutoff is configurable from the header. Two modes exist: <em>day-ahead clock time</em> (a
            London clock time N days before the delivery date) and <em>fixed lead time</em> (N hours before
            each interval starts). The Accuracy Analysis page shows how sensitive the results are to this
            choice.
          </p>
          <p>
            Day-ahead cutoffs are computed from the London calendar, so “09:00 on D-1” stays 09:00 local time
            across clock changes, even though its UTC instant shifts by an hour. Ambiguous local times (clocks
            going back) use the first occurrence; non-existent ones (clocks going forward) use the pre-change
            offset.
          </p>
        </Section>

        <Section id="time" title="Timestamps, timezone and daylight saving">
          <ul>
            <li>
              Every timestamp is normalised to UTC for matching. Display is Europe/London (GMT/BST) or UTC,
              switchable in the header; hover a time to see the UTC instant.
            </li>
            <li>Timestamps without an offset are assumed to be UTC and counted as an alignment issue.</li>
            <li>
              The expected grid is every half-hour of each London delivery day: normally 48, but{' '}
              <strong>46</strong> on the spring-forward day and <strong>50</strong> on the autumn-back day.
              January 2026 has no clock change, so London time equals UTC throughout.
            </li>
            <li>
              A <code>startTime</code> not on a :00 or :30 boundary cannot be matched and is dropped (and
              counted).
            </li>
            <li>
              Actuals carry a settlement date and period. The app recomputes them from <code>startTime</code>{' '}
              and reports any disagreement; <code>startTime</code> stays authoritative.
            </li>
          </ul>
        </Section>

        <Section id="matching" title="Matching and deduplication">
          <p>
            Actuals and selected forecasts are matched on the identical UTC half-hour start. Only intervals
            with both a valid actual and a valid forecast are “matched” and enter the metrics.
          </p>
          <p>
            <strong>Actuals (FUELHH WIND), grouped by startTime:</strong>
          </p>
          <ul>
            <li>The record with the latest publishTime wins (a missing publishTime ranks lowest).</li>
            <li>
              If several records tie for the latest publishTime with different values, the interval is
              “conflicting” and excluded; the app does not guess.
            </li>
            <li>
              Identical duplicates collapse to one. Identical records returned by two adjacent download
              windows are collapsed first and counted separately.
            </li>
          </ul>
          <p>
            <strong>Forecasts (WINDFOR), grouped by startTime and publishTime:</strong>
          </p>
          <ul>
            <li>Identical duplicates collapse to one.</li>
            <li>
              Differing values for the same startTime and publishTime make that vintage ambiguous; if it is
              the selected vintage the interval is excluded.
            </li>
          </ul>
        </Section>

        <Section id="exclusions" title="Missing data and exclusions">
          <p>
            Missing data is never replaced by zero. An interval is excluded, and shown with its reason, when:
          </p>
          <ul>
            {ALL_REASONS.map((r) => (
              <li key={r}>
                <strong>{REASON_LABEL[r]}.</strong> {REASON_HELP[r]}
              </li>
            ))}
          </ul>
          <p>
            Coverage is matched intervals ÷ expected intervals. Sample size (n) is shown with every metric,
            and warnings appear when n is small (fewer than {cfg ? cfg.min_sample_warning : 48} intervals) or
            when a period is only partly covered.
          </p>
        </Section>

        <Section id="metrics" title="Metrics and formulas">
          <p>
            Errors are always <strong>forecast minus actual</strong>, in megawatts (MW). Generation values are
            half-hourly average MW as published by Elexon. All metrics use matched intervals only.
          </p>
          {METRIC_DEFINITIONS.map((d) => (
            <div key={d.key} className="space-y-1.5">
              <h3 className="text-sm font-semibold text-ink-900">
                {d.name} <span className="font-normal text-ink-600">· {d.unit}</span>
              </h3>
              <Formula>{d.formula}</Formula>
              <p>{d.plain}</p>
              {d.caution && <p className="text-warn-700">{d.caution}</p>}
            </div>
          ))}
          <p>
            <strong>WAPE guard:</strong> WAPE is shown only when the mean actual generation of the matched
            sample is at least{' '}
            <strong>{cfg ? `${cfg.wape_min_mean_actual_mw} MW` : 'the configured minimum'}</strong>. Otherwise
            it displays “n/a” with the reason. The app never computes per-interval percentage errors, because
            actual wind output can be zero or near zero.
          </p>
          <p>
            Percentiles use linear interpolation. Weekly aggregation uses Monday–Sunday London weeks; weeks
            cut by the selected dates are labelled “partial”.
          </p>
        </Section>

        <Section id="facts" title="Data facts vs derived metrics">
          <ul>
            <li>
              <strong>Data facts</strong> come straight from Elexon: actual MW, forecast MW, startTime,
              publishTime, record counts, and “latest source publishTime”.
            </li>
            <li>
              <strong>Derived values</strong> are computed by this app: selected vintage, signed/absolute
              error, MAE, RMSE, bias, WAPE, coverage, exclusions.
            </li>
            <li>
              <strong>Retrieval time</strong> (when this app downloaded data) is different from{' '}
              <strong>source publication time</strong> (publishTime inside the records). Data Quality shows
              both.
            </li>
          </ul>
        </Section>

        <Section id="limits" title="Limitations">
          <ul>
            <li>
              The cutoff is an assumption (see above). Results change with it, so check the sensitivity view.
            </li>
            <li>
              FUELHH WIND and WINDFOR may not cover exactly the same set of wind generation (for example
              embedded versus transmission-connected). This app does not verify that, so part of the bias
              could reflect definition differences rather than forecast skill.
            </li>
            <li>
              Actuals are taken as they stand at retrieval time, including any later revisions, which is the
              right basis for judging forecasts after the fact.
            </li>
            <li>
              Live WINDFOR data is hourly (every startTime is on the hour) while FUELHH is half-hourly, so the
              :30 half-hours have no forecast of their own. They are excluded with the reason &quot;Forecast
              is hourly only&quot; and never interpolated or copied from the hour before. Coverage is
              therefore about 50% by construction. Any other unmatched half-hours are excluded the same way
              (see the resolution check on Data Quality).
            </li>
            <li>
              One month is a short sample: weather regimes in the month will dominate, and nothing here
              explains why a given error happened.
            </li>
            <li>No demand, price or procurement quantity is modelled, so no financial outcome is implied.</li>
          </ul>
        </Section>

        <Section id="repro" title="Reproducibility">
          {isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <ul>
              <li>
                Analysis period:{' '}
                <strong>{cfg ? formatDateRange(cfg.period.date_from, cfg.period.date_to) : '—'}</strong>{' '}
                (London delivery dates, {cfg?.period.expected_intervals ?? '—'} expected intervals).
              </li>
              <li>
                Default cutoff: <strong>{cfg?.default_cutoff.description ?? '—'}</strong>. Data source:{' '}
                <code>{cfg?.api_base_url ?? '—'}</code>. App version {cfg?.version ?? '—'}.
              </li>
              <li>
                Downloaded responses are cached on disk and reused, so the same cached data and the same
                cutoff always give identical numbers.
              </li>
              <li>
                To reproduce from scratch: start the stack (see the README), open Data Quality and press
                “Force full re-download”, then compare. The exported CSV on the Forecast Explorer contains
                every interval, its selected forecast publishTime and the cutoff used.
              </li>
              <li>
                The API contract is published at <code>/docs</code> (OpenAPI) on the backend.
              </li>
            </ul>
          )}
        </Section>
      </article>
    </div>
  )
}
