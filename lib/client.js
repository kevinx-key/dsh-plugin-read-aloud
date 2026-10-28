window.__ModuleLoader__.load({
	id: "dsh-plugin-read-aloud",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react2 = require("react");
var import_client = require("react-dom/client");

// src/doc.js
var SHOW_TEXT = 4;
var SKIP_SELECTOR = [
  "button",
  "svg",
  "style",
  "script",
  "noscript",
  "template",
  "img",
  "video",
  "audio",
  "canvas",
  "iframe",
  "[hidden]",
  "details:not([open])",
  '[aria-hidden="true"]',
  '[data-variant="think"]',
  "[data-code-block-banner]",
  "[data-read-aloud-skip]"
].join(",");
var BLOCK_SELECTOR = [
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "td",
  "th",
  "dt",
  "dd",
  "figcaption",
  "tr"
].join(",");
var SPEAKABLE = /[A-Za-z0-9\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
var DEFAULT_MAX_CHUNK = 90;
function normalizeText(raw) {
  let text = "";
  const map = [];
  let pendingSpace = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (/\s/u.test(character)) {
      if (text.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      map.push(index);
      pendingSpace = false;
    }
    text += character;
    map.push(index);
  }
  return { text, map };
}
function blockOf(element) {
  return element.closest(BLOCK_SELECTOR) ?? element;
}
function buildSpeechDoc(root, doc = root.ownerDocument) {
  const nodes = [];
  let text = "";
  let previousBlock = null;
  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node2) {
      if (typeof node2.nodeValue !== "string" || node2.nodeValue.trim() === "") return 2;
      const parent = node2.parentElement;
      if (parent === null) return 2;
      if (parent.closest(SKIP_SELECTOR) !== null) return 2;
      return 1;
    }
  });
  let node = walker.nextNode();
  while (node !== null) {
    const raw = node.nodeValue ?? "";
    const clean = normalizeText(raw);
    if (clean.text !== "") {
      const block = blockOf(node.parentElement);
      if (text !== "" && block !== previousBlock && !text.endsWith("\n")) text += "\n";
      if (node.previousSibling !== null && node.previousSibling.nodeName === "BR" && !text.endsWith("\n")) {
        text += "\n";
      }
      const start = text.length;
      text += clean.text;
      nodes.push({
        node,
        raw,
        text: clean.text,
        map: clean.map,
        start,
        end: start + clean.text.length
      });
      previousBlock = block;
    }
    node = walker.nextNode();
  }
  const pointAt = (offset) => {
    if (nodes.length === 0) return null;
    const safe = Math.max(0, Math.min(offset, text.length));
    for (const record of nodes) {
      if (safe < record.start) continue;
      if (safe >= record.end) continue;
      const local = safe - record.start;
      return { node: record.node, offset: record.map[local] ?? 0 };
    }
    const last = nodes[nodes.length - 1];
    return { node: last.node, offset: last.raw.length };
  };
  const ranges = (from) => {
    const result = [];
    if (nodes.length === 0) return result;
    const safe = Math.max(0, Math.min(from, text.length));
    for (const record of nodes) {
      if (record.end <= safe) continue;
      if (record.start >= text.length) break;
      const local = Math.max(0, safe - record.start);
      if (local >= record.text.length) continue;
      const rawStart = record.map[local];
      if (rawStart === void 0) continue;
      const range = doc.createRange();
      range.setStart(record.node, rawStart);
      range.setEnd(record.node, record.raw.length);
      if (!range.collapsed) result.push(range);
    }
    return result;
  };
  return { root, text, nodes, ranges, pointAt };
}
function splitLong(text, start, end, max) {
  const pieces = [];
  let cursor = start;
  while (end - cursor > max) {
    let cut = -1;
    const floor = cursor + Math.floor(max * 0.55);
    const ceiling = Math.min(end, cursor + max);
    for (let index = floor; index < ceiling; index += 1) {
      if (/[，,、；;：:。！？!?\n]/u.test(text[index])) cut = index + 1;
    }
    if (cut < 0) {
      const space = text.lastIndexOf(" ", ceiling);
      cut = space > cursor + 20 ? space + 1 : ceiling;
    }
    pieces.push({ start: cursor, end: cut });
    cursor = cut;
  }
  pieces.push({ start: cursor, end });
  return pieces;
}
function splitIntoChunks(text, max = DEFAULT_MAX_CHUNK) {
  if (text.trim() === "") return [];
  const rawSegments = [];
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh", { granularity: "sentence" });
    for (const part of segmenter.segment(text)) {
      rawSegments.push({ start: part.index, end: part.index + part.segment.length });
    }
  } else {
    const pattern = /[^。！？!?；;\n]+[。！？!?；;\n]?/gu;
    let match = pattern.exec(text);
    while (match !== null) {
      rawSegments.push({ start: match.index, end: match.index + match[0].length });
      match = pattern.exec(text);
    }
  }
  const chunks = [];
  for (const segment of rawSegments) {
    for (const piece of splitLong(text, segment.start, segment.end, max)) {
      let start = piece.start;
      let end = piece.end;
      while (start < end && /\s/u.test(text[start])) start += 1;
      while (end > start && /\s/u.test(text[end - 1])) end -= 1;
      if (end <= start) continue;
      const value = text.slice(start, end);
      if (!SPEAKABLE.test(value)) continue;
      chunks.push({ start, end, text: value });
    }
  }
  return chunks;
}
function findAssistantRoot(anchor) {
  const tail = anchor.closest("[data-turn-tail]");
  const scope = tail?.closest("[data-chat-flow]") ?? tail?.parentElement?.parentElement ?? tail?.parentElement ?? anchor.ownerDocument;
  const selector = '[data-chat-flow-kind="assistant-step"], [data-chat-flow-kind="assistant"]';
  const candidates = [...scope.querySelectorAll(selector)];
  let best = null;
  for (const candidate of candidates) {
    if (tail !== null && candidate.compareDocumentPosition(tail) & 4) {
      if (best === null || best.compareDocumentPosition(candidate) & 4) best = candidate;
    }
  }
  if (best !== null) return best;
  if (tail === null && candidates.length > 0) return candidates[candidates.length - 1];
  return anchor.closest(selector);
}

// src/controller.js
var HIGHLIGHT_NAME = "dsh-read-aloud-pending";
var STORAGE_RATE = "dsh.read-aloud.rate";
var STORAGE_VOICE = "dsh.read-aloud.voice";
var STORAGE_SAPI_VOICE = "dsh.read-aloud.sapi-voice";
var DEFAULT_RATE = 1;
var HOST_PORTS = Array.from({ length: 12 }, (_, index) => 18766 + index);
var ERROR_TEXT = {
  "not-allowed": "\u6D4F\u89C8\u5668\u963B\u6B62\u4E86\u8BED\u97F3\u64AD\u653E\uFF0C\u8BF7\u5148\u70B9\u51FB\u4E00\u4E0B\u9875\u9762\u540E\u518D\u8BD5\u3002",
  "audio-busy": "\u97F3\u9891\u8BBE\u5907\u6B63\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002",
  network: "\u8BED\u97F3\u5408\u6210\u9700\u8981\u7F51\u7EDC\uFF0C\u6216\u8005\u7CFB\u7EDF\u8BED\u97F3\u5C1A\u672A\u5B89\u88C5\u3002",
  "synthesis-failed": "\u8BED\u97F3\u5408\u6210\u5931\u8D25\uFF0C\u8BF7\u6362\u4E00\u4E2A\u97F3\u8272\u518D\u8BD5\u3002",
  "synthesis-unavailable": "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u8BED\u97F3\u5F15\u64CE\u3002",
  interrupted: "",
  canceled: "",
  "text-too-long": "\u8FD9\u6BB5\u6587\u5B57\u592A\u957F\uFF0C\u8BED\u97F3\u5F15\u64CE\u62D2\u7EDD\u4E86\u8BF7\u6C42\u3002"
};
function clampRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_RATE;
  return Math.max(0.5, Math.min(2, Math.round(number * 4) / 4));
}
function readStorage(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function writeStorage(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
  }
}
function findScrollParent(element, win, doc) {
  let node = element?.parentElement ?? null;
  while (node !== null && node !== doc.body && node !== doc.documentElement) {
    const style = win.getComputedStyle(node);
    if (/(auto|scroll)/u.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return doc.scrollingElement ?? doc.documentElement;
}
function describeVoice(voice) {
  return {
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService
  };
}
function voiceRank(voice) {
  const lang = voice.lang.toLowerCase();
  if (lang.startsWith("zh")) return 0;
  if (lang.startsWith("en")) return 1;
  return 2;
}
function voiceScore(voice) {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (name.includes("natural")) score += 4;
  if (name.includes("neural")) score += 4;
  if (name.includes("online")) score += 2;
  if (name.includes("desktop")) score += 6;
  if (name.includes("xiaoxiao")) score += 3;
  if (name.includes("yunxi") || name.includes("yunjian") || name.includes("xiaoyi")) score += 2;
  return score;
}
var ReadAloudController = class {
  /**
   * @param {object} [options]
   * @param {Window} [options.window]
   * @param {Document} [options.document]
   * @param {Storage} [options.storage]
   */
  constructor(options = {}) {
    this.win = options.window ?? globalThis.window;
    this.doc = options.document ?? globalThis.document;
    this.storage = options.storage ?? this.win?.localStorage;
    this.synth = this.win?.speechSynthesis;
    this.supported = Boolean(
      this.synth && this.doc && typeof this.win.SpeechSynthesisUtterance === "function"
    );
    this.highlightSupported = Boolean(
      this.win?.CSS?.highlights && typeof this.win.Highlight === "function"
    );
    this.listeners = /* @__PURE__ */ new Set();
    this.runId = 0;
    this.utterance = null;
    this.voiceObjects = [];
    this.voices = [];
    this.rate = clampRate(readStorage(this.storage, STORAGE_RATE) ?? DEFAULT_RATE);
    this.voicePreference = readStorage(this.storage, STORAGE_VOICE);
    this.voiceURI = this.voicePreference ?? "";
    this.voiceCandidates = null;
    this.voiceAttempt = 0;
    this.activeCandidate = null;
    this.pendingRestart = false;
    this.follow = true;
    this.followTimer = null;
    this.speakTimer = null;
    this.scrollTimer = 0;
    this.scrollPort = null;
    this.onUserScroll = null;
    this.beforeUnload = null;
    this.backend = "browser";
    this.provider = "sapi";
    this.hostState = "probing";
    this.hostError = null;
    this.hostBase = null;
    this.hostProbeAbort = null;
    this.sapiVoicePreference = readStorage(this.storage, STORAGE_SAPI_VOICE);
    this.sapiVoice = this.sapiVoicePreference ?? "";
    this.sapiDefaultVoice = "";
    this.audioContext = null;
    this.audioSource = null;
    this.audioAbort = null;
    this.audioBuffer = null;
    this.audioChunk = null;
    this.audioStartedAt = 0;
    this.audioStartOffset = 0;
    this.audioPausedAt = null;
    this.audioPlaybackRate = this.rate;
    this.snapshot = {
      supported: this.supported,
      highlightSupported: this.highlightSupported,
      engine: "browser",
      hostState: "probing",
      hostError: null,
      status: "idle",
      activeMessageId: null,
      panelOpen: false,
      rate: this.rate,
      voiceURI: this.voiceURI,
      voices: [],
      voiceError: null,
      voiceNotice: null,
      error: null,
      chunkIndex: 0,
      chunkCount: 0,
      done: false,
      selectionActive: false,
      selectionText: null
    };
    this.docModel = null;
    this.chunks = [];
    this.index = 0;
    this.messageId = null;
    this.anchor = null;
    this.selectionText = null;
    this.onVoicesChanged = () => {
      this.loadVoices();
    };
    if (this.supported) {
      this.synth.addEventListener?.("voiceschanged", this.onVoicesChanged);
      this.loadVoices();
    }
    this.beforeUnload = () => {
      this.cancelSpeech();
      this.clearHighlight();
    };
    this.win?.addEventListener?.("beforeunload", this.beforeUnload);
    void this.probeHost();
  }
  /** @returns {ReadAloudSnapshot} */
  getSnapshot() {
    return this.snapshot;
  }
  /** @param {() => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Merge a patch into the immutable snapshot and wake subscribers. */
  setSnapshot(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
      }
    }
  }
  /** Re-read the browser's voice roster (it can populate after first paint). */
  loadVoices() {
    if (this.backend === "sapi") return;
    if (!this.supported) return;
    let raw = [];
    try {
      raw = this.synth.getVoices?.() ?? [];
    } catch {
      raw = [];
    }
    const entries = raw.map((voice) => ({ raw: voice, info: describeVoice(voice) })).sort((a, b) => voiceRank(a.info) - voiceRank(b.info) || voiceScore(b.info) - voiceScore(a.info) || a.info.lang.localeCompare(b.info.lang) || a.info.name.localeCompare(b.info.name));
    this.voiceObjects = entries.map((entry) => entry.raw);
    this.voices = entries.map((entry) => entry.info);
    let selected = this.voices.find((voice) => voice.voiceURI === this.voiceURI);
    if (selected === void 0 && this.voicePreference !== "") {
      selected = this.voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ?? this.voices[0];
      if (selected !== void 0) {
        this.voiceURI = selected.voiceURI;
        this.voicePreference = selected.voiceURI;
      }
    }
    this.setSnapshot({
      voices: this.voices,
      voiceURI: this.voiceURI,
      voiceError: this.voices.length === 0 ? "\u6CA1\u6709\u68C0\u6D4B\u5230\u7CFB\u7EDF\u8BED\u97F3\uFF0C\u5C06\u5C1D\u8BD5\u4F7F\u7528\u6D4F\u89C8\u5668\u9ED8\u8BA4\u8BED\u97F3\u3002" : null
    });
  }
  /** Ask the active engine to refresh its voice roster. */
  refreshVoices() {
    if (this.backend === "sapi") {
      void this.refreshSapiVoices();
      return;
    }
    void this.probeHost();
    this.loadVoices();
  }
  /** Refresh the SAPI roster without interrupting an active sentence. */
  async refreshSapiVoices() {
    if (this.hostBase === null) {
      void this.probeHost();
      return;
    }
    try {
      const response = await this.fetchWithTimeout(`${this.hostBase}/voices`, 2500);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const voices = (Array.isArray(data.voices) ? data.voices : []).map((voice) => ({
        voiceURI: voice.name,
        name: voice.displayName ?? voice.name,
        lang: voice.culture,
        localService: voice.engine === "sapi",
        provider: voice.engine === "sapi" ? "sapi" : "edge"
      }));
      if (voices.length === 0) throw new Error("empty voice roster");
      this.sapiDefaultVoice = data.defaultVoice ?? voices[0].voiceURI;
      if (!voices.some((voice) => voice.voiceURI === this.voiceURI)) this.voiceURI = this.sapiDefaultVoice;
      this.sapiVoice = this.voiceURI;
      this.provider = voices.find((voice) => voice.voiceURI === this.voiceURI)?.provider ?? this.provider;
      this.voices = voices;
      this.voiceObjects = [];
      this.setSnapshot({ voices, voiceURI: this.voiceURI, engine: this.provider, voiceError: null });
    } catch {
      void this.probeHost();
    }
  }
  /** Fetch with a hard timeout, used by the local-service probe. */
  async fetchWithTimeout(url, timeoutMs, options = {}) {
    if (typeof this.win?.fetch !== "function") throw new Error("fetch is unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.win.fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * Probe the Host's loopback SAPI service. The Host may still be starting its
   * PowerShell worker, so retry briefly before falling back to Web Speech.
   */
  async probeHost() {
    if (typeof this.win?.fetch !== "function") {
      this.hostState = "unavailable";
      this.hostError = "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch\uFF0C\u65E0\u6CD5\u8FDE\u63A5\u672C\u5730\u8BED\u97F3\u670D\u52A1\u3002";
      this.setSnapshot({ hostState: "unavailable", hostError: this.hostError });
      return;
    }
    if (this.hostProbeAbort !== null) this.hostProbeAbort.abort();
    const abort = new AbortController();
    this.hostProbeAbort = abort;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (abort.signal.aborted) return;
      let best = null;
      for (const port of HOST_PORTS) {
        try {
          const response = await this.fetchWithTimeout(`http://127.0.0.1:${port}/health`, 250);
          if (!response.ok) continue;
          const health = await response.json();
          if (health?.plugin !== "dsh-plugin-read-aloud") continue;
          if (health.ready !== true || !Array.isArray(health.voices) || health.voices.length === 0) continue;
          const score = (health.engines?.edge === true ? 10 : 0) + (health.engines?.sapi === true ? 5 : 0) + health.voices.length;
          if (best === null || score > best.score) best = { port, health, score };
        } catch {
        }
      }
      if (abort.signal.aborted) return;
      if (best !== null) {
        this.adoptSapiHost(best.port, best.health);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (abort.signal.aborted) return;
    this.hostState = "unavailable";
    this.hostError = "\u672C\u5730\u8BED\u97F3\u670D\u52A1\u672A\u8FDE\u63A5\uFF0C\u5DF2\u56DE\u9000\u5230\u6D4F\u89C8\u5668\u8BED\u97F3\u3002";
    this.setSnapshot({
      hostState: "unavailable",
      hostError: this.hostError
    });
  }
  /** Switch the controller to the Host's working voice roster. */
  adoptSapiHost(port, health) {
    const voices = health.voices.map((voice) => ({
      voiceURI: voice.name,
      name: voice.displayName ?? voice.name,
      lang: voice.culture,
      localService: voice.engine === "sapi",
      provider: voice.engine === "sapi" ? "sapi" : "edge"
    }));
    const preferredVoice = voices.find((voice) => voice.voiceURI === this.sapiVoice) ?? voices.find((voice) => voice.voiceURI === health.defaultVoice) ?? voices.find((voice) => voice.provider === "edge" && String(voice.lang).toLowerCase().startsWith("zh")) ?? voices[0];
    this.provider = preferredVoice?.provider ?? "sapi";
    this.backend = "sapi";
    this.supported = true;
    this.hostState = "ready";
    this.hostError = null;
    this.hostBase = `http://127.0.0.1:${port}`;
    this.sapiDefaultVoice = health.defaultVoice ?? voices[0]?.voiceURI ?? "";
    const preferred = preferredVoice?.voiceURI ?? this.sapiDefaultVoice;
    this.sapiVoice = preferred;
    this.voiceURI = preferred;
    this.voicePreference = preferred;
    this.voiceObjects = [];
    this.voices = voices;
    this.voiceCandidates = null;
    this.voiceAttempt = 0;
    const wasActive = this.snapshot.status !== "idle";
    if (wasActive) {
      if (this.snapshot.selectionActive) this.clearNativeSelection();
      this.cancelSpeech();
      this.clearHighlight();
      this.detachFollow();
      this.selectionText = null;
    }
    const selectedName = voices.find((voice) => voice.voiceURI === preferred)?.name ?? preferred;
    this.setSnapshot({
      supported: true,
      engine: this.provider,
      hostState: "ready",
      hostError: null,
      voices,
      voiceURI: preferred,
      voiceError: null,
      error: null,
      ...wasActive ? {
        status: "idle",
        chunkIndex: 0,
        done: false,
        selectionActive: false,
        selectionText: null
      } : {},
      voiceNotice: this.provider === "edge" ? `Microsoft Edge \u81EA\u7136\u8BED\u97F3\u5DF2\u5C31\u7EEA\uFF1A${selectedName}` : `\u672C\u5730 SAPI \u8BED\u97F3\u5DF2\u5C31\u7EEA\uFF1A${selectedName}`
    });
  }
  /** @returns {SpeechSynthesisVoice | null} */
  currentVoice() {
    if (this.voices.length === 0) return null;
    const index = this.voices.findIndex((voice) => voice.voiceURI === this.voiceURI);
    return index >= 0 ? this.voiceObjects[index] ?? null : null;
  }
  /**
   * Ordered voices to attempt for one sentence: the chosen voice first, then
   * every other installed voice, then the browser default (null). Some Windows
   * OneCore voices are advertised by getVoices() but throw synthesis-failed.
   */
  buildVoiceCandidates() {
    const selected = this.currentVoice();
    const primary = (selected?.lang ?? "zh").split("-")[0].toLowerCase();
    const sameLanguage = [];
    const rest = [];
    const seen = /* @__PURE__ */ new Set();
    if (selected !== null) seen.add(selected.voiceURI);
    for (const voice of this.voiceObjects) {
      if (seen.has(voice.voiceURI)) continue;
      seen.add(voice.voiceURI);
      if (voice.lang.toLowerCase().split("-")[0] === primary) sameLanguage.push(voice);
      else rest.push(voice);
    }
    const candidates = [];
    if (selected === null) {
      candidates.push(null, ...sameLanguage);
    } else {
      candidates.push(selected, ...sameLanguage, null);
    }
    candidates.push(...rest);
    return candidates;
  }
  /** Start a fresh fallback chain for the next sentence. */
  resetVoiceCandidates() {
    this.voiceCandidates = this.buildVoiceCandidates();
    this.voiceAttempt = 0;
    this.activeCandidate = this.voiceCandidates[0] ?? null;
  }
  /**
   * Start reading one assistant reply, or toggle the active one.
   * @param {string} messageId - durable assistant message id.
   * @param {HTMLElement} anchor - the speaker button, used to find the reply DOM.
   * @returns {boolean} whether playback was started or toggled.
   */
  start(messageId, anchor) {
    if (!this.supported) {
      this.setSnapshot({ error: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u6D4F\u89C8\u5668\u8BED\u97F3\u5408\u6210\u3002" });
      return false;
    }
    if (this.snapshot.selectionActive) {
      this.clearNativeSelection();
      this.selectionText = null;
    }
    if (this.snapshot.activeMessageId === messageId && this.snapshot.status !== "idle") {
      if (this.snapshot.status === "paused") this.resume();
      else this.pause();
      return true;
    }
    this.cancelSpeech();
    this.clearHighlight();
    this.detachFollow();
    this.docModel = null;
    this.chunks = [];
    this.index = 0;
    this.messageId = messageId;
    this.anchor = anchor;
    this.follow = true;
    this.pendingRestart = false;
    const failStart = (message) => {
      this.setSnapshot({
        activeMessageId: messageId,
        panelOpen: true,
        status: "idle",
        chunkIndex: 0,
        chunkCount: 0,
        done: false,
        error: message
      });
      return false;
    };
    const root = findAssistantRoot(anchor);
    if (root === null) return failStart("\u6CA1\u6709\u627E\u5230\u8FD9\u6761\u56DE\u590D\u7684\u6B63\u6587\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    let model;
    try {
      model = buildSpeechDoc(root);
    } catch {
      return failStart("\u65E0\u6CD5\u8BFB\u53D6\u8FD9\u6761\u56DE\u590D\u7684\u6B63\u6587\u3002");
    }
    const chunks = splitIntoChunks(model.text);
    if (chunks.length === 0) return failStart("\u8FD9\u6761\u56DE\u590D\u91CC\u6CA1\u6709\u53EF\u6717\u8BFB\u7684\u6587\u5B57\u3002");
    if (this.backend === "sapi") {
      try {
        this.ensureAudioContext();
      } catch {
        return failStart("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u97F3\u9891\u64AD\u653E\u3002");
      }
      void this.audioContext?.resume().catch(() => {
      });
    }
    this.docModel = model;
    this.chunks = chunks;
    if (this.backend === "sapi") {
      this.voiceCandidates = null;
      this.voiceAttempt = 0;
    } else {
      this.resetVoiceCandidates();
    }
    this.attachFollow(anchor);
    this.setSnapshot({
      status: "speaking",
      activeMessageId: messageId,
      panelOpen: true,
      chunkIndex: 0,
      chunkCount: chunks.length,
      done: false,
      error: null,
      voiceNotice: null,
      selectionActive: false,
      selectionText: null
    });
    this.paintFrom(chunks[0].start);
    this.scrollToOffset(chunks[0].start);
    if (this.backend === "sapi") void this.speakSapi(chunks[0]);
    else this.queueSpeak(30);
    return true;
  }
  /**
   * Read arbitrary selected text. There is no assistant DOM model to paint, so
   * the browser's native selection remains the visual marker; the audio pipeline
   * (including pause offset, speed and voice) is shared with message reading.
   * @param {string} text - selected text.
   * @returns {boolean} whether playback started.
   */
  speakSelection(text) {
    const trimmed = String(text ?? "").trim();
    if (trimmed === "") return false;
    if (!this.supported) {
      this.setSnapshot({ error: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8BED\u97F3\u6717\u8BFB\u3002" });
      return false;
    }
    const chunks = splitIntoChunks(trimmed);
    if (chunks.length === 0) return false;
    this.cancelSpeech();
    this.clearHighlight();
    this.detachFollow();
    this.docModel = null;
    this.chunks = chunks;
    this.index = 0;
    this.messageId = null;
    this.anchor = null;
    this.follow = false;
    this.pendingRestart = false;
    this.selectionText = trimmed;
    if (this.backend === "sapi") {
      try {
        this.ensureAudioContext();
        void this.audioContext?.resume().catch(() => {
        });
      } catch {
        return false;
      }
      this.voiceCandidates = null;
      this.voiceAttempt = 0;
    } else {
      this.resetVoiceCandidates();
    }
    this.setSnapshot({
      status: "speaking",
      activeMessageId: null,
      panelOpen: false,
      chunkIndex: 0,
      chunkCount: chunks.length,
      done: false,
      error: null,
      voiceNotice: null,
      selectionActive: true,
      selectionText: trimmed
    });
    if (this.backend === "sapi") void this.speakSapi(chunks[0]);
    else this.queueSpeak(30);
    return true;
  }
  /** Remove the browser's native selection after selection playback ends. */
  clearNativeSelection() {
    try {
      const selection = this.win?.getSelection?.();
      if (selection !== void 0 && selection !== null && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    } catch {
    }
  }
  /** Stop any active utterance and clear the blue pending highlight. */
  stop() {
    const wasSelection = this.snapshot.selectionActive;
    this.cancelSpeech();
    this.clearHighlight();
    this.detachFollow();
    this.pendingRestart = false;
    this.index = 0;
    if (wasSelection) this.clearNativeSelection();
    this.selectionText = null;
    this.setSnapshot({
      status: "idle",
      chunkIndex: 0,
      done: false,
      error: null,
      selectionActive: false,
      selectionText: null
    });
  }
  /** Pause the active utterance. */
  pause() {
    if (this.snapshot.status !== "speaking") return;
    if (this.backend === "sapi") {
      if (this.audioSource !== null && this.audioBuffer !== null) {
        this.audioPausedAt = this.audioPosition();
        this.stopAudioSource();
      } else {
        this.pendingRestart = true;
      }
      this.setSnapshot({ status: "paused" });
      return;
    }
    this.setSnapshot({ status: "paused" });
    try {
      this.synth.pause();
    } catch {
    }
  }
  /** Resume, or restart the current chunk when a voice/speed change invalidated it. */
  resume() {
    if (this.snapshot.status !== "paused") return;
    if (this.backend === "sapi") {
      if (this.pendingRestart) {
        this.pendingRestart = false;
        this.setSnapshot({ status: "speaking" });
        this.restartChunk();
        return;
      }
      if (this.audioPausedAt !== null && this.audioBuffer !== null && this.audioChunk !== null) {
        const offset = this.audioPausedAt;
        const buffer = this.audioBuffer;
        const chunk = this.audioChunk;
        const run = this.runId;
        this.audioPausedAt = null;
        this.setSnapshot({ status: "speaking", error: null });
        void this.playAudioBuffer(buffer, offset, chunk, run);
        return;
      }
      this.setSnapshot({ status: "speaking" });
      if (this.audioSource !== null && !this.pendingRestart) {
        void this.audioContext?.resume().catch(() => {
        });
        return;
      }
      this.pendingRestart = false;
      this.restartChunk();
      return;
    }
    this.setSnapshot({ status: "speaking" });
    if (this.pendingRestart) {
      this.pendingRestart = false;
      this.restartChunk();
      return;
    }
    try {
      this.synth.resume();
      if (!this.synth.speaking && !this.synth.pending) this.restartChunk();
    } catch {
      this.restartChunk();
    }
  }
  /** Toggle play/pause for the UI. */
  toggle() {
    if (this.snapshot.status === "speaking") this.pause();
    else if (this.snapshot.status === "paused") this.resume();
    else this.restart();
  }
  /** Re-read the current reply from its first sentence. */
  restart() {
    if (this.chunks.length === 0 || this.docModel === null && !this.snapshot.selectionActive) return;
    this.cancelSpeech();
    this.clearHighlight();
    this.index = 0;
    this.pendingRestart = false;
    this.follow = true;
    if (this.backend === "sapi") {
      this.voiceCandidates = null;
      this.voiceAttempt = 0;
      void this.audioContext?.resume().catch(() => {
      });
    } else {
      this.resetVoiceCandidates();
    }
    this.attachFollow(this.anchor);
    this.setSnapshot({ status: "speaking", chunkIndex: 0, done: false, error: null, voiceNotice: null });
    this.paintFrom(0);
    this.scrollToOffset(0);
    if (this.backend === "sapi") void this.speakSapi(this.chunks[0]);
    else this.queueSpeak(30);
  }
  /**
   * Change speed. The current sentence is repeated so the new rate takes effect.
   * @param {number} value - 0.5–2.
   */
  setRate(value) {
    const next = clampRate(value);
    if (next === this.rate) return;
    this.rate = next;
    writeStorage(this.storage, STORAGE_RATE, String(next));
    this.setSnapshot({ rate: next });
    if (this.backend === "sapi") {
      if (this.provider === "edge") {
        this.audioPlaybackRate = 1;
        if (this.snapshot.status === "speaking") this.restartChunk();
        else if (this.snapshot.status === "paused") this.pendingRestart = true;
        return;
      }
      if (this.audioSource !== null && this.audioBuffer !== null) {
        const position = this.audioPosition();
        this.audioStartOffset = position;
        this.audioStartedAt = this.audioContext?.currentTime ?? this.audioStartedAt;
        this.audioPlaybackRate = next;
        this.audioSource.playbackRate.value = next;
      } else {
        this.audioPlaybackRate = next;
      }
      return;
    }
    if (this.snapshot.status === "speaking") this.restartChunk();
    else if (this.snapshot.status === "paused") this.pendingRestart = true;
  }
  /**
   * Switch voice. The current sentence is repeated with the new voice.
   * @param {string} voiceURI - browser voice identity.
   */
  setVoice(voiceURI) {
    if (voiceURI === this.voiceURI) return;
    this.voiceURI = voiceURI;
    if (this.backend === "sapi") {
      const selected = this.voices.find((voice) => voice.voiceURI === voiceURI);
      this.provider = selected?.provider ?? this.provider;
      this.sapiVoice = voiceURI;
      this.sapiVoicePreference = voiceURI;
      writeStorage(this.storage, STORAGE_SAPI_VOICE, voiceURI);
      this.setSnapshot({ voiceURI, engine: this.provider, voiceNotice: null });
      if (this.snapshot.status === "speaking") this.restartChunk();
      else if (this.snapshot.status === "paused") this.pendingRestart = true;
      return;
    }
    this.voicePreference = voiceURI;
    writeStorage(this.storage, STORAGE_VOICE, voiceURI);
    this.resetVoiceCandidates();
    this.setSnapshot({ voiceURI, voiceNotice: null });
    if (this.snapshot.status === "speaking") this.restartChunk();
    else if (this.snapshot.status === "paused") this.pendingRestart = true;
  }
  /** Open the settings popover. */
  openPanel() {
    this.setSnapshot({ panelOpen: true });
  }
  /** Close the settings popover without stopping playback. */
  closePanel() {
    this.setSnapshot({ panelOpen: false });
  }
  /** Toggle the settings popover. */
  togglePanel() {
    this.setSnapshot({ panelOpen: !this.snapshot.panelOpen });
  }
  /** Create (or reuse) the Web Audio context used by the SAPI backend. */
  ensureAudioContext() {
    if (this.audioContext !== null && this.audioContext.state !== "closed") return this.audioContext;
    const Constructor = this.win?.AudioContext ?? this.win?.webkitAudioContext;
    if (typeof Constructor !== "function") throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 Web Audio");
    this.audioContext = new Constructor();
    return this.audioContext;
  }
  /** Fetch one sentence as WAV from the Host's loopback SAPI service. */
  async fetchSapi(text) {
    const controller = new AbortController();
    this.audioAbort = controller;
    const timer = setTimeout(() => controller.abort(), 2e4);
    try {
      const response = await this.win.fetch(`${this.hostBase}/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          voice: this.voiceURI || void 0,
          engine: this.provider,
          rate: this.provider === "edge" ? this.rate : 1
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.error === "string") detail = parsed.error;
        } catch {
        }
        throw new Error(detail.slice(0, 300) || `HTTP ${response.status}`);
      }
      return await response.arrayBuffer();
    } finally {
      clearTimeout(timer);
      if (this.audioAbort === controller) this.audioAbort = null;
    }
  }
  /** Stop the current buffer source but keep its decoded audio for resume. */
  stopAudioSource() {
    const source = this.audioSource;
    this.audioSource = null;
    if (source !== null) {
      source.onended = null;
      try {
        source.stop();
      } catch {
      }
      try {
        source.disconnect();
      } catch {
      }
    }
  }
  /** Current playback position inside the decoded buffer, in seconds. */
  audioPosition() {
    if (this.audioPausedAt !== null) return this.audioPausedAt;
    if (this.audioSource === null || this.audioBuffer === null) return this.audioStartOffset;
    const current = this.audioContext?.currentTime ?? this.audioStartedAt;
    const elapsed = Math.max(0, current - this.audioStartedAt) * this.audioPlaybackRate;
    return Math.min(this.audioBuffer.duration, this.audioStartOffset + elapsed);
  }
  /** Stop the current SAPI buffer and abort an in-flight WAV request. */
  stopSapiAudio() {
    if (this.audioAbort !== null) {
      this.audioAbort.abort();
      this.audioAbort = null;
    }
    this.stopAudioSource();
    this.audioBuffer = null;
    this.audioChunk = null;
    this.audioPausedAt = null;
    this.audioStartOffset = 0;
    this.audioStartedAt = 0;
  }
  /** Play a decoded sentence from an offset, preserving exact pause position. */
  async playAudioBuffer(buffer, offset, chunk, run) {
    const context = this.ensureAudioContext();
    await context.resume();
    if (run !== this.runId || this.snapshot.status !== "speaking") return;
    const playbackRate = this.provider === "edge" ? 1 : this.rate;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(context.destination);
    const startOffset = Math.max(0, Math.min(offset, Math.max(0, buffer.duration - 0.01)));
    this.audioSource = source;
    this.audioBuffer = buffer;
    this.audioChunk = chunk;
    this.audioStartOffset = startOffset;
    this.audioStartedAt = context.currentTime;
    this.audioPlaybackRate = playbackRate;
    this.audioPausedAt = null;
    source.onended = () => {
      if (run !== this.runId || this.audioSource !== source) return;
      this.audioSource = null;
      this.audioBuffer = null;
      this.audioChunk = null;
      this.audioPausedAt = null;
      if (this.snapshot.status === "paused") {
        this.pendingRestart = true;
        return;
      }
      this.paintFrom(chunk.end);
      this.index += 1;
      if (this.index >= this.chunks.length) {
        this.finish();
        return;
      }
      this.setSnapshot({ chunkIndex: this.index });
      const next = this.chunks[this.index];
      this.paintFrom(next.start);
      this.scrollToOffset(next.start);
      void this.speakSapi(next);
    };
    source.start(0, startOffset);
    if (context.state !== "running") {
      this.setSnapshot({ status: "paused", error: "\u6D4F\u89C8\u5668\u963B\u6B62\u4E86\u81EA\u52A8\u64AD\u653E\uFF0C\u8BF7\u70B9\u201C\u7EE7\u7EED\u201D\u3002" });
    }
  }
  /** Play one sentence through the SAPI WAV service. */
  async speakSapi(chunk) {
    if (chunk === void 0 || this.hostBase === null) {
      this.fail("synthesis-unavailable", "\u672C\u5730\u8BED\u97F3\u670D\u52A1\u4E0D\u53EF\u7528\u3002");
      return;
    }
    if (this.snapshot.status !== "speaking") return;
    const run = ++this.runId;
    this.paintFrom(chunk.start);
    this.scrollToOffset(chunk.start);
    try {
      const wav = await this.fetchSapi(chunk.text);
      if (run !== this.runId) return;
      const context = this.ensureAudioContext();
      const buffer = await context.decodeAudioData(wav);
      if (run !== this.runId) return;
      if (this.snapshot.status !== "speaking") {
        this.pendingRestart = true;
        return;
      }
      await this.playAudioBuffer(buffer, 0, chunk, run);
    } catch (error) {
      if (run !== this.runId) return;
      if (error instanceof Error && error.name === "AbortError") return;
      console.warn("[read-aloud] SAPI speech failed", error);
      if (this.provider === "edge") {
        const fallback = this.voices.find((voice) => voice.provider === "sapi" && String(voice.lang).toLowerCase().startsWith("zh")) ?? this.voices.find((voice) => voice.provider === "sapi");
        if (fallback !== void 0) {
          this.provider = "sapi";
          this.voiceURI = fallback.voiceURI;
          this.sapiVoice = fallback.voiceURI;
          this.audioPausedAt = null;
          this.audioBuffer = null;
          this.audioChunk = null;
          this.setSnapshot({
            engine: "sapi",
            voiceURI: fallback.voiceURI,
            error: null,
            voiceNotice: `\u5728\u7EBF\u81EA\u7136\u97F3\u8272\u5931\u8D25\uFF0C\u5DF2\u5207\u6362\u5230\u672C\u5730\u97F3\u8272\uFF1A${fallback.name}`
          });
          this.restartChunk();
          return;
        }
      }
      this.fail(
        "synthesis-failed",
        `\u672C\u5730\u8BED\u97F3\u5408\u6210\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /** Speak the chunk at `this.index`, wiring every event to the current run. */
  speakCurrent() {
    if (this.backend === "sapi") {
      void this.speakSapi(this.chunks[this.index]);
      return;
    }
    if (!this.supported || this.snapshot.status !== "speaking") return;
    const chunk = this.chunks[this.index];
    if (chunk === void 0) {
      this.finish();
      return;
    }
    if (this.docModel !== null && !this.docModel.root.isConnected) {
      this.stop();
      return;
    }
    const run = ++this.runId;
    let utterance;
    try {
      utterance = new this.win.SpeechSynthesisUtterance(chunk.text);
    } catch {
      this.fail("synthesis-unavailable");
      return;
    }
    const candidates = this.voiceCandidates ?? this.buildVoiceCandidates();
    const candidate = candidates[this.voiceAttempt] ?? null;
    this.activeCandidate = candidate;
    if (candidate !== null) {
      utterance.voice = candidate;
      utterance.lang = candidate.lang;
    } else {
      utterance.lang = /[\u3400-\u9fff]/u.test(chunk.text) ? "zh-CN" : "en-US";
    }
    utterance.rate = this.rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => {
      if (run !== this.runId) return;
      if (candidate !== null && candidate.voiceURI !== this.voiceURI) {
        this.voiceURI = candidate.voiceURI;
        this.voicePreference = candidate.voiceURI;
        writeStorage(this.storage, STORAGE_VOICE, candidate.voiceURI);
        this.setSnapshot({ voiceURI: candidate.voiceURI, voiceNotice: `\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u53EF\u7528\u97F3\u8272\uFF1A${candidate.name}` });
        this.resetVoiceCandidates();
      } else if (candidate === null && this.voiceURI !== "") {
        this.voiceURI = "";
        this.voicePreference = "";
        writeStorage(this.storage, STORAGE_VOICE, "");
        this.setSnapshot({ voiceURI: "", voiceNotice: "\u5DF2\u5207\u6362\u5230\u7CFB\u7EDF\u9ED8\u8BA4\u97F3\u8272" });
        this.resetVoiceCandidates();
      }
      this.setSnapshot({ status: "speaking" });
    };
    utterance.onboundary = (event) => {
      if (run !== this.runId) return;
      const charIndex = Number(event?.charIndex ?? 0);
      const offset = Math.min(chunk.end, chunk.start + (Number.isFinite(charIndex) ? charIndex : 0));
      this.paintFrom(offset);
      this.maybeScroll(offset);
    };
    utterance.onend = () => {
      if (run !== this.runId) return;
      this.paintFrom(chunk.end);
      this.index += 1;
      if (this.index >= this.chunks.length) {
        this.finish();
        return;
      }
      this.setSnapshot({ chunkIndex: this.index });
      const next = this.chunks[this.index];
      this.paintFrom(next.start);
      this.scrollToOffset(next.start);
      this.speakCurrent();
    };
    utterance.onerror = (event) => {
      if (run !== this.runId) return;
      const code = String(event?.error ?? "synthesis-failed");
      if (code === "interrupted" || code === "canceled") return;
      console.warn("[read-aloud] speech failed", {
        code,
        voice: candidate?.name ?? "system default",
        text: chunk.text.slice(0, 80)
      });
      if (code === "synthesis-failed" || code === "synthesis-unavailable") {
        this.retryVoice(code);
        return;
      }
      this.fail(code);
    };
    this.utterance = utterance;
    try {
      this.synth.speak(utterance);
    } catch (error) {
      console.warn("[read-aloud] speak() threw", error);
      this.retryVoice("synthesis-failed");
    }
  }
  /** Move to the next installed voice after a synthesis failure. */
  retryVoice(code) {
    const candidates = this.voiceCandidates ?? this.buildVoiceCandidates();
    const failed = this.activeCandidate;
    this.voiceAttempt += 1;
    if (this.voiceAttempt < candidates.length) {
      const next = candidates[this.voiceAttempt];
      this.cancelSpeech();
      const chunk = this.chunks[this.index];
      if (chunk !== void 0) this.paintFrom(chunk.start);
      this.setSnapshot({
        status: "speaking",
        error: null,
        voiceNotice: `\u97F3\u8272\u300C${failed?.name ?? "\u7CFB\u7EDF\u9ED8\u8BA4"}\u300D\u4E0D\u53EF\u7528\uFF0C\u6B63\u5728\u5C1D\u8BD5\u300C${next?.name ?? "\u7CFB\u7EDF\u9ED8\u8BA4"}\u300D\u2026`
      });
      this.queueSpeak(120);
      return;
    }
    const tried = candidates.map((candidate) => candidate?.name ?? "\u7CFB\u7EDF\u9ED8\u8BA4").join("\u3001");
    this.fail(
      code,
      `\u5DF2\u5C1D\u8BD5 ${candidates.length} \u4E2A\u97F3\u8272\u4ECD\u5931\u8D25\uFF1A${tried}\u3002\u8BF7\u5728 Windows\u300C\u8BBE\u7F6E \u2192 \u65F6\u95F4\u548C\u8BED\u8A00 \u2192 \u8BED\u97F3\u300D\u4E2D\u5B89\u88C5\u6216\u542F\u7528\u8BED\u97F3\uFF0C\u6216\u6362\u4E00\u4E2A\u97F3\u8272\u3002`
    );
  }
  /** Cancel the engine's queue and invalidate every in-flight callback. */
  cancelSpeech() {
    this.runId += 1;
    this.utterance = null;
    this.stopSapiAudio();
    try {
      this.synth?.cancel();
    } catch {
    }
  }
  /** Re-speak the current sentence after a speed/voice change. */
  restartChunk() {
    if (this.snapshot.status !== "speaking") {
      this.pendingRestart = true;
      return;
    }
    this.cancelSpeech();
    const chunk = this.chunks[this.index];
    if (chunk === void 0) {
      this.finish();
      return;
    }
    this.paintFrom(chunk.start);
    if (this.backend === "sapi") void this.speakSapi(chunk);
    else this.queueSpeak(60);
  }
  /** Delay speak() slightly; Chromium can drop a speak() issued inside cancel(). */
  queueSpeak(delay) {
    clearTimeout(this.speakTimer);
    this.speakTimer = setTimeout(() => {
      this.speakTimer = null;
      if (this.snapshot.status === "speaking") this.speakCurrent();
    }, delay);
  }
  /** Mark the reply finished, keeping the settings panel open. */
  finish() {
    const wasSelection = this.snapshot.selectionActive;
    this.clearHighlight();
    this.detachFollow();
    this.utterance = null;
    this.audioSource = null;
    this.audioBuffer = null;
    this.audioChunk = null;
    this.audioPausedAt = null;
    if (wasSelection) this.clearNativeSelection();
    this.selectionText = null;
    this.setSnapshot({
      status: "idle",
      chunkIndex: this.chunks.length,
      done: true,
      error: null,
      ...wasSelection ? { selectionActive: false, selectionText: null } : {}
    });
  }
  /** Stop on a real engine failure and surface a human-readable reason. */
  fail(code, detail) {
    const wasSelection = this.snapshot.selectionActive;
    this.cancelSpeech();
    this.clearHighlight();
    this.detachFollow();
    this.index = 0;
    this.setSnapshot({
      status: "idle",
      chunkIndex: 0,
      done: false,
      error: detail ?? ERROR_TEXT[code] ?? `\u6717\u8BFB\u5931\u8D25\uFF08${code}\uFF09\u3002`,
      ...wasSelection ? { selectionActive: true, selectionText: this.selectionText } : {}
    });
  }
  /** Paint every unread character blue, starting at `offset`. */
  paintFrom(offset) {
    if (!this.highlightSupported || this.docModel === null) return;
    try {
      const ranges = this.docModel.ranges(offset);
      const highlight = new this.win.Highlight();
      for (const range of ranges) highlight.add(range);
      if (ranges.length === 0) this.win.CSS.highlights.delete(HIGHLIGHT_NAME);
      else this.win.CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    } catch {
    }
  }
  /** Remove the pending-text highlight. */
  clearHighlight() {
    if (!this.highlightSupported) return;
    try {
      this.win.CSS.highlights.delete(HIGHLIGHT_NAME);
    } catch {
    }
  }
  /** Scroll the current sentence into the middle third of the conversation. */
  scrollToOffset(offset) {
    if (!this.follow || this.docModel === null) return;
    let point;
    try {
      point = this.docModel.pointAt(offset);
    } catch {
      return;
    }
    if (point === null) return;
    const length = point.node.nodeValue?.length ?? 0;
    if (length === 0) return;
    const range = this.doc.createRange();
    range.setStart(point.node, point.offset);
    range.setEnd(point.node, Math.min(length, point.offset + 1));
    if (typeof range.getBoundingClientRect !== "function") return;
    let rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      rect = point.node.parentElement?.getBoundingClientRect() ?? rect;
    }
    if (rect.width === 0 && rect.height === 0) return;
    const port = this.scrollPort ?? findScrollParent(this.anchor, this.win, this.doc);
    if (port === null) return;
    const portRect = port.getBoundingClientRect();
    if (portRect.height === 0) return;
    const target = port.scrollTop + (rect.top - portRect.top) - portRect.height * 0.32;
    const max = Math.max(0, port.scrollHeight - port.clientHeight);
    const top = Math.max(0, Math.min(target, max));
    if (Math.abs(top - port.scrollTop) < 8) return;
    const reduceMotion = this.win.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (typeof port.scrollTo === "function") {
      port.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
    } else {
      port.scrollTop = top;
    }
  }
  /** Follow the voice, but throttle boundary-driven scrolls to avoid jitter. */
  maybeScroll(offset) {
    if (!this.follow) return;
    const now = Date.now();
    if (now - this.scrollTimer < 550) return;
    this.scrollTimer = now;
    this.scrollToOffset(offset);
  }
  /** Suspend auto-follow for a few seconds when the reader scrolls by hand. */
  attachFollow(anchor) {
    this.detachFollow();
    const port = findScrollParent(anchor, this.win, this.doc);
    if (port === null) return;
    this.scrollPort = port;
    this.onUserScroll = () => {
      this.follow = false;
      clearTimeout(this.followTimer);
      this.followTimer = setTimeout(() => {
        this.follow = true;
      }, 6e3);
    };
    const target = port === this.doc.scrollingElement ? this.win : port;
    target.addEventListener?.("wheel", this.onUserScroll, { passive: true });
    target.addEventListener?.("touchstart", this.onUserScroll, { passive: true });
  }
  /** Remove the reader-scroll listeners. */
  detachFollow() {
    if (this.onUserScroll !== null) {
      const target = this.scrollPort === this.doc.scrollingElement ? this.win : this.scrollPort;
      target?.removeEventListener?.("wheel", this.onUserScroll);
      target?.removeEventListener?.("touchstart", this.onUserScroll);
    }
    clearTimeout(this.followTimer);
    this.followTimer = null;
    this.onUserScroll = null;
    this.scrollPort = null;
  }
  /** Release every listener and stop speech. */
  dispose() {
    this.cancelSpeech();
    clearTimeout(this.speakTimer);
    this.speakTimer = null;
    this.clearHighlight();
    this.detachFollow();
    this.hostProbeAbort?.abort();
    this.hostProbeAbort = null;
    this.synth?.removeEventListener?.("voiceschanged", this.onVoicesChanged);
    if (this.beforeUnload !== null) this.win?.removeEventListener?.("beforeunload", this.beforeUnload);
    const context = this.audioContext;
    this.audioContext = null;
    if (context !== null) void context.close().catch(() => {
    });
    this.listeners.clear();
  }
};

// src/ui.jsx
var import_react = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");
var import_jsx_runtime = require("react/jsx-runtime");
var PANEL_MARGIN = 12;
function SpeakerIcon({ active = false }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className: "dsr-icon", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "path",
      {
        d: "M2 6.05h2.15L7.1 3.55a.55.55 0 0 1 .9.43v8.04a.55.55 0 0 1-.9.43L4.15 9.95H2a.65.65 0 0 1-.65-.65V6.7A.65.65 0 0 1 2 6.05Z",
        fill: "currentColor"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "path",
      {
        className: "dsr-wave dsr-wave-1",
        d: "M10.05 5.35a3.2 3.2 0 0 1 0 5.3",
        stroke: "currentColor",
        strokeWidth: "1.35",
        strokeLinecap: "round",
        opacity: active ? void 0 : 0.55
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "path",
      {
        className: "dsr-wave dsr-wave-2",
        d: "M11.85 3.8a5.45 5.45 0 0 1 0 8.4",
        stroke: "currentColor",
        strokeWidth: "1.35",
        strokeLinecap: "round",
        opacity: active ? void 0 : 0.35
      }
    )
  ] });
}
function PlayIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.2 2.1 9.7 6l-6.5 3.9V2.1Z", fill: "currentColor" }) });
}
function PauseIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "2.6", y: "2", width: "2.5", height: "8", rx: "0.6", fill: "currentColor" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "6.9", y: "2", width: "2.5", height: "8", rx: "0.6", fill: "currentColor" })
  ] });
}
function StopIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "2.4", y: "2.4", width: "7.2", height: "7.2", rx: "1", fill: "currentColor" }) });
}
function RestartIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "13", height: "13", viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "path",
      {
        d: "M2.2 6.1a5 5 0 1 1 .7 3.8",
        stroke: "currentColor",
        strokeWidth: "1.35",
        strokeLinecap: "round"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.05 2.9v3.35H5.4", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
}
function CloseIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m2.6 2.6 6.8 6.8M9.4 2.6 2.6 9.4", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round" }) });
}
function TuneIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "14", height: "14", viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2 4h5.2M10.2 4H12M2 10h1.8M6.8 10H12", stroke: "currentColor", strokeWidth: "1.25", strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8.7", cy: "4", r: "1.35", stroke: "currentColor", strokeWidth: "1.25" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "5.3", cy: "10", r: "1.35", stroke: "currentColor", strokeWidth: "1.25" })
  ] });
}
function ReadAloudGlobal({ controller }) {
  const state = (0, import_react.useSyncExternalStore)(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot()
  );
  const [menu, setMenu] = (0, import_react.useState)(null);
  const rangeRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    const onContextMenu = (event) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (text === "" || selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (element === null) return;
      if (!element.closest("[data-conversation-scroll], [data-chat-flow]")) return;
      if (element.closest('textarea, input, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      rangeRef.current = range.cloneRange();
      setMenu({ x: event.clientX, y: event.clientY, text });
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const onShortcut = (event) => {
      if (!event.altKey || event.key.toLowerCase() !== "r") return;
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (text === "" || selection === null || selection.rangeCount === 0) return;
      const node = selection.getRangeAt(0).commonAncestorContainer;
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (element === null || element.closest('textarea, input, [contenteditable="true"]') !== null) return;
      if (!element.closest("[data-conversation-scroll], [data-chat-flow]")) return;
      event.preventDefault();
      controller.speakSelection(text);
    };
    document.addEventListener("keydown", onShortcut);
    return () => {
      document.removeEventListener("keydown", onShortcut);
    };
  }, [controller]);
  (0, import_react.useEffect)(() => {
    if (menu === null) return;
    const onPointerDown = (event) => {
      if (event.target?.closest?.("[data-read-aloud-menu]")) return;
      setMenu(null);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onResize = () => {
      setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);
  const speakSelection = () => {
    const range = rangeRef.current;
    if (range !== null) {
      try {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } catch {
      }
    }
    controller.speakSelection(menu.text);
    setMenu(null);
  };
  const copySelection = () => {
    void navigator.clipboard?.writeText(menu.text).catch(() => {
    });
    setMenu(null);
  };
  const left = menu === null ? 0 : Math.max(8, Math.min(menu.x, window.innerWidth - 178));
  const top = menu === null ? 0 : Math.max(8, Math.min(menu.y, window.innerHeight - 104));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    menu !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: "dsr-menu",
        "data-read-aloud-menu": "true",
        role: "menu",
        "aria-label": "\u9009\u4E2D\u6587\u5B57\u64CD\u4F5C",
        style: { left, top },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dsr-menu-item", role: "menuitem", onClick: copySelection, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-menu-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyIcon, {}) }),
            "\u590D\u5236"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dsr-menu-item", role: "menuitem", onClick: speakSelection, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-menu-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpeakerIcon, {}) }),
            "\u6717\u8BFB"
          ] })
        ]
      }
    ),
    state.selectionActive && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectionPlayer, { controller, state })
  ] });
}
function CopyIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "14", height: "14", viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "4.2", y: "1.8", width: "7.5", height: "8.5", rx: "1.4", stroke: "currentColor", strokeWidth: "1.2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 4.2H2.6A1.4 1.4 0 0 0 1.2 5.6v6.2A1.4 1.4 0 0 0 2.6 13.2h6.2a1.4 1.4 0 0 0 1.4-1.4V11", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
  ] });
}
function SelectionPlayer({ controller, state }) {
  const speaking = state.status === "speaking";
  const paused = state.status === "paused";
  const status = state.error !== null ? state.error : speaking ? `\u6B63\u5728\u6717\u8BFB \xB7 ${Math.min(state.chunkIndex + 1, state.chunkCount)}/${state.chunkCount}` : paused ? "\u5DF2\u6682\u505C" : "\u5DF2\u505C\u6B62";
  const rates = [0.75, 1, 1.25, 1.5, 2];
  const nextRate = rates[(rates.indexOf(state.rate) + 1) % rates.length] ?? 1;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-mini", role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-mini-title", title: state.selectionText ?? "", children: "\u6717\u8BFB\u9009\u4E2D\u6587\u5B57" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-mini-status", title: status, children: status }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-mini-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsr-mini-btn dsr-mini-primary",
          onClick: () => {
            if (speaking) controller.pause();
            else if (paused) controller.resume();
            else controller.restart();
          },
          disabled: state.chunkCount === 0,
          children: [
            speaking ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PauseIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlayIcon, {}),
            speaking ? "\u6682\u505C" : paused ? "\u7EE7\u7EED" : "\u91CD\u8BFB"
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsr-mini-btn", onClick: () => controller.stop(), children: "\u505C\u6B62" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsr-mini-btn dsr-mini-rate",
          onClick: () => controller.setRate(nextRate),
          title: "\u5207\u6362\u8BED\u901F",
          children: [
            state.rate.toFixed(2).replace(/\.?0+$/u, ""),
            "\xD7"
          ]
        }
      )
    ] })
  ] });
}
function groupVoices(voices) {
  const groups = { zh: [], en: [], other: [] };
  for (const voice of voices) {
    const lang = voice.lang.toLowerCase();
    if (lang.startsWith("zh")) groups.zh.push(voice);
    else if (lang.startsWith("en")) groups.en.push(voice);
    else groups.other.push(voice);
  }
  return groups;
}
function voiceLabel(voice) {
  const suffix = voice.provider === "edge" ? " \xB7 \u5728\u7EBF\u81EA\u7136" : voice.provider === "sapi" ? " \xB7 \u672C\u5730" : voice.localService === false ? " \xB7 \u5728\u7EBF" : "";
  return `${voice.name}\uFF08${voice.lang}${suffix}\uFF09`;
}
function ReadAloudAction({
  messageId,
  useReadAloud,
  start,
  pause,
  resume,
  stop,
  restart,
  setRate,
  setVoice,
  refreshVoices,
  openPanel,
  closePanel
}) {
  const buttonRef = (0, import_react.useRef)(null);
  const active = useReadAloud((state) => state.activeMessageId === messageId);
  const status = useReadAloud((state) => state.activeMessageId === messageId ? state.status : "idle");
  const panelOpen = useReadAloud((state) => state.panelOpen && state.activeMessageId === messageId);
  const supported = useReadAloud((state) => state.supported);
  const error = useReadAloud((state) => state.activeMessageId === messageId ? state.error : null);
  const speaking = status === "speaking";
  const paused = status === "paused";
  const label = !supported ? "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8BED\u97F3\u6717\u8BFB" : speaking ? "\u6682\u505C\u6717\u8BFB" : paused ? "\u7EE7\u7EED\u6717\u8BFB" : "\u6717\u8BFB\u8FD9\u6761\u56DE\u590D";
  const onClick = () => {
    const element = buttonRef.current;
    if (element === null) return;
    if (speaking) {
      openPanel();
      pause();
      return;
    }
    if (paused) {
      openPanel();
      resume();
      return;
    }
    start(messageId, element);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        ref: buttonRef,
        type: "button",
        className: "dsr-action",
        "data-read-aloud-anchor": "true",
        "data-active": active || panelOpen ? "true" : void 0,
        "data-speaking": speaking ? "true" : void 0,
        "aria-label": label,
        "aria-pressed": speaking,
        title: error ?? label,
        disabled: !supported,
        onClick,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpeakerIcon, { active })
      }
    ),
    panelOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ReadAloudPanel,
      {
        messageId,
        anchorRef: buttonRef,
        useReadAloud,
        closePanel,
        pause,
        resume,
        stop,
        restart,
        setRate,
        setVoice,
        refreshVoices
      }
    )
  ] });
}
function ReadAloudPanel({
  messageId,
  anchorRef,
  useReadAloud,
  closePanel,
  pause,
  resume,
  stop,
  restart,
  setRate,
  setVoice,
  refreshVoices
}) {
  const state = useReadAloud((snapshot) => snapshot);
  const panelRef = (0, import_react.useRef)(null);
  const positioned = (0, import_react.useRef)(false);
  const [position, setPosition] = (0, import_react.useState)({ left: -9999, top: -9999, ready: false });
  const [rateDraft, setRateDraft] = (0, import_react.useState)(state.rate);
  (0, import_react.useEffect)(() => {
    setRateDraft(state.rate);
  }, [state.rate]);
  (0, import_react.useLayoutEffect)(() => {
    if (positioned.current) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (anchor === null || panel === null) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const width = panel.offsetWidth || 322;
    const height = panel.offsetHeight || 324;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const center = rect.left + rect.width / 2;
    let left = center - width / 2;
    left = Math.max(PANEL_MARGIN, Math.min(left, viewportWidth - width - PANEL_MARGIN));
    let top = rect.top - height - 10;
    if (top < PANEL_MARGIN) top = rect.bottom + 10;
    top = Math.max(PANEL_MARGIN, Math.min(top, viewportHeight - height - PANEL_MARGIN));
    positioned.current = true;
    setPosition({ left, top, ready: true });
  });
  (0, import_react.useEffect)(() => {
    const onResize = () => {
      positioned.current = false;
      setPosition((previous) => ({ ...previous, ready: false }));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const onPointerDown = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target)) return;
      if (target?.closest?.("[data-read-aloud-anchor]")) return;
      closePanel();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePanel]);
  const speaking = state.status === "speaking";
  const paused = state.status === "paused";
  const done = state.status === "idle" && state.done;
  const hasDocument = state.chunkCount > 0;
  const progress = state.chunkCount === 0 ? 0 : Math.max(0, Math.min(100, Math.round(state.chunkIndex / state.chunkCount * 100)));
  const groups = groupVoices(state.voices);
  const statusText = state.error !== null ? "\u6717\u8BFB\u9047\u5230\u95EE\u9898" : speaking ? "\u6B63\u5728\u6717\u8BFB" : paused ? "\u5DF2\u6682\u505C" : done ? "\u6717\u8BFB\u5B8C\u6210" : "\u51C6\u5907\u6717\u8BFB";
  const onPrimary = () => {
    if (speaking) pause();
    else if (paused) resume();
    else restart();
  };
  const commitRate = () => {
    if (rateDraft !== state.rate) setRate(rateDraft);
  };
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        ref: panelRef,
        className: "dsr-panel",
        "data-read-aloud-panel": "true",
        "data-message-id": messageId,
        role: "dialog",
        "aria-label": "\u6717\u8BFB\u8BBE\u7F6E",
        style: {
          left: `${position.left}px`,
          top: `${position.top}px`,
          visibility: position.ready ? "visible" : "hidden"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsr-title", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-title-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TuneIcon, {}) }),
              "\u6717\u8BFB\u8BBE\u7F6E"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsr-close", "aria-label": "\u5173\u95ED\u6717\u8BFB\u8BBE\u7F6E", onClick: closePanel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CloseIcon, {}) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-status", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsr-status-main", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-dot", "data-live": speaking ? "true" : void 0 }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: statusText })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: hasDocument ? `${Math.min(state.chunkIndex + 1, state.chunkCount)} / ${state.chunkCount} \u53E5` : "\u2014" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-progress", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: `${progress}%` } }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-controls", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "button",
              {
                type: "button",
                className: "dsr-btn dsr-btn-primary",
                onClick: onPrimary,
                disabled: !hasDocument,
                "aria-label": speaking ? "\u6682\u505C" : paused ? "\u7EE7\u7EED" : "\u5F00\u59CB\u6717\u8BFB",
                children: [
                  speaking ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PauseIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlayIcon, {}),
                  speaking ? "\u6682\u505C" : paused ? "\u7EE7\u7EED" : done ? "\u91CD\u8BFB" : "\u64AD\u653E"
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsr-btn dsr-btn-icon",
                onClick: stop,
                disabled: !speaking && !paused,
                "aria-label": "\u505C\u6B62\u6717\u8BFB",
                title: "\u505C\u6B62\u6717\u8BFB",
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StopIcon, {})
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsr-btn dsr-btn-icon",
                onClick: restart,
                disabled: !hasDocument,
                "aria-label": "\u4ECE\u5934\u6717\u8BFB",
                title: "\u4ECE\u5934\u6717\u8BFB",
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RestartIcon, {})
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-label", children: "\u8BED\u901F" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "dsr-range",
                type: "range",
                min: "0.5",
                max: "2",
                step: "0.25",
                value: rateDraft,
                "aria-label": "\u6717\u8BFB\u901F\u5EA6",
                onChange: (event) => setRateDraft(Number(event.target.value)),
                onPointerUp: commitRate,
                onKeyUp: commitRate,
                onBlur: commitRate
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsr-rate", children: [
              rateDraft.toFixed(2).replace(/\.?0+$/u, ""),
              "\xD7"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-chips", children: [0.75, 1, 1.25, 1.5, 2].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              className: "dsr-chip",
              "data-current": state.rate === value ? "true" : void 0,
              onClick: () => setRate(value),
              "aria-label": `${value} \u500D\u901F`,
              children: [
                value,
                "\xD7"
              ]
            },
            value
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsr-voice-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsr-label", children: "\u97F3\u8272" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "select",
              {
                className: "dsr-select",
                value: state.voiceURI,
                "aria-label": "\u6717\u8BFB\u97F3\u8272",
                onChange: (event) => setVoice(event.target.value),
                disabled: state.voices.length === 0,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u7CFB\u7EDF\u9ED8\u8BA4\uFF08\u8DDF\u968F\u6587\u672C\u8BED\u8A00\uFF09" }),
                  groups.zh.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("optgroup", { label: "\u4E2D\u6587", children: groups.zh.map((voice) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: voice.voiceURI, children: voiceLabel(voice) }, voice.voiceURI)) }),
                  groups.en.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("optgroup", { label: "English", children: groups.en.map((voice) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: voice.voiceURI, children: voiceLabel(voice) }, voice.voiceURI)) }),
                  groups.other.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("optgroup", { label: "\u5176\u4ED6", children: groups.other.map((voice) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: voice.voiceURI, children: voiceLabel(voice) }, voice.voiceURI)) })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsr-refresh", onClick: refreshVoices, title: "\u91CD\u65B0\u8BFB\u53D6\u7CFB\u7EDF\u97F3\u8272", children: "\u5237\u65B0" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-note", children: state.engine === "edge" ? "Microsoft Edge \u5728\u7EBF\u81EA\u7136\u8BED\u97F3\uFF08\u6587\u5B57\u4F1A\u53D1\u9001\u7ED9 Microsoft\uFF09" : state.engine === "sapi" ? "\u672C\u5730 SAPI \u8BED\u97F3\u5F15\u64CE\uFF08\u79BB\u7EBF\u5408\u6210\uFF0C\u4E0D\u8054\u7F51\uFF09" : state.hostState === "probing" ? "\u6B63\u5728\u8FDE\u63A5\u672C\u5730\u8BED\u97F3\u5F15\u64CE\u2026" : "\u6D4F\u89C8\u5668\u8BED\u97F3\u5F15\u64CE" }),
          state.voiceError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-note", children: state.voiceError }),
          state.voiceNotice !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-note dsr-notice", children: state.voiceNotice }),
          state.engine === "browser" && state.hostState === "unavailable" && state.hostError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-note", children: state.hostError }),
          state.error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-error", role: "status", children: state.error }),
          !state.highlightSupported && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-note", children: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u6587\u672C\u9AD8\u4EAE\uFF0C\u6717\u8BFB\u4ECD\u53EF\u6B63\u5E38\u8FDB\u884C\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsr-note", children: "\u84DD\u8272\u80CC\u666F\u8868\u793A\u5C1A\u672A\u6717\u8BFB\u7684\u6587\u5B57\uFF0C\u8BFB\u5230\u540E\u4F1A\u9010\u6BB5\u6E05\u9664\u3002\u62D6\u52A8\u6216\u6EDA\u8F6E\u624B\u52A8\u6EDA\u52A8\u65F6\uFF0C\u81EA\u52A8\u8DDF\u968F\u4F1A\u6682\u65F6\u8BA9\u4F4D\u3002" })
        ]
      }
    ),
    document.body
  );
}

// src/styles.js
var READ_ALOUD_CSS = `
::highlight(dsh-read-aloud-pending) {
  background-color: rgba(47, 111, 237, 0.28);
  color: inherit;
}

@media (forced-colors: active) {
  ::highlight(dsh-read-aloud-pending) {
    background-color: Highlight;
    color: HighlightText;
  }
}

.dsr-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dsr-action:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-secondary, #4b5563);
}

.dsr-action:focus-visible {
  outline: 2px solid var(--dsw-alias-border-focus, #2f6fed);
  outline-offset: 1px;
}

.dsr-action:disabled {
  cursor: default;
  opacity: 0.4;
}

.dsr-action[data-active="true"] {
  color: var(--dsw-alias-label-primary, #111827);
}

.dsr-action[data-speaking="true"] .dsr-wave {
  animation: dsr-wave 1.4s ease-in-out infinite;
}

.dsr-action[data-speaking="true"] .dsr-wave-1 {
  animation-delay: 0s;
}

.dsr-action[data-speaking="true"] .dsr-wave-2 {
  animation-delay: 0.18s;
}

@keyframes dsr-wave {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}

.dsr-icon {
  display: block;
  width: 16px;
  height: 16px;
}

.dsr-panel {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  width: 322px;
  max-width: calc(100vw - 24px);
  max-height: min(560px, calc(100vh - 24px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  animation: dsr-in 140ms ease-out;
}

@keyframes dsr-in {
  from { opacity: 0; transform: translateY(4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .dsr-panel { animation: none; }
  .dsr-action { transition: none; }
}

.dsr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.dsr-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dsr-title-icon {
  display: inline-flex;
  color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  cursor: pointer;
}

.dsr-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary, #111827);
}

.dsr-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-variant-numeric: tabular-nums;
}

.dsr-status-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dsr-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #9ca3af);
}

.dsr-dot[data-live="true"] {
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.14);
}

.dsr-progress {
  height: 3px;
  margin-bottom: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127, 127, 127, 0.16));
}

.dsr-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  transition: width 220ms ease;
}

.dsr-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 13px;
}

.dsr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsr-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-btn:disabled {
  cursor: default;
  opacity: 0.42;
}

.dsr-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  color: #ffffff;
}

.dsr-btn-primary:hover {
  background: var(--dsw-alias-button-primary-hover, #245bcc);
}

.dsr-btn-icon {
  width: 30px;
  padding: 0;
}

.dsr-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 10px;
}

.dsr-label {
  flex: none;
  width: 32px;
  color: var(--dsw-alias-label-secondary, #4b5563);
}

.dsr-range {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-rate {
  flex: none;
  width: 42px;
  text-align: right;
  color: var(--dsw-alias-label-primary, #111827);
  font-variant-numeric: tabular-nums;
}

.dsr-chips {
  display: flex;
  gap: 5px;
  margin: 7px 0 0 41px;
}

.dsr-chip {
  height: 23px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.dsr-chip:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127, 127, 127, 0.18));
}

.dsr-chip[data-current="true"] {
  border-color: var(--dsw-alias-button-primary-fill, #2f6fed);
  background: transparent;
  color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-voice-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
}

.dsr-select {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 12px;
}

.dsr-refresh {
  flex: none;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsr-refresh:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-note {
  margin-top: 11px;
  padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  font-size: 11px;
  line-height: 1.45;
}

.dsr-notice {
  color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-error {
  margin-top: 9px;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.07));
  color: var(--dsw-alias-state-error-primary, #c0392b);
  font-size: 11px;
  line-height: 1.45;
}

.dsr-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.dsr-menu {
  position: fixed;
  z-index: 2147483001;
  width: 158px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 13px;
  animation: dsr-in 100ms ease-out;
}

.dsr-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsr-menu-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-menu-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
}

.dsr-mini {
  position: fixed;
  left: 50%;
  bottom: calc(var(--dsh-composer-height, 152px) + 16px);
  z-index: 2147483001;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 7px 8px 7px 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2), 0 1px 4px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 12px;
  transform: translateX(-50%);
  animation: dsr-in 140ms ease-out;
}

.dsr-mini-title {
  flex: none;
  font-weight: 600;
  white-space: nowrap;
}

.dsr-mini-status {
  max-width: 280px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsr-mini-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.dsr-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 27px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.dsr-mini-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-mini-btn:disabled {
  cursor: default;
  opacity: 0.45;
}

.dsr-mini-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  color: #ffffff;
}

.dsr-mini-primary:hover {
  background: var(--dsw-alias-button-primary-hover, #245bcc);
}

.dsr-mini-rate {
  font-variant-numeric: tabular-nums;
}
`;

// src/client.js
var PLUGIN_ID = "dsh-plugin-read-aloud";
var STYLE_ATTR = "data-read-aloud-style";
var inject = ["slots"];
function apply(ctx) {
  if (typeof document === "undefined") return;
  const controller = new ReadAloudController();
  ctx.effect(() => {
    let style = document.head.querySelector(`style[${STYLE_ATTR}="${PLUGIN_ID}"]`);
    if (style === null) {
      style = document.createElement("style");
      style.setAttribute(STYLE_ATTR, PLUGIN_ID);
      style.dataset.plugin = PLUGIN_ID;
      style.textContent = READ_ALOUD_CSS;
      document.head.appendChild(style);
    }
    const globalHost = document.createElement("div");
    globalHost.setAttribute("data-read-aloud-global", PLUGIN_ID);
    document.body.appendChild(globalHost);
    const root = (0, import_client.createRoot)(globalHost);
    root.render((0, import_react2.createElement)(ReadAloudGlobal, { controller }));
    const onPageHide = () => {
      controller.dispose();
    };
    window.addEventListener("pagehide", onPageHide, { once: true });
    return () => {
      controller.dispose();
      window.removeEventListener("pagehide", onPageHide);
      root.unmount();
      globalHost.remove();
      style?.remove();
    };
  }, "read-aloud: lifecycle");
  ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
    name: "conversation.chat.assistant-actions",
    id: "read-aloud",
    order: 5,
    inject: () => ({
      hooks: { readAloud: controller },
      start: (messageId, anchor) => controller.start(messageId, anchor),
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      stop: () => controller.stop(),
      restart: () => controller.restart(),
      setRate: (value) => controller.setRate(value),
      setVoice: (uri) => controller.setVoice(uri),
      refreshVoices: () => controller.refreshVoices(),
      openPanel: () => controller.openPanel(),
      closePanel: () => controller.closePanel()
    })
  }, ReadAloudAction));
}
		return module.exports;
	}
});

