import { JSDOM } from 'jsdom'
import { SapiSpeechService } from '../lib/index.js'
import { ReadAloudController } from '../src/controller.js'

const HTML = `
  <div id="flow" data-chat-flow="">
    <div class="flow-item"><div data-chat-flow-kind="assistant-step"><p>第一句。第二句！</p></div></div>
    <div class="flow-item"><div data-turn-tail="1"><button id="speaker">speaker</button></div></div>
  </div>
`

class FakeSource {
  constructor() {
    this.playbackRate = { value: 1 }
    this.onended = null
    this.started = false
  }
  connect() {}
  start() { this.started = true }
  stop() {}
  disconnect() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running'
    this.destination = {}
    this.sources = []
  }
  resume() { this.state = 'running'; return Promise.resolve() }
  suspend() { this.state = 'suspended'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  decodeAudioData() { return Promise.resolve({ duration: 1 }) }
  createBufferSource() {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
}

const service = new SapiSpeechService({ ports: [18766] })
await service.start()
if (!service.workerReady) throw new Error(`host not ready: ${service.workerError}`)
console.log('host', service.port, service.voices.map(voice => voice.name))

const dom = new JSDOM(`<!doctype html><html><body>${HTML}</body></html>`, { url: 'http://localhost/' })
const { window } = dom
window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
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
window.CSS = { highlights: new Map() }
window.Highlight = class { constructor() { this.ranges = [] } add(range) { this.ranges.push(range) } }
window.fetch = (url, options) => fetch(url, options)

const controller = new ReadAloudController({
  window,
  document: window.document,
  storage: window.localStorage,
})
await new Promise(resolve => setTimeout(resolve, 4000))
console.log('engine', controller.getSnapshot().engine, 'voice', controller.getSnapshot().voiceURI)
if (!['edge', 'sapi'].includes(controller.getSnapshot().engine)) throw new Error('client did not adopt host')

const anchor = window.document.querySelector('#speaker')
controller.start('message-1', anchor)
await new Promise(resolve => setTimeout(resolve, 2500))
console.log('status', controller.getSnapshot().status, 'chunk', controller.getSnapshot().chunkIndex, 'sources', controller.audioContext?.sources.length)
if (controller.audioContext?.sources.length !== 1 || !controller.audioContext.sources[0].started) {
  throw new Error('no audio source started')
}
controller.dispose()
await service.stop()
console.log('OK')
