import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Stand-in for ComfyUI's HTTP API. Renders the requested size with ffmpeg so downstream ffmpeg steps run for real. */
export function startFakeComfy(): Promise<{ url: string; graphs: Array<Record<string, any>>; freed: () => number; close: () => void }> {
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
        const isVideo = Object.values(jobs.get(id)!).some((node: any) => node.class_type === 'SaveVideo')
        return json({ [id]: { status: { completed: true, status_str: 'success' }, outputs: { out: { images: [{ filename: `${id}.${isVideo ? 'mp4' : 'png'}`, subfolder: '', type: 'output' }] } } } })
      }
      if (url.pathname === '/view') {
        const filename = url.searchParams.get('filename')!
        const graph = jobs.get(filename.split('.')[0]!)!
        // A graph without a size (frame interpolation works on an uploaded clip) renders a small clip at the graph's frame rate.
        const size = Object.values(graph).map((node: any) => node.inputs).find((inputs: any) => 'width' in inputs) ?? { width: 352, height: 640 }
        const rate = Object.values(graph).find((node: any) => node.class_type === 'CreateVideo')?.inputs?.fps ?? 24
        const output = join(scratch, filename)
        const source = filename.endsWith('.mp4') ? `testsrc=s=${size.width}x${size.height}:d=1:r=${rate}` : `color=c=teal:s=${size.width}x${size.height}`
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, ...(filename.endsWith('.mp4') ? ['-pix_fmt', 'yuv420p'] : ['-frames:v', '1']), output])
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
