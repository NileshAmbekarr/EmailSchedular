'use client';

import { format } from 'date-fns';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ScheduledEmail, SentEmail, EmailStatus } from '@/types';

interface ScheduledEmailTableProps {
    emails: ScheduledEmail[];
    loading: boolean;
}

export function ScheduledEmailTable({ emails, loading }: ScheduledEmailTableProps) {
    if (loading) {
        return <div className="loading-spinner">Loading...</div>;
    }

    if (emails.length === 0) {
        return (
            <EmptyState
                icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                }
                title="No scheduled emails"
                description="Schedule your first email to get started"
            />
        );
    }

    return (
        <div className="table-container">
            <table className="email-table">
                <thead>
                    <tr>
                        <th>Recipient</th>
                        <th>Subject</th>
                        <th>Scheduled Time</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {emails.map((email) => (
                        <tr key={email.id}>
                            <td>{email.recipientEmail}</td>
                            <td>{email.subject}</td>
                            <td>{format(new Date(email.scheduledAt), 'MMM d, yyyy h:mm a')}</td>
                            <td>
                                <Badge variant={email.status as EmailStatus}>
                                    {email.status.charAt(0).toUpperCase() + email.status.slice(1)}
                                </Badge>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

interface SentEmailTableProps {
    emails: SentEmail[];
    loading: boolean;
}

export function SentEmailTable({ emails, loading }: SentEmailTableProps) {
    if (loading) {
        return <div className="loading-spinner">Loading...</div>;
    }

    if (emails.length === 0) {
        return (
            <EmptyState
                icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                }
                title="No sent emails yet"
                description="Emails will appear here once they are sent"
            />
        );
    }

    return (
        <div className="table-container">
            <table className="email-table">
                <thead>
                    <tr>
                        <th>Recipient</th>
                        <th>Subject</th>
                        <th>Sent Time</th>
                        <th>Status</th>
                        <th>Preview</th>
                    </tr>
                </thead>
                <tbody>
                    {emails.map((email) => (
                        <tr key={email.id}>
                            <td>{email.recipientEmail}</td>
                            <td>{email.subject}</td>
                            <td>{email.sentAt ? format(new Date(email.sentAt), 'MMM d, yyyy h:mm a') : '-'}</td>
                            <td>
                                <Badge variant={email.status}>
                                    {email.status.charAt(0).toUpperCase() + email.status.slice(1)}
                                </Badge>
                            </td>
                            <td>
                                {email.previewUrl ? (
                                    <a href={email.previewUrl} target="_blank" rel="noopener noreferrer" className="preview-link">
                                        View
                                    </a>
                                ) : email.errorMessage ? (
                                    <span className="error-text" title={email.errorMessage}>Error</span>
                                ) : (
                                    '-'
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
