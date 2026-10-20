import { z } from 'zod'

const text = (max, label) => z.string().trim().max(max, `${label} tối đa ${max} ký tự.`)

// Nhãn: bỏ trống, bỏ trùng (không phân biệt hoa/thường), giữ dạng chữ người dùng gõ —
// cùng quy tắc với parseTagsInput() ở FE.
const tags = z
  .array(z.string().trim().max(50, 'Mỗi nhãn tối đa 50 ký tự.'))
  .max(30, 'Tối đa 30 nhãn mỗi từ.')
  .transform((list) => {
    const seen = new Set()
    return list.filter((t) => {
      const key = t.toLowerCase()
      if (!t || seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

// Mã từ loại — PHẢI khớp với migration 015 và lib/partsOfSpeech.js (FE).
export const POS_CODES = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'determiner',
  'article',
  'interjection',
  'numeral',
  'auxiliary',
  'modal',
  'phrasal_verb',
  'idiom',
  'abbreviation',
  'prefix',
  'suffix',
]

// Bỏ trùng, giữ thứ tự người dùng chọn.
const pos = z
  .array(z.enum(POS_CODES, { error: 'Từ loại không hợp lệ.' }))
  .max(POS_CODES.length)
  .transform((list) => [...new Set(list)])

const fields = {
  word: z.string({ error: 'Vui lòng nhập từ.' }).trim().min(1, 'Vui lòng nhập từ.').max(200, 'Từ tối đa 200 ký tự.'),
  meaning: z
    .string({ error: 'Vui lòng nhập nghĩa.' })
    .trim()
    .min(1, 'Vui lòng nhập nghĩa.')
    .max(1000, 'Nghĩa tối đa 1000 ký tự.'),
  example: text(2000, 'Câu ví dụ'),
  ipa: text(200, 'IPA'),
  // Chỉ nhận link http(s) (hoặc để trống): link này được trình duyệt của MỌI thành viên nhóm tải
  // khi bấm phát âm, nên không cho các dạng khác (javascript:, data:, file:...).
  audio_url: text(2000, 'Link phát âm').refine(
    (v) => v === '' || /^https?:\/\/\S+$/i.test(v),
    'Link phát âm phải bắt đầu bằng http:// hoặc https://.',
  ),
  tags,
  pos,
  deck_id: z.uuid('deck_id không hợp lệ.').nullable(),
}

const newWord = z.object({
  word: fields.word,
  meaning: fields.meaning,
  example: fields.example.default(''),
  ipa: fields.ipa.default(''),
  audio_url: fields.audio_url.default(''),
  tags: fields.tags.default([]),
  pos: fields.pos.default([]),
  deck_id: fields.deck_id.default(null),
})

export const createWordSchema = newWord

export const bulkCreateWordsSchema = z.object({
  words: z.array(newWord).min(1, 'Danh sách từ trống.').max(1000, 'Tối đa 1000 từ mỗi lần.'),
})

// Chỉ gửi những field muốn đổi. Các field tiến trình học (due_at, ease_factor...) KHÔNG sửa
// ở đây — thuộc bảng word_progress, có endpoint riêng.
export const updateWordSchema = z
  .object({
    word: fields.word.optional(),
    meaning: fields.meaning.optional(),
    example: fields.example.optional(),
    ipa: fields.ipa.optional(),
    audio_url: fields.audio_url.optional(),
    tags: fields.tags.optional(),
    pos: fields.pos.optional(),
    deck_id: fields.deck_id.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')
