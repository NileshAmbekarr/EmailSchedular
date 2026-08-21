'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { initials, Loading } from '@/components/ui';

const Icon = ({ path }: { path: string }) => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d={path} />
    </svg>
);

interface NavItem {
    href: string;
    label: string;
    icon: string;
    /** Match the path exactly, so "/dashboard" is not active on every subpage. */
    exact?: boolean;
}

const NAV: Array<{ group: string | null; items: NavItem[] }> = [
    {
        group: null,
        items: [
            { href: '/dashboard', label: 'Overview', icon: 'M3 3v18h18M7 16l4-6 4 3 5-8', exact: true },
            {
                href: '/dashboard/guide',
                label: 'Getting started',
                icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
            },
            { href: '/dashboard/campaigns', label: 'Campaigns', icon: 'M4 4h16v12H5.2L4 17.5V4Z' },
            { href: '/dashboard/messages', label: 'Messages', icon: 'M2 6h20v13H2zM2 6l10 7 10-7' },
        ],
    },
    {
        group: 'Content',
        items: [
            { href: '/dashboard/templates', label: 'Templates', icon: 'M4 3h16v6H4zM4 13h7v8H4zM15 13h5v8h-5z' },
            {
                href: '/dashboard/audiences',
                label: 'Audiences',
                icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
            },
        ],
    },
    {
        group: 'Deliverability',
        items: [
            {
                href: '/dashboard/suppressions',
                label: 'Suppressions',
                icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM5 5l14 14',
            },
            {
                href: '/dashboard/settings',
                label: 'Settings',
                icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
            },
        ],
    },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const { user, loading, logout } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !user) router.replace('/login');
    }, [loading, user, router]);

    if (loading) return <Loading label="Loading your workspace…" />;
    if (!user) return null;

    const isActive = (href: string, exact?: boolean) =>
        exact ? pathname === href : pathname.startsWith(href);

    const current = NAV.flatMap((section) => section.items).find((item) =>
        isActive(item.href, item.exact)
    );

    return (
        <div className="shell">
            <aside className="sidebar">
                <Link href="/" className="sidebar-brand">
                    <span className="auth-mark" style={{ width: 26, height: 26, fontSize: 13 }}>
                        ✦
                    </span>
                    Dispatch
                </Link>

                <nav className="sidebar-nav">
                    {NAV.map((section) => (
                        <div key={section.group ?? 'main'}>
                            {section.group && <div className="nav-group">{section.group}</div>}
                            {section.items.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`nav-item ${isActive(item.href, item.exact) ? 'active' : ''}`}
                                >
                                    <Icon path={item.icon} />
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="sidebar-foot">
                    <div className="user-chip">
                        <div className="avatar">{initials(user.name)}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="user-name">{user.name}</div>
                            <div className="user-email">{user.email}</div>
                        </div>
                    </div>
                    <button className="btn btn-ghost btn-sm btn-block" onClick={() => void logout()}>
                        Sign out
                    </button>
                </div>
            </aside>

            <div className="main">
                <header className="topbar">
                    <div className="topbar-title">{current?.label ?? 'Dashboard'}</div>
                    <div className="topbar-actions">
                        <Link href="/dashboard/compose" className="btn btn-accent btn-sm">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            New campaign
                        </Link>
                    </div>
                </header>

                <main className="content">{children}</main>
            </div>
        </div>
    );
}
