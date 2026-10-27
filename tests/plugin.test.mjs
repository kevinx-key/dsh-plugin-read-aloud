import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const HTML = `
  <div id="flow">
    <div data-chat-flow-kind="assistant-step"><p>你好，世界。</p></div>
    <div data-turn-tail="1"><button id="speaker">speaker</button></div>
  </div>
`

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.onstart = null
    this.onboundary = null
    this.onend = null
    this.onerror = null
  }
}

class FakeHighlight {
  constructor() {
    this.ranges = []
  }

  add(range) {
    this.ranges.push(range)
  }
}

function installBrowserGlobals() {
  const dom = new JSDOM(`<!doctype html><html><body>${HTML}</body></html>`, { url: 'http://localhost/' })
  const { window } = dom
  window.speechSynthesis = {
    voices: [{ voiceURI: 'zh', name: '中文', lang: 'zh-CN', localService: true }],
    getVoices() { return this.voices },
    addEventListener() {},
    removeEventListener() {},
    speak() {},
    cancel() {},
    pause() {},
    resume() {},
    speaking: false,
    pending: false,
  }
  window.SpeechSynthesisUtterance = FakeUtterance
  window.CSS = { highlights: new Map() }
  window.Highlight = FakeHighlight
  globalThis.window = window
  globalThis.document = window.document
  return dom
}

function fakeRequire() {
  const react = {
    useEffect() {},
    useLayoutEffect() {},
    useRef() { return { current: null } },
    useState(value) { return [value, () => {}] },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    createElement() { return null },
  }
  return (id) => {
    if (id === 'react') return react
    if (id === 'react-dom') return { createPortal: value => value }
    if (id === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    if (id === 'react/jsx-runtime') return { jsx() {}, jsxs() {}, Fragment: Symbol('Fragment') }
    throw new Error(`unexpected require(${id})`)
  }
}

test('host half exports an apply body', async () => {
  const host = await import('../lib/index.js')
  assert.equal(typeof host.apply, 'function')
  assert.equal(host.apply({ effect() {} }), undefined)
})

test('client bundle registers exactly one assistant action and injects the controller', async () => {
  const dom = installBrowserGlobals()
  let captured = null
  dom.window.__ModuleLoader__ = {
    load(definition) {
      captured = definition.factory(fakeRequire())
    },
  }
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  // eslint-disable-next-line no-new-func -- executing the built loader envelope in a jsdom environment.
  new Function('window', 'document', 'require', code)(dom.window, dom.window.document, fakeRequire())

  assert.equal(captured?.inject?.length, 1)
  assert.equal(captured.inject[0], 'slots')

  const registrations = []
  const cleanups = []
  const ctx = {
    effect(factory) {
      cleanups.push(factory())
    },
    slots: {
      inject(name, factory) {
        assert.equal(name, 'conversation.chat.assistant-actions')
        cleanups.push(factory())
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  captured.apply(ctx)
  assert.equal(registrations.length, 1)
  const { options, component } = registrations[0]
  assert.equal(options.name, 'conversation.chat.assistant-actions')
  assert.equal(options.id, 'read-aloud')
  assert.equal(options.order, 5)
  assert.equal(typeof component, 'function')

  const face = options.inject('session-1')
  assert.equal(typeof face.hooks.readAloud.getSnapshot, 'function')
  assert.equal(face.hooks.readAloud.getSnapshot().voiceURI, 'zh')
  for (const key of ['start', 'pause', 'resume', 'stop', 'restart', 'setRate', 'setVoice', 'refreshVoices', 'openPanel', 'closePanel']) {
    assert.equal(typeof face[key], 'function', `${key} should be injected`)
  }

  const style = dom.window.document.querySelector('style[data-read-aloud-style="dsh-plugin-read-aloud"]')
  assert.ok(style !== null)
  assert.match(style.textContent, /::highlight\(dsh-read-aloud-pending\)/)

  for (const cleanup of cleanups) {
    if (typeof cleanup === 'function') cleanup()
  }
  assert.equal(dom.window.document.querySelector('style[data-read-aloud-style="dsh-plugin-read-aloud"]'), null)
})
