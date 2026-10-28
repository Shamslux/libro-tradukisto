import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';

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

const TEXTUAL_ELEMENTS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote',
  'dt', 'dd', 'figcaption', 'caption', 'th', 'td', 'title', 'a',
]);

const REVIEW_BOUNDARIES = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote',
  'dt', 'dd', 'figcaption', 'caption', 'th', 'td',
]);

const EXCLUDED_ELEMENTS = new Set([
  'script', 'style', 'svg', 'math', 'code', 'pre', 'textarea',
]);

function localName(name: string): string {
  return name.split(':').pop()!.toLowerCase();
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function childNodes(node: AnyNode): AnyNode[] {
  return 'children' in node ? node.children as AnyNode[] : [];
}

function isText(node: AnyNode): node is Text {
  return node.type === 'text';
}

function parseXml(source: string) {
  return cheerio.load(source, {
    xml: { xmlMode: true, decodeEntities: true, withStartIndices: false },
  });
}

/**
 * A deterministic traversal shared by extraction and reconstruction.
 * The IDs are stable for an unchanged source document, not across EPUB edits.
 */
function collectTextNodes(source: string, chapterId: string): Array<{
  segment: TranslationSegment;
  node: Text;
  reviewKey: string;
  startsHeading: boolean;
}> {
  const $ = parseXml(source);
  const result: Array<{ segment: TranslationSegment; node: Text; reviewKey: string; startsHeading: boolean }> = [];
  const roots = $.root().contents().toArray() as AnyNode[];

  const visit = (
    node: AnyNode, path: string, inContent: boolean, excluded: boolean,
    reviewKey: string, startsHeading: boolean,
  ): void => {
    if (isText(node)) {
      if (inContent && !excluded && node.data.trim().length > 0) {
        const id = `${chapterId}::t${result.length}`;
        result.push({
          segment: { id, original: node.data, path },
          node,
          reviewKey: reviewKey || path,
          startsHeading,
        });
      }
      return;
    }

    if (isElement(node)) {
      const name = localName(node.name);
      const nextExcluded = excluded || EXCLUDED_ELEMENTS.has(name);
      const nextContent = inContent || TEXTUAL_ELEMENTS.has(name);
      const nextReviewKey = REVIEW_BOUNDARIES.has(name) ? path : reviewKey;
      const nextHeading = REVIEW_BOUNDARIES.has(name)
        ? /^h[1-6]$/.test(name) : startsHeading;
      childNodes(node).forEach((child, index) => {
        visit(child, `${path}/${name}[${index}]`, nextContent, nextExcluded, nextReviewKey, nextHeading);
      });
      return;
    }

    childNodes(node).forEach((child, index) => {
      visit(child, `${path}/node[${index}]`, inContent, excluded, reviewKey, startsHeading);
    });
  };

  roots.forEach((root, index) => visit(root, `/root[${index}]`, false, false, '', false));
  return result;
}

export class EpubProcessor {
  /**
   * Flattening is intentionally disabled in the fidelity-preserving pipeline.
   * Removing spans or other wrappers can destroy anchors, styles, and semantics.
   */
  public cleanAndFlattenHtml(htmlContent: string): string {
    return htmlContent;
  }

  /**
   * Groups complete semantic passages into contextual translation requests.
   * Oversized passages remain intact to preserve inline-node correspondence.
   */
  public splitIntoBlocks(
    htmlContent: string,
    chapterId: string,
    maxCharacters = 2500,
    flatten = false,
  ): TranslationBlock[] {
    if (flatten) {
      throw new Error('Flattening is not supported by the structure-preserving processor.');
    }
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
      throw new Error('maxCharacters must be a positive integer.');
    }
    if (!chapterId.trim()) {
      throw new Error('chapterId must not be empty.');
    }

    const entries = collectTextNodes(htmlContent, chapterId);
    const blocks: TranslationBlock[] = [];
    let current: TranslationSegment[] = [];
    let currentLength = 0;
    let currentPreview = '';

    const flush = (): void => {
      if (current.length === 0) return;
      blocks.push({
        id: `${chapterId}::b${blocks.length}`,
        // Plain-text preview only. Never use it to reconstruct XHTML.
        rawHtml: currentPreview,
        segments: current,
      });
      current = [];
      currentLength = 0;
      currentPreview = '';
    };

    // Keep all nodes of a paragraph/heading together, including inline markup.
    // An oversized semantic unit remains intact rather than splitting its DOM nodes.
    const units: Array<{ key: string; heading: boolean; segments: TranslationSegment[] }> = [];
    for (const entry of entries) {
      const last = units[units.length - 1];
      if (last && last.key === entry.reviewKey) {
        last.segments.push(entry.segment);
      } else {
        units.push({
          key: entry.reviewKey,
          heading: entry.startsHeading,
          segments: [entry.segment],
        });
      }
    }

    for (const unit of units) {
      // Inline text nodes belong to one semantic passage, not separate paragraphs.
      const preview = unit.segments.map(segment => segment.original).join('');
      const separator = current.length ? '\n\n' : '';
      const additionalLength = separator.length + preview.length;
      if (current.length && (unit.heading || currentLength + additionalLength > maxCharacters)) {
        flush();
      }
      const actualSeparator = current.length ? '\n\n' : '';
      current.push(...unit.segments);
      currentPreview += actualSeparator + preview;
      currentLength += actualSeparator.length + preview.length;
    }
    flush();
    return blocks;
  }

  /**
   * Reconstructs the original XHTML using explicit text-node IDs.
   * Rejects unknown, duplicate, missing, or blank translations. A translation
   * is assigned as text data, so markup supplied by a provider is escaped.
   */
  public reconstructHtml(
    originalHtml: string,
    translatedBlocks: TranslatedBlockInput[],
    flatten = false,
    chapterId?: string,
  ): string {
    if (flatten) {
      throw new Error('Flattening is not supported by the structure-preserving processor.');
    }
    if (!originalHtml.trim()) return originalHtml;
    if (!chapterId?.trim()) {
      throw new Error('chapterId is required for deterministic reconstruction.');
    }

    const entries = collectTextNodes(originalHtml, chapterId);
    const expected = new Set(entries.map(entry => entry.segment.id));
    const provided = new Map<string, string>();

    for (const block of translatedBlocks) {
      if (!block.segments) {
        throw new Error(`Block ${block.id} does not contain structured segment translations.`);
      }
      for (const segment of block.segments) {
        if (!expected.has(segment.id)) {
          throw new Error(`Unknown translation segment: ${segment.id}`);
        }
        if (provided.has(segment.id)) {
          throw new Error(`Duplicate translation segment: ${segment.id}`);
        }
        if (!segment.translatedText.trim()) {
          throw new Error(`Empty translation for segment: ${segment.id}`);
        }
        provided.set(segment.id, segment.translatedText);
      }
    }

    if (provided.size !== entries.length) {
      const missing = entries.find(entry => !provided.has(entry.segment.id));
      throw new Error(`Incomplete translation: missing ${missing?.segment.id ?? 'segment'}.`);
    }

    // Reparse the original document to ensure the output is never derived from
    // a provider's potentially malformed or altered HTML markup.
    const $ = parseXml(originalHtml);
    const nodes: Text[] = [];
    const roots = $.root().contents().toArray() as AnyNode[];
    const visit = (node: AnyNode, inContent: boolean, excluded: boolean): void => {
      if (isText(node)) {
        if (inContent && !excluded && node.data.trim()) nodes.push(node);
        return;
      }
      if (isElement(node)) {
        const name = localName(node.name);
        const nextExcluded = excluded || EXCLUDED_ELEMENTS.has(name);
        const nextContent = inContent || TEXTUAL_ELEMENTS.has(name);
        childNodes(node).forEach(child => visit(child, nextContent, nextExcluded));
        return;
      }
      childNodes(node).forEach(child => visit(child, inContent, excluded));
    };
    roots.forEach(root => visit(root, false, false));
    if (nodes.length !== entries.length) {
      throw new Error('Internal XML traversal mismatch during reconstruction.');
    }
    nodes.forEach((node, index) => {
      node.data = provided.get(entries[index].segment.id)!;
    });
    return $.xml();
  }
}
