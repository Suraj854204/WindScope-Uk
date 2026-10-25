import { Download, RefreshCw } from 'lucide-react'
import { useDatasetStatus, useRefresh } from '@/api/hooks'
import { Button } from './ui/Button'
import { EmptyState } from './ui/StateBlocks'

/**
 * Explains honestly why there is nothing to show: still downloading, never downloaded, source
 * failure, or data present but no interval matched. Offers the matching action.
 */
export function NoDataNotice({ what = 'This view' }: { what?: string }) {
  const { data: status } = useDatasetStatus()
  const refresh = useRefresh()

  if (status?.state === 'loading') {
    return (
      <EmptyState title="Downloading data from Elexon…">
        {status.progress_completed} of {status.progress_total} requests complete. {what} will fill in
        automatically.
      </EmptyState>
    )
  }
  if (status?.state === 'failed' || status?.state === 'empty') {
    const failed = status.state === 'failed'
    return (
      <EmptyState
        title={failed ? 'No data could be retrieved from Elexon' : 'No data has been downloaded yet'}
        action={
          <Button
            size="sm"
            variant="primary"
            loading={refresh.isPending}
            icon={
              failed ? (
                <RefreshCw className="size-3.5" aria-hidden />
              ) : (
                <Download className="size-3.5" aria-hidden />
              )
            }
            onClick={() => refresh.mutate(false)}
          >
            {failed ? 'Retry download' : 'Download data'}
          </Button>
        }
      >
        {failed && status.last_error ? (
          <>Last error: {status.last_error}</>
        ) : (
          <>{what} needs the Elexon FUELHH and WINDFOR data.</>
        )}
        {refresh.data && !refresh.data.accepted && <p className="mt-1 text-xs">{refresh.data.message}</p>}
        {refresh.isError && (
          <p className="mt-1 text-xs text-bad-700">Could not reach the API to start the download.</p>
        )}
      </EmptyState>
    )
  }
  return (
    <EmptyState title="No intervals matched for this selection">
      Data was retrieved, but no half-hour in the chosen dates has both an actual and a forecast published at
      or before the cutoff. Try a later cutoff or a wider date range, or open Data Quality to see why
      intervals were excluded.
    </EmptyState>
  )
}
