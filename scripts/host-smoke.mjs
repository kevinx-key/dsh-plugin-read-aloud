import { SapiSpeechService } from '../lib/index.js'

const service = new SapiSpeechService({ ports: [18866, 18867, 18868] })
await service.start()
console.log('port=', service.port, 'ready=', service.workerReady, 'error=', service.workerError)
console.log('voices=', JSON.stringify(service.voices))
console.log('default=', service.defaultVoice)
if (service.port !== null) {
  const health = await fetch(`http://127.0.0.1:${service.port}/health`).then(response => response.json())
  console.log('health=', JSON.stringify(health))
  const speak = await fetch(`http://127.0.0.1:${service.port}/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '这是一段语音测试。', voice: service.defaultVoice }),
  })
  const wav = Buffer.from(await speak.arrayBuffer())
  console.log('speak=', speak.status, speak.headers.get('content-type'), wav.length, wav.subarray(0, 4).toString())
  console.log('wav fmt=', wav.readUInt16LE(20), 'channels=', wav.readUInt16LE(22), 'rate=', wav.readUInt32LE(24), 'bits=', wav.readUInt16LE(34))
}
await service.stop()
