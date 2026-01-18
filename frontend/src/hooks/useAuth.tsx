'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi } from '@/lib/api';
import type { User } from '@/types';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, name: string) => Promise<void>;
    googleLogin: (credential: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setLoading(false);
                return;
            }

            const response = await authApi.getMe();
            if (response.success && response.data) {
                setUser(response.data);
            } else {
                localStorage.removeItem('token');
            }
        } catch (error) {
            localStorage.removeItem('token');
        } finally {
            setLoading(false);
        }
    };

    const login = async (email: string, password: string) => {
        const response = await authApi.login(email, password);
        if (response.success && response.data) {
            localStorage.setItem('token', response.data.token);
            setUser(response.data.user);
        } else {
            throw new Error(response.error || 'Login failed');
        }
    };

    const register = async (email: string, password: string, name: string) => {
        const response = await authApi.register(email, password, name);
        if (response.success && response.data) {
            localStorage.setItem('token', response.data.token);
            setUser(response.data.user);
        } else {
            throw new Error(response.error || 'Registration failed');
        }
    };

    const googleLogin = async (credential: string) => {
        const response = await authApi.googleLogin(credential);
        if (response.success && response.data) {
            localStorage.setItem('token', response.data.token);
            setUser(response.data.user);
        } else {
            throw new Error(response.error || 'Google login failed');
        }
    };

    const logout = async () => {
        try {
            await authApi.logout();
        } finally {
            localStorage.removeItem('token');
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, googleLogin, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
