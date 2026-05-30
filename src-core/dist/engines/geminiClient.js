"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiClient = void 0;
const genai_1 = require("@google/genai");
class GeminiClient {
    ai;
    modelName;
    targetLanguage;
    modelHealthStatus = {};
    languageNames = {
        "eo": "Esperanto",
        "pt": "Português",
        "en": "English",
        "es": "Español",
        "zh": "中文",
        "fr": "Français",
        "de": "Deutsch",
        "ru": "Русский"
    };
    constructor(config = {}) {
        const key = config.apiKey || process.env.GEMINI_API_KEY;
        if (!key) {
            throw new Error("Error: GEMINI_API_KEY not found!");
        }
        this.ai = new genai_1.GoogleGenAI({ apiKey: key });
        this.modelName = config.modelName || "gemini-2.0-flash";
        this.targetLanguage = config.targetLanguage || "eo";
    }
    /**
     * Builds the system translation guidelines based on style, genre, or custom prompts,
     * injecting the glossary terms transparently.
     */
    prepareInstruction(genreOrPrompt, glossary) {
        const targetLangName = this.languageNames[this.targetLanguage] || "Esperanto";
        // Fixed: Calling .toUpperCase() directly on the string
        let baseInstruction = `VI ESTAS PROFESIA TRADUKISTO AL ${targetLangName.toUpperCase()}\n` +
            `VIA CELO: Traduki la tekston al eleganta, akademia, literara kaj flua ${targetLangName}.\n` +
            `STILO-REGULOJ:\n` +
            `- Konservu HTML-etikedojn netusxitaj. Ne traduku ene de < >.\n` +
            `- Liveru NUR la tradukitu HTML-kodon, sen klarigoj.\n`;
        if (this.targetLanguage === "eo") {
            baseInstruction = baseInstruction.replace("STILO-REGULOJ:\n", "STILO-REGULOJ:\n- Uzu klasikan stilon (Zamenhofan).\n");
        }
        const bibleRule = this.targetLanguage === "eo"
            ? "Por bibliaj citaĵoj, uzu la oficialan Esperantan Biblion (La Sankta Biblio de Zamenhof)."
            : `Por bibliaj citaĵoj, uzu the definition version en ${targetLangName}.`;
        const styles = {
            "teologio": "STILO: Biblia, solena kaj ekumena. REGLOJ: Uzu klasikan vortprovizon. Uzu majusklojn por Diaj pronomoj (Li, Lia).",
            "kristana_teologio": `STILO: Biblia, solena kaj ekumena. REGLOJ: Uzu klasikan vortprovizon. ${bibleRule} Uzu majusklojn por Diaj pronomoj (Li, Lia).`,
            "akademia": "STILO: Rigora, preciza, neŭtra kaj scienca. REGLOJ: Uzu pasivajn voĉojn por objektiveco; konservu teknikajn terminojn laŭ internaciaj sciencaj normoj.",
            "fantasto": "STILO: Epika, evoka kaj atmosfera. REGLOJ: Uzu poeziajn metaforojn; kreu arkaikan senton.",
            "sciencfikcio": `STILO: Moderna, teknologia kaj futurisma. REGLOJ: Kreu neologismojn laŭ the language norms of ${targetLangName}.`,
            "biografio": "STILO: Rakonta, intimeca kaj historia. REGLOJ: Fokusigu la psikologiajn nuancojn.",
            "poezio": "STILO: Lirika, ritma kaj belsona. REGLOJ: Prioritatu eŭfonion; permesu eliziojn.",
            "generala": `STILO: Klara, ekvilibra kaj moderna. REGLOJ: Sekvu la 'Baza Literatura Standardo' por ${targetLangName}.`
        };
        const lookupKey = genreOrPrompt.toLowerCase();
        let finalInstruction = styles[lookupKey] ? `${baseInstruction}\n${styles[lookupKey]}` : `${baseInstruction}\n${genreOrPrompt}`;
        if (glossary && Object.keys(glossary).length > 0) {
            let glossaryText = "\n\nGRAVA: Konservu cxi tiun terminologion (Glosaro):\n";
            for (const [orig, trad] of Object.entries(glossary)) {
                glossaryText += `- '${orig}' -> '${trad}'\n`;
            }
            finalInstruction += glossaryText;
        }
        return finalInstruction;
    }
    /**
     * Translates an atomic block of HTML payload safely with automated retry logic for rate limits.
     */
    async translateBlock(text, genreOrPrompt, glossary, retries = 5) {
        const instruction = this.prepareInstruction(genreOrPrompt, glossary);
        const fullPrompt = `${instruction}\n\nJEN LA TEKSTO POR TRADUKI:\n${text}`;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await this.ai.models.generateContent({
                    model: this.modelName,
                    contents: fullPrompt
                });
                if (!response || !response.text) {
                    continue;
                }
                this.modelHealthStatus[this.modelName] = "Sana";
                return response.text;
            }
            catch (error) {
                const errorMsg = String(error).toUpperCase();
                if (errorMsg.includes("429")) {
                    this.modelHealthStatus[this.modelName] = "Limo Atingita (429)";
                    const delay = (65 + attempt * 10) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                else if (errorMsg.includes("404")) {
                    this.modelHealthStatus[this.modelName] = "Modelo ne trovita (404)";
                    return `Eraro: Modelo ${this.modelName} ne trovita.`;
                }
                else {
                    this.modelHealthStatus[this.modelName] = `Eraro: ${errorMsg.substring(0, 20)}...`;
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            }
        }
        return "Eraro: Ne eblis traduki post pluraj provoj.";
    }
}
exports.GeminiClient = GeminiClient;
