'use client';

import { useState, Fragment } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApi, replayMockEvent, type WebhookEventLog } from '@/lib/api';
import { config } from '@/lib/config';
import { isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query';
import { EmptyState, ErrorState, LoadingState, safeErrorMessage } from '@/components/ui/api-states';
import { AddressText } from '@/components/wallet/address-text';
import { AdminGuard } from '@/components/admin-guard';
import { useSiweAuth } from '@/lib/wallet/providers';
import { Button } from '@/components/ui/button';
import { Select } from "@/components/ui/select";

function SessionExpiredState() {
  const { signIn, isSigningIn } = useSiweAuth();

  return (
    <EmptyState
      title="Admin session expired"
      message="Your admin session has expired. Re-authenticate with your wallet to load webhook logs again."
      actions={
        <Button
          id="webhook-events-reauth-btn"
          size="sm"
          variant="outline"
          onClick={signIn}
          disabled={isSigningIn}
        >
          {isSigningIn ? 'Signing…' : 'Re-authenticate'}
        </Button>
      }
    />
  );
}

function WebhookLogsContent() {
  const { address } = useAccount();
  const { authSession, markExpired, sessionStatus } = useSiweAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isMockMode = config.apiMode === 'mock';

  const {
    data: events = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: [...queryKeys.webhookEvents.all, address, authSession?.token ?? 'anonymous'],
    queryFn: async () => {
      try {
        return await getApi(address, authSession?.token).listWebhookEvents();
      } catch (err) {
        if (isApiError(err) && err.code === 'unauthorized') {
          markExpired();
        }
        throw err;
      }
    },
    enabled: !!address && sessionStatus === 'authenticated',
    retry: (failureCount, err) => {
      if (isApiError(err) && err.code === 'unauthorized') return false;
      return failureCount < 1;
    },
  });

  const filteredEvents = events.filter((evt) => {
    const matchStatus = statusFilter === 'all' || evt.status === statusFilter;
    const matchType = typeFilter === 'all' || evt.eventType === typeFilter;
    return matchStatus && matchType;
  });

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleReplay(evt: WebhookEventLog) {
    if (!isMockMode) return;
    replayMockEvent(evt);
    queryClient.invalidateQueries({ queryKey: queryKeys.webhookEvents.all });
  }

  function isReplayedEvent(evt: WebhookEventLog): boolean {
    return evt.id.startsWith('replay_');
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Ecosystem Webhook Logs
        </h1>
        <p className="text-sm text-muted-foreground">
          Operational telemetry stream for community subscription events, upgrades, and access
          switches.
        </p>
      </div>

      <hr className="border-border" />

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-col gap-1">
          <label htmlFor="event-type-filter" className="text-xs font-medium text-muted-foreground">
            Filter by Action
          </label>
          <Select
            id="event-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All Actions</option>
            <option value="membership.created">membership.created</option>
            <option value="membership.renewed">membership.renewed</option>
            <option value="membership.expired">membership.expired</option>
            <option value="tier.upgraded">tier.upgraded</option>
            <option value="policy.updated">policy.updated</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="event-status-filter"
            className="text-xs font-medium text-muted-foreground"
          >
            Filter by Telemetry Status
          </label>
          <Select
            id="event-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All States</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </Select>
        </div>
      </div>

      {sessionStatus === 'expired' ? (
        <SessionExpiredState />
      ) : isLoading ? (
        <LoadingState message="Ingesting latest system events..." />
      ) : isError ? (
        <ErrorState
          title="Error loading log feed"
          message={safeErrorMessage(error)}
          onRetry={() => refetch()}
        />
      ) : filteredEvents.length === 0 ? (
        <EmptyState
          title="No event records found"
          message="No recent logs match the active event filters or system records are blank."
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-left text-sm">
              <thead className="bg-muted text-muted-foreground uppercase text-xs font-semibold tracking-wider">
                <tr>
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-6 py-3">Event Type</th>
                  <th className="px-6 py-3">Target Address/Resource</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Payload Summary</th>
                  {isMockMode && <th className="px-6 py-3 w-0">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-transparent text-card-foreground">
                {filteredEvents.map((evt) => {
                  const expanded = expandedId === evt.id;
                  const replayed = isReplayedEvent(evt);
                  return (
                    <Fragment key={evt.id}>
                      <tr
                        onClick={() => toggleExpand(evt.id)}
                        className="hover:bg-muted/50 transition-colors cursor-pointer"
                        aria-expanded={expanded}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-muted-foreground font-mono text-xs">
                          {new Date(evt.timestamp).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 font-semibold font-mono text-xs text-foreground">
                          {evt.eventType}
                          {replayed && (
                            <span className="ml-2 inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                              Replay
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                          <AddressText
                            address={evt.affectedIdentifier}
                            label="Target address or resource"
                            announceInvalid={false}
                            className="text-muted-foreground"
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide uppercase ${
                              evt.status === 'success'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : evt.status === 'failed'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}
                          >
                            {evt.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground text-xs max-w-xs truncate font-mono">
                          {JSON.stringify(evt.payloadSummary)}
                        </td>
                        {isMockMode && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReplay(evt);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              aria-label={`Replay ${evt.eventType} event`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                              </svg>
                              Replay
                            </button>
                          </td>
                        )}
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20">
                          <td colSpan={isMockMode ? 6 : 5} className="px-6 py-4">
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Full Event Payload
                                </h4>
                                {replayed && (
                                  <span className="text-[10px] text-purple-600 dark:text-purple-400">
                                    — debug replay (original id: {evt.id.replace(/^replay_(.+)_\d+$/, '$1')})
                                  </span>
                                )}
                              </div>
                              <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-all">
                                {JSON.stringify(
                                  {
                                    id: evt.id,
                                    eventType: evt.eventType,
                                    status: evt.status,
                                    timestamp: evt.timestamp,
                                    affectedIdentifier: evt.affectedIdentifier,
                                    payloadSummary: evt.payloadSummary,
                                  },
                                  null,
                                  2,
                                )}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminEventsPage() {
  return (
    <AdminGuard>
      <WebhookLogsContent />
    </AdminGuard>
  );
}
