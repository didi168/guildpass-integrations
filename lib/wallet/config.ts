/**
 * lib/wallet/config.ts
 *
 * Builds wagmi chain configuration with fallback RPC transport.
 * Primary RPC URLs are read from environment variables:
 *   NEXT_PUBLIC_WALLET_RPC_MAINNET
 *   NEXT_PUBLIC_WALLET_RPC_BASE
 *   NEXT_PUBLIC_WALLET_RPC_SEPOLIA
 *
 * If a primary URL is set, the transport uses wagmi's fallback:
 *   primary → public default (via http() with no url).
 * If no primary URL is set, only the public default is used.
 */
import { http, createConfig, fallback } from 'wagmi'
import { mainnet, base, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]['id']

export const SUPPORTED_CHAINS = [mainnet, base, sepolia] as const

function buildTransport(chainId: number, envKey: string) {
  const primaryUrl = typeof process !== 'undefined'
    ? process.env[envKey]
    : undefined

  const publicTransport = http()

  if (!primaryUrl) return publicTransport

  return fallback([
    http(primaryUrl, { timeout: 10_000 }),
    publicTransport,
  ])
}

export function buildWagmiConfig() {
  return createConfig({
    chains: SUPPORTED_CHAINS,
    connectors: [injected()],
    transports: {
      [mainnet.id]: buildTransport(mainnet.id, 'NEXT_PUBLIC_WALLET_RPC_MAINNET'),
      [base.id]: buildTransport(base.id, 'NEXT_PUBLIC_WALLET_RPC_BASE'),
      [sepolia.id]: buildTransport(sepolia.id, 'NEXT_PUBLIC_WALLET_RPC_SEPOLIA'),
    },
  })
}

export const wagmiConfig = buildWagmiConfig()
