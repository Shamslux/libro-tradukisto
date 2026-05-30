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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EpubProcessor = void 0;
const cheerio = __importStar(require("cheerio"));
class EpubProcessor {
    /**
     * Replicates the legacy Python 'purigi_kaj_platigi_html' logic using Cheerio.
     * Safely unwraps redundant inline tags and strips empty whitespace blocks.
     */
    cleanAndFlattenHtml(htmlContent) {
        const $ = cheerio.load(htmlContent, {
            xml: { decodeEntities: false }
        });
        // 1. Unwrap spans and font tags keeping their raw text content intact
        $('span, font').each((_, el) => {
            $(el).replaceWith($(el).contents());
        });
        // 2. Safely decompose empty layout structures
        $('*').each((_, el) => {
            const node = $(el);
            if (el.type === 'tag') {
                const nodeName = el.name.toLowerCase();
                if (node.text().trim().length === 0 &&
                    !['br', 'img', 'hr', 'meta', 'link'].includes(nodeName)) {
                    node.remove();
                }
            }
        });
        return $.html();
    }
    /**
     * Groups separate DOM structural tags into larger context blocks up to maxCharacters.
     * Replicates the exact logical execution pattern of the legacy Python structural parser.
     */
    splitIntoBlocks(htmlContent, chapterId, maxCharacters = 5000, flatten = false) {
        const workingHtml = flatten ? this.cleanAndFlattenHtml(htmlContent) : htmlContent;
        const $ = cheerio.load(workingHtml, {
            xml: { decodeEntities: false }
        });
        const selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';
        const elements = $(selectors);
        const blocks = [];
        let currentChunk = '';
        let blockIndex = 0;
        elements.each((_, el) => {
            const elementHtml = $.html(el).trim();
            if (elementHtml.length > maxCharacters && !currentChunk) {
                blocks.push({
                    id: `${chapterId}_${blockIndex++}`,
                    rawHtml: elementHtml
                });
                return;
            }
            if (currentChunk.length + elementHtml.length > maxCharacters && currentChunk) {
                blocks.push({
                    id: `${chapterId}_${blockIndex++}`,
                    rawHtml: currentChunk
                });
                currentChunk = elementHtml;
            }
            else {
                currentChunk += elementHtml;
            }
        });
        if (currentChunk) {
            blocks.push({
                id: `${chapterId}_${blockIndex++}`,
                rawHtml: currentChunk
            });
        }
        return blocks;
    }
}
exports.EpubProcessor = EpubProcessor;
