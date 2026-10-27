import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  buildSpeechDoc,
  findAssistantRoot,
  normalizeText,
  splitIntoChunks,
} from '../src/doc.js'

function domFrom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`)
}

test('normalizeText collapses whitespace and maps every character back', () => {
  const result = normalizeText('  foo   bar\n')
  assert.equal(result.text, 'foo bar')
  assert.equal(result.map.length, result.text.length)
  assert.equal('  foo   bar\n'[result.map[0]], 'f')
  assert.equal('  foo   bar\n'[result.map[4]], 'b')
})

test('buildSpeechDoc keeps prose, drops reasoning and controls, and separates blocks', () => {
  const dom = domFrom(`
    <div id="flow">
      <div data-chat-flow-kind="assistant-step">
        <div data-variant="think"><span>内部思考不应朗读</span></div>
        <p>第一段，<strong>加粗</strong>内容。</p>
        <p>第二段！</p>
        <ul><li>条目一</li><li>条目二</li></ul>
        <button>复制</button>
        <pre><code>const x = 1</code></pre>
      </div>
      <div data-turn-tail="1"><button id="speaker">speaker</button></div>
    </div>
  `)
  const { document } = dom.window
  const root = document.querySelector('[data-chat-flow-kind="assistant-step"]')
  const model = buildSpeechDoc(root)

  assert.ok(model.text.includes('第一段，加粗内容。'))
  assert.ok(model.text.includes('第二段！'))
  assert.ok(model.text.includes('条目一\n条目二'))
  assert.ok(model.text.includes('const x = 1'))
  assert.ok(!model.text.includes('内部思考'))
  assert.ok(!model.text.includes('复制'))
  assert.ok(model.text.includes('\n'))

  const all = model.ranges(0)
  assert.ok(all.length >= 3)
  assert.equal(model.ranges(model.text.length).length, 0)

  const firstChunk = splitIntoChunks(model.text)[0]
  const point = model.pointAt(firstChunk.start)
  assert.ok(point !== null)
  assert.equal(point.node.nodeValue[point.offset], '第')
})

test('splitIntoChunks handles Chinese and English sentences and preserves offsets', () => {
  const text = '第一句。第二句！第三句？ Hello world. This is a test.'
  const chunks = splitIntoChunks(text)
  assert.ok(chunks.length >= 5)
  for (const chunk of chunks) {
    assert.equal(chunk.text, text.slice(chunk.start, chunk.end))
    assert.ok(chunk.text.length <= 90)
  }
  assert.ok(chunks.some(chunk => chunk.text === '第一句。'))
  assert.ok(chunks.some(chunk => chunk.text.includes('Hello world.')))
})

test('splitIntoChunks splits oversized Chinese prose without losing characters', () => {
  const text = `${'这是一段很长的说明，'.repeat(40)}结束。`
  const chunks = splitIntoChunks(text)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.text.length <= 90))
  assert.equal(chunks.map(chunk => chunk.text).join(''), text)
})

test('splitIntoChunks rejects punctuation-only text', () => {
  assert.deepEqual(splitIntoChunks('……！？——'), [])
})

test('findAssistantRoot picks the last assistant row before the turn tail', () => {
  const dom = domFrom(`
    <div id="flow" data-chat-flow="">
      <div class="flow-item">
        <div data-chat-flow-kind="assistant-step" data-chat-turn="1">older</div>
      </div>
      <div class="flow-item" data-chat-group-key="g">
        <div data-step-process-content>
          <div data-chat-flow-kind="assistant-step" data-chat-turn="1">closing</div>
        </div>
      </div>
      <div class="flow-item">
        <div data-turn-tail="1"><button id="speaker">speaker</button></div>
      </div>
      <div class="flow-item">
        <div data-chat-flow-kind="assistant-step" data-chat-turn="2">later turn</div>
      </div>
    </div>
  `)
  const { document } = dom.window
  const anchor = document.querySelector('#speaker')
  const root = findAssistantRoot(anchor)
  assert.equal(root?.textContent, 'closing')
})
