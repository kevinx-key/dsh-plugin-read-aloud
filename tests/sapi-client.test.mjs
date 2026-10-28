import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { ReadAloudController } from '../src/controller.js'

const HTML = `
  <div id="flow" data-chat-flow="">
    <div class="flow-item">
      <div data-chat-flow-kind="assistant-step"><p>第一句。第二句！</p></div>
    </div>
    <div class="flow-item">
      <div data-turn-tail="1"><button id="speaker">speaker</button></div>
    </div>
  </div>
`

class FakeUtterance {
  constructor(text) { this.text = text }
}

class FakeSource {
  constructor(context) {
    this.context = context
    this.playbackRate = { value: 1 }
    this.onended = null
    this.started = false
    this.stopped = false
    this.startOffset = 0
  }

  connect() {}
  start(_when, offset = 0) {
    this.started = true
    this.startOffset = offset
  }
  stop() { this.stopped = true }
  disconnect() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running'
    this.currentTime = 0
    this.destination = {}
    this.sources = []
  }

  resume() { this.state = 'running'; return Promise.resolve() }
  suspend() { this.state = 'suspended'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  decodeAudioData() { return Promise.resolve({ duration: 10 }) }

  createBufferSource() {
    const source = new FakeSource(this)
    this.sources.push(source)
    return source
  }
}

const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))

const SAPI_VOICE = {
  name: 'Microsoft Huihui Desktop',
  displayName: 'Microsoft Huihui Desktop',
  culture: 'zh-CN',
  gender: 'Female',
  engine: 'sapi',
}

function harness(voices = [SAPI_VOICE], options = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${HTML}</body></html>`, { url: 'http://localhost/' })
  const { window } = dom
  window.SpeechSynthesisUtterance = FakeUtterance
  window.speechSynthesis = {
    getVoices: () => [],
    addEventListener() {},
    removeEventListener() {},
    speak() {},
    cancel() {},
    pause() {},
    resume() {},
  }
  window.AudioContext = FakeAudioContext
  const calls = []
  let edgeFailures = options.failEdgeOnce ? 1 : 0
  window.fetch = async (url, request = {}) => {
    calls.push({ url: String(url), options: request, body: request.body })
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({
        ok: true,
        plugin: 'dsh-plugin-read-aloud',
        engine: voices[0]?.engine ?? 'sapi',
        ready: true,
        voices,
        defaultVoice: voices[0]?.name ?? '',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).endsWith('/speak')) {
      const body = request.body === undefined ? {} : JSON.parse(request.body)
      if (body.engine === 'edge' && edgeFailures > 0) {
        edgeFailures -= 1
        return new Response(JSON.stringify({ ok: false, error: 'edge unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer, {
        status: 200,
        headers: { 'content-type': body.engine === 'edge' ? 'audio/mpeg' : 'audio/wav' },
      })
    }
    return new Response('not found', { status: 404 })
  }
  const controller = new ReadAloudController({
    window,
    document: window.document,
    storage: window.localStorage,
  })
  return { dom, window, controller, calls, anchor: window.document.querySelector('#speaker') }
}

test('SAPI backend adopts host voices and plays WAV sentences', async () => {
  const { controller, window, anchor, calls } = harness()
  await tick()
  assert.equal(controller.getSnapshot().engine, 'sapi')
  assert.equal(controller.getSnapshot().voiceURI, 'Microsoft Huihui Desktop')
  assert.equal(controller.getSnapshot().voices[0].name, 'Microsoft Huihui Desktop')

  assert.equal(controller.start('message-1', anchor), true)
  await tick()
  const context = controller.audioContext
  assert.ok(context)
  assert.equal(context.sources.length, 1)
  assert.equal(context.sources[0].started, true)
  assert.equal(controller.getSnapshot().status, 'speaking')
  assert.ok(calls.some(call => call.url.endsWith('/speak')))

  context.currentTime = 2.5
  controller.pause()
  assert.equal(controller.getSnapshot().status, 'paused')
  assert.equal(context.sources[0].stopped, true)
  assert.ok(Math.abs(controller.audioPausedAt - 2.5) < 0.01)

  controller.resume()
  await tick()
  assert.equal(controller.getSnapshot().status, 'speaking')
  assert.equal(context.sources.length, 2)
  assert.ok(Math.abs(context.sources[1].startOffset - 2.5) < 0.01)

  controller.setRate(1.5)
  assert.equal(context.sources[1].playbackRate.value, 1.5)

  context.sources[1].onended()
  await tick()
  assert.equal(controller.getSnapshot().chunkIndex, 1)
  assert.equal(context.sources.length, 3)

  controller.stop()
  assert.equal(controller.getSnapshot().status, 'idle')
  assert.equal(context.sources[2].stopped, true)
  assert.equal(window.CSS?.highlights?.has('dsh-read-aloud-pending') ?? false, false)
  controller.dispose()
})

const EDGE_VOICE = {
  name: 'zh-CN-XiaoxiaoNeural',
  displayName: 'Microsoft Xiaoxiao Online (Natural)',
  culture: 'zh-CN',
  gender: 'Female',
  engine: 'edge',
}

test('Edge backend uses natural voices and re-synthesizes on speed change', async () => {
  const { controller, anchor, calls } = harness([EDGE_VOICE, SAPI_VOICE])
  await tick()
  assert.equal(controller.getSnapshot().engine, 'edge')
  assert.equal(controller.getSnapshot().voiceURI, 'zh-CN-XiaoxiaoNeural')

  controller.start('message-1', anchor)
  await tick()
  const context = controller.audioContext
  assert.equal(controller.getSnapshot().status, 'speaking')
  assert.equal(context.sources[0].playbackRate.value, 1)
  const firstSpeak = calls.find(call => call.url.endsWith('/speak'))
  assert.equal(JSON.parse(firstSpeak.body).engine, 'edge')
  assert.equal(JSON.parse(firstSpeak.body).rate, 1)

  controller.setRate(1.5)
  await tick()
  assert.equal(context.sources.length, 2)
  const lastSpeak = calls.filter(call => call.url.endsWith('/speak')).at(-1)
  assert.equal(JSON.parse(lastSpeak.body).rate, 1.5)
  assert.equal(context.sources[1].playbackRate.value, 1)

  controller.setRate(3)
  await tick()
  assert.equal(context.sources.length, 3)
  const fastestSpeak = calls.filter(call => call.url.endsWith('/speak')).at(-1)
  assert.equal(JSON.parse(fastestSpeak.body).rate, 2)
  assert.ok(Math.abs(context.sources[2].playbackRate.value - 1.5) < 0.001)
  controller.dispose()
})

test('selected text uses the same audio pipeline, pause offset and completion', async () => {
  const { controller, anchor } = harness()
  await tick()
  assert.equal(controller.speakSelection('第一句。第二句！'), true)
  await tick()
  assert.equal(controller.getSnapshot().selectionActive, true)
  assert.equal(controller.getSnapshot().activeMessageId, null)
  assert.equal(controller.getSnapshot().chunkCount, 2)
  const context = controller.audioContext
  assert.equal(context.sources.length, 1)

  context.currentTime = 1.25
  controller.pause()
  assert.ok(Math.abs(controller.audioPausedAt - 1.25) < 0.01)
  controller.resume()
  await tick()
  assert.ok(Math.abs(context.sources[1].startOffset - 1.25) < 0.01)
  context.sources[1].onended()
  await tick()
  assert.equal(controller.getSnapshot().chunkIndex, 1)
  context.sources[2].onended()
  await tick()
  assert.equal(controller.getSnapshot().selectionActive, false)
  assert.equal(controller.getSnapshot().status, 'idle')
  controller.dispose()
})

test('an Edge failure falls back to the local SAPI voice', async () => {
  const { controller, anchor, calls } = harness([EDGE_VOICE, SAPI_VOICE], { failEdgeOnce: true })
  await tick()
  controller.start('message-1', anchor)
  await tick()
  assert.equal(controller.getSnapshot().engine, 'sapi')
  assert.equal(controller.getSnapshot().voiceURI, 'Microsoft Huihui Desktop')
  assert.match(controller.getSnapshot().voiceNotice, /已切换到本地音色/)
  const lastSpeak = calls.filter(call => call.url.endsWith('/speak')).at(-1)
  assert.equal(JSON.parse(lastSpeak.body).engine, 'sapi')
  assert.equal(controller.audioContext.sources.length, 1)
  controller.dispose()
})
