import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ReadAloudAction, ReadAloudGlobal } from '../src/ui.jsx'

function mount(state, overrides = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)
  const calls = []
  const props = {
    messageId: 'message-1',
    useReadAloud: selector => selector(state),
    start: (...args) => calls.push(['start', ...args]),
    pause: () => calls.push(['pause']),
    resume: () => calls.push(['resume']),
    stop: () => calls.push(['stop']),
    restart: () => calls.push(['restart']),
    setRate: value => calls.push(['setRate', value]),
    setVoice: value => calls.push(['setVoice', value]),
    refreshVoices: () => calls.push(['refreshVoices']),
    openPanel: () => calls.push(['openPanel']),
    closePanel: () => calls.push(['closePanel']),
    ...overrides,
  }
  act(() => {
    root.render(React.createElement(ReadAloudAction, props))
  })
  return { dom, container, root, calls, props }
}

const baseState = {
  supported: true,
  highlightSupported: true,
  engine: 'browser',
  hostState: 'unavailable',
  hostError: null,
  status: 'idle',
  activeMessageId: null,
  panelOpen: false,
  rate: 1,
  voiceURI: 'zh',
  voices: [{ voiceURI: 'zh', name: '中文', lang: 'zh-CN', localService: true }],
  voiceError: null,
  voiceNotice: null,
  error: null,
  chunkIndex: 0,
  chunkCount: 3,
  done: false,
}

test('speaker action renders idle and starts playback with its own button', () => {
  const { container, calls, root } = mount(baseState)
  const button = container.querySelector('button[data-read-aloud-anchor]')
  assert.ok(button !== null)
  assert.equal(button.getAttribute('aria-label'), '朗读这条回复')
  act(() => { button.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(calls[0][0], 'start')
  assert.equal(calls[0][1], 'message-1')
  assert.equal(calls[0][2], button)
  act(() => root.unmount())
})

test('speaking speaker pauses and opens the settings panel', () => {
  const { container, calls, root } = mount({ ...baseState, status: 'speaking', activeMessageId: 'message-1' })
  const button = container.querySelector('button[data-read-aloud-anchor]')
  assert.equal(button.getAttribute('aria-label'), '暂停朗读')
  act(() => { button.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(calls, [['openPanel'], ['pause']])
  act(() => root.unmount())
})

test('settings panel exposes speed, voice, transport and closes on Escape', () => {
  const { dom, calls, root } = mount({ ...baseState, status: 'speaking', activeMessageId: 'message-1', panelOpen: true })
  const panel = dom.window.document.querySelector('[data-read-aloud-panel]')
  assert.ok(panel !== null)
  assert.match(panel.textContent, /朗读设置/)
  assert.match(panel.textContent, /语速/)
  assert.match(panel.textContent, /音色/)
  const range = panel.querySelector('input[type="range"]')
  assert.equal(range.value, '1')
  assert.equal(range.max, '3')
  const voice = panel.querySelector('select')
  assert.equal(voice.value, 'zh')
  assert.ok(panel.querySelector('button[aria-label="停止朗读"]'))

  const chip = [...panel.querySelectorAll('.dsr-chip')].find(button => button.textContent === '1.5×')
  act(() => { chip.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(calls.some(call => call[0] === 'setRate' && call[1] === 1.5))
  const fastChip = [...panel.querySelectorAll('.dsr-chip')].find(button => button.textContent === '3×')
  act(() => { fastChip.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(calls.some(call => call[0] === 'setRate' && call[1] === 3))

  act(() => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.ok(calls.some(call => call[0] === 'closePanel'))
  act(() => root.unmount())
})

test('right-click selection menu offers copy and read-aloud for the selected text', () => {
  const dom = new JSDOM('<!doctype html><html><body><div data-chat-flow><p id="selected">选中文字测试</p></div></body></html>', {
    url: 'http://localhost/',
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const state = { ...baseState, selectionActive: false, selectionText: null, status: 'idle' }
  const calls = []
  const controller = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    speakSelection: text => { calls.push(text); return true },
    pause() {},
    resume() {},
    stop() {},
    restart() {},
    setRate() {},
  }
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(React.createElement(ReadAloudGlobal, { controller })) })

  const paragraph = dom.window.document.querySelector('#selected')
  const range = dom.window.document.createRange()
  range.selectNodeContents(paragraph)
  const selection = dom.window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)

  const event = new dom.window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 120,
  })
  act(() => { paragraph.dispatchEvent(event) })
  assert.equal(event.defaultPrevented, true)
  const menu = dom.window.document.querySelector('[data-read-aloud-menu]')
  assert.ok(menu !== null)
  assert.match(menu.textContent, /朗读/)
  assert.match(menu.textContent, /复制/)
  assert.deepEqual(
    [...menu.querySelectorAll('button')].map(button => button.textContent.trim()),
    ['复制', '朗读'],
  )

  const readButton = [...menu.querySelectorAll('button')].find(button => button.textContent.includes('朗读'))
  act(() => { readButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(calls, ['选中文字测试'])
  assert.equal(dom.window.document.querySelector('[data-read-aloud-menu]'), null)
  act(() => root.unmount())
})
