/**
 * Host half: a loopback-only speech bridge with two engines.
 *
 * - Edge Read Aloud: Microsoft's natural Chinese/English neural voices. Text
 *   is sent to Microsoft for this engine (clearly labelled in the UI).
 * - SAPI5: fully local fallback using the working Desktop voices.
 *
 * Chromium's speechSynthesis is avoided entirely: on this Windows build it
 * advertises OneCore voices but fails every speak(). The browser half reads
 * audio from this service and plays it through Web Audio.
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const WORKER_SCRIPT = join(__dirname, 'worker.ps1')
const MAX_BODY_BYTES = 32 * 1024
const MAX_TEXT_LENGTH = 600
const BASE_PORT = Number(process.env.DSH_READ_ALOUD_PORT) || 18766
const PORTS = Array.from({ length: 12 }, (_, index) => BASE_PORT + index)
const EDGE_DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
const EDGE_VOICES_TIMEOUT_MS = 3500
const EDGE_AUDIO_TIMEOUT_MS = 30_000

/** Locate a usable PowerShell executable without relying on PATH order. */
function resolvePowerShell() {
  const candidates = [
    process.env.DSH_PWSH,
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'powershell.exe'
}

/** Escape text before inserting it into Edge's SSML template. */
function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Read and parse a small JSON request body. */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

/** A local SAPI5 service with a persistent PowerShell synthesis worker. */
export class SapiSpeechService {
  constructor(options = {}) {
    this.ports = options.ports ?? PORTS
    this.server = null
    this.port = null
    this.tempDir = null
    this.worker = null
    this.workerReady = false
    this.workerStarting = null
    this.workerError = null
    this.pending = new Map()
    this.sequence = 0
    this.sapiVoices = []
    this.voices = []
    this.defaultVoice = ''
    this.edge = null
    this.edgeVoices = []
    this.edgeReady = false
    this.edgeStarting = null
    this.edgeError = null
    this.edgeMetadataVoice = ''
    this.startupDone = false
    this.stopped = false
  }

  /** Start the HTTP listener and the PowerShell worker. */
  async start() {
    if (this.stopped) return
    this.tempDir = await mkdtemp(join(tmpdir(), 'dsh-read-aloud-'))
    if (this.stopped) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {})
      this.tempDir = null
      return
    }
    try {
      await this.startServer()
    } catch (error) {
      this.workerError = error instanceof Error ? error.message : String(error)
      return
    }
    if (this.stopped) {
      await this.stop()
      return
    }
    await Promise.allSettled([this.ensureSapi(), this.ensureEdge()])
    this.startupDone = true
  }

  /** Initialize the local SAPI worker without rejecting the whole startup. */
  async ensureSapi() {
    try {
      await this.ensureWorker()
      this.workerError = null
    } catch (error) {
      this.workerError = error instanceof Error ? error.message : String(error)
      console.warn('[read-aloud] SAPI worker unavailable:', this.workerError)
    }
  }

  /** Initialize Microsoft Edge's natural neural voices. Failure is non-fatal. */
  async ensureEdge() {
    if (this.stopped) return
    if (this.edgeReady) return
    if (this.edgeStarting !== null) return this.edgeStarting
    this.edgeStarting = (async () => {
      const tts = new MsEdgeTTS({
        connectionTimeoutMs: EDGE_VOICES_TIMEOUT_MS,
        synthesisTimeoutMs: EDGE_AUDIO_TIMEOUT_MS,
      })
      this.edge = tts
      let timer
      try {
        const voices = await Promise.race([
          tts.getVoices(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Edge voice list timed out')), EDGE_VOICES_TIMEOUT_MS)
            timer.unref?.()
          }),
        ])
        const unique = new Map()
        for (const voice of voices) {
          if (!/^(zh|en)/iu.test(String(voice.Locale ?? ''))) continue
          unique.set(voice.ShortName, voice)
        }
        if (this.stopped) {
          try { tts.close() } catch {}
          return
        }
        this.edgeVoices = [...unique.values()]
        this.edgeReady = true
        this.edgeError = null
        this.rebuildVoices()
      } finally {
        clearTimeout(timer)
      }
    })().catch((error) => {
      this.edgeError = error instanceof Error ? error.message : String(error)
      this.edgeReady = false
      try { this.edge?.close() } catch {}
      this.edge = null
      this.rebuildVoices()
    }).finally(() => {
      this.edgeStarting = null
    })
    return this.edgeStarting
  }

  /** Combine Edge and SAPI voices, preferring Xiaoxiao for the default. */
  rebuildVoices() {
    const edge = this.edgeVoices.map(voice => ({
      name: voice.ShortName,
      displayName: voice.FriendlyName || voice.ShortName,
      culture: voice.Locale,
      gender: voice.Gender,
      engine: 'edge',
    }))
    const sapi = this.sapiVoices.map(voice => ({
      name: voice.name,
      displayName: voice.name,
      culture: voice.culture,
      gender: voice.gender,
      engine: 'sapi',
    }))
    this.voices = [...edge, ...sapi]
    const preferred = edge.find(voice => voice.name === EDGE_DEFAULT_VOICE)
      ?? edge.find(voice => String(voice.culture).toLowerCase().startsWith('zh'))
      ?? sapi.find(voice => String(voice.culture).toLowerCase().startsWith('zh'))
      ?? this.voices[0]
    this.defaultVoice = preferred?.name ?? ''
  }

  /** Bind the first free loopback port in the configured range. */
  async startServer() {
    for (const port of this.ports) {
      const server = createServer((request, response) => {
        void this.handle(request, response)
      })
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '127.0.0.1')
        })
        this.server = server
        this.port = port
        return
      } catch {
        try { server.close() } catch {}
      }
    }
    throw new Error('no free loopback port for the read-aloud SAPI service')
  }

  /** Route one HTTP request. */
  async handle(request, response) {
    this.writeCors(response, request)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port ?? 0}`)
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        this.writeJson(response, 200, {
          ok: true,
          plugin: 'dsh-plugin-read-aloud',
          engine: this.edgeReady ? 'edge' : this.workerReady ? 'sapi' : 'none',
          engines: { edge: this.edgeReady, sapi: this.workerReady },
          port: this.port,
          ready: this.startupDone && (this.workerReady || this.edgeReady),
          startupDone: this.startupDone,
          edgePending: this.edgeStarting !== null,
          error: [this.edgeError, this.workerError].filter(Boolean).join('; ') || null,
          voices: this.voices,
          defaultVoice: this.defaultVoice,
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/voices') {
        await Promise.allSettled([this.ensureSapi(), this.ensureEdge()])
        this.startupDone = true
        this.writeJson(response, 200, {
          ok: true,
          engines: { edge: this.edgeReady, sapi: this.workerReady },
          voices: this.voices,
          defaultVoice: this.defaultVoice,
          error: [this.edgeError, this.workerError].filter(Boolean).join('; ') || null,
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/speak') {
        const body = await readJsonBody(request)
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text === '') throw new Error('text is required')
        if (text.length > MAX_TEXT_LENGTH) throw new Error('text is too long')
        const voice = typeof body.voice === 'string' ? body.voice : ''
        const rate = Math.max(0.5, Math.min(2, Number(body.rate) || 1))
        const requested = body.engine === 'sapi' ? 'sapi' : 'edge'
        const useEdge = requested === 'edge' && this.edgeReady
        const audio = useEdge
          ? await this.synthesizeEdge(text, voice, rate)
          : await this.synthesizeSapi(text, voice)
        response.writeHead(200, {
          'content-type': useEdge ? 'audio/mpeg' : 'audio/wav',
          'content-length': audio.length,
          'cache-control': 'no-store',
          'x-read-aloud-engine': useEdge ? 'edge' : 'sapi',
        })
        response.end(audio)
        return
      }
      this.writeJson(response, 404, { ok: false, error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.writeJson(response, 503, { ok: false, error: message })
    }
  }

  /** Send CORS and Private Network Access preflight headers. */
  writeCors(response, request) {
    const origin = request.headers.origin
    response.setHeader('access-control-allow-origin', typeof origin === 'string' ? origin : '*')
    response.setHeader('vary', 'Origin')
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('access-control-allow-private-network', 'true')
  }

  /** Write a JSON response. */
  writeJson(response, status, value) {
    const body = Buffer.from(JSON.stringify(value), 'utf8')
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
    })
    response.end(body)
  }

  /** Spawn the worker once and ask it for its SAPI voice roster. */
  async ensureWorker() {
    if (this.stopped) return
    if (this.workerReady) return
    if (this.workerStarting !== null) return this.workerStarting
    this.workerStarting = (async () => {
      const command = resolvePowerShell()
      const child = spawn(command, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        WORKER_SCRIPT,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.worker = child
      const lines = createInterface({ input: child.stdout })
      lines.on('line', line => this.onWorkerLine(line))
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (text) => {
        const message = String(text).trim()
        if (message !== '') console.warn('[read-aloud] powershell:', message.slice(0, 500))
      })
      child.on('error', (error) => {
        if (this.worker === child) this.failWorker(error)
      })
      child.on('exit', (code, signal) => {
        if (this.worker === child) this.failWorker(new Error(`SAPI worker exited (${code ?? signal ?? 'unknown'})`))
      })
      const result = await this.request({ cmd: 'voices' }, 20_000)
      if (result.ok !== true) throw new Error(String(result.error ?? 'voice discovery failed'))
      const listed = Array.isArray(result.voices) ? result.voices : [result.voices]
      const installed = listed.filter(voice => voice !== null && typeof voice === 'object')
      this.sapiVoices = await this.probeVoices(installed)
      if (this.stopped) {
        try { child.kill() } catch {}
        return
      }
      if (this.sapiVoices.length === 0) throw new Error('no usable SAPI voice')
      this.workerReady = true
      this.workerError = null
      this.rebuildVoices()
    })().finally(() => {
      this.workerStarting = null
    })
    return this.workerStarting
  }

  /** Handle one worker response line. */
  onWorkerLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    pending.resolve(message)
  }

  /** Reject in-flight work and forget a dead worker. */
  failWorker(error) {
    if (this.stopped) return
    this.workerReady = false
    this.worker = null
    this.workerError = error instanceof Error ? error.message : String(error)
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  /** Send one command to the worker and await its response. */
  request(payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = this.worker
      if (child === null || child.stdin === null || !child.stdin.writable) {
        reject(new Error('SAPI worker is not running'))
        return
      }
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('SAPI worker timed out'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`, (error) => {
        if (error === null || error === undefined) return
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        clearTimeout(pending.timer)
        pending.reject(error)
      })
    })
  }

  /**
   * Ask the worker to synthesize one short probe per installed voice and keep
   * only the voices that actually work. SAPI lists the OneCore voices too, but
   * SelectVoice/Speak for them fails with "voice was disabled".
   */
  async probeVoices(installed) {
    const usable = []
    for (const voice of installed) {
      try {
        const probe = String(voice.culture ?? '').toLowerCase().startsWith('zh') ? '测试' : 'test'
        const output = await this.requestSpeech(probe, voice.name, 12_000)
        await unlink(output).catch(() => {})
        usable.push(voice)
      } catch (error) {
        console.warn(`[read-aloud] SAPI voice skipped: ${voice.name} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    return usable
  }

  /** Synthesize one sentence to a temp WAV file and return its path. */
  async requestSpeech(text, voice, timeoutMs) {
    const id = ++this.sequence
    const output = join(this.tempDir, `${id}.wav`)
    const result = await this.request({
      cmd: 'speak',
      text,
      voice,
      out: output,
    }, timeoutMs)
    if (result.ok !== true) {
      await unlink(output).catch(() => {})
      throw new Error(String(result.error ?? 'speech synthesis failed'))
    }
    return output
  }

  /** Synthesize one sentence into a WAV buffer. */
  async synthesizeSapi(text, voice) {
    await this.ensureWorker()
    const selected = this.sapiVoices.some(candidate => candidate.name === voice)
      ? voice
      : (this.sapiVoices.find(candidate => String(candidate.culture).toLowerCase().startsWith('zh'))
        ?? this.sapiVoices[0])?.name
    if (selected === undefined) throw new Error('no usable SAPI voice')
    const output = await this.requestSpeech(text, selected, 40_000)
    try {
      return await readFile(output)
    } finally {
      await unlink(output).catch(() => {})
    }
  }

  /** Synthesize one sentence with Microsoft Edge's natural neural voices. */
  async synthesizeEdge(text, voice, rate) {
    await this.ensureEdge()
    if (!this.edgeReady || this.edge === null) {
      throw new Error(this.edgeError ?? 'Edge TTS is unavailable')
    }
    const selected = this.edgeVoices.some(candidate => candidate.ShortName === voice)
      ? voice
      : (this.edgeVoices.find(candidate => String(candidate.Locale).toLowerCase().startsWith('zh'))?.ShortName
        ?? EDGE_DEFAULT_VOICE)
    try {
      if (this.edgeMetadataVoice !== selected) {
        await this.edge.setMetadata(selected, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
        this.edgeMetadataVoice = selected
      }
      const { audioStream } = this.edge.toStream(escapeXml(text), { rate })
      const chunks = []
      await new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          audioStream.destroy?.()
          reject(new Error('Edge TTS timed out'))
        }, EDGE_AUDIO_TIMEOUT_MS)
        const finish = (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) {
            audioStream.destroy?.()
            reject(error)
          } else {
            resolve()
          }
        }
        audioStream.on('data', chunk => chunks.push(Buffer.from(chunk)))
        audioStream.on('end', () => finish(null))
        audioStream.on('error', error => finish(error))
      })
      if (chunks.length === 0) throw new Error('Edge TTS returned no audio')
      return Buffer.concat(chunks)
    } catch (error) {
      this.edgeError = error instanceof Error ? error.message : String(error)
      this.edgeReady = false
      try { this.edge?.close() } catch {}
      this.edge = null
      this.edgeMetadataVoice = ''
      throw error
    }
  }

  /** Stop the server, kill the worker, and remove temp files. */
  async stop() {
    if (this.stopped && this.server === null && this.worker === null && this.tempDir === null) return
    this.stopped = true
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('SAPI service stopped'))
      this.pending.delete(id)
    }
    const child = this.worker
    this.worker = null
    this.workerReady = false
    if (child !== null) {
      try { child.stdin?.end() } catch {}
      try { child.kill() } catch {}
    }
    const edge = this.edge
    this.edge = null
    this.edgeReady = false
    this.edgeStarting = null
    try { edge?.close() } catch {}
    const server = this.server
    this.server = null
    if (server !== null) {
      await new Promise(resolve => server.close(() => resolve()))
    }
    if (this.tempDir !== null) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {})
      this.tempDir = null
    }
  }
}

/**
 * Host plugin body: start the loopback SAPI service for the lifetime of the
 * plugin fiber.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  const service = new SapiSpeechService()
  ctx.effect(() => {
    void service.start()
    return () => { void service.stop() }
  }, 'read-aloud: local SAPI service')
}
