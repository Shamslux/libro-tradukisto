import * as cheerio from 'cheerio';

export interface TranslationBlock {
    id: string;
    rawHtml: string;
}

export interface TranslatedBlockInput {
    id: string;
    translatedHtml: string;
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

    /**
     * Reconstructs the chapter HTML by inserting the translated text blocks 
     * sequentially back into the same original positions as the structural elements.
     * 
     * @param originalHtml The raw HTML/XHTML of the original chapter.
     * @param translatedBlocks List containing the IDs and translated contents (in rendering order).
     * @param flatten If true, normalizes the structure by applying simplification rules.
     */
    public reconstructHtml(
        originalHtml: string,
        translatedBlocks: TranslatedBlockInput[],
        flatten: boolean = false
    ): string {
        if (!originalHtml || originalHtml.trim().length === 0) {
            return originalHtml;
        }

        const workingHtml = flatten ? this.cleanAndFlattenHtml(originalHtml) : originalHtml;
        const $ = cheerio.load(workingHtml, { 
            xml: { decodeEntities: false } 
        });

        const selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd';
        const elements = $(selectors);

        let blockIndex = 0;
        let currentBlockPayload = translatedBlocks[blockIndex];

        if (!currentBlockPayload) {
            return $.html();
        }

        // Load the first translated block into a Cheerio fragment
        let blockMarkup = cheerio.load(currentBlockPayload.translatedHtml, { 
            xml: { decodeEntities: false } 
        });
        let translatedElements = blockMarkup(selectors);
        let elementInBlockIndex = 0;

        // Sequentially iterate through each original structural element
        elements.each((_, el) => {
            const currentTranslatedEl = translatedElements[elementInBlockIndex];

            if (currentTranslatedEl) {
                // Replace the original element with the corresponding translated one while preserving the structural tag
                $(el).replaceWith(blockMarkup.html(currentTranslatedEl));
                elementInBlockIndex++;
            }

            // If the node limit for this block is reached, advance to the next translation block
            if (elementInBlockIndex >= translatedElements.length) {
                blockIndex++;
                currentBlockPayload = translatedBlocks[blockIndex];

                if (currentBlockPayload) {
                    blockMarkup = cheerio.load(currentBlockPayload.translatedHtml, { 
                        xml: { decodeEntities: false } 
                    });
                    translatedElements = blockMarkup(selectors);
                    elementInBlockIndex = 0;
                }
            }
        });

        return $.html();
    }
}