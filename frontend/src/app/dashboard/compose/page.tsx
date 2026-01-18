'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { useEmails } from '@/hooks/useEmails';
import toast from 'react-hot-toast';

interface Attachment {
    name: string;
    size: number;
    type: string;
    file: File;
}

export default function ComposePage() {
    const router = useRouter();
    const { senders, scheduleEmails } = useEmails();

    const [senderId, setSenderId] = useState('');
    const [recipients, setRecipients] = useState<string[]>([]);
    const [recipientInput, setRecipientInput] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [delayBetween, setDelayBetween] = useState('00');
    const [hourlyLimit, setHourlyLimit] = useState('00');
    const [showScheduler, setShowScheduler] = useState(false);
    const [scheduledAt, setScheduledAt] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [loading, setLoading] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null);

    // Update senderId when senders load
    useEffect(() => {
        if (senders.length > 0 && !senderId) {
            setSenderId(senders[0].id);
        }
    }, [senders, senderId]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            complete: (results) => {
                const emails: string[] = [];
                results.data.forEach((row: unknown) => {
                    if (Array.isArray(row)) {
                        row.forEach((cell) => {
                            const email = String(cell).trim();
                            if (email && email.includes('@')) {
                                emails.push(email);
                            }
                        });
                    }
                });
                const uniqueEmails = [...new Set([...recipients, ...emails])];
                setRecipients(uniqueEmails);
                toast.success(`Added ${emails.length} email addresses`);
            },
            error: () => {
                toast.error('Failed to parse file');
            },
        });
        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        const newAttachments: Attachment[] = [];
        Array.from(files).forEach((file) => {
            newAttachments.push({
                name: file.name,
                size: file.size,
                type: file.type,
                file: file,
            });
        });
        setAttachments([...attachments, ...newAttachments]);
        toast.success(`Added ${newAttachments.length} attachment(s)`);

        // Reset file input
        if (attachmentInputRef.current) {
            attachmentInputRef.current.value = '';
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(attachments.filter((_, i) => i !== index));
    };

    const addRecipient = (email: string) => {
        const trimmed = email.trim();
        if (trimmed && trimmed.includes('@') && !recipients.includes(trimmed)) {
            setRecipients([...recipients, trimmed]);
            setRecipientInput('');
        }
    };

    const removeRecipient = (email: string) => {
        setRecipients(recipients.filter(r => r !== email));
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
            e.preventDefault();
            if (recipientInput.trim()) {
                // Split by comma or space to handle multiple emails pasted
                const emails = recipientInput.split(/[,\s]+/).filter(email => email.includes('@'));
                emails.forEach(email => addRecipient(email));
                setRecipientInput('');
            }
        } else if (e.key === 'Backspace' && !recipientInput && recipients.length > 0) {
            // Remove last recipient if backspace pressed with empty input
            setRecipients(recipients.slice(0, -1));
        }
    };

    const handleInputBlur = () => {
        if (recipientInput.trim()) {
            const emails = recipientInput.split(/[,\s]+/).filter(email => email.includes('@'));
            emails.forEach(email => addRecipient(email));
            setRecipientInput('');
        }
    };

    const handleSend = async () => {
        if (!senderId) {
            toast.error('Please select a sender');
            return;
        }

        if (recipients.length === 0) {
            toast.error('Please add recipient email addresses');
            return;
        }

        if (!subject.trim()) {
            toast.error('Please enter a subject');
            return;
        }

        if (!scheduledAt) {
            toast.error('Please select a schedule time');
            return;
        }

        setLoading(true);
        try {
            await scheduleEmails({
                senderId,
                recipients,
                subject,
                body: body || `<p>${subject}</p>`,
                scheduledAt: new Date(scheduledAt).toISOString(),
            });
            toast.success(`Scheduled ${recipients.length} emails`);
            router.push('/dashboard/scheduled');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to schedule emails');
        } finally {
            setLoading(false);
        }
    };

    const handleQuickSchedule = (option: string) => {
        const now = new Date();
        let scheduled = new Date();

        switch (option) {
            case 'tomorrow':
                scheduled.setDate(now.getDate() + 1);
                scheduled.setHours(9, 0, 0, 0);
                break;
            case 'tomorrow-10':
                scheduled.setDate(now.getDate() + 1);
                scheduled.setHours(10, 0, 0, 0);
                break;
            case 'tomorrow-11':
                scheduled.setDate(now.getDate() + 1);
                scheduled.setHours(11, 0, 0, 0);
                break;
            case 'tomorrow-3':
                scheduled.setDate(now.getDate() + 1);
                scheduled.setHours(15, 0, 0, 0);
                break;
        }

        setScheduledAt(scheduled.toISOString().slice(0, 16));
        setShowScheduler(false);
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
        <div className="compose-page">
            {/* Header */}
            <div className="compose-header">
                <div className="compose-header-left">
                    <button className="back-btn" onClick={() => router.back()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="compose-title">Compose New Email</h1>
                </div>
                <div className="compose-header-right">
                    {/* Attachment button */}
                    <button
                        className="icon-btn"
                        onClick={() => attachmentInputRef.current?.click()}
                        style={{ position: 'relative' }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
                        {attachments.length > 0 && (
                            <span className="badge-count">{attachments.length}</span>
                        )}
                    </button>
                    <input
                        type="file"
                        ref={attachmentInputRef}
                        multiple
                        onChange={handleAttachmentUpload}
                        style={{ display: 'none' }}
                    />

                    {/* Schedule button */}
                    <div style={{ position: 'relative' }}>
                        <button className="icon-btn" onClick={() => setShowScheduler(!showScheduler)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12,6 12,12 16,14" />
                            </svg>
                        </button>

                        {/* Schedule Dropdown */}
                        {showScheduler && (
                            <div className="send-later-dropdown">
                                <div className="send-later-header">Send Later</div>
                                <div className="send-later-input">
                                    <input
                                        type="datetime-local"
                                        className="datetime-input"
                                        value={scheduledAt}
                                        onChange={(e) => setScheduledAt(e.target.value)}
                                        min={new Date().toISOString().slice(0, 16)}
                                    />
                                </div>
                                <div className="send-later-options">
                                    <div className="send-later-option" onClick={() => handleQuickSchedule('tomorrow')}>
                                        <span>Tomorrow</span>
                                        <span className="option-time">9:00 AM</span>
                                    </div>
                                    <div className="send-later-option" onClick={() => handleQuickSchedule('tomorrow-10')}>
                                        <span>Tomorrow</span>
                                        <span className="option-time">10:00 AM</span>
                                    </div>
                                    <div className="send-later-option" onClick={() => handleQuickSchedule('tomorrow-11')}>
                                        <span>Tomorrow</span>
                                        <span className="option-time">11:00 AM</span>
                                    </div>
                                    <div className="send-later-option" onClick={() => handleQuickSchedule('tomorrow-3')}>
                                        <span>Tomorrow</span>
                                        <span className="option-time">3:00 PM</span>
                                    </div>
                                </div>
                                <div className="send-later-footer">
                                    <button className="btn btn-ghost btn-sm" onClick={() => setShowScheduler(false)}>
                                        Cancel
                                    </button>
                                    <button className="btn btn-outline btn-sm" onClick={() => setShowScheduler(false)}>
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    <button className="send-btn" onClick={handleSend} disabled={loading}>
                        {loading ? 'Sending...' : 'Send Later'}
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="compose-body">
                {/* From */}
                <div className="compose-field">
                    <span className="compose-label">From</span>
                    <select
                        className="compose-select"
                        value={senderId}
                        onChange={(e) => setSenderId(e.target.value)}
                    >
                        {senders.map((sender) => (
                            <option key={sender.id} value={sender.id}>
                                {sender.email}
                            </option>
                        ))}
                    </select>
                </div>

                {/* To with chips */}
                <div className="compose-field">
                    <span className="compose-label">To</span>
                    <div className="recipients-container">
                        <div className="email-chips-input">
                            {recipients.map((email) => (
                                <span key={email} className="email-chip">
                                    {email}
                                    <button className="chip-remove" onClick={() => removeRecipient(email)}>×</button>
                                </span>
                            ))}
                            <input
                                type="text"
                                className="chip-input"
                                placeholder={recipients.length === 0 ? "Enter email addresses..." : ""}
                                value={recipientInput}
                                onChange={(e) => setRecipientInput(e.target.value)}
                                onKeyDown={handleInputKeyDown}
                                onBlur={handleInputBlur}
                            />
                        </div>
                        <button className="upload-list-btn" onClick={() => fileInputRef.current?.click()}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                            </svg>
                            Upload List
                        </button>
                    </div>
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept=".csv,.txt"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />
                </div>

                {/* Subject */}
                <div className="compose-field">
                    <span className="compose-label">Subject</span>
                    <input
                        type="text"
                        className="compose-input"
                        placeholder="Subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                    />
                </div>

                {/* Delay & Limit */}
                <div className="compose-row">
                    <div className="compose-row-item">
                        <span className="compose-row-label">Delay between 2 emails</span>
                        <input
                            type="text"
                            className="compose-row-input"
                            value={delayBetween}
                            onChange={(e) => setDelayBetween(e.target.value)}
                            placeholder="00"
                        />
                    </div>
                    <div className="compose-row-item">
                        <span className="compose-row-label">Hourly Limit</span>
                        <input
                            type="text"
                            className="compose-row-input"
                            value={hourlyLimit}
                            onChange={(e) => setHourlyLimit(e.target.value)}
                            placeholder="00"
                        />
                    </div>
                </div>

                {/* Attachments Preview */}
                {attachments.length > 0 && (
                    <div className="attachments-preview">
                        {attachments.map((att, index) => (
                            <div key={index} className="attachment-item">
                                <div className="attachment-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                        <polyline points="14,2 14,8 20,8" />
                                    </svg>
                                </div>
                                <div className="attachment-details">
                                    <span className="attachment-name">{att.name}</span>
                                    <span className="attachment-size">{formatFileSize(att.size)}</span>
                                </div>
                                <button className="attachment-remove" onClick={() => removeAttachment(index)}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Editor */}
                <div className="compose-editor">
                    <div
                        className="editor-content"
                        contentEditable
                        data-placeholder="Type Your Reply..."
                        onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
                    />
                    <div className="editor-toolbar">
                        <button className="toolbar-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                        </button>
                        <button className="toolbar-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                            </svg>
                        </button>
                        <div className="toolbar-divider" />
                        <button className="toolbar-btn">Tt</button>
                        <div className="toolbar-divider" />
                        <button className="toolbar-btn"><strong>B</strong></button>
                        <button className="toolbar-btn"><em>I</em></button>
                        <button className="toolbar-btn"><u>U</u></button>
                        <div className="toolbar-divider" />
                        <button className="toolbar-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="21" y1="6" x2="3" y2="6" />
                                <line x1="15" y1="12" x2="3" y2="12" />
                                <line x1="17" y1="18" x2="3" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
