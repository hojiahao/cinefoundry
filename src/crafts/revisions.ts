import { checkRepairedPrompt } from '../agent/checks.js'
import { chatJson, type ModelEndpoint } from '../agent/llm.js'

/** The crafts of a revision that are not a stage of their own: a client's note applied to a frame prompt, a new subtitle. */

const CJK = /[㐀-鿿]/

/** A revised frame prompt: changed, English picture words, the framing and any quoted label text kept (checkRepairedPrompt). */
export function checkShotPrompt(previous: string, revised: string | undefined): string[] {
  if (!revised?.trim()) return ['"image_prompt" is empty']
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (words(revised) === words(previous)) return ['the new prompt is the current one again; apply the note']
  const problems = checkRepairedPrompt(previous, revised)
  if (CJK.test(revised.replace(/"[^"]*"/g, ''))) problems.push('English only: Chinese is allowed only inside quoted label text')
  if (/\b(caption|subtitle|title card|text overlay|the words?)\b/i.test(revised)) problems.push('no on-screen text in a frame prompt: titles and subtitles are typeset in the cut')
  return problems
}

/**
 * The storyboard artist applies the client's note to one shot's frame prompt. The new prompt is what the frame is
 * generated from from now on, so it is written back to the storyboard. Throws when no usable rewrite comes back: a note
 * that cannot be applied is not silently replaced by a new seed.
 */
export async function reviseShotPrompt(planner: ModelEndpoint, system: string, input: { shot: number; prompt: string; note: string; mustShow?: string; framing?: string }): Promise<{ prompt: string; change: string }> {
  const run = await chatJson<{ change: string; image_prompt: string }>(
    planner,
    {
      system,
      thinking: false,
      temperature: 0.4,
      user: `The client asked for a change to shot ${input.shot}: "${input.note}"
Current image prompt (the shot's first frame, picture words): ${input.prompt}
${input.framing ? `Framing: ${input.framing}. ` : ''}${input.mustShow ? `The frame must still show: ${input.mustShow}.` : ''}
Rewrite the image prompt so the frame carries the client's note and nothing else changes: keep the framing, copy any quoted label text character for character, English picture words only, no on-screen text. First say in one sentence what you change.
Return JSON only: {"change": "...", "image_prompt": "..."}`,
    },
    (value) => checkShotPrompt(input.prompt, value.image_prompt),
    3,
  )
  if (run.unresolved.length) throw new Error(`the storyboard artist could not apply the note to shot ${input.shot}: ${run.unresolved.join('; ').slice(0, 200)}`)
  return { prompt: run.value.image_prompt.trim(), change: run.value.change ?? '' }
}

/** A Chinese subtitle for a changed English line: what an audience reads, within the line width, a space for commas and full stops. */
export function checkSubtitle(zh: string | undefined, maxChars: number): string[] {
  if (!zh?.trim()) return ['"zh" is empty']
  const problems: string[] = []
  if (!CJK.test(zh)) problems.push('the subtitle must be Chinese')
  if ([...zh.replace(/\s/g, '')].length > maxChars) problems.push(`at most ${maxChars} characters on this frame`)
  if (/[，。,.！!？?]$|[，。,.]/.test(zh)) problems.push('a space instead of commas and full stops, no closing punctuation')
  return problems
}

/** The bilingual copy editor translates a changed line into its subtitle when the client gave only the English. */
export async function translateSubtitle(editor: ModelEndpoint, system: string, input: { en: string; maxChars: number; context: string }): Promise<string> {
  const run = await chatJson<{ zh: string }>(
    editor,
    {
      system,
      thinking: false,
      temperature: 0.3,
      user: `${input.context}
Translate this English line into its Chinese subtitle: "${input.en}"
A subtitle an audience reads, not a gloss: natural Chinese that says what the English says, at most ${input.maxChars} characters, a space instead of commas and full stops.
Return JSON only: {"zh": "中文字幕"}`,
    },
    (value) => checkSubtitle(value.zh, input.maxChars),
    3,
  )
  if (run.unresolved.length) throw new Error(`no usable subtitle came back for "${input.en}" (${run.unresolved.join('; ')}); pass --zh`)
  return run.value.zh.trim()
}
