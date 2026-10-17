import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INTERPOLATION_MODEL, VIDEO_MODELS } from '../src/lib/media.js'
import { aria2Args, aria2Entry, downloadTarget, linkSnapshot, writeRef } from '../src/setup/download.js'
import { entriesFor, siblingHash, type HubRevision } from '../src/setup/hf.js'
import { DEFAULT_FEATURES, downloadUrl, featuresFor, installedPath, loadManifest, selectFiles, storagePath, validateManifest, type Feature, type Manifest, type ModelFile } from '../src/setup/manifest.js'
import { childEnv, curlProxyArgs } from '../src/setup/net.js'
import { assessPlatform, ffmpegHasLibass, hasNotoCjk, parseCdiDevices, parseDfAvail, parseNvidiaSmi, parseVersion, rootFixes, type PlatformFacts } from '../src/setup/platform.js'
import { checkoutCommands, githubUrl, imagePlans, parseEnvFile, registryMirrors, renderSparkEnv, voiceBuildCommands } from '../src/setup/stack.js'
import { gitBlobOid, sha256File, VerifyCache, verifyFile } from '../src/setup/verify.js'
import { allModelRefs, checkWorkflows, loadWorkflows, placeholderCandidates } from '../src/setup/workflows.js'

const manifest = loadManifest()
const tmp = () => mkdtempSync(join(tmpdir(), 'cf-install-'))
const comfyKey = (folder: string, filename: string) => `comfyui/${folder}/${filename}`

describe('model manifest', () => {
  it('is structurally valid: unique ids and destinations, a pinned revision, exactly one content hash per file', () => {
    expect(validateManifest(manifest)).toEqual([])
    expect(manifest.files.every((file) => file.sha256 || file.gitOid)).toBe(true)
    // Weights are LFS files: they are identified by sha256, never by a git id or a size.
    for (const file of manifest.files.filter((f) => /\.(safetensors|pth|pt|bin|gguf)$/.test(f.filename) && f.size > 1e6)) expect(file.sha256, file.id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects files without a hash, with two hashes, with a bad revision or escaping the model root', () => {
    const good = manifest.files.find((file) => file.sha256 && file.source.type === 'hf')!
    const broken = (patch: Partial<ModelFile>): Manifest => ({ ...manifest, files: [{ ...good, ...patch } as ModelFile] })
    expect(validateManifest(broken({ sha256: undefined }))).toContainEqual(expect.stringContaining('exactly one of sha256 or gitOid'))
    expect(validateManifest(broken({ gitOid: 'a'.repeat(40) }))).toContainEqual(expect.stringContaining('exactly one of sha256 or gitOid'))
    expect(validateManifest(broken({ sha256: 'ABC' }))).toContainEqual(expect.stringContaining('64 lowercase hex'))
    expect(validateManifest(broken({ target: '../etc' }))).toContainEqual(expect.stringContaining('relative directory'))
    expect(validateManifest(broken({ source: { type: 'hf', repo: 'a/b', revision: 'main', path: 'x' } }))).toContainEqual(expect.stringContaining('40-hex commit'))
    expect(validateManifest(broken({ size: 0 }))).toContainEqual(expect.stringContaining('size'))
    expect(validateManifest({ ...manifest, files: [good, good] })).toContainEqual(expect.stringContaining('duplicate id'))
  })

  it('holds every model file every workflow can load, in the folder its loader reads', () => {
    const files = new Set(manifest.files.filter((file) => file.layout === 'file').map((file) => `${file.target}/${file.filename}`))
    const refs = allModelRefs()
    expect(refs.length).toBeGreaterThan(20)
    for (const ref of refs) expect(files.has(comfyKey(ref.folder, ref.filename)), `${ref.workflow} node ${ref.node}: ${ref.folder}/${ref.filename}`).toBe(true)
  })

  it('holds no ComfyUI file that no workflow loads', () => {
    const referenced = new Set(allModelRefs().map((ref) => comfyKey(ref.folder, ref.filename)))
    for (const file of manifest.files.filter((f) => f.target.startsWith('comfyui/'))) expect(referenced.has(`${file.target}/${file.filename}`), file.id).toBe(true)
  })

  it('resolves the placeholders the code fills: both LTX transformers and the RIFE model', () => {
    expect(placeholderCandidates('ltx25_fast_i2v').unet_name!.sort()).toEqual(['ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', 'ltx-2.5-22b-distilled-transformer-nvfp4.safetensors'])
    expect(placeholderCandidates('rife_interpolate').model).toEqual([INTERPOLATION_MODEL])
  })

  it('holds every model the compose stack serves, in the layout vLLM reads', () => {
    const compose = readFileSync('deploy/spark/compose.yaml', 'utf8')
    const services = compose.split(/\n {2}(?=[\w-]+:\n)/).slice(1)
    for (const service of services) {
      const models = [...service.matchAll(/--(?:speculative_config\.)?model=(\S+)/g)].map((match) => match[1]!)
      for (const model of models) {
        if (model.startsWith('/super/')) {
          const target = `nemotron-super-vl/${model.slice('/super/'.length)}`
          expect(manifest.files.some((file) => file.target === target && file.features.includes('super-vl')), target).toBe(true)
        } else {
          const files = manifest.files.filter((file) => file.layout === 'hf-cache' && file.source.type === 'hf' && file.source.repo === model)
          expect(files.length, model).toBeGreaterThan(0)
          expect(files.every((file) => file.features.includes('core')), model).toBe(true)
          expect(files.some((file) => file.filename === 'config.json'), model).toBe(true)
        }
      }
    }
  })

  it('holds the voice, ASR and sound-effect models where src/lib/speech.ts mounts them', () => {
    const speech = readFileSync('src/lib/speech.ts', 'utf8')
    const targets = new Set(manifest.files.map((file) => file.target))
    for (const match of speech.matchAll(/'\/models\/([\w.-]+)'/g)) expect(targets.has(`tts/${match[1]}`), match[1]).toBe(true)
    expect(speech).toContain("'/asr/whisper-large-v3-turbo'")
    expect(targets.has('asr/whisper-large-v3-turbo')).toBe(true)
    expect(speech).toContain("'audio', 'MOSS-SoundEffect-v2.0'")
    expect(targets.has('audio/MOSS-SoundEffect-v2.0')).toBe(true)
    for (const dir of ['tts/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'tts/Qwen3-TTS-12Hz-1.7B-Base']) {
      const files = manifest.files.filter((file) => file.target === dir).map((file) => file.filename)
      expect(files).toEqual(expect.arrayContaining(['config.json', 'model.safetensors', 'speech_tokenizer/model.safetensors']))
    }
  })

  it('installs by default everything the three formats run with their default models', () => {
    const selected = new Set(selectFiles(manifest, DEFAULT_FEATURES).map((file) => `${file.target}/${file.filename}`))
    const defaults = ['qwen_image_lightning', 'qwen_image_edit_lightning', 'qwen_image_2512', 'qwen_image_edit_2511_lightning', 'ltx25_fast_i2v', 'ltx25_fast_lipsync', 'rife_interpolate', 'ace_step_instrumental']
    const nvfp4 = VIDEO_MODELS['ltx25-fast-nvfp4'].values!.unet_name as string
    for (const ref of allModelRefs().filter((r) => defaults.includes(r.workflow) && !(r.input === 'unet_name' && r.filename.includes('int8')))) {
      expect(selected.has(comfyKey(ref.folder, ref.filename)), `${ref.workflow}: ${ref.filename}`).toBe(true)
    }
    expect(selected.has(comfyKey('diffusion_models', nvfp4))).toBe(true)
    expect(selected.has(comfyKey('diffusion_models', 'wan2.2_ti2v_5B_fp16.safetensors'))).toBe(false)
  })

  it('makes each optional video model complete on its own', () => {
    const cases: Array<[Feature, string[]]> = [['wan22-14b', ['wan22_i2v_14b_4step']], ['wan22-5b', ['wan22_ti2v_5b_i2v', 'wan22_ti2v_5b_t2v']]]
    for (const [feature, workflows] of cases) {
      const selected = new Set(selectFiles(manifest, featuresFor(['ad'], [feature])).map((file) => `${file.target}/${file.filename}`))
      for (const ref of allModelRefs().filter((r) => workflows.includes(r.workflow))) expect(selected.has(comfyKey(ref.folder, ref.filename)), `${feature}: ${ref.filename}`).toBe(true)
    }
  })

  it('marks the gated LTX-2.5 weights with the page where the terms are accepted', () => {
    const ltx = manifest.files.filter((file) => file.source.type === 'hf' && file.source.repo === 'Lightricks/LTX-2.5')
    expect(ltx.length).toBeGreaterThan(4)
    for (const file of ltx) expect(file.gated?.url).toBe('https://huggingface.co/Lightricks/LTX-2.5')
  })

  it('maps formats and extras to features', () => {
    expect(featuresFor(undefined).sort()).toEqual(['ad', 'core', 'narrative'])
    expect(featuresFor(['short'])).toEqual(['core', 'narrative'])
    expect(featuresFor(['ad'], ['wan22-14b'])).toEqual(['core', 'ad', 'wan22-14b'])
    expect(() => featuresFor(['musical'])).toThrow(/unknown format/)
    expect(() => featuresFor(['ad'], ['wan3'])).toThrow(/unknown feature/)
  })
})

describe('Hub metadata to manifest entries', () => {
  const revision = (siblings: HubRevision['siblings']): HubRevision => ({ id: 'org/repo', sha: 'c'.repeat(40), cardData: { license: 'apache-2.0' }, siblings })
  const sha = 'a'.repeat(64)

  it('takes lfs.oid for LFS files and the git blob id for small files', () => {
    expect(siblingHash({ rfilename: 'm.safetensors', lfs: { sha256: sha, size: 10 } })).toEqual({ sha256: sha })
    expect(siblingHash({ rfilename: 'config.json', blobId: 'b'.repeat(40), size: 3 })).toEqual({ gitOid: 'b'.repeat(40) })
    expect(siblingHash({ rfilename: 'm.safetensors', lfs: { sha256: '*'.repeat(64) } })).toBeNull()
  })

  it('builds ComfyUI, directory and hf-cache entries pinned to the revision', () => {
    const hub = revision([{ rfilename: 'split/m.safetensors', size: 10, lfs: { sha256: sha, size: 10 } }, { rfilename: 'config.json', size: 3, blobId: 'b'.repeat(40) }])
    const [single] = entriesFor({ kind: 'hf-file', repo: 'org/repo', path: 'split/m.safetensors', target: 'comfyui/vae', features: ['core'], license: 'Apache-2.0' }, hub)
    expect(single).toMatchObject({ filename: 'm.safetensors', target: 'comfyui/vae', sha256: sha, size: 10, hashSource: 'hf-api', source: { revision: 'c'.repeat(40), path: 'split/m.safetensors' } })
    const cached = entriesFor({ kind: 'hf-repo', repo: 'org/repo', layout: 'hf-cache', features: ['core'], license: 'x' }, hub)
    expect(cached.map((entry) => [entry.target, entry.filename, entry.gitOid ?? entry.sha256])).toEqual([['hf/hub/models--org--repo', 'split/m.safetensors', sha], ['hf/hub/models--org--repo', 'config.json', 'b'.repeat(40)]])
  })

  it('refuses a file whose hash the Hub hides and nobody measured, and a measured hash the Hub contradicts', () => {
    const hidden = revision([{ rfilename: 'x.safetensors', size: 10, lfs: { sha256: '*'.repeat(64), size: 10 } }])
    expect(() => entriesFor({ kind: 'hf-file', repo: 'org/repo', path: 'x.safetensors', target: 'comfyui/vae', features: ['core'], license: 'x' }, hidden)).toThrow(/hides this file's hash/)
    const ltxPath = 'vae/ltx-2.5-audio-vae-bf16.safetensors'
    const gated = { ...revision([{ rfilename: ltxPath, size: 10, lfs: { sha256: '*'.repeat(64), size: 10 } }]), id: 'Lightricks/LTX-2.5' }
    const [measured] = entriesFor({ kind: 'hf-file', repo: 'Lightricks/LTX-2.5', path: ltxPath, target: 'comfyui/vae', features: ['core'], license: 'x' }, gated)
    expect(measured!.hashSource).toBe('measured')
    expect(measured!.gated?.url).toContain('Lightricks/LTX-2.5')
    const contradicted = { ...gated, siblings: [{ rfilename: ltxPath, size: 10, lfs: { sha256: sha, size: 10 } }] }
    expect(() => entriesFor({ kind: 'hf-file', repo: 'Lightricks/LTX-2.5', path: ltxPath, target: 'comfyui/vae', features: ['core'], license: 'x' }, contradicted)).toThrow(/differs from the measured/)
  })

  it('fails when a pinned file is not in the repo', () => {
    expect(() => entriesFor({ kind: 'hf-file', repo: 'org/repo', path: 'gone.safetensors', target: 'comfyui/vae', features: ['core'], license: 'x' }, revision([]))).toThrow(/has no file gone.safetensors/)
  })
})

describe('content verification', () => {
  it('computes sha256 and git blob ids exactly', async () => {
    const dir = tmp()
    const file = join(dir, 'hello.txt')
    writeFileSync(file, 'hello\n')
    expect(await sha256File(file)).toBe(createHash('sha256').update('hello\n').digest('hex'))
    expect(await gitBlobOid(file)).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    writeFileSync(join(dir, 'empty'), '')
    expect(await gitBlobOid(join(dir, 'empty'))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })

  it('reports verified, mismatch, missing and partial; equal size never passes for equal content', async () => {
    const dir = tmp()
    const path = join(dir, 'w.safetensors')
    writeFileSync(path, 'abcd')
    const sha256 = createHash('sha256').update('abcd').digest('hex')
    expect(await verifyFile(path, { sha256 })).toBe('verified')
    writeFileSync(path, 'abce')
    expect(await verifyFile(path, { sha256 })).toBe('mismatch')
    expect(await verifyFile(join(dir, 'none'), { sha256 })).toBe('missing')
    writeFileSync(`${path}.aria2`, '')
    expect(await verifyFile(path, { sha256 })).toBe('partial')
  })

  it('reuses a recorded hash only while the file is unchanged', async () => {
    const dir = tmp()
    const path = join(dir, 'w.bin')
    writeFileSync(path, 'abcd')
    const sha256 = createHash('sha256').update('abcd').digest('hex')
    const cache = new VerifyCache(join(dir, 'cache.json'))
    expect(await verifyFile(path, { sha256 }, cache, { cachedOnly: true })).toBe('unverified')
    expect(await verifyFile(path, { sha256 }, cache)).toBe('verified')
    await cache.save()
    const reloaded = new VerifyCache(join(dir, 'cache.json'))
    expect(await verifyFile(path, { sha256 }, reloaded, { cachedOnly: true })).toBe('verified')
    writeFileSync(path, 'abce')
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    expect(await verifyFile(path, { sha256 }, reloaded, { cachedOnly: true })).toBe('unverified')
    expect(await verifyFile(path, { sha256 }, reloaded)).toBe('mismatch')
  })
})

describe('download plan', () => {
  const hfFile = manifest.files.find((file) => file.layout === 'hf-cache' && file.sha256)!
  const comfyFile = manifest.files.find((file) => file.target === 'comfyui/vae' && file.filename === 'qwen_image_vae.safetensors')!

  it('resolves Hugging Face files at their pinned revision through HF_ENDPOINT', () => {
    const source = comfyFile.source as { repo: string; revision: string; path: string }
    expect(downloadUrl(comfyFile, 'https://hf-mirror.com')).toBe(`https://hf-mirror.com/${source.repo}/resolve/${source.revision}/${source.path}`)
    expect(downloadUrl({ ...comfyFile, source: { ...source, type: 'hf', path: 'a b/c+d.json' } }, 'https://e')).toBe(`https://e/${source.repo}/resolve/${source.revision}/a%20b/c%2Bd.json`)
  })

  it('saves under the real filename (aria2 out=), hf-cache bytes under their content hash', () => {
    expect(downloadTarget('/m', comfyFile)).toEqual({ dir: '/m/comfyui/vae', out: 'qwen_image_vae.safetensors' })
    expect(storagePath('/m', hfFile)).toBe(`/m/${hfFile.target}/blobs/${hfFile.sha256}`)
    const entry = aria2Entry('https://e/x', '/m/comfyui/vae', 'qwen_image_vae.safetensors', ['Authorization: Bearer t'])
    expect(entry).toBe('https://e/x\n  dir=/m/comfyui/vae\n  out=qwen_image_vae.safetensors\n  header=Authorization: Bearer t\n')
  })

  it('passes the proxy to aria2c and curl, or disables it', () => {
    expect(aria2Args('in.txt', { endpoint: 'e', proxy: 'http://p:1' })).toContain('--all-proxy=http://p:1')
    expect(aria2Args('in.txt', { endpoint: 'e', proxy: 'none' })).toEqual(expect.arrayContaining(['--all-proxy=', '--no-proxy=*']))
    expect(aria2Args('in.txt', { endpoint: 'e' })).toEqual(expect.arrayContaining(['-c', '--auto-file-renaming=false']))
    expect(curlProxyArgs({ endpoint: 'e', proxy: 'none' })).toEqual(['--noproxy', '*'])
    expect(childEnv({ endpoint: 'e', proxy: 'none' }, { HTTPS_PROXY: 'x', PATH: '/bin' })).toEqual({ PATH: '/bin' })
    expect(childEnv({ endpoint: 'e' }, { HTTPS_PROXY: 'x' })).toEqual({ HTTPS_PROXY: 'x' })
  })

  it('lays out an hf-cache snapshot the way huggingface_hub does', async () => {
    const root = tmp()
    const blob = storagePath(root, hfFile)
    mkdirSync(join(blob, '..'), { recursive: true })
    writeFileSync(blob, 'x')
    expect(await linkSnapshot(root, hfFile)).toBe(true)
    expect(await linkSnapshot(root, hfFile)).toBe(false)
    await writeRef(root, hfFile)
    expect(realpathSync(installedPath(root, hfFile))).toBe(realpathSync(blob))
    expect(readFileSync(join(root, hfFile.target, 'refs', 'main'), 'utf8')).toBe((hfFile.source as { revision: string }).revision)
  })
})

describe('platform detection', () => {
  const spark: PlatformFacts = {
    arch: 'aarch64', gpus: [{ name: 'NVIDIA GB10', driver: '580.159.03' }], docker: { server: '28.5.1' }, compose: '2.40.0', cdiDevices: ['nvidia.com/gpu=0', 'nvidia.com/gpu=all'],
    node: '22.23.3', ffmpeg: { present: true, libass: true }, fonts: true, git: true, curl: true, aria2: true, python3: true,
    memory: { totalGb: 121.7, availableGb: 110, swapUsedGb: 0 }, modelDiskFree: 3e12, dockerDiskFree: 1e12,
  }
  const needs = { downloadBytes: 2e11, imagesMissing: true, startGb: 95, stackRunning: false }

  it('parses nvidia-smi, versions, CDI devices, ffmpeg, fonts and df output', () => {
    expect(parseNvidiaSmi('NVIDIA GB10, 580.159.03\n')).toEqual([{ name: 'NVIDIA GB10', driver: '580.159.03' }])
    expect(parseVersion('v22.14.0')).toEqual([22, 14, 0])
    expect(parseVersion('2.40.3-desktop.1')).toEqual([2, 40, 3])
    const dockerInfo = ' CDI spec directories:\n  /etc/cdi\n  /var/run/cdi\n Discovered Devices:\n  cdi: nvidia.com/gpu=0\n  cdi: nvidia.com/gpu=GPU-322c537b-3a5e\n  cdi: nvidia.com/gpu=all\n Swarm: inactive'
    expect(parseCdiDevices(dockerInfo)).toEqual(['nvidia.com/gpu=0', 'nvidia.com/gpu=GPU-322c537b-3a5e', 'nvidia.com/gpu=all'])
    expect(parseCdiDevices('INFO[0000] Found 2 CDI devices\nnvidia.com/gpu=0\nnvidia.com/gpu=all\n')).toEqual(['nvidia.com/gpu=0', 'nvidia.com/gpu=all'])
    expect(parseCdiDevices(' Runtimes: io.containerd.runc.v2 runc nvidia\n')).toEqual([])
    expect(ffmpegHasLibass('  configuration:\n    --enable-gpl\n    --enable-libass\n    --enable-libfreetype')).toBe(true)
    expect(ffmpegHasLibass('  configuration:\n    --enable-gpl\n    --enable-libfreetype')).toBe(false)
    expect(hasNotoCjk('DejaVu Sans\nNoto Sans CJK SC,Noto Sans CJK SC Medium\n')).toBe(true)
    expect(hasNotoCjk('Noto Sans CJK TC,Noto Sans CJK TC Medium\nNoto Sans\n')).toBe(false)
    expect(parseDfAvail('    Avail\n3151816634368\n')).toBe(3151816634368)
    expect(parseDfAvail('')).toBeUndefined()
  })

  it('passes a DGX Spark with everything installed', () => {
    const checks = assessPlatform(spark, needs)
    expect(checks.filter((check) => check.status !== 'ok')).toEqual([])
  })

  it('stops on anything that is not aarch64 with a GB10', () => {
    const x86 = assessPlatform({ ...spark, arch: 'x86_64', gpus: [{ name: 'NVIDIA GeForce RTX 4090', driver: '570' }] }, needs)
    expect(x86.filter((check) => check.fatal).map((check) => check.name)).toEqual(['cpu', 'gpu'])
    expect(x86.find((check) => check.name === 'gpu')!.detail).toContain('RTX 4090')
    const noDriver = assessPlatform({ ...spark, gpus: null }, needs)
    expect(noDriver.find((check) => check.name === 'gpu')).toMatchObject({ status: 'fail', fatal: true })
  })

  it('names the root command for what needs root, and only that', () => {
    const checks = assessPlatform({ ...spark, cdiDevices: [], ffmpeg: { present: true, libass: false }, fonts: false, aria2: false }, needs)
    const fixes = rootFixes(checks)
    expect(fixes).toHaveLength(3)
    expect(fixes[0]).toContain('nvidia-ctk cdi generate')
    expect(fixes.join('\n')).toContain('fonts-noto-cjk')
    expect(checks.find((check) => check.name === 'aria2c')).toMatchObject({ status: 'warn' })
    expect(rootFixes(assessPlatform({ ...spark, docker: { error: 'permission denied while trying to connect to the Docker daemon socket' } }, needs))).toEqual(['sudo usermod -aG docker $USER && newgrp docker'])
  })

  it('sums the real download size against free disk, and free unified memory against the stack', () => {
    const tight = assessPlatform({ ...spark, modelDiskFree: 1e11, dockerDiskFree: 1e10, memory: { totalGb: 121.7, availableGb: 54, swapUsedGb: 0 } }, needs)
    expect(tight.find((check) => check.name === 'model disk')).toMatchObject({ status: 'fail' })
    expect(tight.find((check) => check.name === 'model disk')!.detail).toContain('200 GB still to download')
    expect(tight.find((check) => check.name === 'docker disk')).toMatchObject({ status: 'fail' })
    expect(tight.find((check) => check.name === 'unified memory')).toMatchObject({ status: 'warn' })
    const running = assessPlatform({ ...spark, memory: { totalGb: 121.7, availableGb: 20, swapUsedGb: 0 } }, { ...needs, stackRunning: true, imagesMissing: false })
    expect(running.find((check) => check.name === 'unified memory')).toMatchObject({ status: 'ok' })
    expect(running.some((check) => check.name === 'docker disk')).toBe(false)
  })
})

describe('stack', () => {
  it('writes spark.env with the real model root and reads inline comments away', () => {
    const example = readFileSync('deploy/spark/spark.env.example', 'utf8')
    expect(parseEnvFile(example).SPARK_MODEL_DIR).toBe('/path/to/models')
    const rendered = parseEnvFile(renderSparkEnv(example, { modelDir: '/data/models', pipIndex: 'https://pypi.tuna.tsinghua.edu.cn/simple' }))
    expect(rendered).toMatchObject({ SPARK_MODEL_DIR: '/data/models', PIP_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple', VLLM_TAG: 'v0.27.1' })
  })

  it('pulls vLLM from Docker Hub first, then each mirror re-tagged to the canonical name, and builds the rest on it', () => {
    const plans = imagePlans({ VLLM_TAG: 'v0.27.1', PIP_INDEX_URL: 'https://mirror/simple' }, registryMirrors({ CINEFOUNDRY_REGISTRY_MIRRORS: 'docker.m.daocloud.io, mirror.example/' }))
    expect(plans.map((plan) => plan.name)).toEqual(['vllm/vllm-openai:v0.27.1', 'cinefoundry/comfyui:local', 'cinefoundry/qwen-tts:local', 'cinefoundry/moss-audio:local'])
    expect(plans[0]!.attempts).toEqual([
      [['docker', 'pull', 'vllm/vllm-openai:v0.27.1']],
      [['docker', 'pull', 'docker.m.daocloud.io/vllm/vllm-openai:v0.27.1'], ['docker', 'tag', 'docker.m.daocloud.io/vllm/vllm-openai:v0.27.1', 'vllm/vllm-openai:v0.27.1']],
      [['docker', 'pull', 'mirror.example/vllm/vllm-openai:v0.27.1'], ['docker', 'tag', 'mirror.example/vllm/vllm-openai:v0.27.1', 'vllm/vllm-openai:v0.27.1']],
    ])
    expect(plans[2]!.attempts[0]![0]).toEqual(expect.arrayContaining(['BASE_IMAGE=vllm/vllm-openai:v0.27.1', 'PIP_INDEX_URL=https://mirror/simple']))
    expect(plans[3]!.attempts[0]![0]).toEqual(expect.arrayContaining(['BASE_IMAGE=cinefoundry/qwen-tts:local', 'PIP_INDEX=https://mirror/simple', '.tools/MOSS-TTS']))
  })

  it('checks out sources at a pinned commit, through an optional GitHub mirror', () => {
    expect(githubUrl('https://github.com/a/b', { CINEFOUNDRY_GITHUB_MIRROR: 'https://ghfast.top' })).toBe('https://ghfast.top/https://github.com/a/b')
    expect(checkoutCommands('d', 'u', 'c'.repeat(40))[1]).toEqual(['git', '-C', 'd', 'fetch', '-q', '--depth', '1', 'u', 'c'.repeat(40)])
  })

  it('builds only the missing voices: design takes, then QC with Whisper', () => {
    const [design, qc] = voiceBuildCommands(['en-f1825-bright'], { repo: '/r', work: '/w', models: '/m' })
    expect(design).toEqual(expect.arrayContaining(['cinefoundry/qwen-tts:local', '/repo/scripts/voice-design.py', '--only', 'en-f1825-bright', '/m/tts:/models:ro']))
    expect(qc).toEqual(expect.arrayContaining(['cinefoundry/moss-audio:local', '/repo/scripts/voice-qc.py', '/m/asr:/asr:ro']))
  })
})

describe('doctor workflow check', () => {
  it('reports a missing default model as a problem and a missing optional one as a warning', () => {
    const workflows = loadWorkflows()
    const info: Record<string, { input: { required: Record<string, unknown[]> } }> = {}
    for (const graph of Object.values(workflows)) for (const [id, node] of Object.entries(graph)) {
      if (id.startsWith('_') || typeof node !== 'object' || !node.class_type) continue
      const required = (info[node.class_type] ??= { input: { required: {} } }).input.required
      for (const input of Object.keys(node.inputs ?? {})) required[input] ??= /_name$/.test(input) ? [[] as string[]] : ['STRING']
    }
    const installed = new Set(allModelRefs(workflows).map((ref) => ref.filename))
    installed.delete('wan2.2_vae.safetensors')
    installed.delete('qwen_image_vae.safetensors')
    for (const spec of Object.values(info)) for (const options of Object.values(spec.input.required)) if (Array.isArray(options[0])) (options[0] as string[]).push(...installed)
    const { problems, warnings } = checkWorkflows(info as never, workflows, (filename) => (filename === 'wan2.2_vae.safetensors' ? 'wan22-5b' : undefined))
    expect(problems.every((problem) => problem.includes('qwen_image_vae.safetensors'))).toBe(true)
    expect(problems.length).toBeGreaterThan(0)
    expect(warnings.every((warning) => warning.includes('wan2.2_vae.safetensors') && warning.includes('--with wan22-5b'))).toBe(true)
  })
})
