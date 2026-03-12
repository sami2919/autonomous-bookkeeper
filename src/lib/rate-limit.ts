import { NextRequest, NextResponse } from 'next/server'

const windows = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 5
const CLEANUP_INTERVAL = 500

let callCount = 0

function evictExpired(now: number) {
  for (const [ip, timestamps] of windows) {
    if (timestamps.every(t => now - t >= WINDOW_MS)) {
      windows.delete(ip)
    }
  }
}

export function rateLimit(req: NextRequest): NextResponse | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
  const now = Date.now()

  if (++callCount % CLEANUP_INTERVAL === 0) {
    evictExpired(now)
  }

  const timestamps = (windows.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  if (timestamps.length >= MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }
  timestamps.push(now)
  windows.set(ip, timestamps)
  return null
}
