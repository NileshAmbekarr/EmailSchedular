'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiKeyApi, authApi, domainApi, senderApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type { ApiKey, SendingDomain, Sender } from '@/types';
import { EmptyState, Loading, Modal, StatusBadge, formatDateTime } from '@/components/ui';

type Tab = 'profile' | 'senders' | 'domains' | 'keys';

const TABS: Array<{ value: Tab; label: string }> = [
    { value: 'profile', label: 'Profile' },
    { value: 'senders', label: 'Senders' },
    { value: 'domains', label: 'Domains' },
    { value: 'keys', label: 'API keys' },
];

export default function SettingsPage() {
    const { user, setUser } = useAuth();
    const [tab, setTab] = useState<Tab>('profile');

    const [senders, setSenders] = useState<Sender[]>([]);
    const [domains, setDomains] = useState<SendingDomain[]>([]);
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);

    // Profile
    const [name, setName] = useState(user?.name ?? '');
    const [timezone, setTimezone] = useState(user?.timezone ?? 'UTC');
    const [companyName, setCompanyName] = useState(user?.companyName ?? '');
    const [postalAddress, setPostalAddress] = useState(user?.postalAddress ?? '');

    // Modals
    const [domainOpen, setDomainOpen] = useState(false);
    const [newDomain, setNewDomain] = useState('');
    const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
    const [keyOpen, setKeyOpen] = useState(false);
    const [keyName, setKeyName] = useState('');
    const [createdKey, setCreatedKey] = useState<string | null>(null);

    const load = async () => {
        try {
            const [senderList, domainList, keyList] = await Promise.all([
                senderApi.list(),
                domainApi.list().catch(() => []),
                apiKeyApi.list().catch(() => []),
            ]);
            setSenders(senderList);
            setDomains(domainList);
            setKeys(keyList);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    useEffect(() => {
        if (!user) return;
        setName(user.name);
        setTimezone(user.timezone);
        setCompanyName(user.companyName ?? '');
        setPostalAddress(user.postalAddress ?? '');
    }, [user]);

    const saveProfile = async () => {
        try {
            const updated = await authApi.updateProfile({
                name,
                timezone,
                companyName,
                postalAddress,
            });
            setUser(updated);
            toast.success('Profile saved');
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const addDomain = async () => {
        try {
            const created = await domainApi.create(newDomain.trim().toLowerCase());
            toast.success('Domain added — publish the DNS records to verify it');
            setDomainOpen(false);
            setNewDomain('');
            setExpandedDomain(created.id);
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const verifyDomain = async (id: string) => {
        try {
            const result = await domainApi.verify(id);
            if (result.verified) {
                toast.success('Domain verified');
            } else {
                toast.error('Records not found yet — DNS can take a while to propagate');
            }
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    const createKey = async () => {
        try {
            const created = await apiKeyApi.create(keyName);
            setCreatedKey(created.key ?? null);
            setKeyName('');
            await load();
        } catch (error) {
            toast.error((error as Error).message);
        }
    };

    if (loading) return <Loading />;

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Settings</h1>
                    <p className="page-sub">Account, sending identities and deliverability setup.</p>
                </div>
            </div>

            <div className="toolbar">
                <div className="tabs">
                    {TABS.map((option) => (
                        <button
                            key={option.value}
                            className={`tab ${tab === option.value ? 'active' : ''}`}
                            onClick={() => setTab(option.value)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ---- Profile ---- */}
            {tab === 'profile' && (
                <div className="card" style={{ maxWidth: 620 }}>
                    <div className="card-title">Profile</div>
                    <div className="card-sub">
                        Your company name and postal address appear in the footer of every campaign
                        — CAN-SPAM requires a valid physical address in commercial email.
                    </div>

                    <div className="field">
                        <label className="label" htmlFor="pName">Name</label>
                        <input
                            id="pName"
                            className="input"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </div>

                    <div className="field">
                        <label className="label" htmlFor="pTz">Timezone</label>
                        <input
                            id="pTz"
                            className="input"
                            value={timezone}
                            onChange={(event) => setTimezone(event.target.value)}
                            placeholder="Asia/Kolkata"
                        />
                        <p className="hint">
                            IANA name. Scheduled times are shown and interpreted in this zone.
                        </p>
                    </div>

                    <div className="field">
                        <label className="label" htmlFor="pCompany">Company name</label>
                        <input
                            id="pCompany"
                            className="input"
                            value={companyName}
                            onChange={(event) => setCompanyName(event.target.value)}
                        />
                    </div>

                    <div className="field">
                        <label className="label" htmlFor="pAddress">Postal address</label>
                        <textarea
                            id="pAddress"
                            className="textarea"
                            style={{ minHeight: 80 }}
                            value={postalAddress}
                            onChange={(event) => setPostalAddress(event.target.value)}
                            placeholder="1 Example Way, Pune, MH 411001, India"
                        />
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className="btn btn-primary" onClick={() => void saveProfile()}>
                            Save changes
                        </button>
                        <button
                            className="btn btn-outline"
                            onClick={() => {
                                if (
                                    window.confirm(
                                        'Sign out of every device? All existing sessions stop working immediately.'
                                    )
                                ) {
                                    void authApi.logoutEverywhere().then(() => {
                                        toast.success('Signed out everywhere');
                                        window.location.href = '/login';
                                    });
                                }
                            }}
                        >
                            Sign out everywhere
                        </button>
                    </div>
                </div>
            )}

            {/* ---- Senders ---- */}
            {tab === 'senders' && (
                <div className="table-wrap">
                    <div className="table-scroll">
                        <table className="data">
                            <thead>
                                <tr>
                                    <th>Sender</th>
                                    <th>Provider</th>
                                    <th className="right">Hourly cap</th>
                                    <th>Warmup</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {senders.map((sender) => (
                                    <tr key={sender.id}>
                                        <td>
                                            <span style={{ fontWeight: 600 }}>{sender.name}</span>
                                            {sender.isDefault && (
                                                <span
                                                    className="badge badge-neutral"
                                                    style={{ marginLeft: 8 }}
                                                >
                                                    default
                                                </span>
                                            )}
                                            <div className="muted" style={{ fontSize: 12.5 }}>
                                                {sender.email}
                                            </div>
                                        </td>
                                        <td>
                                            <span
                                                className={`badge ${sender.provider === 'ethereal' ? 'badge-warn' : 'badge-success'}`}
                                            >
                                                {sender.provider === 'ethereal'
                                                    ? 'sandbox'
                                                    : sender.provider}
                                            </span>
                                        </td>
                                        <td className="right tabular">
                                            {sender.hourlyLimit?.toLocaleString() ?? 'default'}
                                        </td>
                                        <td className="muted">
                                            {sender.warmupEnabled ? 'Ramping' : 'Off'}
                                        </td>
                                        <td className="right">
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={async () => {
                                                    try {
                                                        const { verified } = await senderApi.verify(
                                                            sender.id
                                                        );
                                                        toast[verified ? 'success' : 'error'](
                                                            verified
                                                                ? 'Connection OK'
                                                                : 'Could not connect with these credentials'
                                                        );
                                                    } catch (error) {
                                                        toast.error((error as Error).message);
                                                    }
                                                }}
                                            >
                                                Test connection
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
                        <p className="hint" style={{ margin: 0 }}>
                            Sandbox senders deliver to Ethereal, which captures mail and returns a
                            preview link instead of delivering it. Verify a domain to send for real.
                        </p>
                    </div>
                </div>
            )}

            {/* ---- Domains ---- */}
            {tab === 'domains' && (
                <>
                    <div style={{ marginBottom: 16 }}>
                        <button className="btn btn-accent" onClick={() => setDomainOpen(true)}>
                            Add domain
                        </button>
                    </div>

                    {domains.length === 0 ? (
                        <div className="table-wrap">
                            <EmptyState
                                title="No sending domains"
                                body="Authenticate a domain with SPF, DKIM and DMARC before sending real mail. Without it, most providers will filter your messages."
                                action={
                                    <button className="btn btn-accent" onClick={() => setDomainOpen(true)}>
                                        Add domain
                                    </button>
                                }
                            />
                        </div>
                    ) : (
                        domains.map((domain) => (
                            <div className="card" key={domain.id} style={{ marginBottom: 14 }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 12,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <div>
                                        <div className="card-title">{domain.domain}</div>
                                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                                            <StatusBadge
                                                status={
                                                    domain.status === 'verified'
                                                        ? 'delivered'
                                                        : 'pending'
                                                }
                                            />
                                            <span
                                                className={`badge ${domain.spfVerified ? 'badge-success' : 'badge-neutral'}`}
                                            >
                                                SPF
                                            </span>
                                            <span
                                                className={`badge ${domain.dkimVerified ? 'badge-success' : 'badge-neutral'}`}
                                            >
                                                DKIM
                                            </span>
                                            <span
                                                className={`badge ${domain.dmarcVerified ? 'badge-success' : 'badge-neutral'}`}
                                            >
                                                DMARC
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            className="btn btn-outline btn-sm"
                                            onClick={() =>
                                                setExpandedDomain(
                                                    expandedDomain === domain.id ? null : domain.id
                                                )
                                            }
                                        >
                                            {expandedDomain === domain.id ? 'Hide' : 'Show'} DNS records
                                        </button>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => void verifyDomain(domain.id)}
                                        >
                                            Check now
                                        </button>
                                        <button
                                            className="btn btn-danger btn-sm"
                                            onClick={async () => {
                                                if (!window.confirm(`Remove ${domain.domain}?`)) return;
                                                await domainApi.remove(domain.id);
                                                toast.success('Domain removed');
                                                await load();
                                            }}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>

                                {expandedDomain === domain.id && (
                                    <div style={{ marginTop: 16 }}>
                                        {domain.dnsRecords.map((record) => (
                                            <div className="dns-record" key={record.name + record.purpose}>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        gap: 8,
                                                        alignItems: 'center',
                                                        marginBottom: 4,
                                                    }}
                                                >
                                                    <span className="badge badge-info">{record.type}</span>
                                                    <strong style={{ fontSize: 13 }}>
                                                        {record.purpose.toUpperCase()}
                                                    </strong>
                                                </div>
                                                <p className="hint" style={{ marginTop: 0 }}>
                                                    {record.description}
                                                </p>
                                                <div className="dns-value">
                                                    <strong>Name:</strong> {record.name}
                                                </div>
                                                <div className="dns-value">
                                                    <strong>Value:</strong> {record.value}
                                                </div>
                                            </div>
                                        ))}
                                        {domain.lastCheckedAt && (
                                            <p className="hint">
                                                Last checked {formatDateTime(domain.lastCheckedAt)}.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </>
            )}

            {/* ---- API keys ---- */}
            {tab === 'keys' && (
                <>
                    <div style={{ marginBottom: 16 }}>
                        <button className="btn btn-accent" onClick={() => setKeyOpen(true)}>
                            Create key
                        </button>
                    </div>

                    <div className="table-wrap">
                        {keys.length === 0 ? (
                            <EmptyState
                                title="No API keys"
                                body="Create a key to schedule campaigns programmatically. Pass it as the X-API-Key header."
                            />
                        ) : (
                            <div className="table-scroll">
                                <table className="data">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Key</th>
                                            <th>Last used</th>
                                            <th>Created</th>
                                            <th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {keys.map((key) => (
                                            <tr key={key.id}>
                                                <td style={{ fontWeight: 600 }}>{key.name}</td>
                                                <td className="mono">{key.keyPrefix}…</td>
                                                <td className="muted nowrap">
                                                    {formatDateTime(key.lastUsedAt)}
                                                </td>
                                                <td className="muted nowrap">
                                                    {formatDateTime(key.createdAt)}
                                                </td>
                                                <td className="right">
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={async () => {
                                                            if (!window.confirm(`Revoke "${key.name}"?`))
                                                                return;
                                                            await apiKeyApi.revoke(key.id);
                                                            toast.success('Key revoked');
                                                            await load();
                                                        }}
                                                    >
                                                        Revoke
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ---- Modals ---- */}
            <Modal
                open={domainOpen}
                onClose={() => setDomainOpen(false)}
                title="Add a sending domain"
                footer={
                    <>
                        <button className="btn btn-ghost" onClick={() => setDomainOpen(false)}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" onClick={() => void addDomain()}>
                            Add domain
                        </button>
                    </>
                }
            >
                <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="domainName">Domain</label>
                    <input
                        id="domainName"
                        className="input"
                        value={newDomain}
                        onChange={(event) => setNewDomain(event.target.value)}
                        placeholder="acme.com"
                    />
                    <p className="hint">
                        A DKIM keypair is generated for you. Publish the four records we show next,
                        then hit Check now — DNS usually propagates within an hour.
                    </p>
                </div>
            </Modal>

            <Modal
                open={keyOpen}
                onClose={() => {
                    setKeyOpen(false);
                    setCreatedKey(null);
                }}
                title={createdKey ? 'Copy your key' : 'Create an API key'}
                footer={
                    createdKey ? (
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                setKeyOpen(false);
                                setCreatedKey(null);
                            }}
                        >
                            Done
                        </button>
                    ) : (
                        <>
                            <button className="btn btn-ghost" onClick={() => setKeyOpen(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={() => void createKey()}>
                                Create
                            </button>
                        </>
                    )
                }
            >
                {createdKey ? (
                    <>
                        <p style={{ marginBottom: 12 }}>
                            This is the only time the key is shown — only a hash is stored, so it
                            cannot be recovered later.
                        </p>
                        <div className="dns-value" style={{ marginTop: 0 }}>
                            {createdKey}
                        </div>
                        <button
                            className="btn btn-outline btn-sm"
                            style={{ marginTop: 10 }}
                            onClick={() => {
                                void navigator.clipboard.writeText(createdKey);
                                toast.success('Copied');
                            }}
                        >
                            Copy to clipboard
                        </button>
                    </>
                ) : (
                    <div className="field" style={{ marginBottom: 0 }}>
                        <label className="label" htmlFor="keyName">Name</label>
                        <input
                            id="keyName"
                            className="input"
                            value={keyName}
                            onChange={(event) => setKeyName(event.target.value)}
                            placeholder="Production server"
                        />
                    </div>
                )}
            </Modal>
        </>
    );
}
