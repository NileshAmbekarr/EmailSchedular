'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { campaignApi, domainApi, listApi, senderApi, templateApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Loading } from '@/components/ui';

/**
 * Getting-started guide.
 *
 * The checklist reads real account state rather than being a static list, so a
 * new user can see exactly where they are instead of guessing which steps
 * already apply to them.
 */

interface Step {
    title: string;
    done: boolean;
    body: React.ReactNode;
    action?: { href: string; label: string };
    optional?: boolean;
}

export default function GuidePage() {
    const { user } = useAuth();
    const [steps, setSteps] = useState<Step[] | null>(null);

    useEffect(() => {
        const load = async () => {
            const [senders, campaigns, lists, templates, domains] = await Promise.all([
                senderApi.list().catch(() => []),
                campaignApi.list({ limit: 1 }).catch(() => ({ items: [], pagination: { total: 0, limit: 0, offset: 0 } })),
                listApi.list().catch(() => []),
                templateApi.list().catch(() => []),
                domainApi.list().catch(() => []),
            ]);

            const hasProfile = Boolean(user?.companyName && user?.postalAddress);
            const verifiedDomain = domains.some((d) => d.status === 'verified');

            setSteps([
                {
                    title: 'You have a sending identity',
                    done: senders.length > 0,
                    body: (
                        <>
                            Every account starts with a <strong>sandbox sender</strong> backed by
                            Ethereal. Mail sent through it is captured, never delivered — you get a
                            preview link instead. That means you can run the whole pipeline end to
                            end today without owning a domain or risking anyone&apos;s inbox.
                        </>
                    ),
                    action: { href: '/dashboard/settings', label: 'View senders' },
                },
                {
                    title: 'Add your company name and postal address',
                    done: hasProfile,
                    body: (
                        <>
                            These appear in the footer of every campaign. A physical postal address
                            is <strong>legally required</strong> in commercial email under CAN-SPAM,
                            and its absence is a common reason mail gets filtered. Two minutes now
                            saves a deliverability problem later.
                        </>
                    ),
                    action: { href: '/dashboard/settings', label: 'Open profile' },
                },
                {
                    title: 'Send yourself a test',
                    done: campaigns.pagination.total > 0,
                    body: (
                        <>
                            Open the composer, write anything, and use{' '}
                            <strong>Send test</strong> in the top bar. It delivers immediately to one
                            address, bypassing the campaign pipeline entirely — no rows created, no
                            analytics touched. With the sandbox sender you&apos;ll get a preview link
                            showing exactly what a recipient would see, footer and all.
                        </>
                    ),
                    action: { href: '/dashboard/compose', label: 'Open composer' },
                },
                {
                    title: 'Save an audience',
                    done: lists.length > 0,
                    optional: true,
                    body: (
                        <>
                            Upload a CSV once and reuse it. Any column named <code>email</code> is the
                            address; <strong>every other column becomes a merge tag</strong>, so a
                            file with <code>email,first_name,company</code> lets you write{' '}
                            <code>{'{{first_name}}'}</code> in the body. Re-uploading the same file
                            skips duplicates rather than erroring.
                        </>
                    ),
                    action: { href: '/dashboard/audiences', label: 'Create an audience' },
                },
                {
                    title: 'Save a template',
                    done: templates.length > 0,
                    optional: true,
                    body: (
                        <>
                            For anything you send more than once. Campaigns copy the template at
                            creation time, so editing a template never rewrites a campaign that
                            already went out.
                        </>
                    ),
                    action: { href: '/dashboard/templates', label: 'Create a template' },
                },
                {
                    title: 'Verify a domain (before real mail)',
                    done: verifiedDomain,
                    optional: true,
                    body: (
                        <>
                            The sandbox sender never delivers. To reach real inboxes you need a
                            domain you control, authenticated with SPF, DKIM and DMARC. Add it in
                            Settings, publish the four DNS records it shows you at your registrar,
                            then hit <strong>Check now</strong>. Gmail and Yahoo reject bulk mail from
                            unauthenticated domains outright, so this is not optional in practice —
                            only in ordering.
                        </>
                    ),
                    action: { href: '/dashboard/settings', label: 'Add a domain' },
                },
            ]);
        };

        void load();
    }, [user]);

    if (!steps) return <Loading />;

    const done = steps.filter((s) => s.done).length;
    const required = steps.filter((s) => !s.optional);
    const requiredDone = required.filter((s) => s.done).length;

    return (
        <>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Getting started</h1>
                    <p className="page-sub">
                        {requiredDone}/{required.length} essentials done · {done}/{steps.length} total
                    </p>
                </div>
            </div>

            <div className="progress" style={{ marginBottom: 24 }}>
                <div
                    className="progress-fill"
                    style={{ width: `${(done / steps.length) * 100}%` }}
                />
            </div>

            {/* ---- Checklist ---- */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
                {steps.map((step, index) => (
                    <div className="card guide-step" key={step.title}>
                        <div className={`guide-num ${step.done ? 'guide-num-done' : ''}`}>
                            {step.done ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            ) : (
                                index + 1
                            )}
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span className="card-title" style={{ marginBottom: 0 }}>
                                    {step.title}
                                </span>
                                {step.optional && <span className="badge badge-neutral">optional</span>}
                                {step.done && <span className="badge badge-success">done</span>}
                            </div>
                            <p className="guide-body">{step.body}</p>
                            {step.action && !step.done && (
                                <Link href={step.action.href} className="btn btn-outline btn-sm">
                                    {step.action.label}
                                </Link>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* ---- Concepts ---- */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-title">How the pieces fit together</div>
                <div className="card-sub">
                    Five nouns. Once these click, the rest of the app is obvious.
                </div>

                <dl className="concept-list">
                    <div>
                        <dt>Sender</dt>
                        <dd>
                            The <em>from</em> address, and the unit throttling applies to. Hourly and
                            daily caps are per sender, so two senders send in parallel without
                            competing.
                        </dd>
                    </div>
                    <div>
                        <dt>Domain</dt>
                        <dd>
                            Proof you own the address a sender uses. Unverified domains cannot send
                            real mail — that restriction is what stops your account being used to
                            spoof someone else.
                        </dd>
                    </div>
                    <div>
                        <dt>Audience</dt>
                        <dd>
                            A saved list of contacts and their data. Optional — you can paste
                            addresses straight into the composer — but reusable and it keeps merge
                            data with each contact.
                        </dd>
                    </div>
                    <div>
                        <dt>Template</dt>
                        <dd>Reusable subject and body. Copied into a campaign, not linked live.</dd>
                    </div>
                    <div>
                        <dt>Campaign</dt>
                        <dd>
                            One send. Owns its content, its recipients, its schedule and its stats.
                            Everything you can pause, cancel or reschedule happens at this level.
                        </dd>
                    </div>
                </dl>
            </div>

            {/* ---- First campaign ---- */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-title">Sending your first campaign</div>
                <div className="card-sub">Roughly two minutes with the sandbox sender.</div>

                <ol className="walk">
                    <li>
                        <strong>New campaign</strong> (top right, on any page).
                    </li>
                    <li>
                        Name it — internal only, recipients never see it.
                    </li>
                    <li>
                        Write a subject and body. HTML works. Use{' '}
                        <code>{'{{first_name|there}}'}</code> to personalise, where the part after{' '}
                        <code>|</code> is the fallback for contacts missing that field — without one
                        you get &ldquo;Hi ,&rdquo; which is the classic mail-merge tell.
                    </li>
                    <li>
                        Add recipients: paste addresses, upload a CSV, or pick a saved audience.
                    </li>
                    <li>
                        <strong>Preview</strong> to see it rendered with the compliance footer, then{' '}
                        <strong>Send test</strong> to yourself.
                    </li>
                    <li>
                        Pick a send time, then <strong>Schedule campaign</strong>. Watch it move on
                        the campaign page — the list refreshes itself while a send is in flight.
                    </li>
                </ol>

                <p className="hint" style={{ marginTop: 14 }}>
                    Changed your mind? A campaign can be paused, rescheduled or cancelled any time
                    before its messages go out, and individual recipients can be cancelled one by one.
                </p>
            </div>

            {/* ---- FAQ ---- */}
            <div className="card">
                <div className="card-title">Things that confuse people</div>

                <dl className="concept-list">
                    <div>
                        <dt>My test email never arrived</dt>
                        <dd>
                            If the sender is the sandbox one, that&apos;s expected — Ethereal captures
                            mail instead of delivering it. Use the preview link in the response, or on
                            the message&apos;s detail page.
                        </dd>
                    </div>
                    <div>
                        <dt>Why is my campaign taking hours?</dt>
                        <dd>
                            By design. Messages are spread by the inter-send delay and capped per
                            hour, because bursting is what gets a domain blocklisted. Raise{' '}
                            <em>Max per hour</em> in the composer, or the sender&apos;s limits in
                            Settings.
                        </dd>
                    </div>
                    <div>
                        <dt>Some recipients were dropped</dt>
                        <dd>
                            Duplicates are collapsed and suppressed addresses are skipped — the
                            counts are shown when you schedule. Anyone who unsubscribed, hard-bounced
                            or reported spam is on the{' '}
                            <Link href="/dashboard/suppressions" className="row-link">
                                suppression list
                            </Link>{' '}
                            permanently.
                        </dd>
                    </div>
                    <div>
                        <dt>A campaign paused itself</dt>
                        <dd>
                            Its complaint or bounce rate crossed the safe threshold. That guard exists
                            because the alternative is your provider suspending the account. Review
                            the content and the list before resuming.
                        </dd>
                    </div>
                    <div>
                        <dt>Status says &ldquo;sent&rdquo; but not &ldquo;delivered&rdquo;</dt>
                        <dd>
                            <em>Sent</em> means the provider accepted it. <em>Delivered</em> arrives
                            later via webhook, and only when a real provider is configured — the
                            sandbox never reports one.
                        </dd>
                    </div>
                    <div>
                        <dt>Open rates look low</dt>
                        <dd>
                            Open tracking relies on a loaded image, and most clients block those by
                            default. Treat opens as a floor, not a measurement. Clicks are far more
                            reliable.
                        </dd>
                    </div>
                </dl>
            </div>
        </>
    );
}
