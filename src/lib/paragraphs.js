// Cắt văn bản bài đọc thành các đoạn — GIỐNG HỆT tuvung-react/src/lib/readingNotes.js splitParagraphs
// (bản dịch `translations[i]` ứng với đoạn thứ i). Bài ngắn ('short') luôn là 1 đoạn.
export function splitParagraphs(text) {
  const out = []
  if (!text) return out
  const re = /\n[ \t]*\n\s*/g
  let pos = 0
  for (const m of text.matchAll(re)) {
    if (text.slice(pos, m.index).trim()) out.push({ start: pos, text: text.slice(pos, m.index) })
    pos = m.index + m[0].length
  }
  if (text.slice(pos).trim()) out.push({ start: pos, text: text.slice(pos) })
  return out
}

export function readingParagraphs(reading) {
  if (reading.kind === 'short') return reading.content.trim() ? [{ start: 0, text: reading.content }] : []
  return splitParagraphs(reading.content)
}
