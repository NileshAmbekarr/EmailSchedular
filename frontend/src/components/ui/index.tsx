'use client';

import { useEffect, type ReactNode } from 'react';
import type { CampaignStatus, EmailStatus } from '@/types';

/** Shared presentational primitives used across the dashboard. */

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

const EMAIL_TONE: Record<EmailStatus, string> = {
    pending: 'badge-neutral',
    queued: 'badge-info',
    processing: 'badge-info',
    retrying: 'badge-warn',
    sent: 'badge-success',
    delivered: 'badge-success',
    bounced: 'badge-danger',
    failed: 'badge-danger',
    cancelled: 'badge-neutral',
    suppressed: 'badge-warn',
};

const CAMPAIGN_TONE: Record<CampaignStatus, string> = {
    draft: 'badge-neutral',
    scheduled: 'badge-info',
    sending: 'badge-success',
    paused: 'badge-warn',
    completed: 'badge-success',
    cancelled: 'badge-neutral',
};

export function StatusBadge({ status }: { status: EmailStatus | CampaignStatus }) {
    const tone =
        EMAIL_TONE[status as EmailStatus] ?? CAMPAIGN_TONE[status as CampaignStatus] ?? 'badge-neutral';

    return <span className={`badge ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Loading({ label = 'Loading…' }: { label?: string }) {
    return (
        <div className="loading-block">
            <span className="spinner" aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}

export function EmptyState({
    title,
    body,
    action,
    icon,
}: {
    title: string;
    body: string;
    action?: ReactNode;
    icon?: ReactNode;
}) {
    return (
        <div className="empty">
            <div className="empty-icon">
                {icon ?? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-10 6L2 7" />
                    </svg>
                )}
            </div>
            <div className="empty-title">{title}</div>
            <p className="empty-body">{body}</p>
            {action}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
    open,
    onClose,
    title,
    children,
    footer,
    wide,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    wide?: boolean;
}) {
    // Escape closes; body scroll is locked while open.
    useEffect(() => {
        if (!open) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="modal-backdrop"
            onClick={onClose}
            role="presentation"
        >
            <div
                className={`modal ${wide ? 'modal-wide' : ''}`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="modal-head">
                    <h2 className="modal-title">{title}</h2>
                    <button className="icon-btn" onClick={onClose} aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-foot">{footer}</div>}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export function Pagination({
    total,
    limit,
    offset,
    onChange,
}: {
    total: number;
    limit: number;
    offset: number;
    onChange: (offset: number) => void;
}) {
    if (total === 0) return null;

    const from = offset + 1;
    const to = Math.min(offset + limit, total);

    return (
        <div className="pagination">
            <span>
                {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
                <button
                    className="btn btn-outline btn-sm"
                    disabled={offset === 0}
                    onClick={() => onChange(Math.max(0, offset - limit))}
                >
                    Previous
                </button>
                <button
                    className="btn btn-outline btn-sm"
                    disabled={to >= total}
                    onClick={() => onChange(offset + limit)}
                >
                    Next
                </button>
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const formatDateTime = (value?: string | null): string => {
    if (!value) return '—';
    return new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const formatRelative = (value?: string | null): string => {
    if (!value) return '—';

    const diff = new Date(value).getTime() - Date.now();
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
    ];

    for (const [unit, ms] of units) {
        if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
    }
    return 'just now';
};

export const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export const initials = (name: string): string =>
    name
        .split(' ')
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
