/** Pull the first JSON object out of a model reply that may wrap it in prose or a code fence. */
export function extractJson<T>(reply: string): T {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`)
  const raw = reply.slice(start, end + 1)
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    // Small models trip over trailing commas and typographic quotes; repair those before giving up.
    const repaired = raw.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"')
    try {
      return JSON.parse(repaired) as T
    } catch {
      throw error
    }
  }
}
