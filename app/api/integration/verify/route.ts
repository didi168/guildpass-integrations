import { NextRequest, NextResponse } from 'next/server'
import { verifyWallet } from '@/lib/integration-client'
import { rateLimitRequest } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')

  // Enforce per-IP / per-wallet rate limit before any downstream call.
  const rl = rateLimitRequest(req, address)
  if (rl.limited) {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests', retryAfter: rl.retryAfter }),
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfter),
          'X-RateLimit-Remaining': String(rl.remaining),
        },
      },
    )
  }

  if (!address) {
    return NextResponse.json(
      { error: 'Missing required query parameter: address' },
      { status: 400 },
    )
  }

  try {
    const verification = await verifyWallet(address)
    return NextResponse.json(verification)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to verify wallet',
      },
      { status: 502 },
    )
  }
}
