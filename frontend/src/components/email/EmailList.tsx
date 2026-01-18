'use client';

import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ScheduledEmail, SentEmail } from '@/types';

interface ScheduledEmailListProps {
    emails: ScheduledEmail[];
    loading: boolean;
}

export function ScheduledEmailList({ emails, loading }: ScheduledEmailListProps) {
    if (loading) {
        return <div className="loading-spinner">Loading...</div>;
    }

    if (emails.length === 0) {
        return (
            <EmptyState
                icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12,6 12,12 16,14" />
                    </svg>
                }
                title="No scheduled emails"
                description="Schedule your first email to get started"
            />
        );
    }

    return (
        <div className="email-list">
            {emails.map((email) => (
                <div key={email.id} className="email-item">
                    <div className="email-recipient">To: {email.recipientEmail.split('@')[0]}</div>
                    <span className="email-badge scheduled">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12,6 12,12 16,14" />
                        </svg>
                        {format(new Date(email.scheduledAt), 'EEE h:mm:ss a')}
                    </span>
                    <div className="email-content">
                        <span className="email-subject">{email.subject}</span>
                        <span className="email-preview">- {email.subject}...</span>
                    </div>
                    <div className="email-star">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                        </svg>
                    </div>
                </div>
            ))}
        </div>
    );
}

interface SentEmailListProps {
    emails: SentEmail[];
    loading: boolean;
}

export function SentEmailList({ emails, loading }: SentEmailListProps) {
    const router = useRouter();

    const handleEmailClick = (emailId: string) => {
        router.push(`/dashboard/email/${emailId}`);
    };

    if (loading) {
        return <div className="loading-spinner">Loading...</div>;
    }

    if (emails.length === 0) {
        return (
            <EmptyState
                icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                }
                title="No sent emails yet"
                description="Emails will appear here once they are sent"
            />
        );
    }

    return (
        <div className="email-list">
            {emails.map((email) => (
                <div
                    key={email.id}
                    className="email-item"
                    onClick={() => handleEmailClick(email.id)}
                >
                    <div className="email-recipient">To: {email.recipientEmail.split('@')[0]}</div>
                    <span className="email-badge sent">Sent</span>
                    <div className="email-content">
                        <span className="email-subject">{email.subject}</span>
                        <span className="email-preview">
                            - Click to view email details...
                        </span>
                    </div>
                    <div className="email-star" onClick={(e) => e.stopPropagation()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                        </svg>
                    </div>
                </div>
            ))}
        </div>
    );
}
