/**
 * Experimental GTX support plus optional official Google Cloud Translation v2.
 * GTX is undocumented and has no guaranteed quota or availability.
 * Use an authorized Google Cloud API key for the official HTML mode.
 */
export type GoogleTranslationMode = 'gtx' | 'cloud-v2-html';
export interface GoogleFreeClientOptions {
    mode?: GoogleTranslationMode;
    apiKey?: string;
    minIntervalMs?: number;
    timeoutMs?: number;
}
export declare class GoogleFreeClient {
    private static readonly gtxEndpoint;
    private static readonly cloudEndpoint;
    private static readonly maxAttempts;
    private static readonly maxRetryDelayMs;
    private static readonly maxCacheEntries;
    private static readonly queueByMode;
    private static readonly nextRequestAt;
    private static readonly blockedModes;
    private static readonly cache;
    private readonly targetLanguage;
    private readonly mode;
    private readonly apiKey?;
    private readonly minIntervalMs;
    private readonly timeoutMs;
    constructor(targetLanguage?: string, options?: GoogleFreeClientOptions);
    private normalizeLanguage;
    private static sleep;
    /** Serialize requests across instances using the same transport. */
    private static enqueue;
    private static waitForSlot;
    private static remember;
    private static retryAfterMs;
    private static parseGtxResponse;
    private static parseCloudResponse;
    private request;
    private translate;
    private applyGlossary;
    private applyGlossaryToHtml;
    /**
     * Translate a fragment while retaining its markup.
     * Official HTML mode translates the fragment as a whole.
     * GTX mode translates individual text nodes to avoid destroying markup.
     * The genreOrPrompt argument is retained for backwards compatibility.
     */
    translateBlock(htmlText: string, genreOrPrompt?: string, glossary?: Record<string, string>): Promise<string>;
}
