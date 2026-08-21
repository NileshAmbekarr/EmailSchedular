'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { emailApi } from '@/lib/api';
import type { EmailMessage } from '@/types';
import { Loading, StatusBadge, formatDateTime } from '@/components/ui';

const EVENT_COLOR: Record<string, string> = {
    queued: '#94a3b8',
    sent: '#22c55e',
    delivered: '#16a34a',
    opened: '#0ea5e9',
    clicked: '#8b5cf6',
    bounced: '#ef4444',
    complained: '#ef4444',
    unsubscribed: '#f59e0b',
    failed: '#ef4444',
    deferred: '#f59e0b',
};

export default function MessageDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [message, setMessage] = useState<EmailMessage | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        emailApi
            .get(id)
            .then(setMessage)
            .catch((error) => {
                toast.error((error as Error).message);
                router.push('/dashboard/messages');
            })
            .finally(() => setLoading(false));
    }, [id, router]);

    if (loading) return <Loading />;
    if (!message) return null;

    const events = [...(message.events ?? [])].sort(
        (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );

    return (
        <>
            <div className="page-head">
                <div>
                    <Link href="/dashboard/messages" className="muted" style={{ fontSize: 13 }}>
                        ← Messages
                    </Link>
                    <h1 className="page-title" style={{ marginTop: 4 }}>
                        {message.renderedSubject ?? message.campaign?.subject ?? 'Message'}
                    </h1>
                    <p className="page-sub">To {message.recipientEmail}</p>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <StatusBadge status={message.status} />
                    {message.previewUrl && (
                        <a
                            href={message.previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline btn-sm"
                        >
                            View captured message
                        </a>
                    )}
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-title">Rendered body</div>
                    <div className="card-sub">
                        Exactly what this recipient received, with their merge data applied.
                    </div>

                    {message.renderedBody ? (
                        <div
                            className="preview-frame"
                            // Sanitised server-side before it is returned.
                            dangerouslySetInnerHTML={{ __html: message.renderedBody }}
                        />
                    ) : (
                        <p className="muted">
                            The campaign body is no longer available for this message.
                        </p>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="card">
                        <div className="card-title">Details</div>
                        <dl style={{ marginTop: 12 }}>
                            <div className="kv">
                                <dt>Campaign</dt>
                                <dd>
                                    {message.campaign ? (
                                        <Link
                                            href={`/dashboard/campaigns/${message.campaign.id}`}
                                            className="row-link"
                                        >
                                            {message.campaign.name}
                                        </Link>
                                    ) : (
                                        '—'
                                    )}
                                </dd>
                            </div>
                            <div className="kv">
                                <dt>From</dt>
                                <dd>{message.sender?.email ?? '—'}</dd>
                            </div>
                            <div className="kv">
                                <dt>Scheduled</dt>
                                <dd>{formatDateTime(message.scheduledAt)}</dd>
                            </div>
                            <div className="kv">
                                <dt>Sent</dt>
                                <dd>{formatDateTime(message.sentAt)}</dd>
                            </div>
                            <div className="kv">
                                <dt>Attempts</dt>
                                <dd>{message.attemptCount}</dd>
                            </div>
                            <div className="kv">
                                <dt>Opened</dt>
                                <dd>{formatDateTime(message.openedAt)}</dd>
                            </div>
                            <div className="kv">
                                <dt>Clicked</dt>
                                <dd>{formatDateTime(message.clickedAt)}</dd>
                            </div>
                        </dl>

                        {message.errorMessage && (
                            <div className="warning warning-high" style={{ marginTop: 14 }}>
                                {message.errorMessage}
                            </div>
                        )}
                    </div>

                    {Object.keys(message.mergeData ?? {}).length > 0 && (
                        <div className="card">
                            <div className="card-title">Merge data</div>
                            <dl style={{ marginTop: 12 }}>
                                {Object.entries(message.mergeData).map(([key, value]) => (
                                    <div className="kv" key={key}>
                                        <dt className="mono">{key}</dt>
                                        <dd>{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}

                    <div className="card">
                        <div className="card-title">Delivery timeline</div>
                        <div className="card-sub">
                            Append-only, fed by the worker and provider webhooks.
                        </div>

                        {events.length === 0 ? (
                            <p className="muted">No events recorded yet.</p>
                        ) : (
                            <div className="timeline">
                                {events.map((event) => (
                                    <div className="timeline-item" key={event.id}>
                                        <span
                                            className="timeline-dot"
                                            style={{
                                                background: EVENT_COLOR[event.type] ?? '#94a3b8',
                                            }}
                                        />
                                        <div className="timeline-body">
                                            <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                                                {event.type}
                                            </div>
                                            <div className="timeline-time">
                                                {formatDateTime(event.occurredAt)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
