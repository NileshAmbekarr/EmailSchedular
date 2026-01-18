'use client';

import { useEmails } from '@/hooks/useEmails';
import { ScheduledEmailList } from '@/components/email/EmailList';

export default function ScheduledPage() {
    const { scheduledEmails, loading, refreshScheduled } = useEmails();

    return (
        <>
            {/* Header */}
            <div className="content-header">
                <div className="search-bar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input type="text" placeholder="Search" />
                </div>
                <div className="header-actions">
                    <button className="icon-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46" />
                        </svg>
                    </button>
                    <button className="icon-btn" onClick={refreshScheduled}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Email List */}
            <ScheduledEmailList emails={scheduledEmails} loading={loading} />
        </>
    );
}
