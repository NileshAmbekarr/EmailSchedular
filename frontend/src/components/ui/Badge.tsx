interface BadgeProps {
    variant: 'pending' | 'queued' | 'processing' | 'sent' | 'failed' | 'default';
    children: React.ReactNode;
}

const variantClasses = {
    pending: 'badge-pending',
    queued: 'badge-queued',
    processing: 'badge-processing',
    sent: 'badge-sent',
    failed: 'badge-failed',
    default: 'badge-default',
};

export function Badge({ variant, children }: BadgeProps) {
    return (
        <span className={`badge ${variantClasses[variant]}`}>
            {children}
        </span>
    );
}
