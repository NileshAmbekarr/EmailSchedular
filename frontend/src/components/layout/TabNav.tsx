'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
    { name: 'Scheduled', href: '/dashboard/scheduled' },
    { name: 'Sent', href: '/dashboard/sent' },
];

export function TabNav() {
    const pathname = usePathname();

    return (
        <nav className="tab-nav">
            {tabs.map((tab) => (
                <Link
                    key={tab.name}
                    href={tab.href}
                    className={`tab-item ${pathname === tab.href ? 'active' : ''}`}
                >
                    {tab.name}
                </Link>
            ))}
        </nav>
    );
}
