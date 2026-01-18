'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export function Header() {
    const { user, logout } = useAuth();
    const router = useRouter();

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    };

    if (!user) return null;

    return (
        <header className="header">
            <div className="header-content">
                <div className="header-brand">
                    <svg className="header-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <h1 className="header-title">Email Scheduler</h1>
                </div>

                <div className="header-user">
                    <div className="user-info">
                        {user.avatar ? (
                            <img src={user.avatar} alt={user.name} className="user-avatar" />
                        ) : (
                            <div className="user-avatar-placeholder">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div className="user-details">
                            <span className="user-name">{user.name}</span>
                            <span className="user-email">{user.email}</span>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="logout-button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                        </svg>
                        Logout
                    </button>
                </div>
            </div>
        </header>
    );
}
