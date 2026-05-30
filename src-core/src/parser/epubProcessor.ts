import * as cheerio from 'cheerio';

export interface TranslationBlock {
    id: string;
    rawHtml: string;
}

export class EpubProcessor {
    /**
     * Replicates the legacy Python 'purigi_kaj_platigi_html' logic using Cheerio.
     * Safely unwraps redundant inline tags and strips empty whitespace blocks.
     */
    public cleanAndFlattenHtml(htmlContent: string): string {
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
                
                if (
                    node.text().trim().length === 0 && 
                    !['br', 'img', 'hr', 'meta', 'link'].includes(nodeName)
                ) {
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
    public splitIntoBlocks(
        htmlContent: string, 
        chapterId: string, 
        maxCharacters: number = 5000, 
        flatten: boolean = false
    ): TranslationBlock[] {
        
        const workingHtml = flatten ? this.cleanAndFlattenHtml(htmlContent) : htmlContent;
        const $ = cheerio.load(workingHtml, { 
            xml: { decodeEntities: false } 
        });
        
        const selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';
        const elements = $(selectors);
        
        const blocks: TranslationBlock[] = [];
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
            } else {
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