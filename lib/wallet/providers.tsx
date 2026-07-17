'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react'
import { WagmiProvider, createConfig, useSignMessage, useAccount, useDisconnect } from 'wagmi'
import { walletConfig } from '@/lib/wallet/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getApi } from '@/lib/api'
import { config } from '@/lib/config'
import { SiweAuthSession, AdminSessionStatus } from '@/lib/api/types'
import { clearAuthSession, loadAuthSession, storeAuthSession } from '@/lib/session'
import { isApiError } from '@/lib/api/errors'
import {
  buildSiweMessage,
  deriveSessionStatus,
  initialSiweSessionState,
  siweSessionReducer,
} from '@/lib/wallet/siwe-session'

// ── Wagmi config ─────────────────────────────────────────────────────────────

const wagmiConfig = createConfig(walletConfig)

// ── SIWE Auth Context ─────────────────────────────────────────────────────────

export interface SiweAuthContextValue {
  /** The authenticated session, or null if the user has not signed in. */
  authSession: SiweAuthSession | null
  isAuthenticated: boolean
  /** Granular status of the admin session. */
  sessionStatus: AdminSessionStatus
  /** True while a signature request is in-flight. */
  isSigningIn: boolean
  /** Human-readable error from the most recent signIn attempt, if any. */
  error: string | null
  /** Trigger the EIP-4361 sign-in flow for the currently connected address. */
  signIn: () => Promise<void>
  /** Clear the session and disconnect the wallet. */
  logout: () => Promise<void>
  /** Mark the current session as expired (e.g. after a 401 from the backend). */
  markExpired: () => void
}

const SiweAuthContext = createContext<SiweAuthContextValue | undefined>(undefined);
const queryClient = new QueryClient();

export function SiweAuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const [state, dispatch] = useReducer(siweSessionReducer, initialSiweSessionState);

  // Restore a persisted (non-expired) session on mount.
  useEffect(() => {
    const stored = loadAuthSession();
    if (stored) dispatch({ type: 'restore', session: stored });
  }, []);

  // The session was invalidated outside this provider (lib/session.ts fires
  // this event whenever the stored session is cleared) — require re-auth.
  useEffect(() => {
    const onInvalidated = () => dispatch({ type: 'mark-expired' });
    window.addEventListener('siwe:invalidated', onInvalidated);
    return () => window.removeEventListener('siwe:invalidated', onInvalidated);
  }, []);

  // Drop the session when the wallet disconnects or switches address.
  useEffect(() => {
    const session = state.authSession;
    if (!session) return;
    if (
      !isConnected ||
      (address && session.address.toLowerCase() !== address.toLowerCase())
    ) {
      clearAuthSession();
      dispatch({ type: 'clear' });
    }
  }, [address, isConnected, state.authSession]);

  // Mark the session expired once its expiry timestamp passes.
  useEffect(() => {
    const session = state.authSession;
    if (!session) return;

    const check = () => {
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        clearAuthSession();
        dispatch({ type: 'mark-expired' });
      }
    };

    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [state.authSession]);

  const signIn = useCallback(async () => {
    if (!address) return;
    dispatch({ type: 'sign-in-start' });
    try {
      const api = getApi(address);
      const nonce = await api.getNonce(address);
      const message = buildSiweMessage({
        domain: config.siwe.domain,
        address,
        statement: config.siwe.statement,
        uri:
          typeof window !== 'undefined'
            ? window.location.origin
            : `https://${config.siwe.domain}`,
        chainId: chainId ?? 1,
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const signature = await signMessageAsync({ message });
      const session = await api.siweVerify(message, signature);
      storeAuthSession(session);
      dispatch({ type: 'sign-in-success', session });
    } catch (err) {
      dispatch({
        type: 'sign-in-error',
        message: isApiError(err)
          ? err.safeMessage
          : 'Sign-in was cancelled or failed. Please try again.',
      });
    }
  }, [address, chainId, signMessageAsync]);

  const logout = useCallback(async () => {
    const token = state.authSession?.token;
    clearAuthSession();
    dispatch({ type: 'clear' });
    disconnect();
    if (token) {
      await getApi(address).siweLogout(token).catch(() => {
        // best-effort server-side invalidation
      });
    }
  }, [address, state.authSession, disconnect]);

  const markExpired = useCallback(() => {
    clearAuthSession();
    dispatch({ type: 'mark-expired' });
  }, []);

  const sessionStatus = deriveSessionStatus(state, isConnected);

  const value = useMemo<SiweAuthContextValue>(
    () => ({
      authSession: state.authSession,
      isAuthenticated: sessionStatus === 'authenticated',
      sessionStatus,
      isSigningIn: state.isSigningIn,
      error: state.error,
      signIn,
      logout,
      markExpired,
    }),
    [state.authSession, state.isSigningIn, state.error, sessionStatus, signIn, logout, markExpired],
  );

  return (
    <SiweAuthContext.Provider value={value}>
      {children}
    </SiweAuthContext.Provider>
  );
}

export function useSiweAuth(): SiweAuthContextValue {
  const context = useContext(SiweAuthContext);
  if (!context) throw new Error('useSiweAuth must be used within SiweAuthProvider');
  return context;
}

export function RootProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SiweAuthProvider>
          {children}
        </SiweAuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
