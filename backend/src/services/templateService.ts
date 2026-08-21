import sanitizeHtml from 'sanitize-html';

/**
 * Merge-tag rendering and HTML hygiene.
 *
 * Syntax: `{{first_name}}`, or `{{first_name|there}}` to supply a fallback for
 * recipients whose data is missing. Falling back matters — "Hi ," in a subject
 * line is the classic mail-merge tell.
 */

const TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g;

/** Lists every distinct tag used, for the composer's variable panel. */
export const extractVariables = (...sources: string[]): string[] => {
    const found = new Set<string>();
    for (const source of sources) {
        for (const match of source.matchAll(TAG_PATTERN)) {
            found.add(match[1]);
        }
    }
    return [...found].sort();
};

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * Substitutes merge tags.
 *
 * Values are HTML-escaped when rendering into HTML: contact data is
 * user-supplied (usually straight from an uploaded CSV) and must never be able
 * to inject markup into the message body.
 */
export const render = (
    source: string,
    data: Record<string, string>,
    opts: { escape?: boolean } = {}
): string => {
    const escape = opts.escape ?? true;

    return source.replace(TAG_PATTERN, (_full, key: string, fallback?: string) => {
        const raw = data[key];
        const value = raw !== undefined && raw !== '' ? raw : (fallback ?? '');
        return escape ? escapeHtml(value) : value;
    });
};

/** Tags present in the content but absent from the supplied data. */
export const findMissingVariables = (
    content: string,
    data: Record<string, string>
): string[] =>
    extractVariables(content).filter(
        (name) => (data[name] === undefined || data[name] === '') && !hasFallback(content, name)
    );

const hasFallback = (content: string, name: string): boolean => {
    for (const match of content.matchAll(TAG_PATTERN)) {
        if (match[1] === name && match[2] !== undefined) return true;
    }
    return false;
};

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Email clients strip scripts anyway, but the body is also rendered back into
 * the dashboard preview — without this, a stored body becomes stored XSS the
 * moment templates are shared between team members.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'small', 'span', 'strong', 'sub', 'sup',
        'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'center', 'font',
    ],
    allowedAttributes: {
        a: ['href', 'name', 'target', 'rel', 'style'],
        img: ['src', 'alt', 'width', 'height', 'style'],
        '*': ['style', 'align', 'valign', 'bgcolor', 'width', 'height', 'colspan', 'rowspan'],
    },
    // `javascript:` and `data:` URLs are the two that matter here.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    allowProtocolRelative: false,
    transformTags: {
        // Prevents reverse-tabnabbing from the dashboard preview.
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
};

export const sanitizeBody = (html: string): string => sanitizeHtml(html, SANITIZE_OPTIONS);

/**
 * Derives a plain-text alternative. A multipart message with a real text part
 * scores materially better with spam filters than HTML alone.
 */
export const htmlToText = (html: string): string =>
    html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();

// ---------------------------------------------------------------------------
// Spam linting
// ---------------------------------------------------------------------------

const SPAM_WORDS = [
    'act now', 'apply now', 'buy direct', 'call now', 'cash bonus', 'click here',
    'congratulations', 'credit card', 'dear friend', 'double your', 'earn extra cash',
    'free access', 'free gift', 'free money', 'guarantee', 'increase sales', 'limited time',
    'lose weight', 'make money', 'no cost', 'no fees', 'no obligation', 'once in a lifetime',
    'order now', 'risk free', 'satisfaction guaranteed', 'special promotion', 'this is not spam',
    'urgent', 'while supplies last', 'winner', 'you have been selected',
];

export interface ContentWarning {
    severity: 'low' | 'medium' | 'high';
    message: string;
}

/**
 * Cheap pre-send checks for the things that most reliably push a message into
 * the spam folder. Advisory only — never blocks a send.
 */
export const lintContent = (subject: string, html: string): ContentWarning[] => {
    const warnings: ContentWarning[] = [];
    const text = htmlToText(html);
    const haystack = `${subject} ${text}`.toLowerCase();

    const hits = SPAM_WORDS.filter((word) => haystack.includes(word));
    if (hits.length >= 3) {
        warnings.push({
            severity: 'high',
            message: `Contains ${hits.length} common spam trigger phrases: ${hits.slice(0, 5).join(', ')}`,
        });
    } else if (hits.length > 0) {
        warnings.push({
            severity: 'low',
            message: `Contains spam trigger phrases: ${hits.join(', ')}`,
        });
    }

    if (subject === subject.toUpperCase() && /[A-Z]{4,}/.test(subject)) {
        warnings.push({ severity: 'medium', message: 'Subject line is all uppercase' });
    }

    if ((subject.match(/[!?]/g) ?? []).length > 2) {
        warnings.push({ severity: 'medium', message: 'Excessive punctuation in the subject line' });
    }

    if (subject.length > 78) {
        warnings.push({
            severity: 'low',
            message: 'Subject longer than 78 characters will be truncated in most clients',
        });
    }

    if (text.length < 40) {
        warnings.push({
            severity: 'medium',
            message: 'Very little text content — image-only emails are frequently filtered',
        });
    }

    const imageCount = (html.match(/<img/gi) ?? []).length;
    if (imageCount > 0 && text.length / imageCount < 100) {
        warnings.push({ severity: 'medium', message: 'High image-to-text ratio' });
    }

    return warnings;
};
