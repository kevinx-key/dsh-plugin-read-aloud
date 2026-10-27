/**
 * Turn one rendered assistant message into a flat, speakable text model.
 *
 * The model keeps a map from every normalized character back to its original
 * DOM text node, so progress can be painted with the CSS Custom Highlight API
 * without mutating React's DOM. Reasoning rows, action buttons and other
 * non-prose chrome are excluded.
 */

const SHOW_TEXT = 4

const SKIP_SELECTOR = [
  'button',
  'svg',
  'style',
  'script',
  'noscript',
  'template',
  'img',
  'video',
  'audio',
  'canvas',
  'iframe',
  '[hidden]',
  'details:not([open])',
  '[aria-hidden="true"]',
  '[data-variant="think"]',
  '[data-code-block-banner]',
  '[data-read-aloud-skip]',
].join(',')

/** Tags whose boundaries deserve a spoken pause. */
const BLOCK_SELECTOR = [
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'td',
  'th',
  'dt',
  'dd',
  'figcaption',
  'tr',
].join(',')

/** A character worth speaking (Latin, CJK, kana, Hangul, Cyrillic, ...). */
const SPEAKABLE = /[A-Za-z0-9\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/

/** Default ceiling for one utterance: short enough for responsive highlighting. */
const DEFAULT_MAX_CHUNK = 90

/**
 * Collapse whitespace while retaining a per-character map back to `raw`.
 * @param {string} raw - original text node value.
 * @returns {{ text: string, map: number[] }} normalized text and raw offsets.
 */
export function normalizeText(raw) {
  let text = ''
  const map = []
  let pendingSpace = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (/\s/u.test(character)) {
      if (text.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      text += ' '
      map.push(index)
      pendingSpace = false
    }
    text += character
    map.push(index)
  }
  return { text, map }
}

/**
 * Nearest block-level ancestor, so inline spans in one paragraph stay one run.
 * @param {Element} element - parent element of a text node.
 * @returns {Element} block element or the element itself.
 */
function blockOf(element) {
  return element.closest(BLOCK_SELECTOR) ?? element
}

/**
 * Collect visible prose from one assistant message.
 * @param {Element} root - the assistant-step row.
 * @param {Document} [doc] - owner document (injectable for tests).
 * @returns {{
 *   root: Element,
 *   text: string,
 *   nodes: Array<{ node: Text, raw: string, text: string, map: number[], start: number, end: number }>,
 *   ranges: (from: number) => Range[],
 *   pointAt: (offset: number) => { node: Text, offset: number } | null,
 * }}
 */
export function buildSpeechDoc(root, doc = root.ownerDocument) {
  const nodes = []
  let text = ''
  let previousBlock = null
  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      if (typeof node.nodeValue !== 'string' || node.nodeValue.trim() === '') return 2
      const parent = node.parentElement
      if (parent === null) return 2
      if (parent.closest(SKIP_SELECTOR) !== null) return 2
      return 1
    },
  })

  let node = walker.nextNode()
  while (node !== null) {
    const raw = node.nodeValue ?? ''
    const clean = normalizeText(raw)
    if (clean.text !== '') {
      const block = blockOf(node.parentElement)
      if (text !== '' && block !== previousBlock && !text.endsWith('\n')) text += '\n'
      if (node.previousSibling !== null && node.previousSibling.nodeName === 'BR' && !text.endsWith('\n')) {
        text += '\n'
      }
      const start = text.length
      text += clean.text
      nodes.push({
        node,
        raw,
        text: clean.text,
        map: clean.map,
        start,
        end: start + clean.text.length,
      })
      previousBlock = block
    }
    node = walker.nextNode()
  }

  const pointAt = (offset) => {
    if (nodes.length === 0) return null
    const safe = Math.max(0, Math.min(offset, text.length))
    for (const record of nodes) {
      if (safe < record.start) continue
      if (safe >= record.end) continue
      const local = safe - record.start
      return { node: record.node, offset: record.map[local] ?? 0 }
    }
    const last = nodes[nodes.length - 1]
    return { node: last.node, offset: last.raw.length }
  }

  const ranges = (from) => {
    const result = []
    if (nodes.length === 0) return result
    const safe = Math.max(0, Math.min(from, text.length))
    for (const record of nodes) {
      if (record.end <= safe) continue
      if (record.start >= text.length) break
      const local = Math.max(0, safe - record.start)
      if (local >= record.text.length) continue
      const rawStart = record.map[local]
      if (rawStart === undefined) continue
      const range = doc.createRange()
      range.setStart(record.node, rawStart)
      range.setEnd(record.node, record.raw.length)
      if (!range.collapsed) result.push(range)
    }
    return result
  }

  return { root, text, nodes, ranges, pointAt }
}

/**
 * Split a long segment at punctuation, then at whitespace, then hard.
 * @param {string} text - full document text.
 * @param {number} start - segment start.
 * @param {number} end - segment end.
 * @param {number} max - maximum chunk length.
 * @returns {Array<{ start: number, end: number }>} raw pieces.
 */
function splitLong(text, start, end, max) {
  const pieces = []
  let cursor = start
  while (end - cursor > max) {
    let cut = -1
    const floor = cursor + Math.floor(max * 0.55)
    const ceiling = Math.min(end, cursor + max)
    for (let index = floor; index < ceiling; index += 1) {
      if (/[，,、；;：:。！？!?\n]/u.test(text[index])) cut = index + 1
    }
    if (cut < 0) {
      const space = text.lastIndexOf(' ', ceiling)
      cut = space > cursor + 20 ? space + 1 : ceiling
    }
    pieces.push({ start: cursor, end: cut })
    cursor = cut
  }
  pieces.push({ start: cursor, end })
  return pieces
}

/**
 * Split prose into short utterances, preserving document offsets.
 * @param {string} text - flat document text.
 * @param {number} [max] - maximum chunk length.
 * @returns {Array<{ start: number, end: number, text: string }>} chunks.
 */
export function splitIntoChunks(text, max = DEFAULT_MAX_CHUNK) {
  if (text.trim() === '') return []
  const rawSegments = []
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'sentence' })
    for (const part of segmenter.segment(text)) {
      rawSegments.push({ start: part.index, end: part.index + part.segment.length })
    }
  } else {
    const pattern = /[^。！？!?；;\n]+[。！？!?；;\n]?/gu
    let match = pattern.exec(text)
    while (match !== null) {
      rawSegments.push({ start: match.index, end: match.index + match[0].length })
      match = pattern.exec(text)
    }
  }

  const chunks = []
  for (const segment of rawSegments) {
    for (const piece of splitLong(text, segment.start, segment.end, max)) {
      let start = piece.start
      let end = piece.end
      while (start < end && /\s/u.test(text[start])) start += 1
      while (end > start && /\s/u.test(text[end - 1])) end -= 1
      if (end <= start) continue
      const value = text.slice(start, end)
      if (!SPEAKABLE.test(value)) continue
      chunks.push({ start, end, text: value })
    }
  }
  return chunks
}

/**
 * Find the closing assistant row that owns an action-strip anchor.
 *
 * 0.2.x renders the action strip in a `turn-tail` row that follows the answer;
 * turn-process groups may sit between them, so this walks backwards over every
 * assistant row before the tail and keeps the last one.
 * @param {Element} anchor - the speaker button.
 * @returns {Element | null} the assistant-step row, or null when not found.
 */
export function findAssistantRoot(anchor) {
  const tail = anchor.closest('[data-turn-tail]')
  // The tail lives inside its own flow-item row; the transcript column is the
  // nearest ancestor that also contains the answer rows. 0.2.x marks that
  // column with data-chat-flow; 0.1.x leaves only the two-level structure.
  const scope = tail?.closest('[data-chat-flow]')
    ?? tail?.parentElement?.parentElement
    ?? tail?.parentElement
    ?? anchor.ownerDocument
  const selector = '[data-chat-flow-kind="assistant-step"], [data-chat-flow-kind="assistant"]'
  const candidates = [...scope.querySelectorAll(selector)]
  let best = null
  for (const candidate of candidates) {
    if (tail !== null && candidate.compareDocumentPosition(tail) & 4) {
      if (best === null || best.compareDocumentPosition(candidate) & 4) best = candidate
    }
  }
  if (best !== null) return best
  if (tail === null && candidates.length > 0) return candidates[candidates.length - 1]
  return anchor.closest(selector)
}
