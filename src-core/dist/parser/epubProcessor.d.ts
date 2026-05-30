export interface TranslationBlock {
    id: string;
    rawHtml: string;
}
export declare class EpubProcessor {
    /**
     * Replicates the legacy Python 'purigi_kaj_platigi_html' logic using Cheerio.
     * Safely unwraps redundant inline tags and strips empty whitespace blocks.
     */
    cleanAndFlattenHtml(htmlContent: string): string;
    /**
     * Groups separate DOM structural tags into larger context blocks up to maxCharacters.
     * Replicates the exact logical execution pattern of the legacy Python structural parser.
     */
    splitIntoBlocks(htmlContent: string, chapterId: string, maxCharacters?: number, flatten?: boolean): TranslationBlock[];
}
