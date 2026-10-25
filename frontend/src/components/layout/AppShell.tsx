import clsx from 'clsx'
import { BookOpenText, CalendarRange, Gauge, LayoutDashboard, Table2, TrendingUp, Wind } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { formatDateRange } from '@/lib/time'
import { useFilters } from '@/state/filters'
import { Segmented } from '../ui/Segmented'
import { CutoffControl } from './CutoffControl'
import { FreshnessStatus } from './FreshnessStatus'

export const NAV = [
  { to: '/', label: 'Overview', short: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/explorer', label: 'Forecast Explorer', short: 'Explorer', icon: Table2, end: false },
  { to: '/accuracy', label: 'Accuracy Analysis', short: 'Accuracy', icon: TrendingUp, end: false },
  { to: '/quality', label: 'Data Quality', short: 'Quality', icon: Gauge, end: false },
  { to: '/methodology', label: 'Methodology', short: 'Method', icon: BookOpenText, end: false },
] as const

function Sidebar() {
  return (
    <aside className="on-dark fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center border-r border-navy-700 bg-navy-950 md:flex">
      <div className="flex h-14 w-full items-center justify-center border-b border-navy-700">
        <div className="flex size-8 items-center justify-center rounded bg-navy-800 ring-1 ring-navy-600">
          <Wind className="size-4 text-cyan-400" aria-hidden />
        </div>
      </div>
      <nav aria-label="Primary" className="flex w-full flex-1 flex-col gap-1 px-1.5 py-3">
        {NAV.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            title={label}
            className={({ isActive }) =>
              clsx(
                'group relative flex flex-col items-center gap-1 rounded px-1 py-2 text-2xs font-medium transition-colors duration-100',
                isActive ? 'bg-navy-800 text-white' : 'text-navy-300 hover:bg-navy-800/60 hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute -left-1.5 top-2 h-[calc(100%-1rem)] w-0.5 rounded-r bg-cyan-400"
                  />
                )}
                <Icon
                  className={clsx('size-[18px]', isActive ? 'text-cyan-400' : 'group-hover:text-cyan-300')}
                  aria-hidden
                />
                <span aria-hidden>{short}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="on-dark fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-navy-700 bg-navy-950 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map(({ to, label, short, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={label}
          className={({ isActive }) =>
            clsx(
              'flex flex-col items-center gap-0.5 py-2 text-2xs font-medium',
              isActive ? 'text-cyan-400' : 'text-navy-300',
            )
          }
        >
          <Icon className="size-5" aria-hidden />
          <span aria-hidden>{short}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function Header() {
  const { dateFrom, dateTo, tz, setTz } = useFilters()
  return (
    <header className="on-dark sticky top-0 z-30 border-b border-navy-700 bg-navy-900 text-navy-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-5 md:min-h-14">
        <div className="mr-auto flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded bg-navy-800 ring-1 ring-navy-600 md:hidden">
            <Wind className="size-4 text-cyan-400" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-white">
              WindScope <span className="text-cyan-400">UK</span>
            </div>
            <div className="hidden text-2xs text-navy-300 sm:block">Day-ahead wind forecast accuracy</div>
          </div>
        </div>

        <div
          className="tnum inline-flex h-8 items-center gap-1.5 rounded border border-navy-600 bg-navy-800 px-2.5 text-xs font-medium text-navy-100"
          title="Analysis period (delivery dates, Europe/London)"
          aria-label={`Analysis period ${formatDateRange(dateFrom, dateTo)}`}
        >
          <CalendarRange className="size-3.5 text-cyan-400" aria-hidden />
          {formatDateRange(dateFrom, dateTo)}
        </div>

        <FreshnessStatus />

        <div
          className="flex items-center gap-2"
          title="Timestamps are stored in UTC and displayed in the selected timezone"
        >
          <span className="hidden text-2xs uppercase tracking-wider text-navy-300 lg:inline">Timezone</span>
          <Segmented
            label="Display timezone"
            size="sm"
            onDark
            value={tz}
            onChange={setTz}
            options={[
              { value: 'Europe/London', label: 'London' },
              { value: 'UTC', label: 'UTC' },
            ]}
          />
        </div>

        <CutoffControl />
      </div>
    </header>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  // Move keyboard/screen-reader focus to the new page's content on navigation.
  useEffect(() => {
    main.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only z-[60] rounded bg-white px-3 py-2 text-sm font-medium text-ink-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="md:pl-[72px]">
        <Header />
        <main
          id="main"
          ref={main}
          tabIndex={-1}
          className="mx-auto max-w-[1480px] px-3 pb-24 pt-5 outline-none sm:px-5 md:pb-10"
        >
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
