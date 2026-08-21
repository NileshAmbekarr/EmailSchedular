'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { campaignApi, emailApi } from '@/lib/api';
import type { Campaign, EmailMessage } from '@/types';
import {
    EmptyState,
    Loading,
    Modal,
    Pagination,
    StatusBadge,
    formatDateTime,
    formatPercent,
} from '@/components/ui';

const LIMIT = 25;

export default function CampaignDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [messages, setMessages] = useState<EmailMessage[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [rescheduling, setRescheduling] = useState(false);
    const [newTime, setNewTime] = useState('');

    const load = useCallback(async () => {
        try {
            const [detail, page] = await Promise.all([
                campaignApi.get(id),
                emailApi.list({ campaignId: id, limit: LIMIT, offset }),
            ]);
            setCampaign(detail);
            setMessages(page.items);
            setTotal(page.pagination.total);
        } catch (error) {
            toast.error((error as Error).message);
            router.push('/dashboard/campaigns');
        } finally {
            setLoading(false);
        }
    }, [id, offset, router]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!campaign || !['sending', 'scheduled'].includes(campaign.status)) return;
        const timer = setInterval(() => void load(), 10_000);
        return () => clearInterval(timer);
    }, [campaign, load]);

    if (loading) return <Loading />;
    if (!campaign) return null;

    const progress =
        campaign.totalRecipients > 0 ? (campaign.sentCount / campaign.totalRecipients) * 100 : 0;
    const openRate = campaign.sentCount > 0 ? campaign.openedCount / campaign.sentCount : 0;
    const clickRate = campaign.sentCount > 0 ? campaign.clickedCount / campaign.sentCount : 0;

    const run = async (fn: () => Promise<unknown>, message: string) => {
        try {
            await fn();
            toast.success(message);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const reschedule = async () => {
        if (!newTime) return;
        await run(
            () => campaignApi.reschedule(id, new Date(newTime).toISOString()),
            'Campaign rescheduled'
        );
        setRescheduling(false);
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <Link href="/dashboard/campaigns" className="muted" style={{ fontSize: 13 }}>
                        ← Campaigns
                    </Link>
                    <h1 className="page-title" style={{ marginTop: 4 }}>
                        {campaign.name}
                    </h1>
                    <p className="page-sub">{campaign.subject}</p>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {campaign.status === 'sending' && (
                        <button
                            className="btn btn-outline"
                            onClick={() => void run(() => campaignApi.pause(id), 'Campaign paused')}
                        >
                            Pause
                        </button>
                    )}
                    {campaign.status === 'paused' && (
                        <button
                            className="btn btn-outline"
                            onClick={() => void run(() => campaignApi.resume(id), 'Campaign resumed')}
                        >
                            Resume
                        </button>
                    )}
                    {campaign.status === 'scheduled' && campaign.sentCount === 0 && (
                        <button className="btn btn-outline" onClick={() => setRescheduling(true)}>
                            Reschedule
                        </button>
                    )}
                    {['scheduled', 'sending', 'paused'].includes(campaign.status) && (
                        <button
                            className="btn btn-danger"
                            onClick={() => {
                                if (!window.confirm('Cancel every unsent message in this campaign?'))
                                    return;
                                void run(async () => {
                                    const { cancelled } = await campaignApi.cancel(id);
                                    toast.success(`Cancelled ${cancelled.toLocaleString()} messages`);
                                }, 'Campaign cancelled');
                            }}
                        >
                            Cancel campaign
                        </button>
                    )}
                </div>
            </div>

            <div className="stat-grid">
                <div className="tile">
                    <div className="tile-label">Status</div>
                    <div style={{ marginTop: 4 }}>
                        <StatusBadge status={campaign.status} />
                    </div>
                    <div className="tile-delta">{formatDateTime(campaign.scheduledAt)}</div>
                </div>
                <div className="tile">
                    <div className="tile-label">Sent</div>
                    <div className="tile-value">{campaign.sentCount.toLocaleString()}</div>
                    <div className="tile-delta">
                        of {campaign.totalRecipients.toLocaleString()} recipients
                    </div>
                </div>
                <div className="tile">
                    <div className="tile-label">Open rate</div>
                    <div className="tile-value">{formatPercent(openRate)}</div>
                    <div className="tile-delta">{campaign.openedCount.toLocaleString()} opens</div>
                </div>
                <div className="tile">
                    <div className="tile-label">Click rate</div>
                    <div className="tile-value">{formatPercent(clickRate)}</div>
                    <div className="tile-delta">{campaign.clickedCount.toLocaleString()} clicks</div>
                </div>
                <div className="tile">
                    <div className="tile-label">Problems</div>
                    <div className="tile-value">
                        {(campaign.bouncedCount + campaign.failedCount).toLocaleString()}
                    </div>
                    <div className="tile-delta">
                        {campaign.bouncedCount} bounced · {campaign.complainedCount} complaints
                    </div>
                </div>
            </div>

            {campaign.status === 'paused' && campaign.complainedCount > 0 && (
                <div className="warning warning-high" style={{ marginBottom: 20 }}>
                    This campaign was paused automatically because its complaint rate crossed the
                    safe threshold. Review the content and the recipient list before resuming — the
                    alternative is your provider suspending the account.
                </div>
            )}

            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-title">Progress</div>
                <div className="card-sub">
                    {campaign.sentCount.toLocaleString()} of{' '}
                    {campaign.totalRecipients.toLocaleString()} messages handed to the provider.
                </div>
                <div className="progress">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>

                {campaign.breakdown && (
                    <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
                        {Object.entries(campaign.breakdown).map(([status, count]) => (
                            <span key={status} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                                <StatusBadge status={status as EmailMessage['status']} />
                                <span className="tabular">{count.toLocaleString()}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="table-wrap">
                <div style={{ padding: '16px 20px 0' }}>
                    <div className="card-title">Recipients</div>
                </div>

                {messages.length === 0 ? (
                    <EmptyState title="No messages" body="This campaign has no recipient rows." />
                ) : (
                    <>
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr>
                                        <th>Recipient</th>
                                        <th>Status</th>
                                        <th>Scheduled</th>
                                        <th>Sent</th>
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
                                                    <div
                                                        style={{ fontSize: 12, color: 'var(--danger)' }}
                                                    >
                                                        {message.errorMessage}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <StatusBadge status={message.status} />
                                            </td>
                                            <td className="nowrap muted">
                                                {formatDateTime(message.scheduledAt)}
                                            </td>
                                            <td className="nowrap muted">
                                                {formatDateTime(message.sentAt)}
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
                                                        onClick={() =>
                                                            void run(
                                                                () => emailApi.cancel(message.id),
                                                                'Message cancelled'
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
                        <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />
                    </>
                )}
            </div>

            <Modal
                open={rescheduling}
                onClose={() => setRescheduling(false)}
                title="Reschedule campaign"
                footer={
                    <>
                        <button className="btn btn-ghost" onClick={() => setRescheduling(false)}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" onClick={() => void reschedule()}>
                            Reschedule
                        </button>
                    </>
                }
            >
                <div className="field">
                    <label className="label" htmlFor="newTime">New send time</label>
                    <input
                        id="newTime"
                        type="datetime-local"
                        className="input"
                        value={newTime}
                        min={new Date().toISOString().slice(0, 16)}
                        onChange={(event) => setNewTime(event.target.value)}
                    />
                    <p className="hint">
                        Every recipient&apos;s slot is recomputed from this time, honouring the
                        campaign&apos;s throttle settings.
                    </p>
                </div>
            </Modal>
        </>
    );
}
