'use client';

import { Toaster } from 'react-hot-toast';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/hooks/useAuth';

export function Providers({ children }: { children: ReactNode }) {
    return (
        <AuthProvider>
            {children}
            <Toaster
                position="top-right"
                toastOptions={{
                    duration: 4000,
                    style: {
                        background: '#0b1220',
                        color: '#f8fafc',
                        fontSize: '13.5px',
                        borderRadius: '9px',
                    },
                    success: { iconTheme: { primary: '#22c55e', secondary: '#0b1220' } },
                    error: { iconTheme: { primary: '#ef4444', secondary: '#0b1220' } },
                }}
            />
        </AuthProvider>
    );
}
