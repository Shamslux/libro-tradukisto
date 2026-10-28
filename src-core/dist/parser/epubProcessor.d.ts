/** A translatable text node, identified by its position in the original XML tree. */
export interface TranslationSegment {
    id: string;
    original: string;
    /** The element path is diagnostic only; reconstruction uses the segment ID. */
    path: string;
}
/** A bounded request group containing complete, independently addressable text nodes. */
export interface TranslationBlock {
    id: string;
    rawHtml: string;
    segments: TranslationSegment[];
}
/** A translated text node. The translation must be plain text, not markup. */
export interface TranslatedSegmentInput {
    id: string;
    translatedText: string;
}
/** A translation response associated with a request block. */
export interface TranslatedBlockInput {
    id: string;
    translatedHtml?: string;
    segments?: TranslatedSegmentInput[];
}
export declare class EpubProcessor {
    /**
     * Flattening is intentionally disabled in the fidelity-preserving pipeline.
     * Removing spans or other wrappers can destroy anchors, styles, and semantics.
     */
    cleanAndFlattenHtml(htmlContent: string): string;
    /**
     * Groups complete semantic passages into contextual translation requests.
     * Oversized passages remain intact to preserve inline-node correspondence.
     */
    splitIntoBlocks(htmlContent: string, chapterId: string, maxCharacters?: number, flatten?: boolean): TranslationBlock[];
    /**
     * Reconstructs the original XHTML using explicit text-node IDs.
     * Rejects unknown, duplicate, missing, or blank translations. A translation
     * is assigned as text data, so markup supplied by a provider is escaped.
     */
    reconstructHtml(originalHtml: string, translatedBlocks: TranslatedBlockInput[], flatten?: boolean, chapterId?: string): string;
}
