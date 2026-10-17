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
}

const assTime = (seconds: number) => {
  const cs = Math.max(0, Math.round(seconds * 100))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`
}

const clean = (text: string) => text.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim()

/** Width of a line in font-size units, letter spacing (0.22 em) included: CJK and full-width marks are 1 em, Latin about 0.6. */
const lineEms = (text: string) => [...text].reduce((sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.6) + 0.22, 0)

export function buildAss(cues: TitleCue[], width: number, height: number, font = 'Noto Sans CJK SC'): string {
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
  const closingSize = Math.round(height * (portrait ? 0.04 : 0.064))
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Title: heavy, letter-spaced, soft shadow, upper third. Subtitle: light outline, bottom.
    `Style: Title,${font},${titleSize},&H00FFFFFF,&H00FFFFFF,&H64000000,&H96000000,1,0,0,0,100,100,${Math.round(titleSize * 0.18)},0,1,0,${Math.round(titleSize * 0.06)},8,60,60,${Math.round(height * (portrait ? 0.14 : 0.1))},1`,
    `Style: Sub,${font},${subtitleSize},&H00FFFFFF,&H00FFFFFF,&HB4000000,&H00000000,0,0,0,0,100,100,${Math.round(subtitleSize * 0.06)},0,1,${Math.max(1, Math.round(subtitleSize * 0.07))},0,2,60,60,${bilingual ? enMargin + Math.round(enSize * 1.55) : Math.round(height * (portrait ? 0.09 : 0.07))},1`,
    `Style: SubEn,${font},${enSize},&H20FFFFFF,&H20FFFFFF,&HB4000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(enSize * 0.07))},0,2,60,60,${enMargin},1`,
    // The explicit AI label (标识办法 / GB 45438-2025): prominent - text 5 % of the frame's short side - and on 9:16 kept
    // below the band the platform's own top bar covers, so the label is never hidden by the player.
    `Style: Label,${font},${Math.round(Math.min(width, height) * 0.05)},&H10FFFFFF,&H10FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,${Math.round(height * 0.002)},0,1,2,0,9,${Math.round(width * 0.05)},${Math.round(width * 0.05)},${Math.round(portrait ? height * 0.2 : height * 0.04)},1`,
    `Style: Closing,${font},${closingSize},&H00FFFFFF,&H00FFFFFF,&H64000000,&H96000000,1,0,0,0,100,100,${Math.round(closingSize * 0.22)},0,1,0,${Math.round(closingSize * 0.07)},2,60,60,${Math.round(height * (portrait ? 0.085 : 0.075))},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  for (const cue of cues) {
    if (cue.title?.trim()) lines.push(`Dialogue: 1,${assTime(cue.start + 0.5)},${assTime(cue.end - 0.4)},Title,,0,0,0,,{\\fad(450,350)\\blur0.6}${clean(cue.title)}`)
    if (cue.closing?.trim()) {
      // WrapStyle 2 never wraps, so a long client line on a portrait end card would run off both edges: shrink it to fit.
      const size = Math.min(closingSize, Math.floor((width - 160) / lineEms(clean(cue.closing))))
      const fit = size < closingSize ? `\\fs${size}\\fsp${Math.round(size * 0.22)}` : ''
      lines.push(`Dialogue: 1,${assTime(cue.start + 0.6)},${assTime(cue.end - 0.1)},Closing,,0,0,0,,{\\fad(500,300)\\blur0.5${fit}}${clean(cue.closing)}`)
    }
    if (cue.label?.trim()) lines.push(`Dialogue: 2,${assTime(cue.start)},${assTime(cue.end)},Label,,0,0,0,,${clean(cue.label)}`)
    if (cue.subtitle?.trim()) lines.push(`Dialogue: 0,${assTime(cue.subtitleStart ?? cue.start + 0.25)},${assTime(cue.subtitleEnd ?? cue.end - 0.15)},Sub,,0,0,0,,{\\fad(150,150)}${clean(cue.subtitle)}`)
    if (cue.subtitleEn?.trim()) lines.push(`Dialogue: 0,${assTime(cue.subtitleStart ?? cue.start + 0.25)},${assTime(cue.subtitleEnd ?? cue.end - 0.15)},SubEn,,0,0,0,,{\\fad(150,150)}${clean(cue.subtitleEn)}`)
  }
  return `${lines.join('\n')}\n`
}
