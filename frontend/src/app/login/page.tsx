'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** Minimal surface of the Google Identity Services script. */
interface GoogleIdentity {
    accounts: {
        id: {
            initialize: (config: {
                client_id: string;
                callback: (response: { credential: string }) => void;
            }) => void;
            renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
    };
}

function AuthForm() {
    const router = useRouter();
    const params = useSearchParams();
    const { login, register, googleLogin, user, loading: authLoading } = useAuth();
    const googleSlot = useRef<HTMLDivElement>(null);
    const [googleReady, setGoogleReady] = useState(false);

    const [mode, setMode] = useState<'login' | 'register'>(
        params.get('mode') === 'register' ? 'register' : 'login'
    );
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Already signed in — skip straight through.
    useEffect(() => {
        if (!authLoading && user) router.replace('/dashboard');
    }, [authLoading, user, router]);

    /**
     * Renders Google's own button once its script has loaded. Skipped entirely
     * when no client id is configured, so a deployment without Google OAuth
     * shows email/password only rather than a button that cannot work.
     */
    const initGoogle = useCallback(() => {
        const google = (window as unknown as { google?: GoogleIdentity }).google;
        if (!google || !GOOGLE_CLIENT_ID || !googleSlot.current) return;

        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (response) => {
                try {
                    await googleLogin(response.credential);
                    toast.success('Signed in with Google');
                    router.push('/dashboard');
                } catch (error) {
                    toast.error(error instanceof ApiError ? error.message : 'Google sign-in failed');
                }
            },
        });

        google.accounts.id.renderButton(googleSlot.current, {
            theme: 'outline',
            size: 'large',
            width: 356,
            text: 'continue_with',
        });

        setGoogleReady(true);
    }, [googleLogin, router]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);

        try {
            if (mode === 'register') {
                await register({
                    email,
                    password,
                    name,
                    // Sensible default so scheduled times display correctly
                    // without the user having to find the setting first.
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
                toast.success('Account created — a sandbox sender is ready for you');
            } else {
                await login(email, password);
                toast.success('Welcome back');
            }
            router.push('/dashboard');
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <Link href="/" className="auth-brand">
                    <span className="auth-mark">✦</span>
                    Dispatch
                </Link>
                <p className="auth-sub">
                    {mode === 'register'
                        ? 'Create an account and start scheduling'
                        : 'Sign in to your workspace'}
                </p>

                <form onSubmit={submit}>
                    {mode === 'register' && (
                        <div className="field">
                            <label className="label" htmlFor="name">Name</label>
                            <input
                                id="name"
                                className="input"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="Ada Lovelace"
                                autoComplete="name"
                                required
                            />
                        </div>
                    )}

                    <div className="field">
                        <label className="label" htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            className="input"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="you@company.com"
                            autoComplete="email"
                            required
                        />
                    </div>

                    <div className="field">
                        <label className="label" htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            className="input"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder={mode === 'register' ? 'At least 10 characters' : '••••••••'}
                            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                            required
                        />
                        {mode === 'register' && (
                            <p className="hint">
                                At least 10 characters, including a number or symbol.
                            </p>
                        )}
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-block"
                        disabled={submitting}
                        style={{ marginTop: 4 }}
                    >
                        {submitting ? (
                            <>
                                <span className="spinner" style={{ borderTopColor: '#fff' }} />
                                Please wait…
                            </>
                        ) : mode === 'register' ? (
                            'Create account'
                        ) : (
                            'Sign in'
                        )}
                    </button>
                </form>

                {GOOGLE_CLIENT_ID && (
                    <>
                        <div className="auth-divider" style={{ opacity: googleReady ? 1 : 0 }}>
                            or
                        </div>
                        <div
                            ref={googleSlot}
                            style={{ display: 'flex', justifyContent: 'center' }}
                        />
                        <Script
                            src="https://accounts.google.com/gsi/client"
                            strategy="afterInteractive"
                            onLoad={initGoogle}
                        />
                    </>
                )}

                <p className="auth-switch">
                    {mode === 'register' ? 'Already have an account?' : 'New here?'}{' '}
                    <button
                        type="button"
                        onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
                    >
                        {mode === 'register' ? 'Sign in' : 'Create an account'}
                    </button>
                </p>
            </div>
        </div>
    );
}

export default function LoginPage() {
    // useSearchParams requires a Suspense boundary in the App Router.
    return (
        <Suspense fallback={<Loading />}>
            <AuthForm />
        </Suspense>
    );
}
