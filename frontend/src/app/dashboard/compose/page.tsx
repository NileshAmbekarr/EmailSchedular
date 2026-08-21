'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { campaignApi, composerApi, listApi, senderApi, templateApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type {
    ContactList,
    ContentWarning,
    PreviewResult,
    RecipientInput,
    Sender,
    Template,
} from '@/types';
import { Loading, Modal } from '@/components/ui';

/**
 * Campaign composer.
 *
 * Recipients carry their CSV columns through as merge data, so a spreadsheet
 * with `email,first_name,company` produces three usable variables rather than
 * discarding everything but the address.
 */
export default function ComposePage() {
    const router = useRouter();
    const { user } = useAuth();

    const [senders, setSenders] = useState<Sender[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [lists, setLists] = useState<ContactList[]>([]);
    const [loading, setLoading] = useState(true);

    const [name, setName] = useState('');
    const [senderId, setSenderId] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [scheduledAt, setScheduledAt] = useState('');
    const [listId, setListId] = useState('');
    const [recipients, setRecipients] = useState<RecipientInput[]>([]);
    const [recipientInput, setRecipientInput] = useState('');
    const [csvColumns, setCsvColumns] = useState<string[]>([]);

    const [trackOpens, setTrackOpens] = useState(true);
    const [trackClicks, setTrackClicks] = useState(true);
    const [perRecipientTimezone, setPerRecipientTimezone] = useState(false);
    const [maxEmailsPerHour, setMaxEmailsPerHour] = useState('');
    const [delayBetweenEmailsMs, setDelayBetweenEmailsMs] = useState('');

    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [warnings, setWarnings] = useState<ContentWarning[]>([]);
    const [testOpen, setTestOpen] = useState(false);
    const [testAddress, setTestAddress] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fileRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [senderList, templateList, contactLists] = await Promise.all([
                    senderApi.list(),
                    templateApi.list().catch(() => []),
                    listApi.list().catch(() => []),
                ]);
                setSenders(senderList);
                setTemplates(templateList);
                setLists(contactLists);
                setSenderId(senderList.find((s) => s.isDefault)?.id ?? senderList[0]?.id ?? '');
            } catch (error) {
                toast.error((error as Error).message);
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, []);

    // Lint content as it is written, but not on every keystroke.
    useEffect(() => {
        if (!subject && !body) {
            setWarnings([]);
            return;
        }

        const timer = setTimeout(async () => {
            try {
                const result = await composerApi.preview({ subject, body });
                setWarnings(result.warnings);
            } catch {
                // Advisory only — never block composing on it.
            }
        }, 900);

        return () => clearTimeout(timer);
    }, [subject, body]);

    const variables = useMemo(() => {
        const found = new Set<string>();
        for (const match of `${subject} ${body}`.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)/g)) {
            found.add(match[1]);
        }
        return [...found];
    }, [subject, body]);

    const totalRecipients = listId
        ? (lists.find((l) => l.id === listId)?.contactCount ?? 0)
        : recipients.length;

    /** Every non-email column becomes a merge variable for that recipient. */
    const handleCsv = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const columns = results.meta.fields ?? [];
                const emailColumn =
                    columns.find((c) => /^e-?mail$/i.test(c.trim())) ??
                    columns.find((c) => /mail/i.test(c));

                if (!emailColumn) {
                    toast.error('No email column found — name one of the columns "email"');
                    return;
                }

                const parsed: RecipientInput[] = [];
                for (const row of results.data) {
                    const address = row[emailColumn]?.trim();
                    if (!address || !address.includes('@')) continue;

                    const fields: Record<string, string> = {};
                    for (const column of columns) {
                        if (column === emailColumn) continue;
                        const value = row[column]?.trim();
                        if (value) fields[column.trim()] = value;
                    }
                    parsed.push({ email: address.toLowerCase(), fields });
                }

                const merged = new Map(recipients.map((r) => [r.email, r]));
                for (const entry of parsed) merged.set(entry.email, entry);

                setRecipients([...merged.values()]);
                setCsvColumns(columns.filter((c) => c !== emailColumn).map((c) => c.trim()));
                toast.success(`Loaded ${parsed.length.toLocaleString()} recipients`);
            },
            error: () => toast.error('Could not parse that file'),
        });

        if (fileRef.current) fileRef.current.value = '';
    };

    const addTyped = (raw: string) => {
        const found = raw
            .split(/[,;\s]+/)
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.includes('@'));

        if (found.length === 0) return;

        const merged = new Map(recipients.map((r) => [r.email, r]));
        for (const email of found) if (!merged.has(email)) merged.set(email, { email, fields: {} });

        setRecipients([...merged.values()]);
        setRecipientInput('');
    };

    const insertVariable = (variable: string) => {
        const textarea = bodyRef.current;
        const token = `{{${variable}}}`;

        if (!textarea) {
            setBody((current) => current + token);
            return;
        }

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        setBody((current) => current.slice(0, start) + token + current.slice(end));

        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const applyTemplate = (templateId: string) => {
        const template = templates.find((t) => t.id === templateId);
        if (!template) return;
        setSubject(template.subject);
        setBody(template.body);
        if (!name) setName(template.name);
    };

    const openPreview = async () => {
        try {
            const sample = Object.fromEntries(variables.map((v) => [v, `[${v}]`]));
            setPreview(await composerApi.preview({ subject, body, mergeData: sample }));
            setPreviewOpen(true);
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const sendTest = async () => {
        try {
            const sample = Object.fromEntries(variables.map((v) => [v, `[${v}]`]));
            const result = await composerApi.testSend({
                senderId,
                to: testAddress,
                subject,
                body,
                mergeData: sample,
            });
            toast.success('Test sent');
            if (result.previewUrl) window.open(result.previewUrl, '_blank', 'noopener');
            setTestOpen(false);
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const submit = async (draft: boolean) => {
        if (!name.trim()) return toast.error('Give the campaign a name');
        if (!senderId) return toast.error('Choose a sender');
        if (!subject.trim()) return toast.error('Add a subject line');
        if (!body.trim()) return toast.error('Add a message body');
        if (!scheduledAt) return toast.error('Choose a send time');
        if (!listId && recipients.length === 0) return toast.error('Add some recipients');

        setSubmitting(true);
        try {
            const result = await campaignApi.create({
                name,
                senderId,
                subject,
                body,
                scheduledAt: new Date(scheduledAt).toISOString(),
                timezone: user?.timezone,
                perRecipientTimezone,
                listId: listId || undefined,
                recipients: listId ? undefined : recipients,
                trackOpens,
                trackClicks,
                maxEmailsPerHour: maxEmailsPerHour ? Number(maxEmailsPerHour) : undefined,
                delayBetweenEmailsMs: delayBetweenEmailsMs
                    ? Number(delayBetweenEmailsMs)
                    : undefined,
                draft,
            });

            const notes: string[] = [];
            if (result.suppressedCount > 0) {
                notes.push(`${result.suppressedCount} suppressed`);
            }
            if (result.duplicateCount > 0) {
                notes.push(`${result.duplicateCount} duplicates removed`);
            }

            toast.success(
                `Scheduled ${result.totalRecipients.toLocaleString()} messages` +
                    (notes.length ? ` (${notes.join(', ')})` : '')
            );

            router.push(`/dashboard/campaigns/${result.campaign.id}`);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <Loading />;

    if (senders.length === 0) {
        return (
            <div className="card">
                <div className="card-title">No sender configured</div>
                <p className="card-sub">
                    You need a sending identity before you can compose a campaign.
                </p>
                <a href="/dashboard/settings" className="btn btn-accent">
                    Add a sender
                </a>
            </div>
        );
    }

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">New campaign</h1>
                    <p className="page-sub">
                        {totalRecipients.toLocaleString()} recipient
                        {totalRecipients === 1 ? '' : 's'} selected
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline" onClick={() => void openPreview()}>
                        Preview
                    </button>
                    <button
                        className="btn btn-outline"
                        onClick={() => {
                            setTestAddress(user?.email ?? '');
                            setTestOpen(true);
                        }}
                    >
                        Send test
                    </button>
                    <button
                        className="btn btn-ghost"
                        disabled={submitting}
                        onClick={() => void submit(true)}
                    >
                        Save draft
                    </button>
                    <button
                        className="btn btn-accent"
                        disabled={submitting}
                        onClick={() => void submit(false)}
                    >
                        {submitting ? 'Scheduling…' : 'Schedule campaign'}
                    </button>
                </div>
            </div>

            <div className="composer">
                {/* ---- Main column ---- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="card">
                        <div className="field">
                            <label className="label" htmlFor="campaignName">Campaign name</label>
                            <input
                                id="campaignName"
                                className="input"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="March product launch"
                            />
                            <p className="hint">Internal only — recipients never see this.</p>
                        </div>

                        <div className="field">
                            <label className="label" htmlFor="sender">From</label>
                            <select
                                id="sender"
                                className="select"
                                value={senderId}
                                onChange={(event) => setSenderId(event.target.value)}
                            >
                                {senders.map((sender) => (
                                    <option key={sender.id} value={sender.id}>
                                        {sender.name} &lt;{sender.email}&gt;
                                        {sender.provider === 'ethereal' ? ' — sandbox' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {templates.length > 0 && (
                            <div className="field">
                                <label className="label" htmlFor="template">Start from a template</label>
                                <select
                                    id="template"
                                    className="select"
                                    defaultValue=""
                                    onChange={(event) => applyTemplate(event.target.value)}
                                >
                                    <option value="">None</option>
                                    {templates.map((template) => (
                                        <option key={template.id} value={template.id}>
                                            {template.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="field">
                            <label className="label" htmlFor="subject">Subject</label>
                            <input
                                id="subject"
                                className="input"
                                value={subject}
                                onChange={(event) => setSubject(event.target.value)}
                                placeholder="Hi {{first_name|there}}, something new"
                            />
                        </div>

                        <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" htmlFor="body">Body</label>
                            <textarea
                                id="body"
                                ref={bodyRef}
                                className="textarea"
                                value={body}
                                rows={14}
                                onChange={(event) => setBody(event.target.value)}
                                placeholder="<p>Hi {{first_name|there}},</p>&#10;<p>…</p>"
                            />
                            <p className="hint">
                                HTML is supported and sanitised. An unsubscribe footer is appended
                                automatically.
                            </p>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-title">Recipients</div>
                        <div className="card-sub">
                            Upload a CSV, pick a saved audience, or type addresses directly.
                        </div>

                        {lists.length > 0 && (
                            <div className="field">
                                <label className="label" htmlFor="audience">Saved audience</label>
                                <select
                                    id="audience"
                                    className="select"
                                    value={listId}
                                    onChange={(event) => setListId(event.target.value)}
                                >
                                    <option value="">None — use the list below</option>
                                    {lists.map((list) => (
                                        <option key={list.id} value={list.id}>
                                            {list.name} ({list.contactCount.toLocaleString()})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {!listId && (
                            <>
                                <div className="field">
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: 6,
                                        }}
                                    >
                                        <span className="label" style={{ marginBottom: 0 }}>
                                            Addresses
                                        </span>
                                        <button
                                            className="btn btn-outline btn-sm"
                                            onClick={() => fileRef.current?.click()}
                                        >
                                            Upload CSV
                                        </button>
                                        <input
                                            ref={fileRef}
                                            type="file"
                                            accept=".csv,.txt"
                                            onChange={handleCsv}
                                            style={{ display: 'none' }}
                                        />
                                    </div>

                                    <div className="recipient-box">
                                        {recipients.slice(0, 60).map((recipient) => (
                                            <span key={recipient.email} className="chip">
                                                {recipient.email}
                                                <button
                                                    onClick={() =>
                                                        setRecipients(
                                                            recipients.filter(
                                                                (r) => r.email !== recipient.email
                                                            )
                                                        )
                                                    }
                                                    aria-label={`Remove ${recipient.email}`}
                                                >
                                                    ×
                                                </button>
                                            </span>
                                        ))}
                                        {recipients.length > 60 && (
                                            <span className="chip muted">
                                                +{(recipients.length - 60).toLocaleString()} more
                                            </span>
                                        )}
                                        <input
                                            className="chip-input"
                                            value={recipientInput}
                                            placeholder={
                                                recipients.length === 0
                                                    ? 'name@company.com, another@company.com'
                                                    : 'Add another…'
                                            }
                                            onChange={(event) => setRecipientInput(event.target.value)}
                                            onKeyDown={(event) => {
                                                if ([',', 'Enter', ' '].includes(event.key)) {
                                                    event.preventDefault();
                                                    addTyped(recipientInput);
                                                } else if (
                                                    event.key === 'Backspace' &&
                                                    !recipientInput &&
                                                    recipients.length > 0
                                                ) {
                                                    setRecipients(recipients.slice(0, -1));
                                                }
                                            }}
                                            onBlur={() => addTyped(recipientInput)}
                                        />
                                    </div>
                                </div>

                                {csvColumns.length > 0 && (
                                    <p className="hint">
                                        Columns available as merge tags:{' '}
                                        {csvColumns.map((column) => (
                                            <button
                                                key={column}
                                                className="var-tag"
                                                onClick={() => insertVariable(column)}
                                            >
                                                {`{{${column}}}`}
                                            </button>
                                        ))}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* ---- Sidebar ---- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="card">
                        <div className="card-title">Schedule</div>
                        <div className="card-sub">Times are in {user?.timezone ?? 'UTC'}.</div>

                        <div className="field">
                            <label className="label" htmlFor="when">Send at</label>
                            <input
                                id="when"
                                type="datetime-local"
                                className="input"
                                value={scheduledAt}
                                min={new Date().toISOString().slice(0, 16)}
                                onChange={(event) => setScheduledAt(event.target.value)}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {[
                                { label: 'In 1 hour', hours: 1 },
                                { label: 'Tomorrow 9am', hours: -1 },
                                { label: 'In 3 days', hours: 72 },
                            ].map((option) => (
                                <button
                                    key={option.label}
                                    className="btn btn-outline btn-sm"
                                    onClick={() => {
                                        const date = new Date();
                                        if (option.hours === -1) {
                                            date.setDate(date.getDate() + 1);
                                            date.setHours(9, 0, 0, 0);
                                        } else {
                                            date.setHours(date.getHours() + option.hours);
                                        }
                                        // datetime-local wants a local-time string.
                                        const offset = date.getTimezoneOffset() * 60_000;
                                        setScheduledAt(
                                            new Date(date.getTime() - offset).toISOString().slice(0, 16)
                                        );
                                    }}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>

                        <label className="checkbox-row" style={{ marginTop: 12 }}>
                            <input
                                type="checkbox"
                                checked={perRecipientTimezone}
                                onChange={(event) => setPerRecipientTimezone(event.target.checked)}
                            />
                            Send at this local time in each recipient&apos;s timezone
                        </label>
                        {perRecipientTimezone && (
                            <p className="hint">
                                Requires a <code>timezone</code> column in your recipient data.
                            </p>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-title">Delivery</div>
                        <div className="card-sub">Leave blank to use your sender&apos;s defaults.</div>

                        <div className="field">
                            <label className="label" htmlFor="hourly">Max per hour</label>
                            <input
                                id="hourly"
                                type="number"
                                min={1}
                                className="input"
                                value={maxEmailsPerHour}
                                onChange={(event) => setMaxEmailsPerHour(event.target.value)}
                                placeholder="200"
                            />
                        </div>

                        <div className="field" style={{ marginBottom: 12 }}>
                            <label className="label" htmlFor="delay">Delay between sends (ms)</label>
                            <input
                                id="delay"
                                type="number"
                                min={0}
                                className="input"
                                value={delayBetweenEmailsMs}
                                onChange={(event) => setDelayBetweenEmailsMs(event.target.value)}
                                placeholder="2000"
                            />
                        </div>

                        <label className="checkbox-row">
                            <input
                                type="checkbox"
                                checked={trackOpens}
                                onChange={(event) => setTrackOpens(event.target.checked)}
                            />
                            Track opens
                        </label>
                        <label className="checkbox-row">
                            <input
                                type="checkbox"
                                checked={trackClicks}
                                onChange={(event) => setTrackClicks(event.target.checked)}
                            />
                            Track clicks
                        </label>
                    </div>

                    {variables.length > 0 && (
                        <div className="card">
                            <div className="card-title">Merge tags in use</div>
                            <div className="card-sub">Give each a fallback: {'{{name|there}}'}</div>
                            {variables.map((variable) => (
                                <span key={variable} className="var-tag">
                                    {`{{${variable}}}`}
                                </span>
                            ))}
                        </div>
                    )}

                    {warnings.length > 0 && (
                        <div className="card">
                            <div className="card-title">Content checks</div>
                            <div className="card-sub">Advisory — these will not block sending.</div>
                            <div className="warning-list">
                                {warnings.map((warning) => (
                                    <div
                                        key={warning.message}
                                        className={`warning warning-${warning.severity}`}
                                    >
                                        {warning.message}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <Modal
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                title="Preview"
                wide
            >
                {preview && (
                    <>
                        <div className="field">
                            <span className="label">Subject</span>
                            <div style={{ fontWeight: 600 }}>{preview.subject}</div>
                        </div>
                        <div
                            className="preview-frame"
                            // Server-sanitised before it reaches here.
                            dangerouslySetInnerHTML={{ __html: preview.html }}
                        />
                    </>
                )}
            </Modal>

            <Modal
                open={testOpen}
                onClose={() => setTestOpen(false)}
                title="Send a test"
                footer={
                    <>
                        <button className="btn btn-ghost" onClick={() => setTestOpen(false)}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" onClick={() => void sendTest()}>
                            Send test
                        </button>
                    </>
                }
            >
                <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="testTo">Send to</label>
                    <input
                        id="testTo"
                        type="email"
                        className="input"
                        value={testAddress}
                        onChange={(event) => setTestAddress(event.target.value)}
                    />
                    <p className="hint">
                        Merge tags render as placeholders. Test sends do not create campaign rows or
                        count towards analytics.
                    </p>
                </div>
            </Modal>
        </>
    );
}
