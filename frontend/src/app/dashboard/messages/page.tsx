'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { emailApi } from '@/lib/api';
import type { EmailMessage } from '@/types';
import {
    EmptyState,
    Loading,
    Pagination,
    StatusBadge,
    formatDateTime,
} from '@/components/ui';

type Bucket = 'scheduled' | 'sent' | 'failed' | 'all';

const BUCKETS: Array<{ value: Bucket; label: string }> = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'sent', label: 'Sent' },
    { value: 'failed', label: 'Problems' },
    { value: 'all', label: 'All' },
];

const LIMIT = 50;

export default function MessagesPage() {
    const [messages, setMessages] = useState<EmailMessage[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [bucket, setBucket] = useState<Bucket>('scheduled');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const page = await emailApi.list({
                bucket,
                limit: LIMIT,
                offset,
                search: search || undefined,
            });
            setMessages(page.items);
            setTotal(page.pagination.total);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, [bucket, offset, search]);

    useEffect(() => {
        void load();
    }, [load]);

    // Scheduled messages move on their own.
    useEffect(() => {
        if (bucket !== 'scheduled') return;
        const timer = setInterval(() => void load(), 15_000);
        return () => clearInterval(timer);
    }, [bucket, load]);

    const cancel = async (id: string) => {
        try {
            await emailApi.cancel(id);
            toast.success('Message cancelled');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Messages</h1>
                    <p className="page-sub">{total.toLocaleString()} in this view</p>
                </div>
            </div>

            <div className="toolbar">
                <div className="tabs">
                    {BUCKETS.map((option) => (
                        <button
                            key={option.value}
                            className={`tab ${bucket === option.value ? 'active' : ''}`}
                            onClick={() => {
                                setBucket(option.value);
                                setOffset(0);
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <input
                    className="input"
                    placeholder="Search by recipient…"
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
                ) : messages.length === 0 ? (
                    <EmptyState
                        title="Nothing to show"
                        body={
                            bucket === 'scheduled'
                                ? 'No messages are waiting to send.'
                                : 'No messages match this view.'
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
                                        <th>Recipient</th>
                                        <th>Campaign</th>
                                        <th>Status</th>
                                        <th>{bucket === 'sent' ? 'Sent' : 'Scheduled'}</th>
                                        <th>Engagement</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {messages.map((message) => (
                                        <tr key={message.id}>
                                            <td>
                                                <Link
                                                    href={`/dashboard/messages/${message.id}`}
                                                    className="row-link"
                                                >
                                                    {message.recipientEmail}
                                                </Link>
                                                {message.errorMessage && (
                                                    <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                                                        {message.errorMessage}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="muted">
                                                {message.campaign ? (
                                                    <Link
                                                        href={`/dashboard/campaigns/${message.campaign.id}`}
                                                        className="row-link"
                                                        style={{ fontWeight: 500 }}
                                                    >
                                                        {message.campaign.name}
                                                    </Link>
                                                ) : (
                                                    '—'
                                                )}
                                            </td>
                                            <td>
                                                <StatusBadge status={message.status} />
                                            </td>
                                            <td className="nowrap muted">
                                                {formatDateTime(
                                                    bucket === 'sent'
                                                        ? message.sentAt
                                                        : message.scheduledAt
                                                )}
                                            </td>
                                            <td className="nowrap muted">
                                                {message.clickedAt
                                                    ? 'Clicked'
                                                    : message.openedAt
                                                      ? 'Opened'
                                                      : '—'}
                                            </td>
                                            <td className="right">
                                                {['pending', 'queued', 'retrying'].includes(
                                                    message.status
                                                ) && (
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => void cancel(message.id)}
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
                        <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />
                    </>
                )}
            </div>
        </>
    );
}
