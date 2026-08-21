'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './showcase.module.css';

/**
 * Public showcase page.
 *
 * The pitch is deliberately about guarantees rather than features: anyone can
 * put a message on a queue, but not dropping it, not sending it twice, and not
 * getting the sending domain blocklisted is the actual work.
 */

const FEED = [
    { text: 'delivered — priya@northwind.io', color: '#22c55e', time: '0.4s' },
    { text: 'opened — marcus@lumen.dev', color: '#0ea5e9', time: '1.2s' },
    { text: 'rate limited — deferred to 15:00 UTC', color: '#f59e0b', time: '2.6s' },
    { text: 'hard bounce — suppressed automatically', color: '#ef4444', time: '3.1s' },
    { text: 'delivered — sam@ridgeline.co', color: '#22c55e', time: '4.0s' },
];

function LiveCard() {
    const [sent, setSent] = useState(1840);
    const [visible, setVisible] = useState(1);

    // A slow tick that suggests an in-flight campaign. Static for anyone who
    // has asked the OS to reduce motion.
    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (media.matches) {
            setVisible(FEED.length);
            return;
        }

        const timer = setInterval(() => {
            setSent((current) => (current >= 2400 ? 1840 : current + 7));
            setVisible((current) => (current >= FEED.length ? 1 : current + 1));
        }, 1800);

        return () => clearInterval(timer);
    }, []);

    const percent = Math.min(100, Math.round((sent / 2400) * 100));

    return (
        <div className={styles.heroCard}>
            <div className={styles.heroCardBar}>
                <span className={styles.dot} style={{ background: '#ff5f57' }} />
                <span className={styles.dot} style={{ background: '#febc2e' }} />
                <span className={styles.dot} style={{ background: '#28c840' }} />
                <span className={styles.heroCardTitle}>Campaign · live</span>
            </div>

            <div className={styles.heroCardBody}>
                <div className={styles.campaignRow}>
                    <div>
                        <div className={styles.campaignName}>Product launch — March</div>
                        <div className={styles.campaignMeta}>hello@acme.com · 2,400 recipients</div>
                    </div>
                    <span className={`${styles.pill} ${styles.pillSending}`}>Sending</span>
                </div>

                <div className={styles.progressTrack}>
                    <div className={styles.progressFill} style={{ width: `${percent}%` }} />
                </div>

                <div className={styles.statGrid}>
                    <div className={styles.stat}>
                        <div className={styles.statValue}>{sent.toLocaleString()}</div>
                        <div className={styles.statLabel}>Sent</div>
                    </div>
                    <div className={styles.stat}>
                        <div className={styles.statValue}>62.4%</div>
                        <div className={styles.statLabel}>Opened</div>
                    </div>
                    <div className={styles.stat}>
                        <div className={styles.statValue}>18.1%</div>
                        <div className={styles.statLabel}>Clicked</div>
                    </div>
                    <div className={styles.stat}>
                        <div className={styles.statValue}>0.3%</div>
                        <div className={styles.statLabel}>Bounced</div>
                    </div>
                </div>

                <div className={styles.feed}>
                    {FEED.slice(0, visible).map((item) => (
                        <div key={item.text} className={styles.feedItem}>
                            <span className={styles.feedDot} style={{ background: item.color }} />
                            <span>{item.text}</span>
                            <span className={styles.feedTime}>{item.time}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

const Check = ({ size = 13 }: { size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const GUARANTEES = [
    {
        title: 'Nothing sends twice',
        body: 'The message row is the arbiter, not the queue. A worker claims it with a conditional update, so a duplicated or recovered job loses the race and exits without sending.',
        proof: 'UPDATE … WHERE status IN (pending, queued, retrying)',
        icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
        ),
    },
    {
        title: 'Nothing gets dropped',
        body: 'Postgres is the source of truth and Redis is only an index. On boot and every five minutes, anything queued without a live job is re-enqueued — including messages whose slot passed during an outage.',
        proof: 'recoverOrphanedJobs() → requeued · late · expired',
        icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
            </svg>
        ),
    },
    {
        title: 'Limits actually hold',
        body: 'Read, compare and increment happen inside one Lua script, so concurrent workers cannot all see the last free slot at once. Windows are keyed in UTC, so replicas never disagree about the hour.',
        proof: 'EVAL — atomic across every worker and replica',
        icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
            </svg>
        ),
    },
];

const FEATURES = [
    {
        title: 'Campaigns, not loose emails',
        body: 'One campaign owns its recipients, content and counters. Pause, resume, reschedule or cancel the whole thing — or a single message — at any point before it sends.',
    },
    {
        title: 'Merge tags with fallbacks',
        body: 'Tags render per recipient from your CSV columns, with a fallback for missing data. Values are escaped, so contact data can never inject markup into the body.',
    },
    {
        title: 'Audiences that persist',
        body: 'Upload a list once and reuse it. Every non-email column becomes a merge variable, and re-uploading the same file simply skips duplicates.',
    },
    {
        title: 'Timezone-aware scheduling',
        body: 'Pick a time in your own zone, or send at 9am in each recipient’s local time. Everything is stored in UTC so nothing shifts under DST.',
    },
    {
        title: 'Delivery timeline per message',
        body: 'Queued, sent, delivered, opened, clicked, bounced — an append-only event log per recipient, fed by provider webhooks and deduplicated on event id.',
    },
    {
        title: 'Provider-agnostic sending',
        body: 'Resend, Amazon SES or your own SMTP behind one interface, with Ethereal as the development sink. Swap providers without touching campaign code.',
    },
    {
        title: 'Idempotent API',
        body: 'Send an Idempotency-Key and a retried request replays the original response instead of scheduling a second campaign.',
    },
    {
        title: 'Warmup and throttling',
        body: 'Per-sender hourly and daily caps, plus a three-week warmup ramp so a new domain does not go from zero to fifty thousand overnight.',
    },
    {
        title: 'Runs anywhere',
        body: 'API and worker are separate processes with graceful shutdown, real readiness probes and a Docker Compose stack for the whole thing.',
    },
];

const DELIVERABILITY = [
    {
        title: 'One-click unsubscribe',
        body: 'List-Unsubscribe and List-Unsubscribe-Post headers plus a visible footer link — required by Gmail and Yahoo for bulk senders, and by law in most jurisdictions.',
    },
    {
        title: 'Automatic suppression',
        body: 'Unsubscribes, hard bounces and spam complaints are suppressed instantly and checked again immediately before every send, not just at schedule time.',
    },
    {
        title: 'Domain authentication',
        body: 'Generated DKIM keypair, SPF and DMARC records, and live DNS verification. Senders cannot use a domain until it passes.',
    },
    {
        title: 'Reputation guards',
        body: 'Campaigns pause themselves automatically if the complaint rate crosses 0.1% or bounces cross 5% — before a provider makes that decision for you.',
    },
];

const BOXES = [
    { x: 20, y: 130, w: 130, label: 'Dashboard', sub: 'Next.js' },
    { x: 200, y: 130, w: 130, label: 'API', sub: 'Express' },
    { x: 380, y: 40, w: 150, label: 'Postgres', sub: 'source of truth' },
    { x: 380, y: 220, w: 150, label: 'Redis · BullMQ', sub: 'delayed jobs' },
    { x: 590, y: 130, w: 150, label: 'Worker', sub: 'claim · limit · send' },
    { x: 790, y: 130, w: 130, label: 'Provider', sub: 'SES · Resend' },
];

export default function ShowcasePage() {
    return (
        <div className={styles.page}>
            {/* ---- Nav ---- */}
            <header className={styles.nav}>
                <div className={`${styles.shell} ${styles.navInner}`}>
                    <Link href="/" className={styles.brand}>
                        <span className={styles.brandMark}>✦</span>
                        Dispatch
                    </Link>

                    <nav className={styles.navLinks}>
                        <a href="#reliability" className={styles.navLink}>Reliability</a>
                        <a href="#features" className={styles.navLink}>Features</a>
                        <a href="#deliverability" className={styles.navLink}>Deliverability</a>
                        <a href="#architecture" className={styles.navLink}>Architecture</a>
                    </nav>

                    <div className={styles.navActions}>
                        <Link href="/login" className={`${styles.btn} ${styles.btnGhost}`}>
                            Sign in
                        </Link>
                        <Link href="/login?mode=register" className={`${styles.btn} ${styles.btnPrimary}`}>
                            Get started
                        </Link>
                    </div>
                </div>
            </header>

            {/* ---- Hero ---- */}
            <section className={styles.hero}>
                <div className={styles.heroGlow} />
                <div className={`${styles.shell} ${styles.heroInner}`}>
                    <div>
                        <span className={styles.eyebrow}>
                            <span className={styles.eyebrowDot} />
                            Queue-backed delivery, not cron
                        </span>

                        <h1 className={styles.heroTitle}>
                            Scheduled email that
                            <br />
                            <span className={styles.heroAccent}>actually arrives</span>
                        </h1>

                        <p className={styles.heroLead}>
                            Schedule thousands of personalised messages, throttled per sender and
                            spread across hours. Survives restarts, never sends twice, and handles
                            the unglamorous parts — unsubscribes, bounces, complaints and domain
                            authentication — before they cost you your sending reputation.
                        </p>

                        <div className={styles.heroActions}>
                            <Link
                                href="/login?mode=register"
                                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLarge}`}
                            >
                                Start sending free
                            </Link>
                            <a
                                href="#architecture"
                                className={`${styles.btn} ${styles.btnGhost} ${styles.btnLarge}`}
                            >
                                See how it works
                            </a>
                        </div>

                        <p className={styles.heroNote}>
                            <Check size={12} /> No credit card · Ethereal sandbox included · Bring
                            your own SES, Resend or SMTP
                        </p>
                    </div>

                    <LiveCard />
                </div>
            </section>

            {/* ---- Metric strip ---- */}
            <section className={styles.strip}>
                <div className={`${styles.shell} ${styles.stripInner}`}>
                    <div>
                        <div className={styles.stripValue}>Exactly once</div>
                        <div className={styles.stripLabel}>Per-recipient delivery</div>
                    </div>
                    <div>
                        <div className={styles.stripValue}>Zero loss</div>
                        <div className={styles.stripLabel}>Across restarts and deploys</div>
                    </div>
                    <div>
                        <div className={styles.stripValue}>4 providers</div>
                        <div className={styles.stripLabel}>SES · Resend · SMTP · Ethereal</div>
                    </div>
                    <div>
                        <div className={styles.stripValue}>100k</div>
                        <div className={styles.stripLabel}>Recipients per campaign</div>
                    </div>
                </div>
            </section>

            {/* ---- Reliability ---- */}
            <section id="reliability" className={styles.section}>
                <div className={styles.shell}>
                    <div className={styles.sectionHead}>
                        <div className={styles.sectionTag}>Reliability</div>
                        <h2 className={styles.sectionTitle}>Three guarantees, enforced in code</h2>
                        <p className={styles.sectionLead}>
                            Email systems are easy to build and hard to build correctly. These are
                            the properties that break first under concurrency and restarts — so
                            they are the ones worth being explicit about.
                        </p>
                    </div>

                    <div className={styles.guaranteeGrid}>
                        {GUARANTEES.map((item) => (
                            <article key={item.title} className={styles.guarantee}>
                                <div className={styles.guaranteeIcon}>{item.icon}</div>
                                <h3 className={styles.guaranteeTitle}>{item.title}</h3>
                                <p className={styles.guaranteeBody}>{item.body}</p>
                                <div className={styles.guaranteeProof}>{item.proof}</div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            {/* ---- Features ---- */}
            <section id="features" className={`${styles.section} ${styles.sectionAlt}`}>
                <div className={styles.shell}>
                    <div className={styles.sectionHead}>
                        <div className={styles.sectionTag}>Product</div>
                        <h2 className={styles.sectionTitle}>Everything a real send needs</h2>
                        <p className={styles.sectionLead}>
                            Composition, audiences, scheduling and analytics — plus the controls
                            you reach for the moment something goes wrong.
                        </p>
                    </div>

                    <div className={styles.featureGrid}>
                        {FEATURES.map((feature) => (
                            <article key={feature.title} className={styles.feature}>
                                <h3 className={styles.featureTitle}>
                                    <span className={styles.checkIcon}>
                                        <Check />
                                    </span>
                                    {feature.title}
                                </h3>
                                <p className={styles.featureBody}>{feature.body}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            {/* ---- Deliverability ---- */}
            <section id="deliverability" className={styles.section}>
                <div className={`${styles.shell} ${styles.split}`}>
                    <div>
                        <div className={styles.sectionTag}>Deliverability</div>
                        <h2 className={styles.sectionTitle}>
                            Compliance is not a checkbox at the end
                        </h2>
                        <p className={styles.sectionLead}>
                            An unauthenticated domain with no opt-out path lands in spam, and
                            eventually gets the account suspended. All of this is on by default.
                        </p>

                        <ul className={styles.checklist}>
                            {DELIVERABILITY.map((item) => (
                                <li key={item.title} className={styles.checkItem}>
                                    <span className={styles.checkBadge}>
                                        <Check size={12} />
                                    </span>
                                    <span className={styles.checkText}>
                                        <strong>{item.title}</strong>
                                        <span>{item.body}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className={styles.dnsPanel}>
                        <div className={styles.dnsHead}>
                            <span className={styles.dot} style={{ background: '#ff5f57' }} />
                            <span className={styles.dot} style={{ background: '#febc2e' }} />
                            <span className={styles.dot} style={{ background: '#28c840' }} />
                            <span style={{ marginLeft: 6 }}>DNS · acme.com</span>
                        </div>

                        <div className={styles.dnsRow}>
                            <span className={styles.dnsType}>TXT</span>
                            <span className={styles.dnsName}>_emailscheduler.acme.com</span>
                            <span className={styles.dnsOk}>VERIFIED</span>
                        </div>
                        <div className={styles.dnsRow}>
                            <span className={styles.dnsType}>TXT</span>
                            <span className={styles.dnsName}>acme.com · v=spf1</span>
                            <span className={styles.dnsOk}>VERIFIED</span>
                        </div>
                        <div className={styles.dnsRow}>
                            <span className={styles.dnsType}>TXT</span>
                            <span className={styles.dnsName}>
                                es4f2a._domainkey.acme.com · v=DKIM1
                            </span>
                            <span className={styles.dnsOk}>VERIFIED</span>
                        </div>
                        <div className={styles.dnsRow}>
                            <span className={styles.dnsType}>TXT</span>
                            <span className={styles.dnsName}>_dmarc.acme.com · p=none</span>
                            <span className={styles.dnsPending}>PENDING</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ---- Architecture ---- */}
            <section id="architecture" className={styles.dark}>
                <div className={styles.shell}>
                    <div className={styles.sectionHead}>
                        <div className={styles.sectionTag}>Architecture</div>
                        <h2 className={styles.sectionTitle}>Postgres decides. Redis schedules.</h2>
                        <p className={styles.sectionLead}>
                            Delayed jobs move messages to a worker at the right moment, but the
                            database is what says whether a message may send. Losing Redis costs
                            you timing, never mail.
                        </p>
                    </div>

                    <svg
                        className={styles.diagram}
                        viewBox="0 0 940 320"
                        role="img"
                        aria-label="The dashboard calls the API, which writes campaigns and messages to Postgres and enqueues delayed jobs in Redis. Workers claim messages, check suppression and rate limits, then send through a provider. Provider webhooks flow back into the event log."
                    >
                        <defs>
                            <marker
                                id="arrow"
                                viewBox="0 0 10 10"
                                refX="9"
                                refY="5"
                                markerWidth="6"
                                markerHeight="6"
                                orient="auto-start-reverse"
                            >
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                            </marker>
                        </defs>

                        {BOXES.map((box) => (
                            <g key={box.label}>
                                <rect
                                    x={box.x}
                                    y={box.y}
                                    width={box.w}
                                    height="62"
                                    rx="10"
                                    fill="#111c2e"
                                    stroke="#1e293b"
                                />
                                <text
                                    x={box.x + box.w / 2}
                                    y={box.y + 26}
                                    textAnchor="middle"
                                    fill="#f1f5f9"
                                    fontSize="14"
                                    fontWeight="600"
                                    fontFamily="Inter, sans-serif"
                                >
                                    {box.label}
                                </text>
                                <text
                                    x={box.x + box.w / 2}
                                    y={box.y + 45}
                                    textAnchor="middle"
                                    fill="#64748b"
                                    fontSize="11"
                                    fontFamily="Inter, sans-serif"
                                >
                                    {box.sub}
                                </text>
                            </g>
                        ))}

                        <g stroke="#475569" strokeWidth="1.6" fill="none" markerEnd="url(#arrow)">
                            <path d="M150 161 L196 161" />
                            <path d="M330 150 L376 90" />
                            <path d="M330 172 L376 240" />
                            <path d="M530 251 L586 180" />
                            <path d="M530 71 L586 148" />
                            <path d="M740 161 L786 161" />
                        </g>

                        <path
                            d="M855 130 L855 40 L560 40"
                            stroke="#22c55e"
                            strokeWidth="1.6"
                            strokeDasharray="5 4"
                            fill="none"
                            markerEnd="url(#arrow)"
                        />
                        <text
                            x="700"
                            y="32"
                            textAnchor="middle"
                            fill="#22c55e"
                            fontSize="11"
                            fontFamily="Inter, sans-serif"
                        >
                            webhooks — delivered · bounced · complained
                        </text>
                    </svg>

                    <div className={styles.codeWrap}>
                        <div className={styles.codeBar}>
                            <span className={styles.dot} style={{ background: '#ff5f57' }} />
                            <span className={styles.dot} style={{ background: '#febc2e' }} />
                            <span className={styles.dot} style={{ background: '#28c840' }} />
                            <span style={{ marginLeft: 6 }}>POST /api/campaigns</span>
                        </div>
                        <pre className={styles.code}>
                            <code>
                                <span className={styles.codeComment}>
                                    {'# Retry this safely — the key replays the original response'}
                                </span>
                                {'\n'}
                                <span className={styles.codeFn}>curl</span>
                                {' -X POST $API/api/campaigns \\\n  -H '}
                                <span className={styles.codeStr}>
                                    &quot;Idempotency-Key: 9f2c...&quot;
                                </span>
                                {' \\\n  -d '}
                                <span className={styles.codeStr}>&#39;&#123;</span>
                                {'\n    '}
                                <span className={styles.codeKey}>&quot;name&quot;</span>
                                {': '}
                                <span className={styles.codeStr}>&quot;March launch&quot;</span>
                                {',\n    '}
                                <span className={styles.codeKey}>&quot;subject&quot;</span>
                                {': '}
                                <span className={styles.codeStr}>
                                    &quot;Hi &#123;&#123;first_name|there&#125;&#125;&quot;
                                </span>
                                {',\n    '}
                                <span className={styles.codeKey}>&quot;scheduledAt&quot;</span>
                                {': '}
                                <span className={styles.codeStr}>
                                    &quot;2026-08-01T09:00:00Z&quot;
                                </span>
                                {',\n    '}
                                <span className={styles.codeKey}>&quot;timezone&quot;</span>
                                {': '}
                                <span className={styles.codeStr}>&quot;Asia/Kolkata&quot;</span>
                                {',\n    '}
                                <span className={styles.codeKey}>&quot;listId&quot;</span>
                                {': '}
                                <span className={styles.codeStr}>&quot;aud_7c1e...&quot;</span>
                                {'\n  '}
                                <span className={styles.codeStr}>&#125;&#39;</span>
                            </code>
                        </pre>
                    </div>
                </div>
            </section>

            {/* ---- CTA ---- */}
            <section className={styles.cta}>
                <div className={styles.shell}>
                    <h2 className={styles.ctaTitle}>Schedule your first campaign</h2>
                    <p className={styles.ctaLead}>
                        Every new account gets a sandbox sender, so you can watch the whole
                        pipeline run before you point a real domain at it.
                    </p>
                    <div className={styles.ctaActions}>
                        <Link
                            href="/login?mode=register"
                            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLarge}`}
                        >
                            Create an account
                        </Link>
                        <Link
                            href="/dashboard"
                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnLarge}`}
                        >
                            Open the dashboard
                        </Link>
                    </div>
                </div>
            </section>

            {/* ---- Footer ---- */}
            <footer className={styles.footer}>
                <div className={`${styles.shell} ${styles.footerInner}`}>
                    <div className={styles.brand}>
                        <span className={styles.brandMark}>✦</span>
                        Dispatch
                    </div>
                    <div className={styles.footerLinks}>
                        <a href="#reliability" className={styles.navLink}>Reliability</a>
                        <a href="#features" className={styles.navLink}>Features</a>
                        <a href="#architecture" className={styles.navLink}>Architecture</a>
                        <Link href="/login" className={styles.navLink}>Sign in</Link>
                    </div>
                    <div className={styles.footerNote}>Built with BullMQ, Postgres and Redis.</div>
                </div>
            </footer>
        </div>
    );
}
