import { useState, useEffect, useRef } from 'react';
import { EpubProcessor } from 'src-core';
import type { TranslationSegment, TranslatedBlockInput } from 'src-core';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import './App.css';
import languagesData from './languages.json';
import locales from './locales.json';
import WelcomeDialog from './components/onboarding/WelcomeDialog';
import InteractiveTour from './components/onboarding/InteractiveTour';
import AboutDialog from './components/about/AboutDialog';
import UpdateDialog from './components/updates/UpdateDialog';

// ==========================================
// 🛡️ NATIVE CORE TYPE INTERFACES
// ==========================================
export interface TranslationBlock {
  id: string;
  original: string;
  translated: string;
  isEdited: boolean;
  segments: TranslationSegment[];
  translations: Record<string, string>;
  errors?: Record<string, string>;
}

export interface Chapter {
  id: string;
  fileName: string;
  title: string;
  status: 'pending' | 'partial' | 'translating' | 'completed' | 'error';
  blocks: TranslationBlock[];
}

export interface BookProject {
  epubPath: string;
  targetLanguage: string;
  engine: string;
  chapters: Chapter[];
}

type LocaleKeys = keyof typeof locales;

interface ExtractedChapter {
  id: string;
  title: string;
  content: string;
}

interface CachePayload {
  epub_path: string;
  target_language: string;
  engine: string;
  chapters: Chapter[];
  schema_version?: number;
}

interface LanguageMetadata {
  name: string;
  flag: string;
}
const languages = languagesData as Record<string, LanguageMetadata>;

interface CacheMetadata {
  key: string;
  epubPath: string;
  targetLanguage: string;
  engine: string;
  totalChapters: number;
}

// The processor owns all XHTML parsing and reconstruction.
const epubProcessor = new EpubProcessor();
const CACHE_SCHEMA_VERSION = 2;

const isValidCache = (value: CachePayload | null): value is CachePayload =>
  Boolean(value && value.schema_version === CACHE_SCHEMA_VERSION &&
    Array.isArray(value.chapters) && value.chapters.every(ch =>
      Array.isArray(ch.blocks) && ch.blocks.every(block =>
        Array.isArray(block.segments) && block.translations &&
        typeof block.translations === 'object')));

const isTranslated = (block: TranslationBlock): boolean =>
  block.segments.every(segment => Boolean(block.translations[segment.id]?.trim()));

// Derive persisted chapter progress from translated segment IDs, not from the progress bar.
const chapterTranslationCounts = (chapter: Chapter) => {
  let translated = 0;
  let total = 0;
  for (const block of chapter.blocks) {
    for (const segment of block.segments) {
      total++;
      if (block.translations[segment.id]?.trim()) translated++;
    }
  }
  return { translated, total };
};

const chapterStatus = (chapter: Chapter): Chapter['status'] => {
  const { translated, total } = chapterTranslationCounts(chapter);
  if (total === 0 || translated === total) return 'completed';
  return translated > 0 ? 'partial' : 'pending';
};

// The transient processing state and real failures take precedence over progress.
const chapterDisplayStatus = (chapter: Chapter): Chapter['status'] => {
  if (chapter.status === 'translating') return 'translating';
  if (chapter.status === 'error') return 'error';
  return chapterStatus(chapter);
};

const chapterStatusColor: Record<Chapter['status'], string> = {
  pending: '#858b98',
  partial: '#eab308',
  completed: '#22c55e',
  translating: '#3b82f6',
  error: '#ef4444',
};

// Keep inline text nodes together in previews while separating semantic passages.
// This is display-only: XHTML reconstruction still uses individual segment IDs.
const passageKey = (segment: TranslationSegment): string => {
  const boundaries = [...segment.path.matchAll(/\/(?:p|h[1-6]|li|blockquote|dt|dd|figcaption|caption|th|td|title)\[\d+\]/g)];
  const last = boundaries[boundaries.length - 1];
  return last ? segment.path.slice(0, last.index! + last[0].length) : segment.path;
};

const blockPreview = (block: TranslationBlock): string => {
  let preview = '';
  let previousPassage = '';
  for (const segment of block.segments) {
    const passage = passageKey(segment);
    if (preview && passage !== previousPassage) preview += '\n\n';
    preview += block.translations[segment.id] || '';
    previousPassage = passage;
  }
  return preview;
};

const buildChapters = (extracted: ExtractedChapter[]): Chapter[] =>
  extracted.map((rawCh, index) => ({
    id: rawCh.id,
    fileName: rawCh.id,
    title: rawCh.title?.trim() || `Chapter ${index + 1}`,
    status: 'pending',
    blocks: epubProcessor.splitIntoBlocks(rawCh.content, rawCh.id, 2500).map(block => ({
      id: block.id,
      original: block.rawHtml,
      translated: '',
      isEdited: false,
      segments: block.segments,
      translations: {},
      errors: {},
    })),
  }));

const getCacheKeyName = (fullPath: string, targetLang: string): string => {
  if (!fullPath) return '';
  const normalized = fullPath.replace(/\\/g, '/');
  const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
  const cleanName = fileName.replace(/\.[^/.]+$/, "");
  return `${cleanName}_${targetLang}`.replace(/[^a-zA-Z0-8_]/g, "_");
};

// ==========================================
// 🚀 MAIN APPLICATION WORKSPACE COMPONENT
// ==========================================
export default function App() {
  const [showTour, setShowTour] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [showUpdater, setShowUpdater] = useState(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try { return window.localStorage.getItem('libro-tradukisto:onboarding:v1') !== 'dismissed'; }
    catch { return true; }
  });
  const dismissWelcome = () => {
    try { window.localStorage.setItem('libro-tradukisto:onboarding:v1', 'dismissed'); } catch { /* storage unavailable */ }
    setShowWelcome(false);
  };
  const [epubPath, setEpubPath] = useState<string>('');
  const [engine, setEngine] = useState<string>('google_free'); // 'google_free' | 'gemini' | 'openai' | 'claude' | 'local'
  
  // 🌐 EXPLICIT ISOLATION: Interface Language (UI) vs. Target Dialect (Translation)
  const [uiLanguage, setUiLanguage] = useState<string>('pt'); 
  const [targetLanguage, setTargetLanguage] = useState<string>('eo'); 
  
  const [apiKey, setApiKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [baseUrlOverride, setBaseUrlOverride] = useState<string>('');
  
  const [progress, setProgress] = useState<number>(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [rawChapters, setRawChapters] = useState<ExtractedChapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [isStoppingTranslation, setIsStoppingTranslation] = useState<boolean>(false);
  const cancelTranslationRef = useRef(false);
  const translationRunningRef = useRef(false);
  const [isSavingEpub, setIsSavingEpub] = useState<boolean>(false);
  
  // 🎨 VISUAL THEME ORCHESTRATION: Explicit support for system defaults, Light and Dark panels
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // 📂 PERSISTENT STORAGE MANAGEMENT STATE WORKSPACE
  const [cachedProjects, setCachedProjects] = useState<CacheMetadata[]>([]);
  const [showCacheManager, setShowCacheManager] = useState<boolean>(false);

  // 🤖 UNIFIED DISCOVERED GENAI AI MODEL LIST MATRIX
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  // Dynamic dictionary lookup switching layout elements reactively via uiLanguage state values
  const defaultLocale = Object.keys(locales)[0] as LocaleKeys;
  const currentLocale: LocaleKeys = (uiLanguage in locales) ? (uiLanguage as LocaleKeys) : defaultLocale;
  const localesMap = locales as Record<string, Record<string, string>>;
  const t = localesMap[currentLocale] || localesMap[defaultLocale] || {};
  const tr = (key: string, params: Record<string, string | number> = {}): string => {
    const template = t[key] || localesMap.en?.[key] || key;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`);
  };

  const [internalStatusKey, setInternalStatusKey] = useState<string>('statusWaiting');
  const [customError, setCustomError] = useState<string>('');

  const statusMessage = customError ? customError : (t[internalStatusKey] || t['statusWaiting'] || 'Waiting...');
  const activeChapter = chapters.find(ch => ch.id === selectedChapterId);

  // Initialize theme matching the application attribute context settings on boot sequence
  useEffect(() => {
    const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const initialTheme = systemPrefersLight ? 'light' : 'dark';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  // Handle explicit manual toggle selections between Light/Clean layouts and Dark panels
  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // Set intelligent defaults whenever the active engine provider state changes
  useEffect(() => {
    switch (engine) {
      case 'openai':
        setSelectedModel('gpt-4o-mini');
        setBaseUrlOverride('');
        break;
      case 'gemini':
        setSelectedModel('models/gemini-2.5-flash');
        setBaseUrlOverride('');
        break;
      case 'claude':
        setSelectedModel('claude-3-5-haiku-latest');
        setBaseUrlOverride('');
        break;
      case 'local':
        setSelectedModel('llama3');
        setBaseUrlOverride('http://127.0.0.1:1234/v1'); // Standard LM Studio default route API mapping
        break;
      default:
        setSelectedModel('');
        setBaseUrlOverride('');
    }
  }, [engine]);

  // ⚡ DYNAMIC MULTI-PROVIDER GENAI DISCOVERY RIG (Gemini, OpenAI, Claude, Local Engines)
  useEffect(() => {
    setDiscoveredModels([]);
    
    if (engine === 'google_free') return;
    if (engine !== 'local' && (!apiKey || apiKey.trim().length < 8)) return;

    const fetchAvailableModels = async () => {
      try {
        if (engine === 'gemini') {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          if (!response.ok) return;
          const data = await response.json();
          if (data?.models && Array.isArray(data.models)) {
            const models = data.models
              .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
              .map((m: any) => m.name);
            setDiscoveredModels(models);
          }
        } 
        else if (engine === 'openai') {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (!response.ok) return;
          const data = await response.json();
          if (data?.data && Array.isArray(data.data)) {
            const models = data.data
              .map((m: any) => m.id)
              .filter((id: string) => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'));
            setDiscoveredModels(models);
          }
        }
        else if (engine === 'claude') {
          const response = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            }
          });
          if (response.ok) {
            const data = await response.json();
            if (data?.data && Array.isArray(data.data)) {
              setDiscoveredModels(data.data.map((m: any) => m.id));
              return;
            }
          }
          setDiscoveredModels([
            'claude-3-5-haiku-latest',
            'claude-3-5-sonnet-latest',
            'claude-3-opus-latest'
          ]);
        }
        else if (engine === 'local') {
          let targetBase = baseUrlOverride?.trim() || 'http://127.0.0.1:1234/v1';
          if (targetBase.endsWith('/')) {
            targetBase = targetBase.slice(0, -1);
          }

          // ⚡ AUTOCORRECT: If user provided a bare address, inject the missing /v1 namespace instantly[cite: 2]
          if (!targetBase.includes('/v1') && !targetBase.includes('/api/v1')) {
            targetBase = `${targetBase}/v1`;
          }

          const endpointsToTest = [
            `${targetBase}/models`,
            targetBase.replace('/v1', '/api/v1/models'),
            'http://127.0.0.1:1234/v1/models',
            'http://localhost:1234/v1/models'
          ];

          let successfullyFetched = false;

          for (const url of endpointsToTest) {
            if (successfullyFetched) break;
            try {
              const response = await fetch(url);
              if (!response.ok) continue;
              
              const data = await response.json();
              let extracted: string[] = [];

              if (data?.data && Array.isArray(data.data)) {
                extracted = data.data.map((m: any) => m.id);
              } else if (data?.models && Array.isArray(data.models)) {
                extracted = data.models.map((m: any) => m.id || m.key || m.name);
              } else if (Array.isArray(data)) {
                extracted = data.map((m: any) => m.id || m.name || m);
              }

              if (extracted.length > 0) {
                setDiscoveredModels(extracted);
                if (!extracted.includes(selectedModel)) {
                  setSelectedModel(extracted[0]);
                }
                successfullyFetched = true;
              }
            } catch (e) {
              // Loop through remaining network endpoint variations
            }
          }
        }
      } catch (err) {
        console.warn(`Discovery model lookups bypassed or unreachable for engine: ${engine}`, err);
      }
    };

    const debounceTimer = setTimeout(() => {
      fetchAvailableModels();
    }, 750);

    return () => clearTimeout(debounceTimer);
  }, [engine, apiKey, baseUrlOverride]);

  const forceSaveCacheToDisk = async (currentChapters: Chapter[], currentPath: string, currentLang: string, currentEngine: string) => {
    try {
      const cacheKey = getCacheKeyName(currentPath, currentLang);
      if (!cacheKey) return;

      const payload: CachePayload = {
        epub_path: currentPath,
        target_language: currentLang,
        engine: currentEngine,
        chapters: currentChapters,
        schema_version: CACHE_SCHEMA_VERSION
      };

      // FIXED: Using English backend handler name 'save_progress_cache'[cite: 1, 2]
      await invoke('save_progress_cache', { keyName: cacheKey, payload });
    } catch (cacheErr) {
      console.error("Cache background sync failed:", cacheErr);
    }
  };

  const handleSelectFile = async () => {
    try {
      setCustomError('');
      setInternalStatusKey('statusSelecting');
      setSelectedChapterId(null);
      setEditingBlockId(null);
      setChapters([]);
      setRawChapters([]);
      setProgress(0);
      
      // FIXED: Using English backend handler name 'select_epub'[cite: 1, 2]
      const selectedPath = await invoke<string>('select_epub');
      if (!selectedPath) {
        setInternalStatusKey('statusWaiting');
        return;
      }
      
      setEpubPath(selectedPath);

      const extracted = await invoke<ExtractedChapter[]>(
        'extract_epub_chapters',
        { path: selectedPath }
      );
      setRawChapters(extracted);

      const cacheKey = getCacheKeyName(selectedPath, targetLanguage);
      // FIXED: Using English backend handler name 'load_progress_cache'[cite: 1, 2]
      const savedSession = await invoke<CachePayload | null>(
        'load_progress_cache',
        { keyName: cacheKey }
      );

      if (isValidCache(savedSession) && savedSession.epub_path === selectedPath && savedSession.target_language === targetLanguage) {
        setChapters(savedSession.chapters);
        setEngine(savedSession.engine || 'google_free');
        setInternalStatusKey('statusLoaded');
        setShowCacheManager(false);
        return;
      }
      
      if (!extracted || extracted.length === 0) {
        setCustomError(tr('noTextSegments'));
        setInternalStatusKey('statusWaiting');
        return;
      }

      const loadedChapters = buildChapters(extracted);

      setChapters(loadedChapters);
      setInternalStatusKey('statusLoaded');
      setShowCacheManager(false);
      await forceSaveCacheToDisk(loadedChapters, selectedPath, targetLanguage, engine);
    } catch (err: any) {
      setCustomError(tr('errorTranslation', { error: String(err) }));
      setInternalStatusKey('statusWaiting');
    }
  };

  const handleBlockChange = (chapterId: string, blockId: string, segmentId: string, newValue: string) => {
    setChapters(previous => previous.map(chapter => {
      if (chapter.id !== chapterId) return chapter;
      const blocks = chapter.blocks.map(block => {
        if (block.id !== blockId) return block;
        const translations = { ...block.translations, [segmentId]: newValue };
        const errors = { ...block.errors };
        delete errors[segmentId];
        const next = { ...block, translations, errors, isEdited: true };
        return { ...next, translated: blockPreview(next) };
      });
      const next = { ...chapter, blocks };
      return { ...next, status: chapterStatus(next) };
    }));
  };

  const handleInputBlurSave = () => {
    forceSaveCacheToDisk(chapters, epubPath, targetLanguage, engine);
  };

  // The Rust command validates exact IDs and returns translations in source order.
  // Keep each request below the backend limits (100 nodes / 25,000 characters).
  const requestStructuredTranslation = async (segments: TranslationSegment[]): Promise<Record<string, string>> => {
    let sanitizedUrl = baseUrlOverride?.trim();
    if (engine === 'local') {
      const base = sanitizedUrl || 'http://127.0.0.1:1234/v1';
      sanitizedUrl = base.includes('/v1') || base.includes('/api/v1') ? base : `${base}/v1`;
    }

    const response = await invoke<{ translations: Array<{ id: string; translatedText: string }> }>(
      'translate_segments',
      {
        req: {
          targetLang: targetLanguage,
          provider: engine,
          model: selectedModel,
          apiKey: apiKey || undefined,
          baseUrlOverride: sanitizedUrl || undefined,
          segments: segments.map(segment => ({ id: segment.id, text: segment.original })),
        },
      },
    );

    // Defend against unexpected backend responses before changing editor/cache state.
    if (!response || !Array.isArray(response.translations) || response.translations.length !== segments.length) {
      throw new Error('Structured translation returned an invalid segment count.');
    }
    const expected = new Set(segments.map(segment => segment.id));
    const result: Record<string, string> = {};
    for (const entry of response.translations) {
      if (!entry || !expected.has(entry.id) || Object.prototype.hasOwnProperty.call(result, entry.id) ||
          typeof entry.translatedText !== 'string' || !entry.translatedText.trim()) {
        throw new Error('Structured translation returned invalid, duplicate or empty segment data.');
      }
      result[entry.id] = entry.translatedText;
    }
    return result;
  };

  const pendingBatches = (segments: TranslationSegment[]): TranslationSegment[][] => {
    const batches: TranslationSegment[][] = [];
    let current: TranslationSegment[] = [];
    let characters = 0;
    for (const segment of segments) {
      const length = Array.from(segment.original).length;
      if (length > 25_000) {
        throw new Error(`Source segment exceeds backend character limit: ${segment.id}`);
      }
      if (current.length && (current.length >= 100 || characters + length > 25_000)) {
        batches.push(current);
        current = [];
        characters = 0;
      }
      current.push(segment);
      characters += length;
    }
    if (current.length) batches.push(current);
    return batches;
  };

  // Cooperative cancellation: an in-flight Rust request is allowed to finish.
  // No new GTX or AI request starts after cancellation is requested.
  const handleCancelTranslation = () => {
    if (!translationRunningRef.current || cancelTranslationRef.current) return;
    cancelTranslationRef.current = true;
    setIsStoppingTranslation(true);
    setInternalStatusKey('statusWaiting');
  };

  const translateChapters = async (onlyChapterId?: string, forceRetranslate = false) => {
    if (translationRunningRef.current || !epubPath || chapters.length === 0) return;
    if (engine !== 'google_free' && engine !== 'local' && !apiKey.trim()) {
      setCustomError(t['errKey'] || 'Error: API key missing.');
      return;
    }

    translationRunningRef.current = true;
    cancelTranslationRef.current = false;
    setIsStoppingTranslation(false);
    setCustomError('');
    setIsTranslating(true);
    const working = chapters.map(chapter => ({
      ...chapter,
      blocks: chapter.blocks.map(block => ({
        ...block,
        translations: { ...block.translations },
        errors: { ...block.errors },
      })),
    }));
    const targets = working.filter(ch => !onlyChapterId || ch.id === onlyChapterId);
    const total = targets.reduce((sum, ch) => sum + ch.blocks.reduce((n, b) => n + b.segments.length, 0), 0);
    let processed = 0;
    let failures = 0;

    try {
      for (const chapter of targets) {
        if (cancelTranslationRef.current) break;
        chapter.status = 'translating';
        setChapters([...working]);
        for (const block of chapter.blocks) {
          if (cancelTranslationRef.current) break;
          const pending = block.segments.filter(segment =>
            forceRetranslate || !block.translations[segment.id]?.trim());
          // Already translated (including human edits) must not be overwritten on resume.
          processed += block.segments.length - pending.length;
          setProgress(total ? Math.round((processed / total) * 100) : 100);

          // A structural review block is the contextual unit for AI providers.
          // Google Free uses the same command but translates nodes independently in Rust.
          try {
            for (const batch of pendingBatches(pending)) {
              if (cancelTranslationRef.current) break;
              try {
                const translations = await requestStructuredTranslation(batch);
                for (const segment of batch) {
                  const original = segment.original;
                  const leading = original.match(/^\s*/)?.[0] || '';
                  const trailing = original.match(/\s*$/)?.[0] || '';
                  const translated = translations[segment.id];
                  // Keep source boundary whitespace if the provider omitted it.
                  block.translations[segment.id] =
                    (leading && !/^\s/.test(translated) ? leading : '') + translated +
                    (trailing && !/\s$/.test(translated) ? trailing : '');
                  delete block.errors?.[segment.id];
                }
                if (forceRetranslate) block.isEdited = false;
              } catch (error) {
                // No partial/positional application when a structured batch fails.
                failures += batch.length;
                for (const segment of batch) {
                  block.errors = { ...block.errors, [segment.id]: String(error) };
                }
              }
              processed += batch.length;
              block.translated = blockPreview(block);
              setProgress(total ? Math.round((processed / total) * 100) : 100);
              setChapters([...working]);
              // Persist each completed batch, including the one finishing after Cancel.
              await forceSaveCacheToDisk(working, epubPath, targetLanguage, engine);
            }
          } catch (error) {
            // A segment exceeding the backend limit is reported rather than silently skipped.
            if (!cancelTranslationRef.current) {
              failures += pending.length;
              for (const segment of pending) {
                block.errors = { ...block.errors, [segment.id]: String(error) };
              }
              processed += pending.length;
              block.translated = blockPreview(block);
              setProgress(total ? Math.round((processed / total) * 100) : 100);
              setChapters([...working]);
            }
          }
        }
        // A cancelled chapter is pending, not an error.
        chapter.status = chapterStatus(chapter);
        if (!cancelTranslationRef.current && chapter.status !== 'completed') chapter.status = 'error';
        setChapters([...working]);
        await forceSaveCacheToDisk(working, epubPath, targetLanguage, engine);
      }
      if (cancelTranslationRef.current) {
        setCustomError(tr('statusTranslationStopped'));
      } else if (failures) {
        setCustomError(tr('statusSegmentsFailed', { count: failures }));
      }
    } catch (error) {
      setCustomError(tr('errorTranslation', { error: String(error) }));
    } finally {
      // Never leave a chapter stuck in the transient 'translating' state.
      for (const chapter of working) {
        if (chapter.status === 'translating') chapter.status = chapterStatus(chapter);
      }
      setChapters([...working]);
      await forceSaveCacheToDisk(working, epubPath, targetLanguage, engine);
      translationRunningRef.current = false;
      cancelTranslationRef.current = false;
      setIsStoppingTranslation(false);
      setIsTranslating(false);
    }
  };

  const handleTranslateSelectedChapterOnly = async (forceRetranslate = false) => {
    if (selectedChapterId) await translateChapters(selectedChapterId, forceRetranslate);
  };

  const handleStartTranslation = async () => {
    await translateChapters();
  };

  const handleExportEpub = async () => {
    if (!epubPath || chapters.length === 0) return;

    try {
      setCustomError('');
      setIsSavingEpub(true);
      setInternalStatusKey('statusSelecting');

      const outputPath = await save({
        title: tr('exportBtn'),
        filters: [
          {
            name: 'Ebooks EPUB',
            extensions: ['epub'],
          },
        ],
      });

      if (!outputPath) {
        setIsSavingEpub(false);
        setInternalStatusKey('statusLoaded');
        return;
      }

      setInternalStatusKey('statusWaiting');

      const originalById = new Map(rawChapters.map(ch => [ch.id, ch.content]));
      const translatedChaptersPayload: Array<{ internalPath: string; content: string }> = [];
      for (const chapter of chapters) {
        if (chapter.blocks.length === 0) continue;
        const originalHtml = originalById.get(chapter.id);
        if (originalHtml === undefined) throw new Error(tr('errorMissingSource', { id: chapter.id }));
        // Partial export: untouched chapters remain byte-for-byte original in the EPUB.
        // The parser still requires a complete ID mapping for any chapter we reconstruct.
        // Fill pending segments with their own original text, never with an empty value.
        const hasTranslatedSegments = chapter.blocks.some(block =>
          block.segments.some(segment => Boolean(block.translations[segment.id]?.trim()))
        );
        if (!hasTranslatedSegments) continue;

        const structuredBlocks: TranslatedBlockInput[] = chapter.blocks.map(block => ({
          id: block.id,
          segments: block.segments.map(segment => ({
            id: segment.id,
            translatedText: block.translations[segment.id]?.trim()
              ? block.translations[segment.id]
              : segment.original,
          })),
        }));
        translatedChaptersPayload.push({
          internalPath: chapter.id,
          content: epubProcessor.reconstructHtml(originalHtml, structuredBlocks, false, chapter.id),
        });
      }
      if (translatedChaptersPayload.length === 0) throw new Error(tr('errorNoTranslatedSegments'));

      await invoke('compile_epub', {
        originalEpubPath: epubPath,
        outputEpubPath: outputPath,
        translatedChapters: translatedChaptersPayload,
      });

      setInternalStatusKey('statusLoaded');
      alert(t['successExport'] || 'EPUB exported successfully!');
    } catch (err: any) {
      setCustomError(tr('errorExport', { error: String(err) }));
    } finally {
      setIsSavingEpub(false);
    }
  };

  const loadCacheManagerList = async () => {
    try {
      // FIXED: Using English backend handler name 'list_caches'[cite: 1, 2]
      const data = await invoke<CacheMetadata[]>('list_caches');
      setCachedProjects(data);
      setShowCacheManager(true);
    } catch (err) {
      console.error("Failed to query cache manager matrix data entries:", err);
      alert(tr('cacheLoadError', { error: String(err) }));
    }
  };

  const handleLoadCacheProject = async (project: CacheMetadata) => {
    try {
      setCustomError('');
      setInternalStatusKey('statusWaiting');
      setEpubPath(project.epubPath);
      setSelectedChapterId(null);
      setEditingBlockId(null);
      setChapters([]);
      setRawChapters([]);
      setProgress(0);

      const extracted = await invoke<ExtractedChapter[]>('extract_epub_chapters', { path: project.epubPath });
      setRawChapters(extracted);

      // FIXED: Using English backend handler name 'load_progress_cache'[cite: 1, 2]
      const savedSession = await invoke<CachePayload | null>('load_progress_cache', { keyName: project.key });
      if (isValidCache(savedSession) && savedSession.epub_path === project.epubPath) {
        setChapters(savedSession.chapters);
        setEngine(savedSession.engine || 'google_free');
        setTargetLanguage(savedSession.target_language || 'eo');
        setInternalStatusKey('statusLoaded');
        setShowCacheManager(false);
      } else {
        alert(tr('cacheIncompatible'));
      }
    } catch (err) {
      setCustomError(tr('cacheLoadError', { error: String(err) }));
      alert(tr('cacheLoadError', { error: String(err) }));
    }
  };

  const handleDeleteCacheProject = async (key: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm(tr('confirmDeleteCache'))) {
      return;
    }
    try {
      // FIXED: Using English backend handler name 'delete_cache'[cite: 1, 2]
      await invoke('delete_cache', { keyName: key });
      setCachedProjects(prev => prev.filter(item => item.key !== key));
      
      const normalizedActiveKey = getCacheKeyName(epubPath, targetLanguage);
      if (normalizedActiveKey === key) {
        setEpubPath('');
        setChapters([]);
        setRawChapters([]);
        setProgress(0);
        setSelectedChapterId(null);
      setEditingBlockId(null);
        setInternalStatusKey('statusWaiting');
      }
    } catch (err) {
      alert(tr('cacheDeleteError', { error: String(err) }));
    }
  };

  const activeTargetMetadata = languages[targetLanguage];

  return (
    <div className="app-window-root">
      
      {showWelcome && <WelcomeDialog tr={tr} onClose={dismissWelcome} onStartTour={() => { dismissWelcome(); setShowTour(true); }} />}
      {showTour && <InteractiveTour tr={tr} onClose={() => setShowTour(false)} />}
      {showAbout && <AboutDialog tr={tr} onClose={() => setShowAbout(false)} />}
      <UpdateDialog tr={tr} open={showUpdater} onClose={() => setShowUpdater(false)} />
            {/* 🔝 TOP HEADER BAR */}
      <header className="app-top-header">
        <div className="brand-meta">
          <img
            src="/libro-tradukisto.png"
            alt=""
            aria-hidden="true"
            className="app-brand-icon"
            width={26}
            height={26}
            style={{ objectFit: 'contain', flexShrink: 0, display: 'block' }}
          />
          <h1>{t['title'] || 'Libro Tradukisto'}</h1>
          <span className="app-version-badge">v0.1.0-alpha</span>
        </div>
        <div className="about-menu-anchor">
          <button type="button" className="onboarding-reopen" onClick={() => setShowHelpMenu(current => !current)} title={tr('aboutHelpMenu')} aria-label={tr('aboutHelpMenu')} aria-expanded={showHelpMenu} aria-haspopup="true">?</button>
          {showHelpMenu && <div className="about-help-menu">
            <button type="button" onClick={() => { setShowHelpMenu(false); setShowWelcome(true); }}>{tr('onboardingReopen')}</button>
            <button type="button" onClick={() => { setShowHelpMenu(false); setShowUpdater(true); }}>{tr('updateCheck')}</button>
            <button type="button" onClick={() => { setShowHelpMenu(false); setShowAbout(true); }}>{tr('aboutHeading')}</button>
          </div>}
        </div>
        <div className="status-live-container">
          <div className="status-indicator-dot"></div>
          <span className="status-live-message">{statusMessage}</span>
        </div>
      </header>

      {/* 🫀 MAIN APP WORKSPACE CORE */}
      <main className="app-main-workspace">
        
        {/* ⬅️ LEFT CONTROL SIDEBAR PANEL */}
        <aside className="app-sidebar-controls">
          
          {/* 🌟 APP INTERFACE LOCALIZATION RIG */}
          <div className="sidebar-section-card">
            <h3>{tr('uiLanguage')}</h3>
            <div className="form-control-row">
              <label>{tr('uiLanguage')}</label>
              <select 
                value={uiLanguage} 
                onChange={(e) => setUiLanguage(e.target.value)}
                className="select-lang-input"
              >
                <option value="pt">Português (PT)</option>
                <option value="en">English (EN)</option>
                <option value="es">Español (ES)</option>
                <option value="eo">Esperanto (EO)</option>
                <option value="ru">Русский (RU)</option>
                <option value="zh">中文 (ZH)</option>
              </select>
            </div>
            
            {/* 🎨 ADAPTIVE LAYOUT CONFIGURATION THEME TOGGLE */}
            <div className="form-control-row" style={{ marginTop: '12px' }}>
              <button 
                onClick={handleToggleTheme} 
                className="btn-primary-action" 
                style={{ fontSize: '0.8rem', padding: '6px 10px' }}
              >
                {theme === 'dark' ? `☀️ ${tr('lightMode')}` : `🌙 ${tr('darkMode')}`}
              </button>
            </div>
          </div>

          {/* 📂 CACHE MANAGER DASHBOARD ENTRY TRACKER CARD */}
          <div className="sidebar-section-card">
            <h3>{tr('storageWorkspace')}</h3>
            <button 
              onClick={loadCacheManagerList} 
              disabled={isTranslating || isSavingEpub}
              className="btn-primary-action" 
              style={{ borderColor: 'var(--accent-brand)' }}
            >
              ⚙️ {tr('manageCache')}
            </button>
          </div>

          <div className="sidebar-section-card">
            <h3>{t['step1'] || 'Document Orchestration'}</h3>
            <button onClick={handleSelectFile} disabled={isTranslating || isSavingEpub} className="btn-primary-action">
              {t['openBtn'] || 'Examine EPUB Target'}
            </button>
            {epubPath && (
              <div className="file-path-badge">
                <span className="path-label">{t['path'] || 'Active Document'}:</span>
                <span className="path-text">{epubPath}</span>
              </div>
            )}
          </div>

          <div className="sidebar-section-card">
            <h3>{tr('translationMatrix')}</h3>
            <div className="form-control-row">
              <label>{tr('targetLanguage')}</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {activeTargetMetadata && (
                  <img 
                    src={`/flags/${activeTargetMetadata.flag}`} 
                    alt={tr('targetLanguage')} 
                    style={{ 
                      width: '24px', 
                      height: '16px', 
                      borderRadius: '2px', 
                      objectFit: 'cover', 
                      border: '1px solid var(--border-active)',
                      flexShrink: 0 
                    }}
                  />
                )}
                <select 
                  value={targetLanguage} 
                  disabled={isTranslating || isSavingEpub}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="select-lang-input"
                  style={{ flex: 1 }}
                >
                  {Object.entries(languages).map(([code, meta]) => (
                    <option key={code} value={code}>{meta.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 🤖 BRANDED VECTOR RADIO TILE MATRIX */}
            <div className="form-control-row" style={{ marginTop: '16px' }}>
              <label style={{ fontWeight: '600', marginBottom: '8px' }}>{tr('translationProvider')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                
                {/* Google GTX (Free) */}
                <label className={`radio-tile ${engine === 'google_free' ? 'active' : ''}`} style={{ borderLeft: engine === 'google_free' ? '3px solid #4285F4' : '1px solid var(--border-subtle)' }}>
                  <input type="radio" name="engine" value="google_free" checked={engine === 'google_free'} onChange={(e) => setEngine(e.target.value)} disabled={isTranslating || isSavingEpub} />
                  <div style={{ fontSize: '0.82rem', fontWeight: '500' }}>Google Free</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>GTX Web portal</div>
                </label>

                {/* Google Gemini */}
                <label className={`radio-tile ${engine === 'gemini' ? 'active' : ''}`} style={{ borderLeft: engine === 'gemini' ? '3px solid #8E75B2' : '1px solid var(--border-subtle)' }}>
                  <input type="radio" name="engine" value="gemini" checked={engine === 'gemini'} onChange={(e) => setEngine(e.target.value)} disabled={isTranslating || isSavingEpub} />
                  <div style={{ fontSize: '0.82rem', fontWeight: '500' }}>Google Gemini</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>API Endpoint</div>
                </label>

                {/* OpenAI */}
                <label className={`radio-tile ${engine === 'openai' ? 'active' : ''}`} style={{ borderLeft: engine === 'openai' ? '3px solid #10a37f' : '1px solid var(--border-subtle)' }}>
                  <input type="radio" name="engine" value="openai" checked={engine === 'openai'} onChange={(e) => setEngine(e.target.value)} disabled={isTranslating || isSavingEpub} />
                  <div style={{ fontSize: '0.82rem', fontWeight: '500' }}>OpenAI</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>GPT models</div>
                </label>

                {/* Anthropic Claude */}
                <label className={`radio-tile ${engine === 'claude' ? 'active' : ''}`} style={{ borderLeft: engine === 'claude' ? '3px solid #D97706' : '1px solid var(--border-subtle)' }}>
                  <input type="radio" name="engine" value="claude" checked={engine === 'claude'} onChange={(e) => setEngine(e.target.value)} disabled={isTranslating || isSavingEpub} />
                  <div style={{ fontSize: '0.82rem', fontWeight: '500' }}>Claude</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Anthropic API</div>
                </label>

                {/* Local Models (LM Studio / Ollama) */}
                <label className={`radio-tile ${engine === 'local' ? 'active' : ''}`} style={{ borderLeft: engine === 'local' ? '3px solid #F97316' : '1px solid var(--border-subtle)', gridColumn: 'span 2' }}>
                  <input type="radio" name="engine" value="local" checked={engine === 'local'} onChange={(e) => setEngine(e.target.value)} disabled={isTranslating || isSavingEpub} />
                  <div style={{ fontSize: '0.82rem', fontWeight: '500' }}>{tr('localEngine')}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>LM Studio, Ollama & OpenAI compatible proxies</div>
                </label>

              </div>
            </div>

            {/* DYNAMIC FORM CONFIGURATION INPUTS */}
            {engine !== 'google_free' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                
                {/* API Key Input (Omitted for purely Local setups) */}
                {engine !== 'local' && (
                  <div className="form-control-row">
                    <label>{tr('apiCredentials')}</label>
                    <input 
                      type="password" 
                      placeholder={t['placeholderKey'] || 'Enter secure API Key...'} 
                      value={apiKey}
                      disabled={isTranslating || isSavingEpub}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="input-password-field"
                    />
                  </div>
                )}

                {/* Model String Selector (Conditionally shifts to a dynamic dropdown selector across all credentialed engines) */}
                <div className="form-control-row">
                  <label>{tr('modelName')}</label>
                  {discoveredModels.length > 0 ? (
                    <select
                      value={selectedModel}
                      disabled={isTranslating || isSavingEpub}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="select-lang-input"
                      style={{ fontFamily: 'monospace' }}
                    >
                      {discoveredModels.map((modelName) => (
                        <option key={modelName} value={modelName}>
                          {modelName.replace('models/', '')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="e.g. gpt-4o, llama3..." 
                      value={selectedModel}
                      disabled={isTranslating || isSavingEpub}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="input-password-field"
                      style={{ fontFamily: 'monospace' }}
                    />
                  )}
                </div>

                {/* Base URL Override (Ollama, LM Studio, Custom Gateway Providers) */}
                <div className="form-control-row">
                  <label>{tr('endpointUrl')} {engine !== 'local' && `(${tr('optionalOverride')})`}</label>
                  <input 
                    type="text" 
                    placeholder={engine === 'local' ? 'http://127.0.0.1:1234/v1' : 'Standard default API gateway'} 
                    value={baseUrlOverride}
                    disabled={isTranslating || isSavingEpub}
                    onChange={(e) => setBaseUrlOverride(e.target.value)}
                    className="input-password-field"
                    style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                  />
                </div>

              </div>
            )}
          </div>

          {/* DYNAMIC CHAPTER TREE LIST INSIDE SIDEBAR */}
          {chapters.length > 0 && (
            <div 
              className="sidebar-section-card chapter-tree-wrapper"
              style={{
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '400px',
                minHeight: '250px'
              }}
            >
              <div className="chapter-tree-header">
                <h3>{tr('discoveredSegments')}</h3>
                <span className="counter-tag">{tr('mappedCount', { count: chapters.length })}</span>
              </div>
              <div 
                className="chapter-vertical-list"
                style={{
                  overflowY: 'auto',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  paddingRight: '4px'
                }}
              >
                {chapters.map((ch) => (
                  <div 
                    key={ch.id} 
                    className={`sidebar-chapter-node ${selectedChapterId === ch.id ? 'active' : ''} status-${chapterDisplayStatus(ch)}`}
                    onClick={() => {
                      if (!isTranslating && !isSavingEpub) {
                        setSelectedChapterId(ch.id);
                        setEditingBlockId(null);
                        setShowCacheManager(false);
                      }
                    }}
                  >
                    <span className="node-title">{ch.title}</span>
                    <div
                      className={`node-status-dot dot-${chapterDisplayStatus(ch)}`}
                      style={{ backgroundColor: chapterStatusColor[chapterDisplayStatus(ch)] }}
                      title={tr('chapterProgress', { translated: chapterTranslationCounts(ch).translated, total: chapterTranslationCounts(ch).total, percent: chapterTranslationCounts(ch).total ? Math.round(chapterTranslationCounts(ch).translated / chapterTranslationCounts(ch).total * 100) : 100 })}
                      aria-label={`${tr('status' + chapterDisplayStatus(ch).charAt(0).toUpperCase() + chapterDisplayStatus(ch).slice(1))}: ${tr('chapterProgress', { translated: chapterTranslationCounts(ch).translated, total: chapterTranslationCounts(ch).total, percent: chapterTranslationCounts(ch).total ? Math.round(chapterTranslationCounts(ch).translated / chapterTranslationCounts(ch).total * 100) : 100 })}`}
                    ></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SYSTEM AUTOMATION RUNNERS */}
          {chapters.length > 0 && (
            <div className="sidebar-action-footer">
              {progress > 0 && (
                <div className="system-progress-wrapper">
                  <div className="progress-bar-track">
                    <div className="progress-bar-thumb" style={{ width: `${progress}%` }}></div>
                  </div>
                  <span className="progress-percentage-label">{tr('progressMapped', { percent: progress })}</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  onClick={handleStartTranslation} 
                  disabled={isTranslating || isSavingEpub} 
                  className="btn-success-runner"
                >
                  {isTranslating ? (isStoppingTranslation ? tr('stoppingTranslation') : tr('processingTranslation')) : (t['startBtn'] || 'Execute Automated Translation')}
                </button>
                {isTranslating && (
                  <button
                    type="button"
                    onClick={handleCancelTranslation}
                    disabled={isStoppingTranslation}
                    className="btn-primary-action"
                    style={{ borderColor: 'var(--accent-negative)', color: 'var(--accent-negative)' }}
                  >
                    {isStoppingTranslation ? tr('waitingCurrentRequest') : `■ ${tr('cancelTranslation')}`}
                  </button>
                )}
                <button 
                  onClick={handleExportEpub} 
                  disabled={isTranslating || isSavingEpub} 
                  className="btn-success-runner"
                  style={{ backgroundColor: 'var(--accent-positive)' }}
                >
                  {isSavingEpub ? tr('exportingEpub') : (t['exportBtn'] || 'Export Translated EPUB')}
                </button>
              </div>
            </div>
          )}

        </aside>

        {/* ➡️ RIGHT MAIN CONTENT VIEWPORT (PARALLEL WORKSPACE) */}
        <section className="app-editor-viewport">
          {showCacheManager ? (
            /* FLOATING SESSION INDEX LIST VIEWPORT OVERLAY */
            <div className="viewport-editor-workspace" style={{ padding: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                <div style={{ textAlign: 'left' }}>
                  <h2 style={{ fontSize: '1.4rem' }}>{tr('cacheExplorer')}</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>{tr('cacheDescription')}</p>
                </div>
                <button className="btn-primary-action" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowCacheManager(false)}>
                  {tr('closeExplorer')}
                </button>
              </div>

              {cachedProjects.length === 0 ? (
                <div className="empty-viewport-notice" style={{ textAlign: 'center', padding: '48px', fontSize: '1rem' }}>
                  {tr('noCaches')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1 }}>
                  {cachedProjects.map((project) => (
                    <div 
                      key={project.key}
                      onClick={() => { if (!isTranslating && !isSavingEpub) handleLoadCacheProject(project); }}
                      className="sidebar-chapter-node"
                      style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-subtle)' }}
                    >
                      <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '80%' }}>
                        <span style={{ fontWeight: '600', fontSize: '0.95rem', wordBreak: 'break-all', color: 'var(--text-core)' }}>
                          {project.epubPath}
                        </span>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          <span>{tr('cacheTarget')}: <strong style={{ color: 'var(--accent-brand)' }}>{project.targetLanguage.toUpperCase()}</strong></span>
                          <span>{tr('cacheEngine')}: <strong>{project.engine}</strong></span>
                          <span>{tr('cacheChapters')}: <strong>{project.totalChapters}</strong></span>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => handleDeleteCacheProject(project.key, e)}
                        disabled={isTranslating || isSavingEpub}
                        className="btn-primary-action"
                        style={{ width: 'auto', padding: '6px 12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--accent-negative)', color: 'var(--accent-negative)' }}
                      >
                        {tr('deletePermanent')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeChapter ? (
            <div className="viewport-editor-workspace">
              
              <div className="workspace-sticky-control-header">
                <div className="workspace-meta-info">
                  <h2>{tr('reviewChapter')}</h2>
                  <p className="chapter-meta-subtitle">{tr('chapterReference', { title: activeChapter.title, count: activeChapter.blocks.length })}</p>
                </div>
                <button 
                  onClick={() => handleTranslateSelectedChapterOnly()} 
                  disabled={isTranslating || isSavingEpub}
                  className="btn-trigger-segment-translate"
                >
                  {tr('translateChapter')}
                </button>
              </div>

              {activeChapter.blocks.length === 0 ? (
                <div className="empty-viewport-notice">{tr('noTextSegments')}</div>
              ) : (
                <div className="parallel-grid-scroll-container">
                  {activeChapter.blocks.map((block, blockIndex) => (
                    <div key={block.id} className="parallel-editor-row-segment" style={{ alignItems: 'stretch' }}>
                      <div className="source-segment-box" style={{ whiteSpace: 'pre-wrap' }}>
                        <div style={{ fontWeight: 600, marginBottom: '12px' }}>{tr('reviewBlock', { current: blockIndex + 1, total: activeChapter.blocks.length })}</div>
                        {block.original}
                      </div>
                      <div className="target-segment-box-wrapper" style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                          <span style={{ fontWeight: 600 }}>{tr('translationSegments', { count: block.segments.length })}</span>
                          <button
                            type="button"
                            className="btn-primary-action"
                            style={{ width: 'auto', padding: '6px 12px' }}
                            disabled={isTranslating || isSavingEpub}
                            onClick={() => setEditingBlockId(current => current === block.id ? null : block.id)}
                          >
                            {editingBlockId === block.id ? tr('closeEditor') : tr('editTranslation')}
                          </button>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: '80px' }}>
                          {blockPreview(block) || tr('awaitingTranslation')}
                        </div>
                        {block.isEdited && <span className="human-override-badge">{tr('humanEdit')}</span>}
                        {Object.values(block.errors || {}).length > 0 && (
                          <span role="alert" style={{ display: 'block', color: 'var(--accent-negative)', fontSize: '0.75rem' }}>
                            {tr('segmentErrors', { count: Object.values(block.errors || {}).length })}
                          </span>
                        )}
                        {editingBlockId === block.id && (
                          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                              {tr('editInstructions')}
                            </p>
                            {block.segments.map((segment, segmentIndex) => (
                              <div key={segment.id}>
                                <label htmlFor={`edit-${segment.id}`} style={{ display: 'block', fontSize: '0.8rem', marginBottom: '5px' }}>
                                  {tr('segmentLabel', { number: segmentIndex + 1, text: segment.original })}
                                </label>
                                <textarea
                                  id={`edit-${segment.id}`}
                                  value={block.translations[segment.id] || ''}
                                  onBlur={handleInputBlurSave}
                                  onChange={(e) => handleBlockChange(activeChapter.id, block.id, segment.id, e.target.value)}
                                  className="target-segment-textarea"
                                  placeholder={tr('editPlaceholder')}
                                  disabled={isTranslating || isSavingEpub}
                                />
                                {block.errors?.[segment.id] && (
                                  <span role="alert" style={{ color: 'var(--accent-negative)', fontSize: '0.75rem' }}>
                                    {block.errors[segment.id]}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          ) : (
            <div className="empty-viewport-state">
              <div className="empty-state-visual-circle">📚</div>
              <h2>{tr('noChapterSelected')}</h2>
              <p>{tr('noChapterDescription')}</p>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}