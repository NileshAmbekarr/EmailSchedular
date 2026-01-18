'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useEmails } from '@/hooks/useEmails';

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, logout } = useAuth();
    const { scheduledEmails, sentEmails } = useEmails();

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    };

    if (!user) return null;

    return (
        <aside className="sidebar">
            {/* Logo */}
            <div className="sidebar-logo">ONB</div>

            {/* User Profile */}
            <div className="sidebar-user">
                {user.avatar ? (
                    <img src={user.avatar} alt={user.name} className="user-avatar" />
                ) : (
                    <div className="user-avatar-placeholder">
                        {user.name.charAt(0).toUpperCase()}
                    </div>
                )}
                <div className="user-info">
                    <span className="user-name">{user.name}</span>
                    <span className="user-email">{user.email}</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </div>

            {/* Compose Button */}
            <Link href="/dashboard/compose" className="compose-btn">
                Compose
            </Link>

            {/* Navigation */}
            <div className="sidebar-section-title">CORE</div>
            <nav className="sidebar-nav">
                <Link
                    href="/dashboard/scheduled"
                    className={`nav-item ${pathname === '/dashboard/scheduled' ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12,6 12,12 16,14" />
                    </svg>
                    Scheduled
                    <span className="nav-item-count">{scheduledEmails.length}</span>
                </Link>
                <Link
                    href="/dashboard/sent"
                    className={`nav-item ${pathname === '/dashboard/sent' ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                    Sent
                    <span className="nav-item-count">{sentEmails.length}</span>
                </Link>
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
                <button className="logout-btn" onClick={handleLogout}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                    </svg>
                    Logout
                </button>
            </div>
        </aside>
    );
}
