import axios from 'axios';
import * as cheerio from 'cheerio';

export class GoogleFreeClient {
    private endpoint = 'https://translate.googleapis.com/translate_a/single';
    private targetLanguage: string;
    private headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    };

    constructor(targetLanguage: string = 'eo') {
        this.targetLanguage = targetLanguage;
    }

    /**
     * Executes an atomic GET request against the open Google GTX translation API endpoint.
     */
    private async callApi(pureText: string): Promise<string> {
        if (!pureText.trim()) return pureText;

        const params = {
            client: 'gtx',
            sl: 'auto', // Source language auto-detection
            tl: this.targetLanguage,
            dt: 't',
            dj: 1,
            q: pureText
        };

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await axios.get(this.endpoint, {
                    params,
                    headers: this.headers,
                    timeout: 15000
                });

                if (response.status !== 200 || !response.data) {
                    continue;
                }

                let translatedText = '';
                const data = response.data;
                
                if (data.sentences && Array.isArray(data.sentences)) {
                    for (const sentence of data.sentences) {
                        if (sentence.trans) {
                            translatedText += sentence.trans;
                        }
                    }
                }
                return translatedText;
            } catch (error) {
                if (attempt === 2) {
                    console.error(`Error calling Google Free API after 3 attempts: {error}`);
                    return pureText;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
        return pureText;
    }

    /**
     * Fixes specific machine translation artifact errors (like "T lia" drop caps) when target is Esperanto.
     */
    private correctChapterItem(text: string): string {
        const pattern = /^([^>]+>)([A-Z])(<[^>]+>)\s+lia\b/;
        const match = text.match(pattern);
        if (match) {
            const [fullMatch, tag1, letter, tag2] = match;
            if (letter === 'T') {
                return `${tag1}Ĉi${tag2} tiu${text.substring(match.index! + fullMatch.length)}`;
            }
            return `${tag1}${letter}${tag2} tiu${text.substring(match.index! + fullMatch.length)}`;
        }
        return text;
    }

    /**
     * Iterates through structural tags sequentially to preserve document DOM tree structures.
     */
    public async translateBlock(
        htmlText: string,
        genreOrPrompt: string = '',
        glossary?: Record<string, string>
    ): Promise<string> {
        if (!htmlText || !htmlText.trim()) {
            return htmlText;
        }

        const $ = cheerio.load(htmlText, { xml: { decodeEntities: false } });
        const selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';
        
        // Explicitly typed as any to bypass internal multi-version re-assignment errors
        let elements: any = $(selectors);

        // Fallback: If no structural tags match, safely get the first available node
        if (elements.length === 0) {
            elements = $('*').first();
        }

        // Loop sequentially through each node to translate text content safely
        for (let i = 0; i < elements.length; i++) {
            const targetNode = elements[i];
            
            if (targetNode && targetNode.type === 'tag') {
                const el = $(targetNode);
                const originalText = el.text().trim();
                
                if (!originalText || !/[a-zA-Z]/.test(originalText)) {
                    continue;
                }

                const textToTranslate = el.text();
                let translatedText = await this.callApi(textToTranslate);

                if (glossary && Object.keys(glossary).length > 0) {
                    for (const [orig, trad] of Object.entries(glossary)) {
                        const regex = new RegExp(`\\b${orig.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
                        translatedText = translatedText.replace(regex, trad);
                    }
                }

                el.empty();
                el.text(translatedText.trim());
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        const result = $.html();
        return this.targetLanguage === 'eo' ? this.correctChapterItem(result) : result;
    }
}