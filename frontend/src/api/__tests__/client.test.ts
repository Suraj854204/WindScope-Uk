import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, buildQuery } from '../client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('buildQuery', () => {
  it('skips empty values and encodes the rest', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '', e: 'x y' })).toBe('?a=1&e=x+y')
    expect(buildQuery({})).toBe('')
  })
})

describe('api client', () => {
  it('surfaces the backend error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: { code: 'validation_error', message: 'bad cutoff' } }, 422)),
    )
    const err = await api.datasetStatus().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      code: 'validation_error',
      message: 'bad cutoff',
      status: 422,
      isNetwork: false,
    })
  })
  it('falls back to a generic message for non-JSON error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })))
    await expect(api.datasetStatus()).rejects.toMatchObject({
      code: 'http_error',
      status: 502,
      message: expect.stringContaining('unavailable'),
    })
  })
  it('maps fetch failures to a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.datasetStatus()).rejects.toMatchObject({ code: 'network', isNetwork: true })
  })
  it('maps an unreadable success body to bad_response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    await expect(api.datasetStatus()).rejects.toMatchObject({ code: 'bad_response' })
  })
})
