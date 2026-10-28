import assert from 'node:assert/strict'
import test from 'node:test'
import { SapiSpeechService } from '../lib/index.js'

/** Edge Read Aloud occasionally drops a turn; retry once before failing. */
async function speakEdge(url, body) {
  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`${url}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.status === 200) return response
    await response.text().catch(() => '')
    await new Promise(resolve => setTimeout(resolve, 800))
  }
  return response
}

test('speech service lists Edge/SAPI voices and returns playable audio', { timeout: 180_000 }, async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows SAPI only')
    return
  }
  const service = new SapiSpeechService({ ports: [18866, 18867, 18868, 18869] })
  t.after(async () => { await service.stop() })
  await service.start()
  assert.equal(service.workerReady, true, service.workerError ?? 'SAPI worker should become ready')
  assert.ok(service.port !== null)
  assert.ok(service.voices.some(voice => voice.engine === 'sapi' && voice.name.includes('Desktop')))
  if (service.edgeReady) {
    assert.ok(service.voices.some(voice => voice.engine === 'edge'))
    assert.equal(service.defaultVoice, 'zh-CN-XiaoxiaoNeural')
  }

  const health = await fetch(`http://127.0.0.1:${service.port}/health`).then(response => response.json())
  assert.equal(health.ready, true)
  assert.equal(health.engines.sapi, true)
  assert.ok(health.voices.length > 0)

  const preflight = await fetch(`http://127.0.0.1:${service.port}/speak`, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://127.0.0.1:8169',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
      'access-control-request-private-network': 'true',
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8169')
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true')
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)

  const sapiVoice = health.voices.find(voice => voice.engine === 'sapi' && voice.culture.startsWith('zh'))
  const sapiResponse = await fetch(`http://127.0.0.1:${service.port}/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '这是一段本地语音测试。', voice: sapiVoice.name, engine: 'sapi' }),
  })
  assert.equal(sapiResponse.status, 200)
  assert.equal(sapiResponse.headers.get('content-type'), 'audio/wav')
  const wav = Buffer.from(await sapiResponse.arrayBuffer())
  assert.ok(wav.length > 1000)
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF')

  if (health.engines.edge) {
    const edgeVoice = health.voices.find(voice => voice.engine === 'edge' && voice.culture.startsWith('zh'))
    const edgeResponse = await speakEdge(`http://127.0.0.1:${service.port}`, {
      text: '这是一段 <自然> & 语音测试。',
      voice: edgeVoice.name,
      engine: 'edge',
      rate: 1.25,
    })
    if (edgeResponse.status !== 200 || edgeResponse.headers.get('content-type') !== 'audio/mpeg') {
      t.diagnostic('Edge Read Aloud is unavailable right now; SAPI path was still validated')
      return
    }
    const mp3 = Buffer.from(await edgeResponse.arrayBuffer())
    assert.ok(mp3.length > 1000)
    assert.equal(mp3[0], 0xff)

    const slowResponse = await speakEdge(`http://127.0.0.1:${service.port}`, {
      text: '语速测试。',
      voice: edgeVoice.name,
      engine: 'edge',
      rate: 0.5,
    })
    if (slowResponse.status !== 200 || slowResponse.headers.get('content-type') !== 'audio/mpeg') {
      t.diagnostic('Edge Read Aloud became unavailable during the speed check')
      return
    }
    const slow = await slowResponse.arrayBuffer()
    const fastResponse = await speakEdge(`http://127.0.0.1:${service.port}`, {
      text: '语速测试。',
      voice: edgeVoice.name,
      engine: 'edge',
      rate: 2,
    })
    if (fastResponse.status !== 200 || fastResponse.headers.get('content-type') !== 'audio/mpeg') {
      t.diagnostic('Edge Read Aloud became unavailable during the speed check')
      return
    }
    const fast = await fastResponse.arrayBuffer()
    assert.ok(slow.byteLength > 1000)
    assert.ok(fast.byteLength > 1000)
    assert.ok(fast.byteLength < slow.byteLength * 0.6, `rate 2 should be much shorter: ${fast.byteLength} vs ${slow.byteLength}`)
  }
})
