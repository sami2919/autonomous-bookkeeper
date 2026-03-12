import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

function isSameOriginRequest(req: NextRequest): boolean {
  const host = req.headers.get('host')
  if (!host) return false

  const origin = req.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }

  const referer = req.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).host === host
    } catch {
      return false
    }
  }

  return false
}

export function requireApiKey(req: NextRequest): NextResponse | null {
  if (isSameOriginRequest(req)) return null

  const apiKey = process.env.API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return null
  }
  const provided = req.headers.get('x-api-key') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(apiKey)
  const match = a.length === b.length && timingSafeEqual(a, b)
  if (!match) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
