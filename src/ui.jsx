/**
 * Browser UI: the speaker entry in the assistant action strip and its
 * speed/voice popover. All speech state arrives through the controller's
 * `useReadAloud` selector hook; components never touch `speechSynthesis`.
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

const PANEL_MARGIN = 12

/** Speaker with two arcs; arcs pulse while the reply is being spoken. */
function SpeakerIcon({ active = false }) {
  return (
    <svg className="dsr-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 6.05h2.15L7.1 3.55a.55.55 0 0 1 .9.43v8.04a.55.55 0 0 1-.9.43L4.15 9.95H2a.65.65 0 0 1-.65-.65V6.7A.65.65 0 0 1 2 6.05Z"
        fill="currentColor"
      />
      <path
        className="dsr-wave dsr-wave-1"
        d="M10.05 5.35a3.2 3.2 0 0 1 0 5.3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity={active ? undefined : 0.55}
      />
      <path
        className="dsr-wave dsr-wave-2"
        d="M11.85 3.8a5.45 5.45 0 0 1 0 8.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity={active ? undefined : 0.35}
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3.2 2.1 9.7 6l-6.5 3.9V2.1Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.6" y="2" width="2.5" height="8" rx="0.6" fill="currentColor" />
      <rect x="6.9" y="2" width="2.5" height="8" rx="0.6" fill="currentColor" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1" fill="currentColor" />
    </svg>
  )
}

function RestartIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.2 6.1a5 5 0 1 1 .7 3.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path d="M2.05 2.9v3.35H5.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m2.6 2.6 6.8 6.8M9.4 2.6 2.6 9.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

/** Small settings glyph used in the panel title. */
function TuneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4h5.2M10.2 4H12M2 10h1.8M6.8 10H12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="8.7" cy="4" r="1.35" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="5.3" cy="10" r="1.35" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

/**
 * Global overlay: the selection context menu and the compact floating player
 * for selected-text playback. Mounted once by the client plugin.
 * @param {object} props - controller instance.
 */
export function ReadAloudGlobal({ controller }) {
  const state = useSyncExternalStore(
    listener => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  )
  const [menu, setMenu] = useState(null)
  const rangeRef = useRef(null)

  useEffect(() => {
    const onContextMenu = (event) => {
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (text === '' || selection === null || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const node = range.commonAncestorContainer
      const element = node.nodeType === 1 ? node : node.parentElement
      if (element === null) return
      if (!element.closest('[data-conversation-scroll], [data-chat-flow]')) return
      if (element.closest('textarea, input, [contenteditable="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      rangeRef.current = range.cloneRange()
      setMenu({ x: event.clientX, y: event.clientY, text })
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => { document.removeEventListener('contextmenu', onContextMenu, true) }
  }, [])

  useEffect(() => {
    const onShortcut = (event) => {
      if (!event.altKey || event.key.toLowerCase() !== 'r') return
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (text === '' || selection === null || selection.rangeCount === 0) return
      const node = selection.getRangeAt(0).commonAncestorContainer
      const element = node.nodeType === 1 ? node : node.parentElement
      if (element === null || element.closest('textarea, input, [contenteditable="true"]') !== null) return
      if (!element.closest('[data-conversation-scroll], [data-chat-flow]')) return
      event.preventDefault()
      controller.speakSelection(text)
    }
    document.addEventListener('keydown', onShortcut)
    return () => { document.removeEventListener('keydown', onShortcut) }
  }, [controller])

  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event) => {
      if (event.target?.closest?.('[data-read-aloud-menu]')) return
      setMenu(null)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenu(null)
    }
    const onResize = () => { setMenu(null) }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [menu])

  const speakSelection = () => {
    const range = rangeRef.current
    if (range !== null) {
      try {
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      } catch {
        // The message may have re-rendered since the selection was captured.
      }
    }
    controller.speakSelection(menu.text)
    setMenu(null)
  }

  const copySelection = () => {
    void navigator.clipboard?.writeText(menu.text).catch(() => {})
    setMenu(null)
  }

  const left = menu === null ? 0 : Math.max(8, Math.min(menu.x, window.innerWidth - 178))
  const top = menu === null ? 0 : Math.max(8, Math.min(menu.y, window.innerHeight - 104))

  return (
    <>
      {menu !== null && (
        <div
          className="dsr-menu"
          data-read-aloud-menu="true"
          role="menu"
          aria-label="选中文字操作"
          style={{ left, top }}
        >
          <button type="button" className="dsr-menu-item" role="menuitem" onClick={speakSelection}>
            <span className="dsr-menu-icon"><SpeakerIcon /></span>
            朗读
          </button>
          <button type="button" className="dsr-menu-item" role="menuitem" onClick={copySelection}>
            <span className="dsr-menu-icon"><CopyIcon /></span>
            复制
          </button>
        </div>
      )}
      {state.selectionActive && <SelectionPlayer controller={controller} state={state} />}
    </>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4.2" y="1.8" width="7.5" height="8.5" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 4.2H2.6A1.4 1.4 0 0 0 1.2 5.6v6.2A1.4 1.4 0 0 0 2.6 13.2h6.2a1.4 1.4 0 0 0 1.4-1.4V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Compact transport shown while selected text is being read. */
function SelectionPlayer({ controller, state }) {
  const speaking = state.status === 'speaking'
  const paused = state.status === 'paused'
  const status = state.error !== null
    ? state.error
    : speaking
      ? `正在朗读 · ${Math.min(state.chunkIndex + 1, state.chunkCount)}/${state.chunkCount}`
      : paused
        ? '已暂停'
        : '已停止'
  const rates = [0.75, 1, 1.25, 1.5, 2]
  const nextRate = rates[(rates.indexOf(state.rate) + 1) % rates.length] ?? 1
  return (
    <div className="dsr-mini" role="status">
      <span className="dsr-mini-title" title={state.selectionText ?? ''}>朗读选中文字</span>
      <span className="dsr-mini-status" title={status}>{status}</span>
      <div className="dsr-mini-actions">
        <button
          type="button"
          className="dsr-mini-btn dsr-mini-primary"
          onClick={() => {
            if (speaking) controller.pause()
            else if (paused) controller.resume()
            else controller.restart()
          }}
          disabled={state.chunkCount === 0}
        >
          {speaking ? <PauseIcon /> : <PlayIcon />}
          {speaking ? '暂停' : paused ? '继续' : '重读'}
        </button>
        <button type="button" className="dsr-mini-btn" onClick={() => controller.stop()}>停止</button>
        <button
          type="button"
          className="dsr-mini-btn dsr-mini-rate"
          onClick={() => controller.setRate(nextRate)}
          title="切换语速"
        >
          {state.rate.toFixed(2).replace(/\.?0+$/u, '')}×
        </button>
      </div>
    </div>
  )
}

/** Build `{ zh, en, other }` groups without depending on locale services. */
function groupVoices(voices) {
  const groups = { zh: [], en: [], other: [] }
  for (const voice of voices) {
    const lang = voice.lang.toLowerCase()
    if (lang.startsWith('zh')) groups.zh.push(voice)
    else if (lang.startsWith('en')) groups.en.push(voice)
    else groups.other.push(voice)
  }
  return groups
}

function voiceLabel(voice) {
  const suffix = voice.provider === 'edge'
    ? ' · 在线自然'
    : voice.provider === 'sapi'
      ? ' · 本地'
      : voice.localService === false ? ' · 在线' : ''
  return `${voice.name}（${voice.lang}${suffix}）`
}

/**
 * The assistant action-strip entry.
 * @param {object} props - slot props plus the controller's injected verbs.
 */
export function ReadAloudAction({
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
  closePanel,
}) {
  const buttonRef = useRef(null)
  const active = useReadAloud(state => state.activeMessageId === messageId)
  const status = useReadAloud(state => state.activeMessageId === messageId ? state.status : 'idle')
  const panelOpen = useReadAloud(state => state.panelOpen && state.activeMessageId === messageId)
  const supported = useReadAloud(state => state.supported)
  const error = useReadAloud(state => state.activeMessageId === messageId ? state.error : null)

  const speaking = status === 'speaking'
  const paused = status === 'paused'
  const label = !supported
    ? '当前环境不支持语音朗读'
    : speaking
      ? '暂停朗读'
      : paused
        ? '继续朗读'
        : '朗读这条回复'

  const onClick = () => {
    const element = buttonRef.current
    if (element === null) return
    if (speaking) {
      openPanel()
      pause()
      return
    }
    if (paused) {
      openPanel()
      resume()
      return
    }
    start(messageId, element)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="dsr-action"
        data-read-aloud-anchor="true"
        data-active={active || panelOpen ? 'true' : undefined}
        data-speaking={speaking ? 'true' : undefined}
        aria-label={label}
        aria-pressed={speaking}
        title={error ?? label}
        disabled={!supported}
        onClick={onClick}
      >
        <SpeakerIcon active={active} />
      </button>
      {panelOpen && (
        <ReadAloudPanel
          messageId={messageId}
          anchorRef={buttonRef}
          useReadAloud={useReadAloud}
          closePanel={closePanel}
          pause={pause}
          resume={resume}
          stop={stop}
          restart={restart}
          setRate={setRate}
          setVoice={setVoice}
          refreshVoices={refreshVoices}
        />
      )}
    </>
  )
}

/**
 * Anchored speed/voice popover. It is deliberately non-modal: the reader can
 * keep scrolling the transcript while it is open.
 */
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
  refreshVoices,
}) {
  const state = useReadAloud(snapshot => snapshot)
  const panelRef = useRef(null)
  const positioned = useRef(false)
  const [position, setPosition] = useState({ left: -9999, top: -9999, ready: false })
  const [rateDraft, setRateDraft] = useState(state.rate)

  useEffect(() => { setRateDraft(state.rate) }, [state.rate])

  // Measure once, at open. Re-measuring on every sentence would make the panel
  // chase the action strip as auto-scroll moves it down the transcript.
  useLayoutEffect(() => {
    if (positioned.current) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (anchor === null || panel === null) return
    const rect = anchor.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const width = panel.offsetWidth || 322
    const height = panel.offsetHeight || 324
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const center = rect.left + rect.width / 2
    let left = center - width / 2
    left = Math.max(PANEL_MARGIN, Math.min(left, viewportWidth - width - PANEL_MARGIN))
    let top = rect.top - height - 10
    if (top < PANEL_MARGIN) top = rect.bottom + 10
    top = Math.max(PANEL_MARGIN, Math.min(top, viewportHeight - height - PANEL_MARGIN))
    positioned.current = true
    setPosition({ left, top, ready: true })
  })

  useEffect(() => {
    const onResize = () => {
      positioned.current = false
      setPosition(previous => ({ ...previous, ready: false }))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    const onPointerDown = (event) => {
      const target = event.target
      if (panelRef.current?.contains(target)) return
      if (target?.closest?.('[data-read-aloud-anchor]')) return
      closePanel()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePanel()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closePanel])

  const speaking = state.status === 'speaking'
  const paused = state.status === 'paused'
  const done = state.status === 'idle' && state.done
  const hasDocument = state.chunkCount > 0
  const progress = state.chunkCount === 0
    ? 0
    : Math.max(0, Math.min(100, Math.round((state.chunkIndex / state.chunkCount) * 100)))
  const groups = groupVoices(state.voices)
  const statusText = state.error !== null
    ? '朗读遇到问题'
    : speaking
      ? '正在朗读'
      : paused
        ? '已暂停'
        : done
          ? '朗读完成'
          : '准备朗读'

  const onPrimary = () => {
    if (speaking) pause()
    else if (paused) resume()
    else restart()
  }

  const commitRate = () => {
    if (rateDraft !== state.rate) setRate(rateDraft)
  }

  return createPortal(
    <div
      ref={panelRef}
      className="dsr-panel"
      data-read-aloud-panel="true"
      data-message-id={messageId}
      role="dialog"
      aria-label="朗读设置"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
    >
      <div className="dsr-head">
        <span className="dsr-title">
          <span className="dsr-title-icon"><TuneIcon /></span>
          朗读设置
        </span>
        <button type="button" className="dsr-close" aria-label="关闭朗读设置" onClick={closePanel}>
          <CloseIcon />
        </button>
      </div>

      <div className="dsr-status">
        <span className="dsr-status-main">
          <span className="dsr-dot" data-live={speaking ? 'true' : undefined} />
          <span>{statusText}</span>
        </span>
        <span>{hasDocument ? `${Math.min(state.chunkIndex + 1, state.chunkCount)} / ${state.chunkCount} 句` : '—'}</span>
      </div>
      <div className="dsr-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

      <div className="dsr-controls">
        <button
          type="button"
          className="dsr-btn dsr-btn-primary"
          onClick={onPrimary}
          disabled={!hasDocument}
          aria-label={speaking ? '暂停' : paused ? '继续' : '开始朗读'}
        >
          {speaking ? <PauseIcon /> : <PlayIcon />}
          {speaking ? '暂停' : paused ? '继续' : done ? '重读' : '播放'}
        </button>
        <button
          type="button"
          className="dsr-btn dsr-btn-icon"
          onClick={stop}
          disabled={!speaking && !paused}
          aria-label="停止朗读"
          title="停止朗读"
        >
          <StopIcon />
        </button>
        <button
          type="button"
          className="dsr-btn dsr-btn-icon"
          onClick={restart}
          disabled={!hasDocument}
          aria-label="从头朗读"
          title="从头朗读"
        >
          <RestartIcon />
        </button>
      </div>

      <div className="dsr-row">
        <span className="dsr-label">语速</span>
        <input
          className="dsr-range"
          type="range"
          min="0.5"
          max="2"
          step="0.25"
          value={rateDraft}
          aria-label="朗读速度"
          onChange={event => setRateDraft(Number(event.target.value))}
          onPointerUp={commitRate}
          onKeyUp={commitRate}
          onBlur={commitRate}
        />
        <span className="dsr-rate">{rateDraft.toFixed(2).replace(/\.?0+$/u, '')}×</span>
      </div>
      <div className="dsr-chips">
        {[0.75, 1, 1.25, 1.5, 2].map(value => (
          <button
            key={value}
            type="button"
            className="dsr-chip"
            data-current={state.rate === value ? 'true' : undefined}
            onClick={() => setRate(value)}
            aria-label={`${value} 倍速`}
          >
            {value}×
          </button>
        ))}
      </div>

      <div className="dsr-voice-row">
        <span className="dsr-label">音色</span>
        <select
          className="dsr-select"
          value={state.voiceURI}
          aria-label="朗读音色"
          onChange={event => setVoice(event.target.value)}
          disabled={state.voices.length === 0}
        >
          <option value="">系统默认（跟随文本语言）</option>
          {groups.zh.length > 0 && (
            <optgroup label="中文">
              {groups.zh.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
            </optgroup>
          )}
          {groups.en.length > 0 && (
            <optgroup label="English">
              {groups.en.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
            </optgroup>
          )}
          {groups.other.length > 0 && (
            <optgroup label="其他">
              {groups.other.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" className="dsr-refresh" onClick={refreshVoices} title="重新读取系统音色">
          刷新
        </button>
      </div>

      <div className="dsr-note">
        {state.engine === 'edge'
          ? 'Microsoft Edge 在线自然语音（文字会发送给 Microsoft）'
          : state.engine === 'sapi'
            ? '本地 SAPI 语音引擎（离线合成，不联网）'
            : state.hostState === 'probing'
              ? '正在连接本地语音引擎…'
              : '浏览器语音引擎'}
      </div>
      {state.voiceError !== null && <div className="dsr-note">{state.voiceError}</div>}
      {state.voiceNotice !== null && <div className="dsr-note dsr-notice">{state.voiceNotice}</div>}
      {state.engine === 'browser' && state.hostState === 'unavailable' && state.hostError !== null && (
        <div className="dsr-note">{state.hostError}</div>
      )}
      {state.error !== null && <div className="dsr-error" role="status">{state.error}</div>}
      {!state.highlightSupported && (
        <div className="dsr-note">当前环境不支持文本高亮，朗读仍可正常进行。</div>
      )}
      <div className="dsr-note">蓝色背景表示尚未朗读的文字，读到后会逐段清除。拖动或滚轮手动滚动时，自动跟随会暂时让位。</div>
    </div>,
    document.body,
  )
}
