'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { campaignApi } from '@/lib/api';
import type { Campaign, CampaignStatus } from '@/types';
import {
    EmptyState,
    Loading,
    Pagination,
    StatusBadge,
    formatDateTime,
} from '@/components/ui';

const FILTERS: Array<{ value: CampaignStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'sending', label: 'Sending' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Completed' },
];

const LIMIT = 25;

export default function CampaignsPage() {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [status, setStatus] = useState<CampaignStatus | 'all'>('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const page = await campaignApi.list({
                limit: LIMIT,
                offset,
                status: status === 'all' ? undefined : status,
                search: search || undefined,
            });
            setCampaigns(page.items);
            setTotal(page.pagination.total);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, [offset, status, search]);

    useEffect(() => {
        void load();
    }, [load]);

    // Anything mid-send changes on its own; poll while that is true.
    useEffect(() => {
        const active = campaigns.some((c) => c.status === 'sending' || c.status === 'scheduled');
        if (!active) return;

        const timer = setInterval(() => void load(), 15_000);
        return () => clearInterval(timer);
    }, [campaigns, load]);

    const act = async (
        id: string,
        action: 'pause' | 'resume' | 'cancel',
        confirmMessage?: string
    ) => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;

        try {
            if (action === 'pause') await campaignApi.pause(id);
            if (action === 'resume') await campaignApi.resume(id);
            if (action === 'cancel') {
                const { cancelled } = await campaignApi.cancel(id);
                toast.success(`Cancelled ${cancelled.toLocaleString()} unsent messages`);
            } else {
                toast.success(`Campaign ${action}d`);
            }
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Campaigns</h1>
                    <p className="page-sub">{total.toLocaleString()} total</p>
                </div>
                <Link href="/dashboard/compose" className="btn btn-accent">
                    New campaign
                </Link>
            </div>

            <div className="toolbar">
                <div className="tabs">
                    {FILTERS.map((filter) => (
                        <button
                            key={filter.value}
                            className={`tab ${status === filter.value ? 'active' : ''}`}
                            onClick={() => {
                                setStatus(filter.value);
                                setOffset(0);
                            }}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
                <input
                    className="input"
                    placeholder="Search campaigns…"
                    value={search}
                    onChange={(event) => {
                        setSearch(event.target.value);
                        setOffset(0);
                    }}
                />
            </div>

            <div className="table-wrap">
                {loading ? (
                    <Loading />
                ) : campaigns.length === 0 ? (
                    <EmptyState
                        title="Nothing here yet"
                        body={
                            search || status !== 'all'
                                ? 'No campaigns match these filters.'
                                : 'Create your first campaign to see it here.'
                        }
                        action={
                            <Link href="/dashboard/compose" className="btn btn-accent">
                                New campaign
                            </Link>
                        }
                    />
                ) : (
                    <>
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr>
                                        <th>Campaign</th>
                                        <th>Status</th>
                                        <th className="right">Recipients</th>
                                        <th className="right">Sent</th>
                                        <th className="right">Opened</th>
                                        <th className="right">Bounced</th>
                                        <th>Scheduled</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {campaigns.map((campaign) => (
                                        <tr key={campaign.id}>
                                            <td>
                                                <Link
                                                    href={`/dashboard/campaigns/${campaign.id}`}
                                                    className="row-link"
                                                >
                                                    {campaign.name}
                                                </Link>
                                                <div className="muted" style={{ fontSize: 12.5 }}>
                                                    {campaign.sender?.email ?? campaign.subject}
                                                </div>
                                            </td>
                                            <td>
                                                <StatusBadge status={campaign.status} />
                                            </td>
                                            <td className="right tabular">
                                                {campaign.totalRecipients.toLocaleString()}
                                            </td>
                                            <td className="right tabular">
                                                {campaign.sentCount.toLocaleString()}
                                            </td>
                                            <td className="right tabular">
                                                {campaign.openedCount.toLocaleString()}
                                            </td>
                                            <td className="right tabular">
                                                {campaign.bouncedCount > 0 ? (
                                                    <span style={{ color: 'var(--danger)' }}>
                                                        {campaign.bouncedCount.toLocaleString()}
                                                    </span>
                                                ) : (
                                                    '0'
                                                )}
                                            </td>
                                            <td className="nowrap muted">
                                                {formatDateTime(campaign.scheduledAt)}
                                            </td>
                                            <td className="right nowrap">
                                                {campaign.status === 'sending' && (
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => void act(campaign.id, 'pause')}
                                                    >
                                                        Pause
                                                    </button>
                                                )}
                                                {campaign.status === 'paused' && (
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => void act(campaign.id, 'resume')}
                                                    >
                                                        Resume
                                                    </button>
                                                )}
                                                {['scheduled', 'sending', 'paused'].includes(
                                                    campaign.status
                                                ) && (
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() =>
                                                            void act(
                                                                campaign.id,
                                                                'cancel',
                                                                `Cancel "${campaign.name}"? Messages already sent cannot be recalled.`
                                                            )
                                                        }
                                                    >
                                                        Cancel
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Pagination
                            total={total}
                            limit={LIMIT}
                            offset={offset}
                            onChange={setOffset}
                        />
                    </>
                )}
            </div>
        </>
    );
}
