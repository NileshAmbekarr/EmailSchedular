'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { emailApi } from '@/lib/api';
import type { SentEmail } from '@/types';

export default function EmailPreviewPage() {
    const params = useParams();
    const router = useRouter();
    const [email, setEmail] = useState<SentEmail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEmail = async () => {
            try {
                // Try to get from sent emails
                const response = await emailApi.getSentEmails();
                const emails = response.data as unknown as SentEmail[];
                const found = emails?.find((e: SentEmail) => e.id === params.id);
                if (found) {
                    setEmail(found);
                }
            } catch (error) {
                console.error('Failed to fetch email:', error);
            } finally {
                setLoading(false);
            }
        };

        if (params.id) {
            fetchEmail();
        }
    }, [params.id]);

    if (loading) {
        return (
            <div className="email-preview-page">
                <div className="loading-spinner">Loading...</div>
            </div>
        );
    }

    if (!email) {
        return (
            <div className="email-preview-page">
                <div className="email-preview-header">
                    <button className="back-btn" onClick={() => router.back()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1>Email not found</h1>
                </div>
            </div>
        );
    }

    // Parse sender name from email
    const senderName = email.senderEmail?.split('@')[0] || email.sender?.name || 'Sender';
    const recipientName = email.recipientEmail?.split('@')[0] || 'Recipient';

    return (
        <div className="email-preview-page">
            {/* Header */}
            <div className="email-preview-header">
                <div className="email-preview-header-left">
                    <button className="back-btn" onClick={() => router.back()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="email-preview-title">
                        {recipientName}, hello there! | {email.subject}
                    </h1>
                </div>
                <div className="email-preview-header-right">
                    <button className="icon-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                        </svg>
                    </button>
                    <button className="icon-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="21 8 21 21 3 21 3 8" />
                            <rect x="1" y="3" width="22" height="5" />
                            <line x1="10" y1="12" x2="14" y2="12" />
                        </svg>
                    </button>
                    <button className="icon-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                    </button>
                    <div className="header-divider" />
                    <div className="user-avatar-small">
                        {recipientName.charAt(0).toUpperCase()}
                    </div>
                </div>
            </div>

            {/* Email Content */}
            <div className="email-preview-content">
                {/* Sender Info */}
                <div className="email-sender-info">
                    <div className="sender-avatar">
                        {senderName.charAt(0).toUpperCase()}
                    </div>
                    <div className="sender-details">
                        <div className="sender-name-row">
                            <span className="sender-name">{senderName}</span>
                            <span className="sender-email">&lt;{email.senderEmail || email.sender?.email}&gt;</span>
                        </div>
                        <div className="sender-to">
                            to me
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <path d="M6 9l6 6 6-6" />
                            </svg>
                        </div>
                    </div>
                    <div className="email-date">
                        {email.sentAt ? format(new Date(email.sentAt), 'MMM d, h:mm a') : 'Pending'}
                    </div>
                </div>

                {/* Email Body */}
                <div className="email-body">
                    {email.body ? (
                        <div dangerouslySetInnerHTML={{ __html: email.body }} />
                    ) : (
                        <div className="email-body-placeholder">
                            <p><strong>To:</strong> {email.recipientEmail}</p>
                            <p><strong>Subject:</strong> {email.subject}</p>
                            <br />
                            <p>This email was sent via Email Scheduler.</p>
                            <br />
                            {email.previewUrl && (
                                <p>
                                    <em>Click the link below to view the full email content on Ethereal.</em>
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* View on Ethereal link */}
                {email.previewUrl && (
                    <div className="email-ethereal-link">
                        <a href={email.previewUrl} target="_blank" rel="noopener noreferrer">
                            View original on Ethereal Email →
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}
