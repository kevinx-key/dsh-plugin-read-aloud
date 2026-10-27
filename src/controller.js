/**
 * Speech, highlight and persistence state for the read-aloud action.
 *
 * One controller is created per client plugin instance. Every assistant
 * message gets its own button, but only one reply can be spoken at a time, so
 * the controller is the single owner of `speechSynthesis` and the pending-text
 * highlight.
 */

import { buildSpeechDoc, findAssistantRoot, splitIntoChunks } from './doc.js'

const HIGHLIGHT_NAME = 'dsh-read-aloud-pending'
const STORAGE_RATE = 'dsh.read-aloud.rate'
const STORAGE_VOICE = 'dsh.read-aloud.voice'
const STORAGE_SAPI_VOICE = 'dsh.read-aloud.sapi-voice'
const DEFAULT_RATE = 1
const HOST_PORTS = Array.from({ length: 12 }, (_, index) => 18766 + index)

const ERROR_TEXT = {
  'not-allowed': '浏览器阻止了语音播放，请先点击一下页面后再试。',
  'audio-busy': '音频设备正忙，请稍后再试。',
  network: '语音合成需要网络，或者系统语音尚未安装。',
  'synthesis-failed': '语音合成失败，请换一个音色再试。',
  'synthesis-unavailable': '当前没有可用的语音引擎。',
  interrupted: '',
  canceled: '',
  'text-too-long': '这段文字太长，语音引擎拒绝了请求。',
}

/**
 * @typedef {object} ReadAloudSnapshot
 * @property {boolean} supported
 * @property {boolean} highlightSupported
 * @property {'browser'|'edge'|'sapi'} engine
 * @property {'probing'|'ready'|'unavailable'} hostState
 * @property {string|null} hostError
 * @property {'idle'|'speaking'|'paused'} status
 * @property {string|null} activeMessageId
 * @property {boolean} panelOpen
 * @property {number} rate
 * @property {string} voiceURI
 * @property {Array<{ voiceURI: string, name: string, lang: string, localService: boolean }>} voices
 * @property {string|null} voiceError
 * @property {string|null} voiceNotice
 * @property {string|null} error
 * @property {number} chunkIndex
 * @property {number} chunkCount
 * @property {boolean} done
 * @property {boolean} selectionActive
 * @property {string|null} selectionText
 */

/** Clamp a user-facing speed to the supported 0.5x–2x grid. */
function clampRate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_RATE
  return Math.max(0.5, Math.min(2, Math.round(number * 4) / 4))
}

/** Read one string from localStorage without letting privacy modes break playback. */
function readStorage(storage, key) {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Persist one string, ignoring quota/privacy failures. */
function writeStorage(storage, key, value) {
  try {
    storage?.setItem(key, value)
  } catch {
    // Persistence is best-effort; playback must not depend on it.
  }
}

/** Pick a scroll container, falling back to the document scrolling element. */
function findScrollParent(element, win, doc) {
  let node = element?.parentElement ?? null
  while (node !== null && node !== doc.body && node !== doc.documentElement) {
    const style = win.getComputedStyle(node)
    if (/(auto|scroll)/u.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  return doc.scrollingElement ?? doc.documentElement
}

/** A stable, plain-data description of the browser voice roster. */
function describeVoice(voice) {
  return {
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
  }
}

/** Group voices for the select: Chinese first, then English, then the rest. */
function voiceRank(voice) {
  const lang = voice.lang.toLowerCase()
  if (lang.startsWith('zh')) return 0
  if (lang.startsWith('en')) return 1
  return 2
}

/** Prefer the natural/neural Windows voices over the legacy SAPI ones. */
function voiceScore(voice) {
  const name = voice.name.toLowerCase()
  let score = 0
  if (name.includes('natural')) score += 4
  if (name.includes('neural')) score += 4
  if (name.includes('online')) score += 2
  // SAPI5 "Desktop" voices are the most reliable in Chromium; some OneCore
  // voices are listed by getVoices() but fail at speak() time.
  if (name.includes('desktop')) score += 6
  if (name.includes('xiaoxiao')) score += 3
  if (name.includes('yunxi') || name.includes('yunjian') || name.includes('xiaoyi')) score += 2
  return score
}

/** @implements {import('@deepseek-ai/dsh-client-ui-slots').HostObservable<ReadAloudSnapshot>} */
export class ReadAloudController {
  /**
   * @param {object} [options]
   * @param {Window} [options.window]
   * @param {Document} [options.document]
   * @param {Storage} [options.storage]
   */
  constructor(options = {}) {
    this.win = options.window ?? globalThis.window
    this.doc = options.document ?? globalThis.document
    this.storage = options.storage ?? this.win?.localStorage
    this.synth = this.win?.speechSynthesis
    this.supported = Boolean(
      this.synth
      && this.doc
      && typeof this.win.SpeechSynthesisUtterance === 'function',
    )
    this.highlightSupported = Boolean(
      this.win?.CSS?.highlights
      && typeof this.win.Highlight === 'function',
    )

    this.listeners = new Set()
    this.runId = 0
    this.utterance = null
    this.voiceObjects = []
    this.voices = []
    this.rate = clampRate(readStorage(this.storage, STORAGE_RATE) ?? DEFAULT_RATE)
    this.voicePreference = readStorage(this.storage, STORAGE_VOICE)
    this.voiceURI = this.voicePreference ?? ''
    this.voiceCandidates = null
    this.voiceAttempt = 0
    this.activeCandidate = null
    this.pendingRestart = false
    this.follow = true
    this.followTimer = null
    this.speakTimer = null
    this.scrollTimer = 0
    this.scrollPort = null
    this.onUserScroll = null
    this.beforeUnload = null

    this.backend = 'browser'
    this.provider = 'sapi'
    this.hostState = 'probing'
    this.hostError = null
    this.hostBase = null
    this.hostProbeAbort = null
    this.sapiVoicePreference = readStorage(this.storage, STORAGE_SAPI_VOICE)
    this.sapiVoice = this.sapiVoicePreference ?? ''
    this.sapiDefaultVoice = ''
    this.audioContext = null
    this.audioSource = null
    this.audioAbort = null
    this.audioBuffer = null
    this.audioChunk = null
    this.audioStartedAt = 0
    this.audioStartOffset = 0
    this.audioPausedAt = null
    this.audioPlaybackRate = this.rate

    /** @type {ReadAloudSnapshot} */
    this.snapshot = {
      supported: this.supported,
      highlightSupported: this.highlightSupported,
      engine: 'browser',
      hostState: 'probing',
      hostError: null,
      status: 'idle',
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
      selectionText: null,
    }

    this.docModel = null
    this.chunks = []
    this.index = 0
    this.messageId = null
    this.anchor = null
    this.selectionText = null

    this.onVoicesChanged = () => { this.loadVoices() }
    if (this.supported) {
      this.synth.addEventListener?.('voiceschanged', this.onVoicesChanged)
      this.loadVoices()
    }
    this.beforeUnload = () => {
      this.cancelSpeech()
      this.clearHighlight()
    }
    this.win?.addEventListener?.('beforeunload', this.beforeUnload)
    void this.probeHost()
  }

  /** @returns {ReadAloudSnapshot} */
  getSnapshot() {
    return this.snapshot
  }

  /** @param {() => void} listener */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Merge a patch into the immutable snapshot and wake subscribers. */
  setSnapshot(patch) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A renderer crash must not take the speech controller down with it.
      }
    }
  }

  /** Re-read the browser's voice roster (it can populate after first paint). */
  loadVoices() {
    if (this.backend === 'sapi') return
    if (!this.supported) return
    let raw = []
    try {
      raw = this.synth.getVoices?.() ?? []
    } catch {
      raw = []
    }
    const entries = raw
      .map(voice => ({ raw: voice, info: describeVoice(voice) }))
      .sort((a, b) => voiceRank(a.info) - voiceRank(b.info)
        || voiceScore(b.info) - voiceScore(a.info)
        || a.info.lang.localeCompare(b.info.lang)
        || a.info.name.localeCompare(b.info.name))
    this.voiceObjects = entries.map(entry => entry.raw)
    this.voices = entries.map(entry => entry.info)
    let selected = this.voices.find(voice => voice.voiceURI === this.voiceURI)
    if (selected === undefined && this.voicePreference !== '') {
      selected = this.voices.find(voice => voice.lang.toLowerCase().startsWith('zh')) ?? this.voices[0]
      if (selected !== undefined) {
        this.voiceURI = selected.voiceURI
        this.voicePreference = selected.voiceURI
      }
    }
    this.setSnapshot({
      voices: this.voices,
      voiceURI: this.voiceURI,
      voiceError: this.voices.length === 0
        ? '没有检测到系统语音，将尝试使用浏览器默认语音。'
        : null,
    })
  }

  /** Ask the active engine to refresh its voice roster. */
  refreshVoices() {
    if (this.backend === 'sapi') {
      void this.refreshSapiVoices()
      return
    }
    void this.probeHost()
    this.loadVoices()
  }

  /** Refresh the SAPI roster without interrupting an active sentence. */
  async refreshSapiVoices() {
    if (this.hostBase === null) {
      void this.probeHost()
      return
    }
    try {
      const response = await this.fetchWithTimeout(`${this.hostBase}/voices`, 2500)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const voices = (Array.isArray(data.voices) ? data.voices : []).map(voice => ({
        voiceURI: voice.name,
        name: voice.displayName ?? voice.name,
        lang: voice.culture,
        localService: voice.engine === 'sapi',
        provider: voice.engine === 'sapi' ? 'sapi' : 'edge',
      }))
      if (voices.length === 0) throw new Error('empty voice roster')
      this.sapiDefaultVoice = data.defaultVoice ?? voices[0].voiceURI
      if (!voices.some(voice => voice.voiceURI === this.voiceURI)) this.voiceURI = this.sapiDefaultVoice
      this.sapiVoice = this.voiceURI
      this.provider = voices.find(voice => voice.voiceURI === this.voiceURI)?.provider ?? this.provider
      this.voices = voices
      this.voiceObjects = []
      this.setSnapshot({ voices, voiceURI: this.voiceURI, engine: this.provider, voiceError: null })
    } catch {
      void this.probeHost()
    }
  }

  /** Fetch with a hard timeout, used by the local-service probe. */
  async fetchWithTimeout(url, timeoutMs, options = {}) {
    if (typeof this.win?.fetch !== 'function') throw new Error('fetch is unavailable')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await this.win.fetch(url, { ...options, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Probe the Host's loopback SAPI service. The Host may still be starting its
   * PowerShell worker, so retry briefly before falling back to Web Speech.
   */
  async probeHost() {
    if (typeof this.win?.fetch !== 'function') {
      this.hostState = 'unavailable'
      this.hostError = '当前环境没有 fetch，无法连接本地语音服务。'
      this.setSnapshot({ hostState: 'unavailable', hostError: this.hostError })
      return
    }
    if (this.hostProbeAbort !== null) this.hostProbeAbort.abort()
    const abort = new AbortController()
    this.hostProbeAbort = abort
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (abort.signal.aborted) return
      let best = null
      for (const port of HOST_PORTS) {
        try {
          const response = await this.fetchWithTimeout(`http://127.0.0.1:${port}/health`, 250)
          if (!response.ok) continue
          const health = await response.json()
          if (health?.plugin !== 'dsh-plugin-read-aloud') continue
          if (health.ready !== true || !Array.isArray(health.voices) || health.voices.length === 0) continue
          const score = (health.engines?.edge === true ? 10 : 0)
            + (health.engines?.sapi === true ? 5 : 0)
            + health.voices.length
          if (best === null || score > best.score) best = { port, health, score }
        } catch {
          // Try the next port / attempt.
        }
      }
      if (abort.signal.aborted) return
      if (best !== null) {
        this.adoptSapiHost(best.port, best.health)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 350))
    }
    if (abort.signal.aborted) return
    this.hostState = 'unavailable'
    this.hostError = '本地语音服务未连接，已回退到浏览器语音。'
    this.setSnapshot({
      hostState: 'unavailable',
      hostError: this.hostError,
    })
  }

  /** Switch the controller to the Host's working voice roster. */
  adoptSapiHost(port, health) {
    const voices = health.voices.map(voice => ({
      voiceURI: voice.name,
      name: voice.displayName ?? voice.name,
      lang: voice.culture,
      localService: voice.engine === 'sapi',
      provider: voice.engine === 'sapi' ? 'sapi' : 'edge',
    }))
    const preferredVoice = voices.find(voice => voice.voiceURI === this.sapiVoice)
      ?? voices.find(voice => voice.voiceURI === health.defaultVoice)
      ?? voices.find(voice => voice.provider === 'edge' && String(voice.lang).toLowerCase().startsWith('zh'))
      ?? voices[0]
    this.provider = preferredVoice?.provider ?? 'sapi'
    this.backend = 'sapi'
    this.supported = true
    this.hostState = 'ready'
    this.hostError = null
    this.hostBase = `http://127.0.0.1:${port}`
    this.sapiDefaultVoice = health.defaultVoice ?? voices[0]?.voiceURI ?? ''
    const preferred = preferredVoice?.voiceURI ?? this.sapiDefaultVoice
    this.sapiVoice = preferred
    this.voiceURI = preferred
    this.voicePreference = preferred
    this.voiceObjects = []
    this.voices = voices
    this.voiceCandidates = null
    this.voiceAttempt = 0
    const wasActive = this.snapshot.status !== 'idle'
    if (wasActive) {
      if (this.snapshot.selectionActive) this.clearNativeSelection()
      this.cancelSpeech()
      this.clearHighlight()
      this.detachFollow()
      this.selectionText = null
    }
    const selectedName = voices.find(voice => voice.voiceURI === preferred)?.name ?? preferred
    this.setSnapshot({
      supported: true,
      engine: this.provider,
      hostState: 'ready',
      hostError: null,
      voices,
      voiceURI: preferred,
      voiceError: null,
      error: null,
      ...(wasActive ? {
        status: 'idle',
        chunkIndex: 0,
        done: false,
        selectionActive: false,
        selectionText: null,
      } : {}),
      voiceNotice: this.provider === 'edge'
        ? `Microsoft Edge 自然语音已就绪：${selectedName}`
        : `本地 SAPI 语音已就绪：${selectedName}`,
    })
  }

  /** @returns {SpeechSynthesisVoice | null} */
  currentVoice() {
    if (this.voices.length === 0) return null
    const index = this.voices.findIndex(voice => voice.voiceURI === this.voiceURI)
    return index >= 0 ? this.voiceObjects[index] ?? null : null
  }

  /**
   * Ordered voices to attempt for one sentence: the chosen voice first, then
   * every other installed voice, then the browser default (null). Some Windows
   * OneCore voices are advertised by getVoices() but throw synthesis-failed.
   */
  buildVoiceCandidates() {
    const selected = this.currentVoice()
    const primary = (selected?.lang ?? 'zh').split('-')[0].toLowerCase()
    const sameLanguage = []
    const rest = []
    const seen = new Set()
    if (selected !== null) seen.add(selected.voiceURI)
    for (const voice of this.voiceObjects) {
      if (seen.has(voice.voiceURI)) continue
      seen.add(voice.voiceURI)
      if (voice.lang.toLowerCase().split('-')[0] === primary) sameLanguage.push(voice)
      else rest.push(voice)
    }
    const candidates = []
    if (selected === null) {
      candidates.push(null, ...sameLanguage)
    } else {
      candidates.push(selected, ...sameLanguage, null)
    }
    candidates.push(...rest)
    return candidates
  }

  /** Start a fresh fallback chain for the next sentence. */
  resetVoiceCandidates() {
    this.voiceCandidates = this.buildVoiceCandidates()
    this.voiceAttempt = 0
    this.activeCandidate = this.voiceCandidates[0] ?? null
  }

  /**
   * Start reading one assistant reply, or toggle the active one.
   * @param {string} messageId - durable assistant message id.
   * @param {HTMLElement} anchor - the speaker button, used to find the reply DOM.
   * @returns {boolean} whether playback was started or toggled.
   */
  start(messageId, anchor) {
    if (!this.supported) {
      this.setSnapshot({ error: '当前环境不支持浏览器语音合成。' })
      return false
    }
    if (this.snapshot.selectionActive) {
      this.clearNativeSelection()
      this.selectionText = null
    }
    if (this.snapshot.activeMessageId === messageId && this.snapshot.status !== 'idle') {
      if (this.snapshot.status === 'paused') this.resume()
      else this.pause()
      return true
    }

    // A click on another reply replaces the active one immediately, even when
    // the new reply turns out to have nothing speakable.
    this.cancelSpeech()
    this.clearHighlight()
    this.detachFollow()
    this.docModel = null
    this.chunks = []
    this.index = 0
    this.messageId = messageId
    this.anchor = anchor
    this.follow = true
    this.pendingRestart = false

    const failStart = (message) => {
      this.setSnapshot({
        activeMessageId: messageId,
        panelOpen: true,
        status: 'idle',
        chunkIndex: 0,
        chunkCount: 0,
        done: false,
        error: message,
      })
      return false
    }

    const root = findAssistantRoot(anchor)
    if (root === null) return failStart('没有找到这条回复的正文，请刷新后重试。')

    let model
    try {
      model = buildSpeechDoc(root)
    } catch {
      return failStart('无法读取这条回复的正文。')
    }
    const chunks = splitIntoChunks(model.text)
    if (chunks.length === 0) return failStart('这条回复里没有可朗读的文字。')

    if (this.backend === 'sapi') {
      try {
        this.ensureAudioContext()
      } catch {
        return failStart('当前环境不支持音频播放。')
      }
      void this.audioContext?.resume().catch(() => {})
    }

    this.docModel = model
    this.chunks = chunks
    if (this.backend === 'sapi') {
      this.voiceCandidates = null
      this.voiceAttempt = 0
    } else {
      this.resetVoiceCandidates()
    }
    this.attachFollow(anchor)
    this.setSnapshot({
      status: 'speaking',
      activeMessageId: messageId,
      panelOpen: true,
      chunkIndex: 0,
      chunkCount: chunks.length,
      done: false,
      error: null,
      voiceNotice: null,
      selectionActive: false,
      selectionText: null,
    })
    this.paintFrom(chunks[0].start)
    this.scrollToOffset(chunks[0].start)
    if (this.backend === 'sapi') void this.speakSapi(chunks[0])
    else this.queueSpeak(30)
    return true
  }

  /**
   * Read arbitrary selected text. There is no assistant DOM model to paint, so
   * the browser's native selection remains the visual marker; the audio pipeline
   * (including pause offset, speed and voice) is shared with message reading.
   * @param {string} text - selected text.
   * @returns {boolean} whether playback started.
   */
  speakSelection(text) {
    const trimmed = String(text ?? '').trim()
    if (trimmed === '') return false
    if (!this.supported) {
      this.setSnapshot({ error: '当前环境不支持语音朗读。' })
      return false
    }
    const chunks = splitIntoChunks(trimmed)
    if (chunks.length === 0) return false

    this.cancelSpeech()
    this.clearHighlight()
    this.detachFollow()
    this.docModel = null
    this.chunks = chunks
    this.index = 0
    this.messageId = null
    this.anchor = null
    this.follow = false
    this.pendingRestart = false
    this.selectionText = trimmed
    if (this.backend === 'sapi') {
      try {
        this.ensureAudioContext()
        void this.audioContext?.resume().catch(() => {})
      } catch {
        return false
      }
      this.voiceCandidates = null
      this.voiceAttempt = 0
    } else {
      this.resetVoiceCandidates()
    }
    this.setSnapshot({
      status: 'speaking',
      activeMessageId: null,
      panelOpen: false,
      chunkIndex: 0,
      chunkCount: chunks.length,
      done: false,
      error: null,
      voiceNotice: null,
      selectionActive: true,
      selectionText: trimmed,
    })
    if (this.backend === 'sapi') void this.speakSapi(chunks[0])
    else this.queueSpeak(30)
    return true
  }

  /** Remove the browser's native selection after selection playback ends. */
  clearNativeSelection() {
    try {
      const selection = this.win?.getSelection?.()
      if (selection !== undefined && selection !== null && selection.rangeCount > 0) {
        selection.removeAllRanges()
      }
    } catch {
      // Selection APIs can disappear while the window tears down.
    }
  }

  /** Stop any active utterance and clear the blue pending highlight. */
  stop() {
    const wasSelection = this.snapshot.selectionActive
    this.cancelSpeech()
    this.clearHighlight()
    this.detachFollow()
    this.pendingRestart = false
    this.index = 0
    if (wasSelection) this.clearNativeSelection()
    this.selectionText = null
    this.setSnapshot({
      status: 'idle',
      chunkIndex: 0,
      done: false,
      error: null,
      selectionActive: false,
      selectionText: null,
    })
  }

  /** Pause the active utterance. */
  pause() {
    if (this.snapshot.status !== 'speaking') return
    if (this.backend === 'sapi') {
      if (this.audioSource !== null && this.audioBuffer !== null) {
        this.audioPausedAt = this.audioPosition()
        this.stopAudioSource()
      } else {
        this.pendingRestart = true
      }
      this.setSnapshot({ status: 'paused' })
      return
    }
    this.setSnapshot({ status: 'paused' })
    try {
      this.synth.pause()
    } catch {
      // Some engines do not implement pause; resume() falls back to re-speaking.
    }
  }

  /** Resume, or restart the current chunk when a voice/speed change invalidated it. */
  resume() {
    if (this.snapshot.status !== 'paused') return
    if (this.backend === 'sapi') {
      if (this.pendingRestart) {
        this.pendingRestart = false
        this.setSnapshot({ status: 'speaking' })
        this.restartChunk()
        return
      }
      if (this.audioPausedAt !== null && this.audioBuffer !== null && this.audioChunk !== null) {
        const offset = this.audioPausedAt
        const buffer = this.audioBuffer
        const chunk = this.audioChunk
        const run = this.runId
        this.audioPausedAt = null
        this.setSnapshot({ status: 'speaking', error: null })
        void this.playAudioBuffer(buffer, offset, chunk, run)
        return
      }
      this.setSnapshot({ status: 'speaking' })
      if (this.audioSource !== null && !this.pendingRestart) {
        void this.audioContext?.resume().catch(() => {})
        return
      }
      this.pendingRestart = false
      this.restartChunk()
      return
    }
    this.setSnapshot({ status: 'speaking' })
    if (this.pendingRestart) {
      this.pendingRestart = false
      this.restartChunk()
      return
    }
    try {
      this.synth.resume()
      if (!this.synth.speaking && !this.synth.pending) this.restartChunk()
    } catch {
      this.restartChunk()
    }
  }

  /** Toggle play/pause for the UI. */
  toggle() {
    if (this.snapshot.status === 'speaking') this.pause()
    else if (this.snapshot.status === 'paused') this.resume()
    else this.restart()
  }

  /** Re-read the current reply from its first sentence. */
  restart() {
    if (this.chunks.length === 0 || (this.docModel === null && !this.snapshot.selectionActive)) return
    this.cancelSpeech()
    this.clearHighlight()
    this.index = 0
    this.pendingRestart = false
    this.follow = true
    if (this.backend === 'sapi') {
      this.voiceCandidates = null
      this.voiceAttempt = 0
      void this.audioContext?.resume().catch(() => {})
    } else {
      this.resetVoiceCandidates()
    }
    this.attachFollow(this.anchor)
    this.setSnapshot({ status: 'speaking', chunkIndex: 0, done: false, error: null, voiceNotice: null })
    this.paintFrom(0)
    this.scrollToOffset(0)
    if (this.backend === 'sapi') void this.speakSapi(this.chunks[0])
    else this.queueSpeak(30)
  }

  /**
   * Change speed. The current sentence is repeated so the new rate takes effect.
   * @param {number} value - 0.5–2.
   */
  setRate(value) {
    const next = clampRate(value)
    if (next === this.rate) return
    this.rate = next
    writeStorage(this.storage, STORAGE_RATE, String(next))
    this.setSnapshot({ rate: next })
    if (this.backend === 'sapi') {
      if (this.provider === 'edge') {
        this.audioPlaybackRate = 1
        if (this.snapshot.status === 'speaking') this.restartChunk()
        else if (this.snapshot.status === 'paused') this.pendingRestart = true
        return
      }
      if (this.audioSource !== null && this.audioBuffer !== null) {
        const position = this.audioPosition()
        this.audioStartOffset = position
        this.audioStartedAt = this.audioContext?.currentTime ?? this.audioStartedAt
        this.audioPlaybackRate = next
        this.audioSource.playbackRate.value = next
      } else {
        this.audioPlaybackRate = next
      }
      return
    }
    if (this.snapshot.status === 'speaking') this.restartChunk()
    else if (this.snapshot.status === 'paused') this.pendingRestart = true
  }

  /**
   * Switch voice. The current sentence is repeated with the new voice.
   * @param {string} voiceURI - browser voice identity.
   */
  setVoice(voiceURI) {
    if (voiceURI === this.voiceURI) return
    this.voiceURI = voiceURI
    if (this.backend === 'sapi') {
      const selected = this.voices.find(voice => voice.voiceURI === voiceURI)
      this.provider = selected?.provider ?? this.provider
      this.sapiVoice = voiceURI
      this.sapiVoicePreference = voiceURI
      writeStorage(this.storage, STORAGE_SAPI_VOICE, voiceURI)
      this.setSnapshot({ voiceURI, engine: this.provider, voiceNotice: null })
      if (this.snapshot.status === 'speaking') this.restartChunk()
      else if (this.snapshot.status === 'paused') this.pendingRestart = true
      return
    }
    this.voicePreference = voiceURI
    writeStorage(this.storage, STORAGE_VOICE, voiceURI)
    this.resetVoiceCandidates()
    this.setSnapshot({ voiceURI, voiceNotice: null })
    if (this.snapshot.status === 'speaking') this.restartChunk()
    else if (this.snapshot.status === 'paused') this.pendingRestart = true
  }

  /** Open the settings popover. */
  openPanel() {
    this.setSnapshot({ panelOpen: true })
  }

  /** Close the settings popover without stopping playback. */
  closePanel() {
    this.setSnapshot({ panelOpen: false })
  }

  /** Toggle the settings popover. */
  togglePanel() {
    this.setSnapshot({ panelOpen: !this.snapshot.panelOpen })
  }

  /** Create (or reuse) the Web Audio context used by the SAPI backend. */
  ensureAudioContext() {
    if (this.audioContext !== null && this.audioContext.state !== 'closed') return this.audioContext
    const Constructor = this.win?.AudioContext ?? this.win?.webkitAudioContext
    if (typeof Constructor !== 'function') throw new Error('当前环境不支持 Web Audio')
    this.audioContext = new Constructor()
    return this.audioContext
  }

  /** Fetch one sentence as WAV from the Host's loopback SAPI service. */
  async fetchSapi(text) {
    const controller = new AbortController()
    this.audioAbort = controller
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await this.win.fetch(`${this.hostBase}/speak`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: this.voiceURI || undefined,
          engine: this.provider,
          rate: this.provider === 'edge' ? this.rate : 1,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const raw = await response.text().catch(() => '')
        let detail = raw
        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.error === 'string') detail = parsed.error
        } catch {
          // Keep the raw body for non-JSON failures.
        }
        throw new Error(detail.slice(0, 300) || `HTTP ${response.status}`)
      }
      return await response.arrayBuffer()
    } finally {
      clearTimeout(timer)
      if (this.audioAbort === controller) this.audioAbort = null
    }
  }

  /** Stop the current buffer source but keep its decoded audio for resume. */
  stopAudioSource() {
    const source = this.audioSource
    this.audioSource = null
    if (source !== null) {
      source.onended = null
      try { source.stop() } catch {}
      try { source.disconnect() } catch {}
    }
  }

  /** Current playback position inside the decoded buffer, in seconds. */
  audioPosition() {
    if (this.audioPausedAt !== null) return this.audioPausedAt
    if (this.audioSource === null || this.audioBuffer === null) return this.audioStartOffset
    const current = this.audioContext?.currentTime ?? this.audioStartedAt
    const elapsed = Math.max(0, current - this.audioStartedAt) * this.audioPlaybackRate
    return Math.min(this.audioBuffer.duration, this.audioStartOffset + elapsed)
  }

  /** Stop the current SAPI buffer and abort an in-flight WAV request. */
  stopSapiAudio() {
    if (this.audioAbort !== null) {
      this.audioAbort.abort()
      this.audioAbort = null
    }
    this.stopAudioSource()
    this.audioBuffer = null
    this.audioChunk = null
    this.audioPausedAt = null
    this.audioStartOffset = 0
    this.audioStartedAt = 0
  }

  /** Play a decoded sentence from an offset, preserving exact pause position. */
  async playAudioBuffer(buffer, offset, chunk, run) {
    const context = this.ensureAudioContext()
    await context.resume()
    if (run !== this.runId || this.snapshot.status !== 'speaking') return
    const playbackRate = this.provider === 'edge' ? 1 : this.rate
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = playbackRate
    source.connect(context.destination)
    const startOffset = Math.max(0, Math.min(offset, Math.max(0, buffer.duration - 0.01)))
    this.audioSource = source
    this.audioBuffer = buffer
    this.audioChunk = chunk
    this.audioStartOffset = startOffset
    this.audioStartedAt = context.currentTime
    this.audioPlaybackRate = playbackRate
    this.audioPausedAt = null
    source.onended = () => {
      if (run !== this.runId || this.audioSource !== source) return
      this.audioSource = null
      this.audioBuffer = null
      this.audioChunk = null
      this.audioPausedAt = null
      if (this.snapshot.status === 'paused') {
        this.pendingRestart = true
        return
      }
      this.paintFrom(chunk.end)
      this.index += 1
      if (this.index >= this.chunks.length) {
        this.finish()
        return
      }
      this.setSnapshot({ chunkIndex: this.index })
      const next = this.chunks[this.index]
      this.paintFrom(next.start)
      this.scrollToOffset(next.start)
      void this.speakSapi(next)
    }
    source.start(0, startOffset)
    if (context.state !== 'running') {
      this.setSnapshot({ status: 'paused', error: '浏览器阻止了自动播放，请点“继续”。' })
    }
  }

  /** Play one sentence through the SAPI WAV service. */
  async speakSapi(chunk) {
    if (chunk === undefined || this.hostBase === null) {
      this.fail('synthesis-unavailable', '本地语音服务不可用。')
      return
    }
    if (this.snapshot.status !== 'speaking') return
    const run = ++this.runId
    this.paintFrom(chunk.start)
    this.scrollToOffset(chunk.start)
    try {
      const wav = await this.fetchSapi(chunk.text)
      if (run !== this.runId) return
      const context = this.ensureAudioContext()
      const buffer = await context.decodeAudioData(wav)
      if (run !== this.runId) return
      if (this.snapshot.status !== 'speaking') {
        this.pendingRestart = true
        return
      }
      await this.playAudioBuffer(buffer, 0, chunk, run)
    } catch (error) {
      if (run !== this.runId) return
      if (error instanceof Error && error.name === 'AbortError') return
      console.warn('[read-aloud] SAPI speech failed', error)
      if (this.provider === 'edge') {
        const fallback = this.voices.find(voice => voice.provider === 'sapi'
          && String(voice.lang).toLowerCase().startsWith('zh'))
          ?? this.voices.find(voice => voice.provider === 'sapi')
        if (fallback !== undefined) {
          this.provider = 'sapi'
          this.voiceURI = fallback.voiceURI
          this.sapiVoice = fallback.voiceURI
          this.audioPausedAt = null
          this.audioBuffer = null
          this.audioChunk = null
          this.setSnapshot({
            engine: 'sapi',
            voiceURI: fallback.voiceURI,
            error: null,
            voiceNotice: `在线自然音色失败，已切换到本地音色：${fallback.name}`,
          })
          this.restartChunk()
          return
        }
      }
      this.fail(
        'synthesis-failed',
        `本地语音合成失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Speak the chunk at `this.index`, wiring every event to the current run. */
  speakCurrent() {
    if (this.backend === 'sapi') {
      void this.speakSapi(this.chunks[this.index])
      return
    }
    if (!this.supported || this.snapshot.status !== 'speaking') return
    const chunk = this.chunks[this.index]
    if (chunk === undefined) {
      this.finish()
      return
    }
    if (this.docModel !== null && !this.docModel.root.isConnected) {
      this.stop()
      return
    }

    const run = ++this.runId
    let utterance
    try {
      utterance = new this.win.SpeechSynthesisUtterance(chunk.text)
    } catch {
      this.fail('synthesis-unavailable')
      return
    }
    const candidates = this.voiceCandidates ?? this.buildVoiceCandidates()
    const candidate = candidates[this.voiceAttempt] ?? null
    this.activeCandidate = candidate
    if (candidate !== null) {
      utterance.voice = candidate
      utterance.lang = candidate.lang
    } else {
      utterance.lang = /[\u3400-\u9fff]/u.test(chunk.text) ? 'zh-CN' : 'en-US'
    }
    utterance.rate = this.rate
    utterance.pitch = 1
    utterance.volume = 1

    utterance.onstart = () => {
      if (run !== this.runId) return
      if (candidate !== null && candidate.voiceURI !== this.voiceURI) {
        this.voiceURI = candidate.voiceURI
        this.voicePreference = candidate.voiceURI
        writeStorage(this.storage, STORAGE_VOICE, candidate.voiceURI)
        this.setSnapshot({ voiceURI: candidate.voiceURI, voiceNotice: `已自动切换到可用音色：${candidate.name}` })
        this.resetVoiceCandidates()
      } else if (candidate === null && this.voiceURI !== '') {
        this.voiceURI = ''
        this.voicePreference = ''
        writeStorage(this.storage, STORAGE_VOICE, '')
        this.setSnapshot({ voiceURI: '', voiceNotice: '已切换到系统默认音色' })
        this.resetVoiceCandidates()
      }
      this.setSnapshot({ status: 'speaking' })
    }
    utterance.onboundary = (event) => {
      if (run !== this.runId) return
      const charIndex = Number(event?.charIndex ?? 0)
      const offset = Math.min(chunk.end, chunk.start + (Number.isFinite(charIndex) ? charIndex : 0))
      this.paintFrom(offset)
      this.maybeScroll(offset)
    }
    utterance.onend = () => {
      if (run !== this.runId) return
      this.paintFrom(chunk.end)
      this.index += 1
      if (this.index >= this.chunks.length) {
        this.finish()
        return
      }
      this.setSnapshot({ chunkIndex: this.index })
      const next = this.chunks[this.index]
      this.paintFrom(next.start)
      this.scrollToOffset(next.start)
      this.speakCurrent()
    }
    utterance.onerror = (event) => {
      if (run !== this.runId) return
      const code = String(event?.error ?? 'synthesis-failed')
      if (code === 'interrupted' || code === 'canceled') return
      console.warn('[read-aloud] speech failed', {
        code,
        voice: candidate?.name ?? 'system default',
        text: chunk.text.slice(0, 80),
      })
      if (code === 'synthesis-failed' || code === 'synthesis-unavailable') {
        this.retryVoice(code)
        return
      }
      this.fail(code)
    }

    this.utterance = utterance
    try {
      this.synth.speak(utterance)
    } catch (error) {
      console.warn('[read-aloud] speak() threw', error)
      this.retryVoice('synthesis-failed')
    }
  }

  /** Move to the next installed voice after a synthesis failure. */
  retryVoice(code) {
    const candidates = this.voiceCandidates ?? this.buildVoiceCandidates()
    const failed = this.activeCandidate
    this.voiceAttempt += 1
    if (this.voiceAttempt < candidates.length) {
      const next = candidates[this.voiceAttempt]
      this.cancelSpeech()
      const chunk = this.chunks[this.index]
      if (chunk !== undefined) this.paintFrom(chunk.start)
      this.setSnapshot({
        status: 'speaking',
        error: null,
        voiceNotice: `音色「${failed?.name ?? '系统默认'}」不可用，正在尝试「${next?.name ?? '系统默认'}」…`,
      })
      this.queueSpeak(120)
      return
    }
    const tried = candidates.map(candidate => candidate?.name ?? '系统默认').join('、')
    this.fail(
      code,
      `已尝试 ${candidates.length} 个音色仍失败：${tried}。请在 Windows「设置 → 时间和语言 → 语音」中安装或启用语音，或换一个音色。`,
    )
  }

  /** Cancel the engine's queue and invalidate every in-flight callback. */
  cancelSpeech() {
    this.runId += 1
    this.utterance = null
    this.stopSapiAudio()
    try {
      this.synth?.cancel()
    } catch {
      // cancel() can throw while the engine is shutting down.
    }
  }

  /** Re-speak the current sentence after a speed/voice change. */
  restartChunk() {
    if (this.snapshot.status !== 'speaking') {
      this.pendingRestart = true
      return
    }
    this.cancelSpeech()
    const chunk = this.chunks[this.index]
    if (chunk === undefined) {
      this.finish()
      return
    }
    this.paintFrom(chunk.start)
    if (this.backend === 'sapi') void this.speakSapi(chunk)
    else this.queueSpeak(60)
  }

  /** Delay speak() slightly; Chromium can drop a speak() issued inside cancel(). */
  queueSpeak(delay) {
    clearTimeout(this.speakTimer)
    this.speakTimer = setTimeout(() => {
      this.speakTimer = null
      if (this.snapshot.status === 'speaking') this.speakCurrent()
    }, delay)
  }

  /** Mark the reply finished, keeping the settings panel open. */
  finish() {
    const wasSelection = this.snapshot.selectionActive
    this.clearHighlight()
    this.detachFollow()
    this.utterance = null
    this.audioSource = null
    this.audioBuffer = null
    this.audioChunk = null
    this.audioPausedAt = null
    if (wasSelection) this.clearNativeSelection()
    this.selectionText = null
    this.setSnapshot({
      status: 'idle',
      chunkIndex: this.chunks.length,
      done: true,
      error: null,
      ...(wasSelection ? { selectionActive: false, selectionText: null } : {}),
    })
  }

  /** Stop on a real engine failure and surface a human-readable reason. */
  fail(code, detail) {
    const wasSelection = this.snapshot.selectionActive
    this.cancelSpeech()
    this.clearHighlight()
    this.detachFollow()
    this.index = 0
    this.setSnapshot({
      status: 'idle',
      chunkIndex: 0,
      done: false,
      error: detail ?? ERROR_TEXT[code] ?? `朗读失败（${code}）。`,
      ...(wasSelection ? { selectionActive: true, selectionText: this.selectionText } : {}),
    })
  }

  /** Paint every unread character blue, starting at `offset`. */
  paintFrom(offset) {
    if (!this.highlightSupported || this.docModel === null) return
    try {
      const ranges = this.docModel.ranges(offset)
      const highlight = new this.win.Highlight()
      for (const range of ranges) highlight.add(range)
      if (ranges.length === 0) this.win.CSS.highlights.delete(HIGHLIGHT_NAME)
      else this.win.CSS.highlights.set(HIGHLIGHT_NAME, highlight)
    } catch {
      // A failed paint is cosmetic; speech must continue.
    }
  }

  /** Remove the pending-text highlight. */
  clearHighlight() {
    if (!this.highlightSupported) return
    try {
      this.win.CSS.highlights.delete(HIGHLIGHT_NAME)
    } catch {
      // Ignore a teardown race.
    }
  }

  /** Scroll the current sentence into the middle third of the conversation. */
  scrollToOffset(offset) {
    if (!this.follow || this.docModel === null) return
    let point
    try {
      point = this.docModel.pointAt(offset)
    } catch {
      return
    }
    if (point === null) return
    const length = point.node.nodeValue?.length ?? 0
    if (length === 0) return
    const range = this.doc.createRange()
    range.setStart(point.node, point.offset)
    range.setEnd(point.node, Math.min(length, point.offset + 1))
    if (typeof range.getBoundingClientRect !== 'function') return
    let rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      rect = point.node.parentElement?.getBoundingClientRect() ?? rect
    }
    if (rect.width === 0 && rect.height === 0) return
    const port = this.scrollPort ?? findScrollParent(this.anchor, this.win, this.doc)
    if (port === null) return
    const portRect = port.getBoundingClientRect()
    if (portRect.height === 0) return
    const target = port.scrollTop + (rect.top - portRect.top) - portRect.height * 0.32
    const max = Math.max(0, port.scrollHeight - port.clientHeight)
    const top = Math.max(0, Math.min(target, max))
    if (Math.abs(top - port.scrollTop) < 8) return
    const reduceMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (typeof port.scrollTo === 'function') {
      port.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' })
    } else {
      port.scrollTop = top
    }
  }

  /** Follow the voice, but throttle boundary-driven scrolls to avoid jitter. */
  maybeScroll(offset) {
    if (!this.follow) return
    const now = Date.now()
    if (now - this.scrollTimer < 550) return
    this.scrollTimer = now
    this.scrollToOffset(offset)
  }

  /** Suspend auto-follow for a few seconds when the reader scrolls by hand. */
  attachFollow(anchor) {
    this.detachFollow()
    const port = findScrollParent(anchor, this.win, this.doc)
    if (port === null) return
    this.scrollPort = port
    this.onUserScroll = () => {
      this.follow = false
      clearTimeout(this.followTimer)
      this.followTimer = setTimeout(() => { this.follow = true }, 6000)
    }
    const target = port === this.doc.scrollingElement ? this.win : port
    target.addEventListener?.('wheel', this.onUserScroll, { passive: true })
    target.addEventListener?.('touchstart', this.onUserScroll, { passive: true })
  }

  /** Remove the reader-scroll listeners. */
  detachFollow() {
    if (this.onUserScroll !== null) {
      const target = this.scrollPort === this.doc.scrollingElement ? this.win : this.scrollPort
      target?.removeEventListener?.('wheel', this.onUserScroll)
      target?.removeEventListener?.('touchstart', this.onUserScroll)
    }
    clearTimeout(this.followTimer)
    this.followTimer = null
    this.onUserScroll = null
    this.scrollPort = null
  }

  /** Release every listener and stop speech. */
  dispose() {
    this.cancelSpeech()
    clearTimeout(this.speakTimer)
    this.speakTimer = null
    this.clearHighlight()
    this.detachFollow()
    this.hostProbeAbort?.abort()
    this.hostProbeAbort = null
    this.synth?.removeEventListener?.('voiceschanged', this.onVoicesChanged)
    if (this.beforeUnload !== null) this.win?.removeEventListener?.('beforeunload', this.beforeUnload)
    const context = this.audioContext
    this.audioContext = null
    if (context !== null) void context.close().catch(() => {})
    this.listeners.clear()
  }
}
