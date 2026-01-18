'use client';

import { useState, useEffect, useCallback } from 'react';
import { emailApi } from '@/lib/api';
import type { ScheduledEmail, SentEmail, Sender, ScheduleEmailRequest } from '@/types';

export function useEmails() {
    const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
    const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
    const [senders, setSenders] = useState<Sender[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchScheduledEmails = useCallback(async () => {
        try {
            const response = await emailApi.getScheduledEmails();
            if (response.success && response.data) {
                setScheduledEmails(response.data);
            }
        } catch (err) {
            console.error('Failed to fetch scheduled emails:', err);
        }
    }, []);

    const fetchSentEmails = useCallback(async () => {
        try {
            const response = await emailApi.getSentEmails();
            if (response.success && response.data) {
                setSentEmails(response.data);
            }
        } catch (err) {
            console.error('Failed to fetch sent emails:', err);
        }
    }, []);

    const fetchSenders = useCallback(async () => {
        try {
            const response = await emailApi.getSenders();
            if (response.success && response.data) {
                setSenders(response.data);
            }
        } catch (err) {
            console.error('Failed to fetch senders:', err);
        }
    }, []);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            await Promise.all([fetchScheduledEmails(), fetchSentEmails(), fetchSenders()]);
        } catch (err) {
            setError('Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [fetchScheduledEmails, fetchSentEmails, fetchSenders]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const scheduleEmails = async (request: ScheduleEmailRequest): Promise<void> => {
        const response = await emailApi.scheduleEmails(request);
        if (!response.success) {
            throw new Error(response.error || 'Failed to schedule emails');
        }
        // Refresh the list
        await fetchScheduledEmails();
    };

    const createSender = async (name: string): Promise<Sender> => {
        const response = await emailApi.createSender(name);
        if (!response.success || !response.data) {
            throw new Error(response.error || 'Failed to create sender');
        }
        await fetchSenders();
        return response.data;
    };

    return {
        scheduledEmails,
        sentEmails,
        senders,
        loading,
        error,
        scheduleEmails,
        createSender,
        refresh: fetchAll,
        refreshScheduled: fetchScheduledEmails,
        refreshSent: fetchSentEmails,
    };
}
