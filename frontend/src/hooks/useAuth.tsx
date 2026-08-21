'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, setUnauthorizedHandler } from '@/lib/api';
import type { User } from '@/types';

interface AuthContextValue {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (payload: {
        email: string;
        password: string;
        name: string;
        timezone?: string;
    }) => Promise<void>;
    googleLogin: (credential: string) => Promise<void>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
    setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Session state.
 *
 * The token lives only in an httpOnly cookie — there is no localStorage copy,
 * so the current session is discovered by asking the API rather than by reading
 * a token the page can see.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const refresh = useCallback(async () => {
        try {
            setUser(await authApi.me());
        } catch {
            setUser(null);
        }
    }, []);

    useEffect(() => {
        void refresh().finally(() => setLoading(false));
    }, [refresh]);

    // A 401 from any request means the cookie expired or was revoked.
    useEffect(() => {
        setUnauthorizedHandler(() => {
            setUser(null);
        });
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const { user: next } = await authApi.login(email, password);
        setUser(next);
    }, []);

    const register = useCallback(
        async (payload: { email: string; password: string; name: string; timezone?: string }) => {
            const { user: next } = await authApi.register(payload);
            setUser(next);
        },
        []
    );

    const googleLogin = useCallback(async (credential: string) => {
        const { user: next } = await authApi.googleLogin(credential);
        setUser(next);
    }, []);

    const logout = useCallback(async () => {
        try {
            await authApi.logout();
        } finally {
            setUser(null);
            router.push('/login');
        }
    }, [router]);

    const value = useMemo(
        () => ({ user, loading, login, register, googleLogin, logout, refresh, setUser }),
        [user, loading, login, register, googleLogin, logout, refresh]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside an AuthProvider');
    return context;
}
