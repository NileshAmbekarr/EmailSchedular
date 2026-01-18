'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Sender, ScheduleEmailRequest } from '@/types';
import toast from 'react-hot-toast';

interface ComposeModalProps {
    isOpen: boolean;
    onClose: () => void;
    senders: Sender[];
    onSchedule: (request: ScheduleEmailRequest) => Promise<void>;
}

export function ComposeModal({ isOpen, onClose, senders, onSchedule }: ComposeModalProps) {
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [senderId, setSenderId] = useState(senders[0]?.id || '');
    const [recipients, setRecipients] = useState<string[]>([]);
    const [scheduledAt, setScheduledAt] = useState('');
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                setRecipients([...new Set(emails)]); // Remove duplicates
                toast.success(`Found ${emails.length} email addresses`);
            },
            error: () => {
                toast.error('Failed to parse file');
            },
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!senderId) {
            toast.error('Please select a sender');
            return;
        }
        if (recipients.length === 0) {
            toast.error('Please upload a file with email addresses');
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
            await onSchedule({
                senderId,
                recipients,
                subject,
                body,
                scheduledAt: new Date(scheduledAt).toISOString(),
            });
            toast.success(`Scheduled ${recipients.length} emails`);
            onClose();
            // Reset form
            setSubject('');
            setBody('');
            setRecipients([]);
            setScheduledAt('');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to schedule emails');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Compose New Email">
            <form onSubmit={handleSubmit} className="compose-form">
                <div className="form-group">
                    <label className="input-label">Sender</label>
                    <select
                        value={senderId}
                        onChange={(e) => setSenderId(e.target.value)}
                        className="input"
                    >
                        {senders.map((sender) => (
                            <option key={sender.id} value={sender.id}>
                                {sender.name} ({sender.email})
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label className="input-label">Recipients (CSV/Text file)</label>
                    <div className="file-upload-area">
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept=".csv,.txt"
                            onChange={handleFileUpload}
                            className="file-input"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Upload File
                        </Button>
                        {recipients.length > 0 && (
                            <span className="recipient-count">
                                {recipients.length} email{recipients.length !== 1 ? 's' : ''} found
                            </span>
                        )}
                    </div>
                </div>

                <Input
                    label="Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Enter email subject"
                    required
                />

                <div className="form-group">
                    <label className="input-label">Body</label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Enter email body (HTML supported)"
                        className="input textarea"
                        rows={5}
                    />
                </div>

                <Input
                    type="datetime-local"
                    label="Schedule Time"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    required
                />

                <div className="form-actions">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" loading={loading}>
                        Schedule Emails
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
