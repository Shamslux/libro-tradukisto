export declare class GoogleFreeClient {
    private endpoint;
    private targetLanguage;
    private headers;
    constructor(targetLanguage?: string);
    /**
     * Executes an atomic GET request against the open Google GTX translation API endpoint.
     */
    private callApi;
    /**
     * Fixes specific machine translation artifact errors (like "T lia" drop caps) when target is Esperanto.
     */
    private correctChapterItem;
    /**
     * Iterates through structural tags sequentially to preserve document DOM tree structures.
     */
    translateBlock(htmlText: string, genreOrPrompt?: string, glossary?: Record<string, string>): Promise<string>;
}
