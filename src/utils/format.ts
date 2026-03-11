/**
 * Converts generic Markdown (often produced by LLMs like Groq) 
 * into Telegram's strict subset of HTML.
 */
export function markdownToTelegramHtml(text: string): string {
    if (!text) return '';

    let html = text;

    // 1. Escape HTML special characters to prevent parsing errors, 
    // EXCEPT those we are about to inject or those that are part of intended formatting.
    // It's safer to escape &, <, > first, then convert MD to HTML.
    html = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // 3. Italic: *text* or _text_ (careful with URLs and underscores in code)
    // We only match if there's no space immediately following the start or preceding the end.
    html = html.replace(/(?<!\w)\*(?!\s)(.*?)(?<!\s)\*(?!\w)/g, '<i>$1</i>');
    html = html.replace(/(?<!\w)_(?!\s)(.*?)(?<!\s)_(?!\w)/g, '<i>$1</i>');

    // 4. Strikethrough: ~~text~~
    html = html.replace(/~~(.*?)~~/g, '<s>$1</s>');

    // 5. Code Blocks: ```language\ncode``` or ```code```
    html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        // Telegram supports language classes in HTML mode for code blocks
        if (lang) {
            return `<pre><code class="language-${lang}">${code}</code></pre>`;
        }
        return `<pre><code>${code}</code></pre>`;
    });

    // 6. Inline Code: `text`
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // 7. Links: [text](URL)
    // We already escaped HTML chars, so the URL might have &amp;
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    return html;
}
