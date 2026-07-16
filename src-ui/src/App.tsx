import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import './App.css';
import languagesData from './languages.json';
import locales from './locales.json';

// ==========================================
// 🛡️ NATIVE CORE TYPE INTERFACES
// ==========================================
export interface TranslationBlock {
  id: string;
  original: string;
  translated: string;
  isEdited: boolean;
}

export interface Chapter {
  id: string;
  fileName: string;
  title: string;
  status: 'pending' | 'translating' | 'completed' | 'error';
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
}

interface LanguageMetadata {
  name: string;
  flag: string;
}
const languages = languagesData as Record<string, LanguageMetadata>;

// ==========================================
// ⚙️ ULTRA-SAFE DOM PARSING, CHUNKING & RECONSTRUCTION ENGINE
// ==========================================
const splitTextIntoCleanBlocks = (htmlContent: string, maxLength: number): string[] => {
  if (!htmlContent || !htmlContent.trim()) return [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const body = doc.body || doc.documentElement;
    
    let paragraphs: string[] = [];
    const textNodes = body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, td, section, article');
    
    if (textNodes && textNodes.length > 0) {
      textNodes.forEach(node => {
        const text = node.textContent?.trim();
        if (text && text.length > 0 && !node.querySelector('p, div')) {
          paragraphs.push(text);
        }
      });
    }

    if (paragraphs.length === 0) {
      const cleanText = htmlContent
        .replace(/<\/?[^>]+(>|$)/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

      paragraphs = cleanText
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => line.length > 1);
    }

    if (paragraphs.length === 0) {
      const globalText = body.textContent?.trim();
      if (globalText) paragraphs.push(globalText);
    }

    const blocks: string[] = [];
    let currentBlock = '';

    for (const paragraph of paragraphs) {
      if (paragraph.length > maxLength) {
        if (currentBlock.trim()) blocks.push(currentBlock.trim());
        blocks.push(paragraph);
        currentBlock = '';
        continue;
      }

      if ((currentBlock + paragraph).length > maxLength) {
        if (currentBlock.trim()) blocks.push(currentBlock.trim());
        currentBlock = paragraph + '\n\n';
      } else {
        currentBlock += paragraph + '\n\n';
      }
    }
    
    if (currentBlock.trim()) blocks.push(currentBlock.trim());
    return blocks;
  } catch (err) {
    console.error("Internal DOM parsing exception intercepted:", err);
    return [];
  }
};

/**
 * Cleanly reconstructs the original HTML template structure of a chapter, 
 * merging translated paragraph blocks with existing DOM elements.
 */
const reconstructHtmlBrowser = (originalHtml: string, blocks: TranslationBlock[]): string => {
  if (!originalHtml || !originalHtml.trim()) return originalHtml;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalHtml, 'text/html');
    const body = doc.body || doc.documentElement;

    const textNodes: Element[] = [];
    const allCandidateNodes = body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, td, section, article');
    
    allCandidateNodes.forEach(node => {
      const text = node.textContent?.trim();
      if (text && text.length > 0 && !node.querySelector('p, div')) {
        textNodes.push(node);
      }
    });

    // Flatten sequential list of translated paragraph entries extracted from parsed UI blocks
    const translatedParagraphs: string[] = [];
    for (const block of blocks) {
      const textToUse = block.translated && block.translated.trim() ? block.translated : block.original;
      const parts = textToUse.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
      translatedParagraphs.push(...parts);
    }

    // Overwrite node contexts preserving all existing metadata attributes, classes, and tags
    textNodes.forEach((node, idx) => {
      if (idx < translatedParagraphs.length) {
        node.textContent = translatedParagraphs[idx];
      }
    });

    return doc.documentElement.innerHTML;
  } catch (err) {
    console.error("Error during HTML reconstruction:", err);
    return originalHtml;
  }
};

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
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [isSavingEpub, setIsSavingEpub] = useState<boolean>(false);
  
  // 🎨 VISUAL THEME ORCHESTRATION: Explicit support for system defaults, Light and Dark panels
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Dynamic dictionary lookup switching layout elements reactively via uiLanguage state values
  const defaultLocale = Object.keys(locales)[0] as LocaleKeys;
  const currentLocale: LocaleKeys = (uiLanguage in locales) ? (uiLanguage as LocaleKeys) : defaultLocale;
  const localesMap = locales as Record<string, Record<string, string>>;
  const t = localesMap[currentLocale] || localesMap[defaultLocale] || {};

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
        setSelectedModel('gemini-2.5-flash');
        setBaseUrlOverride('');
        break;
      case 'claude':
        setSelectedModel('claude-3-5-haiku-latest');
        setBaseUrlOverride('');
        break;
      case 'local':
        setSelectedModel('llama3');
        setBaseUrlOverride('http://localhost:1234/v1'); // Standard LM Studio API port allocation
        break;
      default:
        setSelectedModel('');
        setBaseUrlOverride('');
    }
  }, [engine]);

  const forceSaveCacheToDisk = async (currentChapters: Chapter[], currentPath: string, currentLang: string, currentEngine: string) => {
    try {
      const cacheKey = getCacheKeyName(currentPath, currentLang);
      if (!cacheKey) return;

      const payload: CachePayload = {
        epub_path: currentPath,
        target_language: currentLang,
        engine: currentEngine,
        chapters: currentChapters
      };

      await invoke('salvar_progresso_cache', { keyNome: cacheKey, payload });
    } catch (cacheErr) {
      console.error("Cache background sync failed:", cacheErr);
    }
  };

  const handleSelectFile = async () => {
    try {
      setCustomError('');
      setInternalStatusKey('statusSelecting');
      setSelectedChapterId(null);
      setChapters([]);
      setRawChapters([]);
      setProgress(0);
      
      const selectedPath = await invoke<string>('selecionar_epub');
      if (!selectedPath) {
        setInternalStatusKey('statusWaiting');
        return;
      }
      
      setEpubPath(selectedPath);

      // Always extract raw HTML schemas in the background to preserve visual structure layouts
      const extracted = await invoke<ExtractedChapter[]>(
        'extract_epub_chapters',
        { path: selectedPath }
      );
      setRawChapters(extracted);

      const cacheKey = getCacheKeyName(selectedPath, targetLanguage);
      const savedSession = await invoke<CachePayload | null>(
        'carregar_progresso_cache',
        { keyNome: cacheKey }
      );

      if (
        savedSession &&
        savedSession.chapters &&
        savedSession.chapters.length > 0
      ) {
        setChapters(savedSession.chapters);
        setEngine(savedSession.engine || 'google_free');
        setInternalStatusKey('statusLoaded');
        return;
      }
      
      if (!extracted || extracted.length === 0) {
        setCustomError('Error: Backend returned an empty chapter schema matrix.');
        setInternalStatusKey('statusWaiting');
        return;
      }

      const loadedChapters: Chapter[] = [];
      let index = 0;

      for (const rawCh of extracted) {
        const cleanBlocks = splitTextIntoCleanBlocks(rawCh.content, 2500);
        
        const uiBlocks = cleanBlocks.map((textStr: string, bIndex: number) => ({
          id: `b_${index}_${bIndex}`,
          original: textStr,
          translated: '', 
          isEdited: false
        }));

        loadedChapters.push({
          id: rawCh.id || `ch_${index}`,
          fileName: rawCh.id ? (rawCh.id.endsWith('.html') || rawCh.id.endsWith('.xhtml') ? rawCh.id : rawCh.id + '.html') : `chapter_${index}.html`,
          title: (rawCh.title && rawCh.title.trim()) ? rawCh.title.trim() : `Chapter ${index + 1}`,
          status: 'pending',
          blocks: uiBlocks
        });
        
        index++;
      }

      setChapters(loadedChapters);
      setInternalStatusKey('statusLoaded');
      await forceSaveCacheToDisk(loadedChapters, selectedPath, targetLanguage, engine);
    } catch (err: any) {
      setCustomError(`Notice: ${err}`);
      setInternalStatusKey('statusWaiting');
    }
  };

  const handleBlockChange = (
    chapterId: string,
    blockId: string,
    newValue: string
  ) => {
    const updatedChapters = chapters.map((chapter) => {
      if (chapter.id !== chapterId) {
        return chapter;
      }

      const updatedBlocks = chapter.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              translated: newValue,
              isEdited: true,
            }
          : block
      );

      const allBlocksTranslated = updatedBlocks.every(
        (block) => block.translated.trim().length > 0
      );

      return {
        ...chapter,
        blocks: updatedBlocks,
        status: allBlocksTranslated ? 'completed' : 'pending',
      };
    });

    setChapters(updatedChapters);
  };

  const handleInputBlurSave = () => {
    forceSaveCacheToDisk(chapters, epubPath, targetLanguage, engine);
  };

  const requestTranslationFromRust = async (text: string): Promise<string> => {
    if (engine === 'google_free') {
      return await invoke<string>('translate_text_free', { text, targetLang: targetLanguage });
    } else {
      // Safely process parameters through our unified core API command
      return await invoke<string>('translate_text_ai', {
        req: {
          text,
          targetLang: targetLanguage,
          provider: engine,
          model: selectedModel,
          apiKey: apiKey || undefined,
          baseUrlOverride: baseUrlOverride || undefined
        }
      });
    }
  };

  const handleTranslateSelectedChapterOnly = async (
    forceRetranslate = false
  ) => {
    if (!selectedChapterId || !activeChapter) return;

    if (engine !== 'google_free' && engine !== 'local' && !apiKey) {
      setCustomError(t['errKey'] || 'Error: API key missing.');
      return;
    }

    try {
      setCustomError('');
      setIsTranslating(true);

      const workingChapters = chapters.map((chapter) =>
        chapter.id === selectedChapterId
          ? { ...chapter, status: 'translating' as const }
          : chapter
      );

      const targetChapterIndex = workingChapters.findIndex(
        (chapter) => chapter.id === selectedChapterId
      );

      const totalBlocks =
        workingChapters[targetChapterIndex].blocks.length;

      setChapters([...workingChapters]);

      for (let index = 0; index < totalBlocks; index++) {
        const currentBlock =
          workingChapters[targetChapterIndex].blocks[index];

        if (forceRetranslate || !currentBlock.translated.trim()) {
          try {
            currentBlock.translated =
              await requestTranslationFromRust(currentBlock.original);

            currentBlock.isEdited = false;
          } catch (error) {
            currentBlock.translated = `[Translation error: ${error}]`;
          }
        }

        setProgress(
          Math.round(((index + 1) / totalBlocks) * 100)
        );

        setChapters([...workingChapters]);
      }

      workingChapters[targetChapterIndex].status = 'completed';

      setChapters([...workingChapters]);
      await forceSaveCacheToDisk(
        workingChapters,
        epubPath,
        targetLanguage,
        engine
      );
    } catch (error) {
      setCustomError(`Error: ${error}`);

      setChapters((previous) =>
        previous.map((chapter) =>
          chapter.id === selectedChapterId
            ? { ...chapter, status: 'error' as const }
            : chapter
        )
      );
    } finally {
      setIsTranslating(false);
    }
  };

  const handleStartTranslation = async () => {
    if (!epubPath || chapters.length === 0) return;
    if (engine !== 'google_free' && engine !== 'local' && !apiKey) {
      setCustomError(t['errKey'] || 'Error: API key missing.');
      return;
    }

    try {
      setCustomError('');
      setIsTranslating(true);
      
      let totalBlocksCount = 0;
      chapters.forEach(ch => totalBlocksCount += ch.blocks.length);
      
      let continuousProcessedBlocks = 0;
      const workingChapters = [...chapters];

      for (let i = 0; i < workingChapters.length; i++) {
        const currentChapter = workingChapters[i];
        if (currentChapter.status === 'completed' || currentChapter.blocks.length === 0) {
          continuousProcessedBlocks += currentChapter.blocks.length;
          continue;
        }

        setChapters(prev => prev.map((ch, idx) => idx === i ? { ...ch, status: 'translating' as const } : ch));

        for (let j = 0; j < currentChapter.blocks.length; j++) {
          const currentBlock = currentChapter.blocks[j];
          if (!currentBlock.translated) {
            try {
              currentBlock.translated = await requestTranslationFromRust(currentBlock.original);
            } catch (blockErr) {
              currentBlock.translated = `[Translation error: ${blockErr}]`;
            }
          }
          continuousProcessedBlocks++;
          setProgress(Math.round((continuousProcessedBlocks / totalBlocksCount) * 100));
          setChapters([...workingChapters]);
        }

        workingChapters[i].status = 'completed';
        setChapters([...workingChapters]);
        await forceSaveCacheToDisk(workingChapters, epubPath, targetLanguage, engine);
      }

      setIsTranslating(false);
    } catch (globalErr: any) {
      setCustomError(`Aborted: ${globalErr}`);
      setIsTranslating(false);
    }
  };

  const handleExportEpub = async () => {
    if (!epubPath || chapters.length === 0) return;

    try {
      setCustomError('');
      setIsSavingEpub(true);
      setInternalStatusKey('statusSelecting');

      const outputPath = await save({
        title: 'Save Translated EPUB',
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

      // Merge translations back with source HTML fragments sequentially
      const translatedChaptersPayload = chapters.map((chapter) => {
        const originalCh = rawChapters.find((r) => r.id === chapter.id);
        const originalHtml = originalCh ? originalCh.content : '';
        const reconstructedHtml = reconstructHtmlBrowser(originalHtml, chapter.blocks);

        return {
          internalPath: chapter.id,
          content: reconstructedHtml,
        };
      });

      await invoke('gerar_epub', {
        originalEpubPath: epubPath,
        outputEpubPath: outputPath,
        translatedChapters: translatedChaptersPayload,
      });

      setInternalStatusKey('statusLoaded');
      alert(t['successExport'] || 'EPUB exported successfully!');
    } catch (err: any) {
      setCustomError(`Export failed: ${err}`);
    } finally {
      setIsSavingEpub(false);
    }
  };

  const activeTargetMetadata = languages[targetLanguage];

  return (
    <div className="app-window-root">
      
      {/* 🔝 TOP HEADER BAR */}
      <header className="app-top-header">
        <div className="brand-meta">
          <h1>{t['title'] || 'Libro Tradukisto'}</h1>
          <span className="app-version-badge">v0.1.0-alpha</span>
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
            <h3>App Localization</h3>
            <div className="form-control-row">
              <label>Interface Language</label>
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
                {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
              </button>
            </div>
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
            <h3>Translation Matrix</h3>
            <div className="form-control-row">
              <label>Target Language Dialect</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {activeTargetMetadata && (
                  <img 
                    src={`/flags/${activeTargetMetadata.flag}`} 
                    alt="Regional Target Dialect Flag" 
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
              <label style={{ fontWeight: '600', marginBottom: '8px' }}>Translation Engine Provider</label>
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
                  <div style={{ fontSize: '0.82rem', fontWeight: '500' }}>Local Offline Engine</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>LM Studio, Ollama & OpenAI compatible proxies</div>
                </label>

              </div>
            </div>

            {/* DYNAMIC FORM CONFIGURATION INPUTS */}
            {engine !== 'google_free' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                
                {/* Model String Selector */}
                <div className="form-control-row">
                  <label>Model Descriptor Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. gpt-4o, llama3..." 
                    value={selectedModel}
                    disabled={isTranslating || isSavingEpub}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="input-password-field"
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>

                {/* API Key Input (Omitted for purely Local set-ups) */}
                {engine !== 'local' && (
                  <div className="form-control-row">
                    <label>Secure API Access Credentials</label>
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

                {/* Base URL Override (Ollama, LM Studio, Custom Gateway Providers) */}
                <div className="form-control-row">
                  <label>Service Endpoint Base URL {engine !== 'local' && '(Optional Overwrite)'}</label>
                  <input 
                    type="text" 
                    placeholder={engine === 'local' ? 'http://localhost:1234/v1' : 'Standard default API gateway'} 
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
            <div className="sidebar-section-card chapter-tree-wrapper">
              <div className="chapter-tree-header">
                <h3>Discovered Segments</h3>
                <span className="counter-tag">{chapters.length} mapped</span>
              </div>
              <div className="chapter-vertical-list">
                {chapters.map((ch) => (
                  <div 
                    key={ch.id} 
                    className={`sidebar-chapter-node ${selectedChapterId === ch.id ? 'active' : ''} status-${ch.status}`}
                    onClick={() => !isTranslating && !isSavingEpub && setSelectedChapterId(ch.id)}
                  >
                    <span className="node-title">{ch.title}</span>
                    <div className={`node-status-dot dot-${ch.status}`}></div>
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
                  <span className="progress-percentage-label">{progress}% Mapped</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  onClick={handleStartTranslation} 
                  disabled={isTranslating || isSavingEpub} 
                  className="btn-success-runner"
                >
                  {isTranslating ? 'Processing Pipeline...' : (t['startBtn'] || 'Execute Automated Translation')}
                </button>
                <button 
                  onClick={handleExportEpub} 
                  disabled={isTranslating || isSavingEpub} 
                  className="btn-success-runner"
                  style={{ backgroundColor: 'var(--accent-positive)' }}
                >
                  {isSavingEpub ? 'Exporting EPUB...' : (t['exportBtn'] || 'Export Translated EPUB')}
                </button>
              </div>
            </div>
          )}

        </aside>

        {/* ➡️ RIGHT MAIN CONTENT VIEWPORT (PARALLEL WORKSPACE) */}
        <section className="app-editor-viewport">
          {activeChapter ? (
            <div className="viewport-editor-workspace">
              
              <div className="workspace-sticky-control-header">
                <div className="workspace-meta-info">
                  <h2>Reviewing Document Segment</h2>
                  <p className="chapter-meta-subtitle">Segment Reference: {activeChapter.title} ({activeChapter.blocks.length} parsing blocks discovered)</p>
                </div>
                <button 
                  onClick={() => handleTranslateSelectedChapterOnly()} 
                  disabled={isTranslating || isSavingEpub}
                  className="btn-trigger-segment-translate"
                >
                  Translate Segment Block Matrix
                </button>
              </div>

              {activeChapter.blocks.length === 0 ? (
                <div className="empty-viewport-notice">This component segment contains no structural plain text elements.</div>
              ) : (
                <div className="parallel-grid-scroll-container">
                  {activeChapter.blocks.map((block) => (
                    <div key={block.id} className="parallel-editor-row-segment">
                      <div className="source-segment-box">
                        {block.original}
                      </div>
                      <div className="target-segment-box-wrapper">
                        <textarea
                          value={block.translated}
                          onBlur={handleInputBlurSave}
                          onChange={(e: any) => handleBlockChange(activeChapter.id, block.id, e.target.value)}
                          className="target-segment-textarea"
                          placeholder="Awaiting translation matrix processing... (Human editing override allowed)"
                          disabled={isTranslating || isSavingEpub}
                        />
                        {block.isEdited && <span className="human-override-badge">Human Edit</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          ) : (
            <div className="empty-viewport-state">
              <div className="empty-state-visual-circle">📚</div>
              <h2>No Chapter Context Selected</h2>
              <p>Please upload an EPUB document or click on a segment inside the left navigation panel to activate the split parallel translation workspace environment.</p>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}