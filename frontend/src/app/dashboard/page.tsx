'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { campaignApi, statsApi } from '@/lib/api';
import type { AccountStats, Campaign, QueueStats } from '@/types';
import {
    EmptyState,
    Loading,
    StatusBadge,
    formatPercent,
    formatRelative,
} from '@/components/ui';

const SERIES = [
    { key: 'sent', label: 'Sent', color: '#22c55e' },
    { key: 'opened', label: 'Opened', color: '#0ea5e9' },
    { key: 'clicked', label: 'Clicked', color: '#8b5cf6' },
    { key: 'bounced', label: 'Bounced', color: '#ef4444' },
] as const;

export default function OverviewPage() {
    const [stats, setStats] = useState<AccountStats | null>(null);
    const [queue, setQueue] = useState<QueueStats | null>(null);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState(30);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const [accountStats, queueStats, campaignPage] = await Promise.all([
                    statsApi.account(days),
                    statsApi.queue().catch(() => null),
                    campaignApi.list({ limit: 5 }),
                ]);

                if (cancelled) return;
                setStats(accountStats);
                setQueue(queueStats);
                setCampaigns(campaignPage.items);
            } catch (error) {
                if (!cancelled) toast.error((error as Error).message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();

        // Campaigns move while you watch them, so refresh in the background
        // rather than making the user reload.
        const timer = setInterval(load, 20_000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [days]);

    if (loading) return <Loading />;
    if (!stats) return null;

    const peak = Math.max(1, ...stats.daily.map((d) => d.sent));
    const inFlight =
        (queue?.email.waiting ?? 0) + (queue?.email.active ?? 0) + (queue?.email.delayed ?? 0);

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Overview</h1>
                    <p className="page-sub">Delivery performance across the last {days} days.</p>
                </div>
                <div className="tabs">
                    {[7, 30, 90].map((option) => (
                        <button
                            key={option}
                            className={`tab ${days === option ? 'active' : ''}`}
                            onClick={() => setDays(option)}
                        >
                            {option}d
                        </button>
                    ))}
                </div>
            </div>

            <div className="stat-grid">
                <div className="tile">
                    <div className="tile-label">Sent</div>
                    <div className="tile-value">{stats.totals.sent.toLocaleString()}</div>
                    <div className="tile-delta">{stats.totals.total.toLocaleString()} created</div>
                </div>
                <div className="tile">
                    <div className="tile-label">Open rate</div>
                    <div className="tile-value">{formatPercent(stats.rates.openRate)}</div>
                    <div className="tile-delta">{stats.totals.opened.toLocaleString()} opens</div>
                </div>
                <div className="tile">
                    <div className="tile-label">Click rate</div>
                    <div className="tile-value">{formatPercent(stats.rates.clickRate)}</div>
                    <div className="tile-delta">{stats.totals.clicked.toLocaleString()} clicks</div>
                </div>
                <div className="tile">
                    <div className="tile-label">Bounce rate</div>
                    <div
                        className="tile-value"
                        style={{ color: stats.rates.bounceRate > 0.05 ? 'var(--danger)' : undefined }}
                    >
                        {formatPercent(stats.rates.bounceRate)}
                    </div>
                    <div className="tile-delta">
                        {stats.rates.bounceRate > 0.05 ? 'Above the safe threshold' : 'Healthy'}
                    </div>
                </div>
                <div className="tile">
                    <div className="tile-label">In flight</div>
                    <div className="tile-value">{inFlight.toLocaleString()}</div>
                    <div className="tile-delta">
                        {stats.totals.scheduled.toLocaleString()} scheduled messages
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-title">Daily volume</div>
                <div className="card-sub">Messages created per day, by outcome.</div>

                {stats.daily.length === 0 ? (
                    <EmptyState
                        title="No activity yet"
                        body="Once you schedule a campaign, delivery volume shows up here."
                        action={
                            <Link href="/dashboard/compose" className="btn btn-accent">
                                Create a campaign
                            </Link>
                        }
                    />
                ) : (
                    <>
                        <div className="chart">
                            {stats.daily.map((day) => (
                                <div key={day.day} className="chart-col" title={`${day.day} · ${day.sent} sent`}>
                                    {SERIES.map((series) => {
                                        const value = day[series.key];
                                        if (!value) return null;
                                        return (
                                            <div
                                                key={series.key}
                                                className="chart-bar"
                                                style={{
                                                    height: `${Math.max(2, (value / peak) * 100)}%`,
                                                    background: series.color,
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        <div className="legend">
                            {SERIES.map((series) => (
                                <span key={series.key} className="legend-item">
                                    <span className="legend-swatch" style={{ background: series.color }} />
                                    {series.label}
                                </span>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="table-wrap">
                <div style={{ padding: '16px 20px 0' }}>
                    <div className="card-title">Recent campaigns</div>
                </div>

                {campaigns.length === 0 ? (
                    <EmptyState
                        title="No campaigns yet"
                        body="Every account starts with a sandbox sender, so you can watch the whole pipeline run without touching a real inbox. New here? The guide walks you through it."
                        action={
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                                <Link href="/dashboard/compose" className="btn btn-accent">
                                    Create a campaign
                                </Link>
                                <Link href="/dashboard/guide" className="btn btn-outline">
                                    Getting started
                                </Link>
                            </div>
                        }
                    />
                ) : (
                    <div className="table-scroll">
                        <table className="data">
                            <thead>
                                <tr>
                                    <th>Campaign</th>
                                    <th>Status</th>
                                    <th className="right">Progress</th>
                                    <th className="right">Opens</th>
                                    <th>Scheduled</th>
                                </tr>
                            </thead>
                            <tbody>
                                {campaigns.map((campaign) => {
                                    const progress =
                                        campaign.totalRecipients > 0
                                            ? (campaign.sentCount / campaign.totalRecipients) * 100
                                            : 0;

                                    return (
                                        <tr key={campaign.id}>
                                            <td>
                                                <Link
                                                    href={`/dashboard/campaigns/${campaign.id}`}
                                                    className="row-link"
                                                >
                                                    {campaign.name}
                                                </Link>
                                                <div className="muted" style={{ fontSize: 12.5 }}>
                                                    {campaign.subject}
                                                </div>
                                            </td>
                                            <td>
                                                <StatusBadge status={campaign.status} />
                                            </td>
                                            <td className="right tabular nowrap">
                                                <div style={{ minWidth: 110 }}>
                                                    <div className="progress" style={{ marginBottom: 4 }}>
                                                        <div
                                                            className="progress-fill"
                                                            style={{ width: `${progress}%` }}
                                                        />
                                                    </div>
                                                    <span className="muted" style={{ fontSize: 12 }}>
                                                        {campaign.sentCount.toLocaleString()} /{' '}
                                                        {campaign.totalRecipients.toLocaleString()}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="right tabular">
                                                {campaign.openedCount.toLocaleString()}
                                            </td>
                                            <td className="nowrap muted">
                                                {formatRelative(campaign.scheduledAt)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
}
