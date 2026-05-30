export interface GeminiConfig {
    apiKey?: string;
    modelName?: string;
    targetLanguage?: string;
}
export declare class GeminiClient {
    private ai;
    private modelName;
    private targetLanguage;
    modelHealthStatus: Record<string, string>;
    private languageNames;
    constructor(config?: GeminiConfig);
    /**
     * Builds the system translation guidelines based on style, genre, or custom prompts,
     * injecting the glossary terms transparently.
     */
    private prepareInstruction;
    /**
     * Translates an atomic block of HTML payload safely with automated retry logic for rate limits.
     */
    translateBlock(text: string, genreOrPrompt: string, glossary?: Record<string, string>, retries?: number): Promise<string>;
}
