'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import toast from 'react-hot-toast';

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: {
                        client_id: string;
                        callback: (response: { credential: string }) => void;
                        auto_select?: boolean;
                        cancel_on_tap_outside?: boolean;
                        use_fedcm_for_prompt?: boolean;
                        ux_mode?: string;
                    }) => void;
                    renderButton: (element: HTMLElement, config: {
                        theme: string;
                        size: string;
                        width?: number;
                        type?: string;
                        text?: string;
                    }) => void;
                    prompt: (callback?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => void) => void;
                    disableAutoSelect: () => void;
                };
                oauth2: {
                    initCodeClient: (config: {
                        client_id: string;
                        scope: string;
                        ux_mode: string;
                        callback: (response: { code: string }) => void;
                    }) => { requestCode: () => void };
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        callback: (response: { access_token?: string; error?: string }) => void;
                    }) => { requestAccessToken: () => void };
                };
            };
        };
    }
}

export default function LoginPage() {
    const router = useRouter();
    const { user, loading, login, register, googleLogin } = useAuth();
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const googleButtonRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!loading && user) {
            router.push('/dashboard/scheduled');
        }
    }, [user, loading, router]);

    const handleGoogleCallback = useCallback(async (response: { credential: string }) => {
        setGoogleLoading(true);
        try {
            await googleLogin(response.credential);
            toast.success('Login successful!');
            router.push('/dashboard/scheduled');
        } catch (error) {
            toast.error('Google login failed. Please try again.');
            console.error('Google login error:', error);
        } finally {
            setGoogleLoading(false);
        }
    }, [googleLogin, router]);

    useEffect(() => {
        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

        if (!clientId) {
            console.warn('Google Client ID not configured');
            return;
        }

        // Load Google Identity Services
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
            if (window.google && googleButtonRef.current) {
                try {
                    window.google.accounts.id.initialize({
                        client_id: clientId,
                        callback: handleGoogleCallback,
                        auto_select: false,
                        cancel_on_tap_outside: true,
                        use_fedcm_for_prompt: false, // Disable FedCM to avoid the error
                        ux_mode: 'popup', // Use popup mode
                    });

                    // Render the Google Sign-In button
                    window.google.accounts.id.renderButton(
                        googleButtonRef.current,
                        {
                            theme: 'outline',
                            size: 'large',
                            type: 'standard',
                            text: 'signin_with',
                        }
                    );
                } catch (error) {
                    console.error('Failed to initialize Google Sign-In:', error);
                }
            }
        };
        document.body.appendChild(script);

        return () => {
            if (script.parentNode) {
                document.body.removeChild(script);
            }
        };
    }, [handleGoogleCallback]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            if (isRegistering) {
                await register(email, password, name);
                toast.success('Registration successful!');
            } else {
                await login(email, password);
                toast.success('Login successful!');
            }
            router.push('/dashboard/scheduled');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Authentication failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="login-page">
                <div className="loading-spinner">Loading...</div>
            </div>
        );
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <h1>{isRegistering ? 'Sign Up' : 'Login'}</h1>
                </div>

                {/* Google Sign-In Button Container */}
                <div className="google-btn-container">
                    <div
                        ref={googleButtonRef}
                        className="google-btn-wrapper"
                        style={{ opacity: googleLoading ? 0.6 : 1 }}
                    />
                </div>

                <div className="divider">
                    <span>or {isRegistering ? 'sign up' : 'sign in'} with email</span>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    {isRegistering && (
                        <Input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Full Name"
                            required
                        />
                    )}
                    <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email ID"
                        required
                    />
                    <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        required
                    />
                    <Button type="submit" loading={submitting} className="login-button">
                        {isRegistering ? 'Sign Up' : 'Login'}
                    </Button>
                </form>

                <p className="login-toggle">
                    {isRegistering ? 'Already have an account?' : "Don't have an account?"}{' '}
                    <button type="button" onClick={() => setIsRegistering(!isRegistering)}>
                        {isRegistering ? 'Login' : 'Sign up'}
                    </button>
                </p>
            </div>
        </div>
    );
}
