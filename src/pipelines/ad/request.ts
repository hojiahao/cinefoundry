import type { Brief } from '../../agent/checks.js'

/** What the client's own words fix, read deterministically: the model may not overrule them. */

/** The closing line a request quotes after 字幕/口号/广告语/slogan, without its closing punctuation. */
export function statedTagline(request: string): string | undefined {
  const quoted = /(?:定版字幕|字幕|口号|广告语|标语|slogan|tagline|subtitle|caption)[^“"「『\n]{0,8}[“"「『]([^”"」』\n]{2,40})[”"」』]/i.exec(request)?.[1]
  if (quoted) return closingLine(quoted)
  // An agent passing the request through a shell dropped the quotes: "字幕：DGX Spark，把 AI 超算放上你的桌面。"
  // Another dropped only the closing one: 字幕："DGX Spark，把 AI 超算放上你的桌面。
  const bare = /(?:定版字幕|字幕|口号|广告语|标语|slogan|tagline)\s*[：:]\s*["“「『]?([^。！？\n“”"「」『』]{2,40})/i.exec(request)?.[1]
  return bare ? closingLine(bare) : undefined
}
export const closingLine = (text: string) => text.trim().replace(/[。！？.!?，,]+$/, '')

export function statedFormat(request: string): { ratio?: Brief['ratio']; durationSeconds?: number } {
  const ratio = /横版|横屏|16:9|16：9/.test(request) ? '16:9' : /竖版|竖屏|9:16|9：16|抖音|快手|小红书|视频号|TikTok|Reels|Shorts/i.test(request) ? '9:16' : /方形|方版|1:1|1：1/.test(request) ? '1:1' : undefined
  // "前 3 秒抓眼球，做一条 30 秒广告": the film length is the valid one (a multiple of 5 up to 30), and the longest of those.
  const lengths = [...request.matchAll(/(\d+)\s*秒/g)].map((m) => Number(m[1])).filter((n) => n % 5 === 0 && n >= 5 && n <= 30)
  const durationSeconds = lengths.length ? Math.max(...lengths) : undefined
  return { ratio, durationSeconds }
}

/**
 * The lettering quoted in the intake agent's `appearance` must be lettering the request actually quotes: asked for
 * 黑色书法字“岩”, the agent wrote “岁”, and the storyboard check then demanded both "岩" (the label) and "岁" (the look),
 * which no storyboard can satisfy. A quoted string the request never contains is replaced by the label text when the
 * request does contain that.
 */
export function faithfulLabel(appearance: string, request: string, brandText?: string): string {
  if (!brandText || !request.includes(brandText)) return appearance
  return appearance.replace(/([“"「『])([^”"」』]{1,12})([”"」』])/g, (all, open: string, text: string, close: string) =>
    request.includes(text) ? all : `${open}${brandText}${close}`)
}

/** Beat numbers a reviewer's issues name ("Beat 2 VO ...", "beat 3:", "第2拍"). */
export function flaggedBeats(issues: string[], beats: number): number[] {
  const found = new Set<number>()
  // "Beat 2", "beats 2 and 3", "Beats 1, 3", "第2拍"
  for (const issue of issues) {
    for (const m of issue.matchAll(/\bbeats?\s*((?:\d+\s*(?:,|and|&|、|-)?\s*)+)/gi)) for (const n of m[1]!.match(/\d+/g) ?? []) if (Number(n) >= 1 && Number(n) <= beats) found.add(Number(n))
    for (const m of issue.matchAll(/第\s*(\d+)\s*[拍幕]/g)) if (Number(m[1]) >= 1 && Number(m[1]) <= beats) found.add(Number(m[1]))
  }
  return [...found].sort((a, b) => a - b)
}
