import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Stand-in for ComfyUI's HTTP API. Renders the requested size with ffmpeg so downstream ffmpeg steps run for real:
 * a still for an image graph, a clip of `clipSeconds` (default 1) for a video graph, a tone of the requested length for
 * an audio graph (ACE-Step music).
 */
export function startFakeComfy(options: { clipSeconds?: number } = {}): Promise<{ url: string; graphs: Array<Record<string, any>>; freed: () => number; close: () => void }> {
  const graphs: Array<Record<string, any>> = []
  const jobs = new Map<string, Record<string, any>>()
  let freed = 0
  const scratch = mkdtempSync(join(tmpdir(), 'fake-comfy-'))

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake')
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const json = (body: unknown) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
      if (url.pathname === '/upload/image') return json({ name: `upload_${jobs.size}_${Date.now()}.png`, subfolder: '' })
      if (url.pathname === '/free') { freed++; return json({}) }
      if (url.pathname === '/prompt') {
        const graph = JSON.parse(Buffer.concat(chunks).toString()).prompt
        const id = `job${jobs.size}`
        jobs.set(id, graph); graphs.push(graph)
        return json({ prompt_id: id })
      }
      if (url.pathname.startsWith('/history/')) {
        const id = url.pathname.split('/').pop()!
        const kind = outputKind(jobs.get(id)!)
        const file = { filename: `${id}.${kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png'}`, subfolder: '', type: 'output' }
        return json({ [id]: { status: { completed: true, status_str: 'success' }, outputs: { out: kind === 'audio' ? { audio: [file] } : { images: [file] } } } })
      }
      if (url.pathname === '/view') {
        const filename = url.searchParams.get('filename')!
        const job = filename.split('.')[0]!
        const graph = jobs.get(job)!
        // Every job renders different pixels and sound, so a regenerated asset differs from the one it replaces.
        const n = Number(job.replace(/\D/g, '')) || 0
        // A graph without a size (frame interpolation works on an uploaded clip) renders a small clip at the graph's frame rate.
        const size = Object.values(graph).map((node: any) => node.inputs).find((inputs: any) => 'width' in inputs) ?? { width: 352, height: 640 }
        const rate = Object.values(graph).find((node: any) => node.class_type === 'CreateVideo')?.inputs?.fps ?? 24
        const output = join(scratch, filename)
        if (filename.endsWith('.mp3')) {
          const seconds = Object.values(graph).map((node: any) => node.inputs?.seconds).find((value) => typeof value === 'number') ?? 3
          execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${220 + (n % 40) * 11}:duration=${seconds}`, '-ac', '2', output])
        } else {
          const colour = `0x${((n * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`
          const source = filename.endsWith('.mp4') ? `testsrc=s=${size.width}x${size.height}:d=${options.clipSeconds ?? 1}:r=${rate},hue=h=${(n * 47) % 360}` : `color=c=${colour}:s=${size.width}x${size.height}`
          execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, ...(filename.endsWith('.mp4') ? ['-pix_fmt', 'yuv420p'] : ['-frames:v', '1']), output])
        }
        response.writeHead(200); response.end(readFileSync(output))
        return
      }
      response.writeHead(404); response.end()
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number }
    resolve({ url: `http://127.0.0.1:${port}`, graphs, freed: () => freed, close: () => server.close() })
  }))
}

function outputKind(graph: Record<string, any>): 'video' | 'audio' | 'image' {
  const classes = Object.values(graph).map((node: any) => String(node.class_type))
  if (classes.includes('SaveVideo')) return 'video'
  if (classes.some((name) => name.startsWith('SaveAudio'))) return 'audio'
  return 'image'
}
