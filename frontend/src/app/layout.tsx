import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
    title: 'Dispatch — scheduled email that actually arrives',
    description:
        'Queue-backed email scheduling with per-sender rate limiting, restart recovery, exactly-once delivery, and deliverability built in.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
