import { describe, expect, it } from 'vitest';
import {
    extractVariables,
    findMissingVariables,
    htmlToText,
    lintContent,
    render,
    sanitizeBody,
} from '../src/services/templateService.js';

describe('merge tags', () => {
    it('substitutes values', () => {
        expect(render('Hi {{first_name}}!', { first_name: 'Nilesh' })).toBe('Hi Nilesh!');
    });

    it('tolerates whitespace inside the braces', () => {
        expect(render('Hi {{  first_name  }}', { first_name: 'Ada' })).toBe('Hi Ada');
    });

    it('uses the fallback when a value is missing or empty', () => {
        expect(render('Hi {{first_name|there}}', {})).toBe('Hi there');
        expect(render('Hi {{first_name|there}}', { first_name: '' })).toBe('Hi there');
    });

    it('renders an empty string when there is no value and no fallback', () => {
        expect(render('Hi {{first_name}}!', {})).toBe('Hi !');
    });

    it('escapes HTML in contact data', () => {
        // Contact data usually comes straight from an uploaded CSV — it must
        // never be able to inject markup into the message body.
        const output = render('<p>Hi {{name}}</p>', {
            name: '<img src=x onerror=alert(1)>',
        });

        expect(output).not.toContain('<img');
        expect(output).toContain('&lt;img');
    });

    it('does not escape when rendering a subject line', () => {
        expect(render('{{name}} & co', { name: 'Ben' }, { escape: false })).toBe('Ben & co');
    });

    it('lists the variables in use', () => {
        expect(extractVariables('Hi {{first_name}}', '{{company}} — {{first_name}}')).toEqual([
            'company',
            'first_name',
        ]);
    });

    it('reports variables with no data and no fallback', () => {
        const content = 'Hi {{first_name}}, welcome to {{company|our product}}';
        expect(findMissingVariables(content, {})).toEqual(['first_name']);
        expect(findMissingVariables(content, { first_name: 'Ada' })).toEqual([]);
    });
});

describe('sanitizeBody', () => {
    it('strips script tags', () => {
        const output = sanitizeBody('<p>Hello</p><script>alert(1)</script>');
        expect(output).toBe('<p>Hello</p>');
    });

    it('strips javascript: URLs', () => {
        const output = sanitizeBody('<a href="javascript:alert(1)">click</a>');
        expect(output).not.toContain('javascript:');
    });

    it('strips inline event handlers', () => {
        const output = sanitizeBody('<div onclick="steal()">hi</div>');
        expect(output).not.toContain('onclick');
    });

    it('keeps the formatting email actually uses', () => {
        const html =
            '<table><tr><td style="padding:8px"><a href="https://example.com">Link</a></td></tr></table>';
        const output = sanitizeBody(html);

        expect(output).toContain('<table>');
        expect(output).toContain('href="https://example.com"');
        expect(output).toContain('padding:8px');
    });

    it('adds rel=noopener to links', () => {
        expect(sanitizeBody('<a href="https://example.com">x</a>')).toContain(
            'rel="noopener noreferrer"'
        );
    });
});

describe('htmlToText', () => {
    it('produces a readable plain-text alternative', () => {
        const text = htmlToText('<h1>Title</h1><p>Hello <strong>world</strong></p>');
        expect(text).toBe('Title\nHello world');
    });

    it('keeps link targets visible', () => {
        expect(htmlToText('<a href="https://example.com">our site</a>')).toContain(
            'our site (https://example.com)'
        );
    });

    it('collapses runs of blank lines', () => {
        expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
    });
});

describe('lintContent', () => {
    it('flags heavy spam-trigger vocabulary', () => {
        const warnings = lintContent(
            'Act now — free money',
            '<p>Click here for a risk free, no obligation limited time offer. Winner!</p>'
        );

        expect(warnings.some((w) => w.severity === 'high')).toBe(true);
    });

    it('flags an all-caps subject', () => {
        const warnings = lintContent('BUY OUR PRODUCT TODAY', '<p>'.padEnd(120, 'x') + '</p>');
        expect(warnings.some((w) => w.message.includes('uppercase'))).toBe(true);
    });

    it('flags excessive punctuation', () => {
        const warnings = lintContent('Really?!?', '<p>'.padEnd(120, 'x') + '</p>');
        expect(warnings.some((w) => w.message.includes('punctuation'))).toBe(true);
    });

    it('flags a subject that clients will truncate', () => {
        const warnings = lintContent('x'.repeat(90), '<p>'.padEnd(120, 'y') + '</p>');
        expect(warnings.some((w) => w.message.includes('78 characters'))).toBe(true);
    });

    it('stays quiet on ordinary content', () => {
        const warnings = lintContent(
            'Your March invoice is ready',
            '<p>Hello, your invoice for March is attached below. It covers the usual monthly subscription and is due in 14 days. Reply if anything looks wrong.</p>'
        );

        expect(warnings).toEqual([]);
    });
});
