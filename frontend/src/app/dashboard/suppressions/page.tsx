'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { suppressionApi } from '@/lib/api';
import type { Suppression } from '@/types';
import { EmptyState, Loading, Modal, Pagination, formatDateTime } from '@/components/ui';

const REASON_TONE: Record<string, string> = {
    unsubscribed: 'badge-warn',
    hard_bounce: 'badge-danger',
    soft_bounce_threshold: 'badge-danger',
    complaint: 'badge-danger',
    manual: 'badge-neutral',
    invalid: 'badge-neutral',
};

const LIMIT = 50;

export default function SuppressionsPage() {
    const [rows, setRows] = useState<Suppression[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [search, setSearch] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [newEmail, setNewEmail] = useState('');

    const load = useCallback(async () => {
        try {
            const page = await suppressionApi.list({
                limit: LIMIT,
                offset,
                search: search || undefined,
                reason: reason || undefined,
            });
            setRows(page.items);
            setTotal(page.pagination.total);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, [offset, search, reason]);

    useEffect(() => {
        void load();
    }, [load]);

    const add = async () => {
        try {
            await suppressionApi.add(newEmail);
            toast.success('Address suppressed');
            setOpen(false);
            setNewEmail('');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const remove = async (email: string) => {
        if (
            !window.confirm(
                `Remove ${email} from the suppression list? Only do this if it was suppressed by mistake — mailing a genuine unsubscribe or hard bounce damages your sending reputation.`
            )
        ) {
            return;
        }

        try {
            await suppressionApi.remove(email);
            toast.success('Removed');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Suppressions</h1>
                    <p className="page-sub">
                        {total.toLocaleString()} addresses that will never be contacted again.
                        Checked immediately before every send.
                    </p>
                </div>
                <button className="btn btn-outline" onClick={() => setOpen(true)}>
                    Add address
                </button>
            </div>

            <div className="toolbar">
                <input
                    className="input"
                    placeholder="Search addresses…"
                    value={search}
                    onChange={(event) => {
                        setSearch(event.target.value);
                        setOffset(0);
                    }}
                />
                <select
                    className="select"
                    value={reason}
                    onChange={(event) => {
                        setReason(event.target.value);
                        setOffset(0);
                    }}
                >
                    <option value="">All reasons</option>
                    <option value="unsubscribed">Unsubscribed</option>
                    <option value="hard_bounce">Hard bounce</option>
                    <option value="soft_bounce_threshold">Repeated soft bounces</option>
                    <option value="complaint">Spam complaint</option>
                    <option value="manual">Added manually</option>
                    <option value="invalid">Invalid address</option>
                </select>
            </div>

            <div className="table-wrap">
                {loading ? (
                    <Loading />
                ) : rows.length === 0 ? (
                    <EmptyState
                        title="Nothing suppressed"
                        body="Unsubscribes, hard bounces and spam complaints land here automatically."
                    />
                ) : (
                    <>
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr>
                                        <th>Address</th>
                                        <th>Reason</th>
                                        <th>Detail</th>
                                        <th>Added</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr key={row.id}>
                                            <td style={{ fontWeight: 500 }}>{row.email}</td>
                                            <td>
                                                <span
                                                    className={`badge ${REASON_TONE[row.reason] ?? 'badge-neutral'}`}
                                                >
                                                    {row.reason.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="muted" style={{ maxWidth: 320 }}>
                                                {row.detail ?? '—'}
                                            </td>
                                            <td className="nowrap muted">
                                                {formatDateTime(row.createdAt)}
                                            </td>
                                            <td className="right">
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => void remove(row.email)}
                                                >
                                                    Remove
                                                </button>
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
                open={open}
                onClose={() => setOpen(false)}
                title="Suppress an address"
                footer={
                    <>
                        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" onClick={() => void add()}>
                            Suppress
                        </button>
                    </>
                }
            >
                <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="suppressEmail">Email address</label>
                    <input
                        id="suppressEmail"
                        type="email"
                        className="input"
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        placeholder="someone@example.com"
                    />
                    <p className="hint">
                        This address will be skipped by every future campaign, including ones
                        already scheduled.
                    </p>
                </div>
            </Modal>
        </>
    );
}
