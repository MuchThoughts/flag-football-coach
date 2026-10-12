import { NextResponse } from 'next/server'

// Read on every request, so an open app always learns about the latest deploy.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
