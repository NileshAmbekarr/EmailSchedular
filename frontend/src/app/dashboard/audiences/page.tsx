'use client';

import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { listApi } from '@/lib/api';
import type { Contact, ContactList } from '@/types';
import { EmptyState, Loading, Modal, formatDateTime } from '@/components/ui';

export default function AudiencesPage() {
    const [lists, setLists] = useState<ContactList[]>([]);
    const [loading, setLoading] = useState(true);
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    const [selected, setSelected] = useState<ContactList | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    const fileRef = useRef<HTMLInputElement>(null);

    const load = async () => {
        try {
            setLists(await listApi.list());
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const openList = async (list: ContactList) => {
        setSelected(list);
        setContactsLoading(true);
        try {
            const page = await listApi.contacts(list.id, { limit: 50 });
            setContacts(page.items);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setContactsLoading(false);
        }
    };

    const create = async () => {
        if (!name.trim()) return toast.error('Give the audience a name');
        try {
            await listApi.create({ name, description: description || undefined });
            toast.success('Audience created');
            setCreateOpen(false);
            setName('');
            setDescription('');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    /**
     * Uploading the same file twice is normal — the API skips addresses already
     * on the list rather than erroring.
     */
    const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !selected) return;

        setUploading(true);
        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const columns = results.meta.fields ?? [];
                const emailColumn =
                    columns.find((c) => /^e-?mail$/i.test(c.trim())) ??
                    columns.find((c) => /mail/i.test(c));

                if (!emailColumn) {
                    toast.error('No email column found — name one of the columns "email"');
                    setUploading(false);
                    return;
                }

                const parsed = results.data
                    .map((row) => {
                        const address = row[emailColumn]?.trim().toLowerCase();
                        if (!address?.includes('@')) return null;

                        const fields: Record<string, string> = {};
                        for (const column of columns) {
                            if (column === emailColumn) continue;
                            const value = row[column]?.trim();
                            if (value) fields[column.trim()] = value;
                        }
                        return { email: address, fields };
                    })
                    .filter((entry): entry is { email: string; fields: Record<string, string> } =>
                        Boolean(entry)
                    );

                if (parsed.length === 0) {
                    toast.error('No valid addresses found in that file');
                    setUploading(false);
                    return;
                }

                try {
                    const result = await listApi.addContacts(selected.id, parsed, file.name);
                    toast.success(
                        `Added ${result.added.toLocaleString()} contacts` +
                            (result.duplicates > 0
                                ? ` (${result.duplicates.toLocaleString()} already present)`
                                : '')
                    );
                    await load();
                    await openList({ ...selected, contactCount: result.total });
                } catch (error) {
                    toast.error((error as Error).message);
                } finally {
                    setUploading(false);
                }
            },
            error: () => {
                toast.error('Could not parse that file');
                setUploading(false);
            },
        });

        if (fileRef.current) fileRef.current.value = '';
    };

    const remove = async (list: ContactList) => {
        if (!window.confirm(`Delete "${list.name}" and all of its contacts?`)) return;
        try {
            await listApi.remove(list.id);
            toast.success('Audience deleted');
            if (selected?.id === list.id) setSelected(null);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Audiences</h1>
                    <p className="page-sub">
                        Upload a list once and reuse it. Every non-email column becomes a merge tag.
                    </p>
                </div>
                <button className="btn btn-accent" onClick={() => setCreateOpen(true)}>
                    New audience
                </button>
            </div>

            <div className="table-wrap" style={{ marginBottom: 20 }}>
                {loading ? (
                    <Loading />
                ) : lists.length === 0 ? (
                    <EmptyState
                        title="No audiences yet"
                        body="Create one, then upload a CSV with an email column plus whatever else you want to personalise on."
                        action={
                            <button className="btn btn-accent" onClick={() => setCreateOpen(true)}>
                                New audience
                            </button>
                        }
                    />
                ) : (
                    <div className="table-scroll">
                        <table className="data">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th className="right">Contacts</th>
                                    <th>Created</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {lists.map((list) => (
                                    <tr key={list.id}>
                                        <td>
                                            <button
                                                className="row-link"
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: 0,
                                                    fontSize: 'inherit',
                                                    fontFamily: 'inherit',
                                                }}
                                                onClick={() => void openList(list)}
                                            >
                                                {list.name}
                                            </button>
                                            {list.description && (
                                                <div className="muted" style={{ fontSize: 12.5 }}>
                                                    {list.description}
                                                </div>
                                            )}
                                        </td>
                                        <td className="right tabular">
                                            {list.contactCount.toLocaleString()}
                                        </td>
                                        <td className="nowrap muted">
                                            {formatDateTime(list.createdAt)}
                                        </td>
                                        <td className="right nowrap">
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => void openList(list)}
                                            >
                                                Open
                                            </button>
                                            <button
                                                className="btn btn-danger btn-sm"
                                                onClick={() => void remove(list)}
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

            {selected && (
                <div className="card">
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <div>
                            <div className="card-title">{selected.name}</div>
                            <div className="card-sub">
                                {selected.contactCount.toLocaleString()} contacts · showing the first
                                50
                            </div>
                        </div>
                        <div>
                            <button
                                className="btn btn-outline btn-sm"
                                disabled={uploading}
                                onClick={() => fileRef.current?.click()}
                            >
                                {uploading ? 'Uploading…' : 'Upload CSV'}
                            </button>
                            <input
                                ref={fileRef}
                                type="file"
                                accept=".csv,.txt"
                                onChange={upload}
                                style={{ display: 'none' }}
                            />
                        </div>
                    </div>

                    {contactsLoading ? (
                        <Loading />
                    ) : contacts.length === 0 ? (
                        <EmptyState
                            title="No contacts"
                            body="Upload a CSV with an email column to populate this audience."
                        />
                    ) : (
                        <div className="table-scroll" style={{ marginTop: 14 }}>
                            <table className="data">
                                <thead>
                                    <tr>
                                        <th>Email</th>
                                        <th>Fields</th>
                                        <th>Added</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {contacts.map((contact) => (
                                        <tr key={contact.id}>
                                            <td style={{ fontWeight: 500 }}>{contact.email}</td>
                                            <td>
                                                {Object.entries(contact.fields).length === 0 ? (
                                                    <span className="muted">—</span>
                                                ) : (
                                                    Object.entries(contact.fields).map(
                                                        ([key, value]) => (
                                                            <span key={key} className="chip">
                                                                <span className="mono">{key}</span>:{' '}
                                                                {value}
                                                            </span>
                                                        )
                                                    )
                                                )}
                                            </td>
                                            <td className="nowrap muted">
                                                {formatDateTime(contact.createdAt)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            <Modal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                title="New audience"
                footer={
                    <>
                        <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" onClick={() => void create()}>
                            Create
                        </button>
                    </>
                }
            >
                <div className="field">
                    <label className="label" htmlFor="listName">Name</label>
                    <input
                        id="listName"
                        className="input"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Newsletter subscribers"
                    />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="listDesc">Description</label>
                    <input
                        id="listDesc"
                        className="input"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Where these contacts came from"
                    />
                    <p className="hint">
                        Recording provenance matters for consent — GDPR expects you to know where
                        each contact came from.
                    </p>
                </div>
            </Modal>
        </>
    );
}
