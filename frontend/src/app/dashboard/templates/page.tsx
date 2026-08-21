'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { templateApi } from '@/lib/api';
import type { Template } from '@/types';
import { EmptyState, Loading, Modal, formatDateTime } from '@/components/ui';

const BLANK = { name: '', subject: '', body: '' };

export default function TemplatesPage() {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Template | null>(null);
    const [draft, setDraft] = useState(BLANK);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        try {
            setTemplates(await templateApi.list());
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const startNew = () => {
        setEditing(null);
        setDraft(BLANK);
        setOpen(true);
    };

    const startEdit = (template: Template) => {
        setEditing(template);
        setDraft({ name: template.name, subject: template.subject, body: template.body });
        setOpen(true);
    };

    const save = async () => {
        if (!draft.name.trim() || !draft.subject.trim() || !draft.body.trim()) {
            toast.error('Name, subject and body are all required');
            return;
        }

        setSaving(true);
        try {
            if (editing) {
                await templateApi.update(editing.id, draft);
                toast.success('Template updated');
            } else {
                await templateApi.create(draft);
                toast.success('Template created');
            }
            setOpen(false);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (template: Template) => {
        if (!window.confirm(`Delete "${template.name}"?`)) return;
        try {
            await templateApi.remove(template.id);
            toast.success('Template deleted');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Templates</h1>
                    <p className="page-sub">
                        Reusable content with merge tags. Campaigns copy the template at creation, so
                        editing one never changes a campaign already sent.
                    </p>
                </div>
                <button className="btn btn-accent" onClick={startNew}>
                    New template
                </button>
            </div>

            <div className="table-wrap">
                {loading ? (
                    <Loading />
                ) : templates.length === 0 ? (
                    <EmptyState
                        title="No templates yet"
                        body="Save a message you send often, with merge tags for the parts that change."
                        action={
                            <button className="btn btn-accent" onClick={startNew}>
                                New template
                            </button>
                        }
                    />
                ) : (
                    <div className="table-scroll">
                        <table className="data">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Subject</th>
                                    <th>Variables</th>
                                    <th>Updated</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {templates.map((template) => (
                                    <tr key={template.id}>
                                        <td style={{ fontWeight: 600 }}>{template.name}</td>
                                        <td className="muted">{template.subject}</td>
                                        <td>
                                            {template.variables.length === 0 ? (
                                                <span className="muted">None</span>
                                            ) : (
                                                template.variables.map((variable) => (
                                                    <span key={variable} className="var-tag">
                                                        {variable}
                                                    </span>
                                                ))
                                            )}
                                        </td>
                                        <td className="nowrap muted">
                                            {formatDateTime(template.updatedAt)}
                                        </td>
                                        <td className="right nowrap">
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => startEdit(template)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                className="btn btn-danger btn-sm"
                                                onClick={() => void remove(template)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title={editing ? 'Edit template' : 'New template'}
                wide
                footer={
                    <>
                        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                            {saving ? 'Saving…' : 'Save template'}
                        </button>
                    </>
                }
            >
                <div className="field">
                    <label className="label" htmlFor="tplName">Name</label>
                    <input
                        id="tplName"
                        className="input"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        placeholder="Monthly newsletter"
                    />
                </div>

                <div className="field">
                    <label className="label" htmlFor="tplSubject">Subject</label>
                    <input
                        id="tplSubject"
                        className="input"
                        value={draft.subject}
                        onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                        placeholder="Hi {{first_name|there}}"
                    />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="tplBody">Body</label>
                    <textarea
                        id="tplBody"
                        className="textarea"
                        rows={14}
                        value={draft.body}
                        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                        placeholder="<p>Hi {{first_name|there}},</p>"
                    />
                    <p className="hint">
                        HTML is sanitised on save. Use {'{{variable|fallback}}'} so missing data does
                        not leave a gap.
                    </p>
                </div>
            </Modal>
        </>
    );
}
