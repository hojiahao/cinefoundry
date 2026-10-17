/** ASS typography for the final cut: a large title per beat and voiceover subtitles, set in a real font. */

export interface TitleCue {
  start: number
  end: number
  title?: string
  subtitle?: string
  /** The closing line on the end card: larger than a subtitle, set low so it never covers the product. */
  closing?: string
  /** The explicit AI-generated label (内容由 AI 生成), set small in the top-right corner. */
  label?: string
  /** When the subtitle shows, if not the whole cue: the seconds the voiceover line is actually spoken. */
  subtitleStart?: number
  subtitleEnd?: number
  /** The English line under the Chinese subtitle (bilingual films: characters speak English, Chinese is read first). */
  subtitleEn?: string
  /** A mandatory legal line of the brand, set small at the foot of the end card. */
  legal?: string
  /** Vertical margin of this cue's closing or legal line, when the end-card layout moves it (a legal line below the closing line). */
  marginV?: number
}

const assTime = (seconds: number) => {
  const cs = Math.max(0, Math.round(seconds * 100))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`
}

const clean = (text: string) => text.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim()

/** Width of a line in font-size units, letter spacing (0.22 em) included: CJK and full-width marks are 1 em, Latin about 0.6. */
const lineEms = (text: string) => [...text].reduce((sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.6) + 0.22, 0)

/** Size of the closing line on the end card. */
export const closingSize = (width: number, height: number) => Math.round(height * (height > width ? 0.04 : 0.064))
/** Default bottom margin of the closing line. */
const closingMarginV = (width: number, height: number) => Math.round(height * (height > width ? 0.085 : 0.075))
/** Legal supers: at least 30 lines high on a 1080-line frame (broadcast clearance minimum), larger on the narrow 9:16 line. */
export const legalSize = (width: number, height: number) => Math.round(height > width ? width * 0.03 : height * 0.028)
const AI_LABEL_TEXT = '内容由 AI 生成'

export interface Box { x: number; y: number; width: number; height: number }

export interface EndCardLayout {
  /** The logo as composited, in frame pixels. */
  logo?: Box
  /** Clear space kept free around the logo, in pixels. */
  clear: number
  closingMarginV: number
  legalMarginV: number
  legalSize: number
  /** What does not fit: a logo whose clear space leaves the frame or meets the AI label or the closing line. */
  problems: string[]
}

/** Where a brand logo sits on an end card: what the clear-space and minimum-size rules of a kit produce on a given frame. */
export interface LogoSpec {
  /** Width over height of the artwork. */
  aspect: number
  /** Clear space on every side, as a fraction of the logo's height. */
  clearSpace: number
  /** Minimum width on a 1080-line frame, scaled with the frame. */
  minWidthPx: number
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * The branded end card: legal lines at the foot, the closing line above them, the logo centred above the closing line
 * with its clear space free of every other element and inside the frame. The logo is about a quarter of the frame's
 * short side, never under the kit's minimum width.
 */
export function endCardLayout(width: number, height: number, legalLines: number, logo?: LogoSpec): EndCardLayout {
  const portrait = height > width
  const short = Math.min(width, height)
  const legal = legalSize(width, height)
  const legalMarginV = Math.round(height * (portrait ? 0.085 : 0.04))
  const closingMargin = legalLines > 0 ? legalMarginV + legalLines * Math.round(legal * 1.3) + Math.round(legal * 0.6) : closingMarginV(width, height)
  const layout: EndCardLayout = { clear: 0, closingMarginV: closingMargin, legalMarginV, legalSize: legal, problems: [] }
  if (!logo) return layout
  const minWidth = Math.round((logo.minWidthPx * short) / 1080)
  let logoWidth = Math.max(minWidth, Math.round(short * 0.24))
  let logoHeight = Math.round(logoWidth / logo.aspect)
  // A tall mark (a crest, a mascot) is held to the same height a wide wordmark would take, unless that breaks its minimum width.
  if (logoHeight > short * 0.24) { logoHeight = Math.round(short * 0.24); logoWidth = Math.max(minWidth, Math.round(logoHeight * logo.aspect)); logoHeight = Math.round(logoWidth / logo.aspect) }
  const clear = Math.round(logo.clearSpace * logoHeight)
  const closingTop = height - closingMargin - Math.round(closingSize(width, height) * 1.25)
  const box: Box = { x: Math.round((width - logoWidth) / 2), y: closingTop - clear - logoHeight, width: logoWidth, height: logoHeight }
  const zone: Box = { x: box.x - clear, y: box.y - clear, width: box.width + 2 * clear, height: box.height + 2 * clear }
  const labelFont = Math.round(short * 0.05)
  const labelWidth = Math.round(lineEms(AI_LABEL_TEXT) * labelFont)
  const label: Box = { x: width - Math.round(width * 0.05) - labelWidth, y: Math.round(portrait ? height * 0.2 : height * 0.04), width: labelWidth, height: Math.round(labelFont * 1.2) }
  if (zone.x < 0 || zone.x + zone.width > width || zone.y < 0) layout.problems.push(`the logo with its clear space (${zone.width}x${zone.height} px) does not fit a ${width}x${height} end card`)
  if (intersects(zone, label)) layout.problems.push(`the logo's clear space meets the AI label on a ${width}x${height} end card`)
  return { ...layout, logo: box, clear }
}

export function buildAss(cues: TitleCue[], width: number, height: number, font = 'Noto Sans CJK SC', subtitleFont = font): string {
  const portrait = height > width
  const titleSize = Math.round(height * (portrait ? 0.058 : 0.085))
  // Subtitles: about 4.5 % of the frame height on 16:9; on 9:16 sized from the width (about 59 px on a 1080-wide frame).
  const subtitleSize = Math.round(portrait ? width * 0.055 : height * 0.045)
  // Bilingual: Chinese large on top, English small below it. On 9:16 both stay inside the platforms' safe zone
  // (above y = 1440 of 1920, clear of the caption, buttons and progress bar), on 16:9 in the lower title-safe area.
  // English sits under the Chinese at about 60 % of its size.
  const enSize = Math.round(subtitleSize * 0.6)
  const enMargin = Math.round(portrait ? height * 0.25 : height * 0.06)
  const bilingual = cues.some((cue) => cue.subtitleEn?.trim())
  const closing = closingSize(width, height)
  const legal = legalSize(width, height)
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Title: heavy, letter-spaced, soft shadow, upper third. Subtitle: light outline, bottom.
    `Style: Title,${font},${titleSize},&H00FFFFFF,&H00FFFFFF,&H64000000,&H96000000,1,0,0,0,100,100,${Math.round(titleSize * 0.18)},0,1,0,${Math.round(titleSize * 0.06)},8,60,60,${Math.round(height * (portrait ? 0.14 : 0.1))},1`,
    `Style: Sub,${subtitleFont},${subtitleSize},&H00FFFFFF,&H00FFFFFF,&HB4000000,&H00000000,0,0,0,0,100,100,${Math.round(subtitleSize * 0.06)},0,1,${Math.max(1, Math.round(subtitleSize * 0.07))},0,2,60,60,${bilingual ? enMargin + Math.round(enSize * 1.55) : Math.round(height * (portrait ? 0.09 : 0.07))},1`,
    `Style: SubEn,${subtitleFont},${enSize},&H20FFFFFF,&H20FFFFFF,&HB4000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(enSize * 0.07))},0,2,60,60,${enMargin},1`,
    // The explicit AI label (标识办法 / GB 45438-2025): prominent - text 5 % of the frame's short side - and on 9:16 kept
    // below the band the platform's own top bar covers, so the label is never hidden by the player.
    `Style: Label,${subtitleFont},${Math.round(Math.min(width, height) * 0.05)},&H10FFFFFF,&H10FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,${Math.round(height * 0.002)},0,1,2,0,9,${Math.round(width * 0.05)},${Math.round(width * 0.05)},${Math.round(portrait ? height * 0.2 : height * 0.04)},1`,
    `Style: Closing,${font},${closing},&H00FFFFFF,&H00FFFFFF,&H64000000,&H96000000,1,0,0,0,100,100,${Math.round(closing * 0.22)},0,1,0,${Math.round(closing * 0.07)},2,60,60,${closingMarginV(width, height)},1`,
    // Legal supers: plain, high-contrast, at the foot of the end card under the closing line.
    `Style: Legal,${subtitleFont},${legal},&H00FFFFFF,&H00FFFFFF,&HB4000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(legal * 0.06))},0,2,60,60,${Math.round(height * (portrait ? 0.085 : 0.04))},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  for (const cue of cues) {
    if (cue.title?.trim()) lines.push(`Dialogue: 1,${assTime(cue.start + 0.5)},${assTime(cue.end - 0.4)},Title,,0,0,0,,{\\fad(450,350)\\blur0.6}${clean(cue.title)}`)
    if (cue.closing?.trim()) {
      // WrapStyle 2 never wraps, so a long client line on a portrait end card would run off both edges: shrink it to fit.
      const size = Math.min(closing, Math.floor((width - 160) / lineEms(clean(cue.closing))))
      const fit = size < closing ? `\\fs${size}\\fsp${Math.round(size * 0.22)}` : ''
      lines.push(`Dialogue: 1,${assTime(cue.start + 0.6)},${assTime(cue.end - 0.1)},Closing,,0,0,${cue.marginV ?? 0},,{\\fad(500,300)\\blur0.5${fit}}${clean(cue.closing)}`)
    }
    if (cue.legal?.trim()) {
      // Never wrapped, never cut: a long legal line is set smaller to fit the width, as the closing line is.
      const size = Math.min(legal, Math.floor((width - 120) / (lineEms(clean(cue.legal)) - [...clean(cue.legal)].length * 0.22)))
      const fit = size < legal ? `\\fs${size}` : ''
      lines.push(`Dialogue: 1,${assTime(cue.start + 0.6)},${assTime(cue.end - 0.1)},Legal,,0,0,${cue.marginV ?? 0},,{\\fad(500,300)${fit}}${clean(cue.legal)}`)
    }
    if (cue.label?.trim()) lines.push(`Dialogue: 2,${assTime(cue.start)},${assTime(cue.end)},Label,,0,0,0,,${clean(cue.label)}`)
    if (cue.subtitle?.trim()) lines.push(`Dialogue: 0,${assTime(cue.subtitleStart ?? cue.start + 0.25)},${assTime(cue.subtitleEnd ?? cue.end - 0.15)},Sub,,0,0,0,,{\\fad(150,150)}${clean(cue.subtitle)}`)
    if (cue.subtitleEn?.trim()) lines.push(`Dialogue: 0,${assTime(cue.subtitleStart ?? cue.start + 0.25)},${assTime(cue.subtitleEnd ?? cue.end - 0.15)},SubEn,,0,0,0,,{\\fad(150,150)}${clean(cue.subtitleEn)}`)
  }
  return `${lines.join('\n')}\n`
}
