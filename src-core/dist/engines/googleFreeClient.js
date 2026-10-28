import axios from 'axios';
import * as cheerio from 'cheerio';
export class GoogleFreeClient {
    static gtxEndpoint = 'https://translate.googleapis.com/translate_a/single';
    static cloudEndpoint = 'https://translation.googleapis.com/language/translate/v2';
    static maxAttempts = 3;
    static maxRetryDelayMs = 60_000;
    static maxCacheEntries = 5000;
    static queueByMode = new Map();
    static nextRequestAt = new Map();
    static blockedModes = new Set();
    static cache = new Map();
    targetLanguage;
    mode;
    apiKey;
    minIntervalMs;
    timeoutMs;
    constructor(targetLanguage = 'eo', options = {}) {
        if (!targetLanguage.trim())
            throw new Error('Target language is required.');
        this.targetLanguage = this.normalizeLanguage(targetLanguage);
        this.mode = options.mode ?? 'gtx';
        this.apiKey = options.apiKey?.trim();
        this.minIntervalMs = options.minIntervalMs ?? 3000;
        this.timeoutMs = options.timeoutMs ?? 15000;
        if (!Number.isFinite(this.minIntervalMs) || this.minIntervalMs < 0) {
            throw new Error('minIntervalMs must be a non-negative number.');
        }
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new Error('timeoutMs must be a positive number.');
        }
        if (this.mode === 'cloud-v2-html' && !this.apiKey) {
            throw new Error('An authorized Google Cloud Translation API key is required for HTML mode.');
        }
    }
    normalizeLanguage(language) {
        const value = language.trim().replace(/_/g, '-');
        if (/^pt(?:-br)?$/i.test(value))
            return 'pt-BR';
        if (/^pt-pt$/i.test(value))
            return 'pt-PT';
        return value;
    }
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /** Serialize requests across instances using the same transport. */
    static enqueue(mode, task) {
        const previous = GoogleFreeClient.queueByMode.get(mode) ?? Promise.resolve();
        const result = previous.then(task);
        GoogleFreeClient.queueByMode.set(mode, result.then(() => undefined, () => undefined));
        return result;
    }
    static async waitForSlot(mode, intervalMs) {
        if (GoogleFreeClient.blockedModes.has(mode)) {
            throw new Error(`${mode} refused access. Translation is stopped for this process.`);
        }
        const wait = Math.max(0, (GoogleFreeClient.nextRequestAt.get(mode) ?? 0) - Date.now());
        if (wait > 0)
            await GoogleFreeClient.sleep(wait);
        GoogleFreeClient.nextRequestAt.set(mode, Date.now() + intervalMs);
    }
    static remember(key, value) {
        GoogleFreeClient.cache.delete(key);
        GoogleFreeClient.cache.set(key, value);
        if (GoogleFreeClient.cache.size > GoogleFreeClient.maxCacheEntries) {
            const oldest = GoogleFreeClient.cache.keys().next().value;
            if (oldest !== undefined)
                GoogleFreeClient.cache.delete(oldest);
        }
    }
    static retryAfterMs(value) {
        if (typeof value !== 'string' && typeof value !== 'number')
            return undefined;
        const raw = String(value);
        const seconds = Number(raw);
        if (Number.isFinite(seconds) && seconds >= 0)
            return seconds * 1000;
        const date = Date.parse(raw);
        if (Number.isFinite(date))
            return Math.max(0, date - Date.now());
        return undefined;
    }
    static parseGtxResponse(data) {
        if (!data || typeof data !== 'object')
            throw new Error('Unexpected GTX response.');
        const sentences = data.sentences;
        if (!Array.isArray(sentences))
            throw new Error('GTX did not return sentences.');
        const translated = sentences.map(item => {
            if (!item || typeof item !== 'object')
                return '';
            const value = item.trans;
            return typeof value === 'string' ? value : '';
        }).join('');
        if (!translated.trim())
            throw new Error('GTX returned an empty translation.');
        return translated;
    }
    static parseCloudResponse(data) {
        if (!data || typeof data !== 'object')
            throw new Error('Unexpected Cloud Translation response.');
        const translations = data.data?.translations;
        const translated = translations?.[0]?.translatedText;
        if (typeof translated !== 'string' || !translated.trim()) {
            throw new Error('Cloud Translation returned an empty or invalid translation.');
        }
        return translated;
    }
    async request(job) {
        if (this.mode === 'gtx') {
            if (job.format !== 'text')
                throw new Error('GTX HTML mode is not supported.');
            const response = await axios.get(GoogleFreeClient.gtxEndpoint, {
                params: {
                    client: 'gtx', sl: 'auto', tl: this.targetLanguage,
                    dt: 't', dj: 1, q: job.text,
                },
                timeout: this.timeoutMs,
            });
            return GoogleFreeClient.parseGtxResponse(response.data);
        }
        const response = await axios.post(GoogleFreeClient.cloudEndpoint, new URLSearchParams({
            key: this.apiKey,
            q: job.text,
            target: this.targetLanguage,
            format: job.format,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: this.timeoutMs,
        });
        return GoogleFreeClient.parseCloudResponse(response.data);
    }
    async translate(job) {
        if (!job.text.trim())
            return job.text;
        const cacheKey = JSON.stringify([this.mode, this.targetLanguage, job.format, job.text]);
        const cached = GoogleFreeClient.cache.get(cacheKey);
        if (cached !== undefined)
            return cached;
        return GoogleFreeClient.enqueue(this.mode, async () => {
            const again = GoogleFreeClient.cache.get(cacheKey);
            if (again !== undefined)
                return again;
            for (let attempt = 1; attempt <= GoogleFreeClient.maxAttempts; attempt++) {
                await GoogleFreeClient.waitForSlot(this.mode, this.minIntervalMs);
                try {
                    const translated = await this.request(job);
                    GoogleFreeClient.remember(cacheKey, translated);
                    return translated;
                }
                catch (error) {
                    const axiosError = axios.isAxiosError(error) ? error : undefined;
                    const status = axiosError?.response?.status;
                    if (status === 403) {
                        GoogleFreeClient.blockedModes.add(this.mode);
                        throw new Error(`${this.mode} returned HTTP 403. Translation stopped.`);
                    }
                    if (status === 429) {
                        const retryAfter = GoogleFreeClient.retryAfterMs(axiosError?.response?.headers?.['retry-after']);
                        const pause = retryAfter ?? GoogleFreeClient.maxRetryDelayMs;
                        GoogleFreeClient.nextRequestAt.set(this.mode, Math.max(GoogleFreeClient.nextRequestAt.get(this.mode) ?? 0, Date.now() + pause));
                        throw new Error(`${this.mode} returned HTTP 429. Translation stopped; respect the service limit.`);
                    }
                    const retryable = status === undefined
                        ? Boolean(axiosError && ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET'].includes(axiosError.code ?? ''))
                        : status === 408 || status >= 500;
                    if (!retryable || attempt === GoogleFreeClient.maxAttempts) {
                        const detail = status ? `HTTP ${status}` : error instanceof Error ? error.message : String(error);
                        throw new Error(`Translation failed (${this.mode}): ${detail}`);
                    }
                    const backoff = Math.min(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500), GoogleFreeClient.maxRetryDelayMs);
                    GoogleFreeClient.nextRequestAt.set(this.mode, Math.max(GoogleFreeClient.nextRequestAt.get(this.mode) ?? 0, Date.now() + backoff));
                }
            }
            throw new Error('Translation attempts exhausted.');
        });
    }
    applyGlossary(text, glossary) {
        if (!glossary)
            return text;
        let result = text;
        for (const [source, target] of Object.entries(glossary)) {
            if (!source.trim())
                continue;
            const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
            result = result.replace(pattern, () => target);
        }
        return result;
    }
    applyGlossaryToHtml(html, glossary) {
        if (!glossary || Object.keys(glossary).length === 0)
            return html;
        const $ = cheerio.load(html, { xml: { decodeEntities: false } });
        for (const node of $('*').contents().toArray()) {
            if (node.type === 'text' && 'data' in node) {
                node.data = this.applyGlossary(node.data, glossary);
            }
        }
        return $.xml();
    }
    /**
     * Translate a fragment while retaining its markup.
     * Official HTML mode translates the fragment as a whole.
     * GTX mode translates individual text nodes to avoid destroying markup.
     * The genreOrPrompt argument is retained for backwards compatibility.
     */
    async translateBlock(htmlText, genreOrPrompt = '', glossary) {
        void genreOrPrompt;
        if (!htmlText?.trim())
            return htmlText;
        if (this.mode === 'cloud-v2-html') {
            // Cloud Translation HTML mode can alter markup; validate EPUB XHTML downstream.
            const result = await this.translate({ text: htmlText, format: 'html' });
            // Apply glossary only to text nodes so markup and attributes remain intact.
            return this.applyGlossaryToHtml(result, glossary);
        }
        const $ = cheerio.load(htmlText, { xml: { decodeEntities: false } });
        const excluded = new Set(['script', 'style', 'code', 'pre', 'svg', 'math']);
        const nodes = $('*').contents().toArray().filter(node => {
            if (node.type !== 'text' || !('data' in node) || !node.data.trim())
                return false;
            let ancestor = node.parent;
            while (ancestor) {
                if ('name' in ancestor && typeof ancestor.name === 'string' && excluded.has(ancestor.name.toLowerCase())) {
                    return false;
                }
                ancestor = ancestor.parent;
            }
            return /\p{L}/u.test(node.data);
        });
        for (const node of nodes) {
            if (node.type !== 'text' || !('data' in node))
                continue;
            const original = node.data;
            const leading = original.match(/^\s*/u)?.[0] ?? '';
            const trailing = original.match(/\s*$/u)?.[0] ?? '';
            const core = original.slice(leading.length, original.length - trailing.length);
            if (!core.trim())
                continue;
            const translated = this.applyGlossary(await this.translate({ text: core, format: 'text' }), glossary);
            node.data = leading + translated.trim() + trailing;
        }
        return $.xml();
    }
}
