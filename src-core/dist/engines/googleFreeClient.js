"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleFreeClient = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
class GoogleFreeClient {
    endpoint = 'https://translate.googleapis.com/translate_a/single';
    targetLanguage;
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    };
    constructor(targetLanguage = 'eo') {
        this.targetLanguage = targetLanguage;
    }
    /**
     * Executes an atomic GET request against the open Google GTX translation API endpoint.
     */
    async callApi(pureText) {
        if (!pureText.trim())
            return pureText;
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
                const response = await axios_1.default.get(this.endpoint, {
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
            }
            catch (error) {
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
    correctChapterItem(text) {
        const pattern = /^([^>]+>)([A-Z])(<[^>]+>)\s+lia\b/;
        const match = text.match(pattern);
        if (match) {
            const [fullMatch, tag1, letter, tag2] = match;
            if (letter === 'T') {
                return `${tag1}Ĉi${tag2} tiu${text.substring(match.index + fullMatch.length)}`;
            }
            return `${tag1}${letter}${tag2} tiu${text.substring(match.index + fullMatch.length)}`;
        }
        return text;
    }
    /**
     * Iterates through structural tags sequentially to preserve document DOM tree structures.
     */
    async translateBlock(htmlText, genreOrPrompt = '', glossary) {
        if (!htmlText || !htmlText.trim()) {
            return htmlText;
        }
        const $ = cheerio.load(htmlText, { xml: { decodeEntities: false } });
        const selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';
        // Explicitly typed as any to bypass internal multi-version re-assignment errors
        let elements = $(selectors);
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
exports.GoogleFreeClient = GoogleFreeClient;
