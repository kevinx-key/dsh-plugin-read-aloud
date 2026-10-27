import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { ReadAloudController } from '../src/controller.js'

const HTML = `
  <div id="flow">
    <div data-chat-flow-kind="assistant-step">
      <div data-variant="think">内部思考</div>
      <p>第一句。第二句！</p>
      <p>第三句？</p>
    </div>
    <div data-turn-tail="1"><button id="speaker">speaker</button></div>
  </div>
`

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.voice = null
    this.lang = ''
    this.rate = 1
    this.pitch = 1
    this.volume = 1
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

class FakeSynth {
  constructor(voices) {
    this.voices = voices
    this.spoken = []
    this.cancelled = 0
    this.paused = false
    this.resumed = 0
    this.speaking = false
    this.pending = false
    this.listeners = new Map()
  }

  getVoices() {
    return this.voices
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener)
  }

  removeEventListener(name) {
    this.listeners.delete(name)
  }

  speak(utterance) {
    this.spoken.push(utterance)
    this.speaking = true
    this.pending = false
  }

  cancel() {
    this.cancelled += 1
    this.speaking = false
    this.pending = false
  }

  pause() {
    this.paused = true
    this.speaking = false
  }

  resume() {
    this.paused = false
    this.resumed += 1
    this.speaking = true
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 60))

function harness() {
  const dom = new JSDOM(`<!doctype html><html><body>${HTML}</body></html>`, { url: 'http://localhost/' })
  const { window } = dom
  const voices = [
    { voiceURI: 'en-voice', name: 'English', lang: 'en-US', localService: true },
    { voiceURI: 'zh-voice', name: '中文', lang: 'zh-CN', localService: true },
    { voiceURI: 'zh2-voice', name: '中文二号', lang: 'zh-CN', localService: true },
  ]
  const synth = new FakeSynth(voices)
  window.speechSynthesis = synth
  window.SpeechSynthesisUtterance = FakeUtterance
  window.CSS = { highlights: new Map() }
  window.Highlight = FakeHighlight
  const controller = new ReadAloudController({
    window,
    document: window.document,
    storage: window.localStorage,
  })
  const anchor = window.document.querySelector('#speaker')
  return { dom, window, synth, controller, anchor }
}

test('controller selects a Chinese voice and exposes a stable snapshot', () => {
  const { controller } = harness()
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.supported, true)
  assert.equal(snapshot.highlightSupported, true)
  assert.equal(snapshot.voiceURI, 'zh-voice')
  assert.equal(snapshot.voices.length, 3)
  assert.equal(controller.currentVoice()?.voiceURI, 'zh-voice')
  assert.equal(controller.getSnapshot(), controller.getSnapshot())
  controller.dispose()
})

test('start paints all unread text, boundary shrinks it, end advances and finishes', async () => {
  const { controller, synth, anchor, window } = harness()
  assert.equal(controller.start('message-1', anchor), true)
  await settle()
  assert.equal(controller.getSnapshot().status, 'speaking')
  assert.equal(controller.getSnapshot().panelOpen, true)
  assert.equal(controller.getSnapshot().chunkCount, 3)
  assert.equal(synth.spoken.length, 1)
  assert.equal(synth.spoken[0].text, '第一句。')

  const highlight = window.CSS.highlights.get('dsh-read-aloud-pending')
  assert.ok(highlight)
  assert.equal(highlight.ranges[0].startOffset, 0)

  synth.spoken[0].onboundary({ charIndex: 2 })
  const afterBoundary = window.CSS.highlights.get('dsh-read-aloud-pending')
  assert.equal(afterBoundary.ranges[0].startOffset, 2)

  synth.spoken[0].onend()
  assert.equal(controller.getSnapshot().chunkIndex, 1)
  assert.equal(synth.spoken.length, 2)
  assert.equal(synth.spoken[1].text, '第二句！')

  synth.spoken[1].onend()
  assert.equal(controller.getSnapshot().chunkIndex, 2)
  assert.equal(synth.spoken[2].text, '第三句？')

  synth.spoken[2].onend()
  assert.equal(controller.getSnapshot().status, 'idle')
  assert.equal(controller.getSnapshot().done, true)
  assert.equal(window.CSS.highlights.has('dsh-read-aloud-pending'), false)
  controller.dispose()
})

test('pause and resume drive the engine and expose paused state', async () => {
  const { controller, synth, anchor } = harness()
  controller.start('message-1', anchor)
  await settle()
  controller.pause()
  assert.equal(controller.getSnapshot().status, 'paused')
  assert.equal(synth.paused, true)
  controller.resume()
  assert.equal(controller.getSnapshot().status, 'speaking')
  assert.equal(synth.resumed, 1)
  controller.dispose()
})

test('speed changes persist and restart the current sentence at the new rate', async () => {
  const { controller, synth, anchor, window } = harness()
  controller.start('message-1', anchor)
  const before = synth.spoken.length
  controller.setRate(1.5)
  assert.equal(controller.getSnapshot().rate, 1.5)
  assert.equal(window.localStorage.getItem('dsh.read-aloud.rate'), '1.5')
  await new Promise(resolve => setTimeout(resolve, 90))
  assert.ok(synth.spoken.length > before)
  assert.equal(synth.spoken.at(-1).rate, 1.5)
  assert.equal(synth.spoken.at(-1).text, '第一句。')
  controller.dispose()
})

test('voice changes switch the raw browser voice used by the next utterance', async () => {
  const { controller, synth, anchor } = harness()
  controller.setVoice('en-voice')
  assert.equal(controller.getSnapshot().voiceURI, 'en-voice')
  controller.start('message-1', anchor)
  await settle()
  assert.equal(synth.spoken[0].voice.voiceURI, 'en-voice')
  assert.equal(synth.spoken[0].lang, 'en-US')
  controller.dispose()
})

test('a failing voice falls back to the next installed voice and is promoted', async () => {
  const { controller, synth, anchor } = harness()
  controller.start('message-1', anchor)
  await settle()
  assert.equal(synth.spoken[0].voice.voiceURI, 'zh-voice')
  synth.spoken[0].onerror({ error: 'synthesis-failed' })
  await new Promise(resolve => setTimeout(resolve, 180))
  assert.equal(controller.getSnapshot().status, 'speaking')
  assert.match(controller.getSnapshot().voiceNotice, /正在尝试/)
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'zh2-voice')
  synth.spoken.at(-1).onstart()
  assert.equal(controller.getSnapshot().voiceURI, 'zh2-voice')
  assert.match(controller.getSnapshot().voiceNotice, /已自动切换/)
  controller.dispose()
})

test('when every voice fails it stops with a diagnostic instead of looping', async () => {
  const { controller, synth, anchor } = harness()
  controller.voiceObjects = []
  controller.voices = []
  controller.voiceURI = ''
  controller.voicePreference = ''
  controller.start('message-1', anchor)
  await settle()
  synth.spoken[0].onerror({ error: 'synthesis-failed' })
  await new Promise(resolve => setTimeout(resolve, 180))
  assert.equal(controller.getSnapshot().status, 'idle')
  assert.match(controller.getSnapshot().error, /已尝试 1 个音色/)
  controller.dispose()
})

test('stop clears the highlight and returns to idle', () => {
  const { controller, anchor, window } = harness()
  controller.start('message-1', anchor)
  controller.stop()
  assert.equal(controller.getSnapshot().status, 'idle')
  assert.equal(window.CSS.highlights.has('dsh-read-aloud-pending'), false)
  controller.dispose()
})

test('a blocked engine produces a readable error and clears the highlight', async () => {
  const { controller, synth, anchor, window } = harness()
  controller.start('message-1', anchor)
  await settle()
  synth.spoken[0].onerror({ error: 'not-allowed' })
  assert.equal(controller.getSnapshot().status, 'idle')
  assert.match(controller.getSnapshot().error, /浏览器阻止/)
  assert.equal(window.CSS.highlights.has('dsh-read-aloud-pending'), false)
  controller.dispose()
})

test('switching to an unspeakable reply cancels the previous one', async () => {
  const { controller, window, synth, anchor } = harness()
  controller.start('message-1', anchor)
  await settle()
  assert.equal(controller.getSnapshot().status, 'speaking')
  const root = window.document.querySelector('[data-chat-flow-kind="assistant-step"]')
  root.innerHTML = '<div data-variant="think">只有思考</div>'
  const started = controller.start('message-2', anchor)
  assert.equal(started, false)
  assert.equal(controller.getSnapshot().status, 'idle')
  assert.equal(controller.getSnapshot().activeMessageId, 'message-2')
  assert.equal(window.CSS.highlights.has('dsh-read-aloud-pending'), false)
  assert.ok(synth.cancelled > 0)
  controller.dispose()
})

test('a reply without speakable text reports an error instead of starting', () => {
  const { controller, window, synth, anchor } = harness()
  const root = window.document.querySelector('[data-chat-flow-kind="assistant-step"]')
  root.innerHTML = '<div data-variant="think">只有思考，没有正式答复</div>'
  const started = controller.start('message-empty', anchor)
  assert.equal(started, false)
  assert.match(controller.getSnapshot().error, /没有可朗读/)
  assert.equal(synth.spoken.length, 0)
  controller.dispose()
})
