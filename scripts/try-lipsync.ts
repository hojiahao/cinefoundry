// Lip-sync trial: one still with a speaker, one spoken line, one 5-second LTX shot against it.
import { ComfyClient } from '../src/comfy/client.js'
import { generateImage, generateVideo } from '../src/lib/media.js'

const [still, line, out, ...words] = process.argv.slice(2)
const comfy = new ComfyClient(process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188')
const prompt = words.join(' ')
if (!process.env.SKIP_IMAGE) {
  const image = await generateImage(comfy, { prompt: process.env.IMAGE_PROMPT!, size: '1920x1088', output: still! })
  console.log('still', image.seconds.toFixed(1), 's')
}
const video = await generateVideo(comfy, { prompt, output: out!, resolution: '1080p', ratio: '16:9', durationSeconds: 5, firstFrame: still, model: 'ltx25-fast-nvfp4', dialogue: { audio: line! } })
console.log('video', video.seconds.toFixed(1), 's', JSON.stringify(video.detail))
