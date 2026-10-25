import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api, ApiError, type AnalysisQuery, type IntervalsQuery } from './client'

/** Don't retry client mistakes (4xx); retry transient/network failures once. */
function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status !== null && error.status >= 400 && error.status < 500)
    return false
  return failureCount < 1
}

export const queryDefaults = {
  retry: retryPolicy,
  refetchOnWindowFocus: false,
  staleTime: 30_000,
} as const

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: ({ signal }) => api.config(signal),
    ...queryDefaults,
    staleTime: 5 * 60_000,
  })
}

/** Polls quickly while a download runs, slowly otherwise, so the header status reflects the real API. */
export function useDatasetStatus() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['dataset-status'],
    queryFn: ({ signal }) => api.datasetStatus(signal),
    ...queryDefaults,
    staleTime: 0,
    refetchInterval: (q) => {
      if (q.state.status === 'error') return 10_000
      return q.state.data?.ingestion_running ? 1_500 : 30_000
    },
  })

  // When a download finishes, every analysis result is out of date.
  const wasRunning = useRef(false)
  const running = query.data?.ingestion_running ?? false
  useEffect(() => {
    if (wasRunning.current && !running) invalidateAnalysis(qc)
    wasRunning.current = running
  }, [running, qc])

  return query
}

export function invalidateAnalysis(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['analysis'] })
}

const analysisOptions = { ...queryDefaults, placeholderData: keepPreviousData } as const

export function useSummary(q: AnalysisQuery) {
  return useQuery({
    queryKey: ['analysis', 'summary', q],
    queryFn: ({ signal }) => api.summary(q, signal),
    ...analysisOptions,
  })
}
export function useSeries(q: AnalysisQuery) {
  return useQuery({
    queryKey: ['analysis', 'series', q],
    queryFn: ({ signal }) => api.series(q, signal),
    ...analysisOptions,
  })
}
export function useIntervals(q: IntervalsQuery) {
  return useQuery({
    queryKey: ['analysis', 'intervals', q],
    queryFn: ({ signal }) => api.intervals(q, signal),
    ...analysisOptions,
  })
}
export function useIntervalDetail(startTime: string | null, q: AnalysisQuery) {
  return useQuery({
    queryKey: ['analysis', 'interval', startTime, q],
    queryFn: ({ signal }) => api.intervalDetail(startTime as string, q, signal),
    enabled: startTime !== null,
    ...queryDefaults,
  })
}
export function useAccuracy(q: AnalysisQuery & { granularity?: 'day' | 'week'; top_n?: number }) {
  return useQuery({
    queryKey: ['analysis', 'accuracy', q],
    queryFn: ({ signal }) => api.accuracy(q, signal),
    ...analysisOptions,
  })
}
export function useSensitivity(q: AnalysisQuery) {
  return useQuery({
    queryKey: ['analysis', 'sensitivity', q],
    queryFn: ({ signal }) => api.sensitivity(q, signal),
    ...analysisOptions,
  })
}
export function useQuality(q: AnalysisQuery) {
  return useQuery({
    queryKey: ['analysis', 'quality', q],
    queryFn: ({ signal }) => api.quality(q, signal),
    ...analysisOptions,
  })
}

export function useRefresh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force: boolean) => api.refresh(force),
    onSuccess: (res) => {
      qc.setQueryData(['dataset-status'], res.status)
      void qc.invalidateQueries({ queryKey: ['dataset-status'] })
    },
  })
}
