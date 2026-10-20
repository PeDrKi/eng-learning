import { z } from 'zod'
import { notFound } from '../../lib/httpError.js'
import { decodeCursor, toPage } from '../../lib/pagination.js'
import { findVisibleWord } from '../words/words.service.js'
import { PROGRESS_FIELDS } from './progress.schemas.js'

// Tiến trình học luôn là của RIÊNG từng người: mỗi người có 1 dòng word_progress cho mỗi từ
// mình học, kể cả từ dùng chung trong nhóm. Không ai đọc/ghi được tiến trình của người khác
// qua các endpoint này (dashboard trưởng nhóm có endpoint riêng ở module Nhóm).
const progressCursor = z.object({ id: z.uuid() })

export function createProgressService({ pool }) {
  // Không truyền `limit` → trả mảng đầy đủ; có `limit` → 1 trang { items, next_cursor }, xếp
  // theo word_id (mỗi người chỉ có 1 dòng cho mỗi từ nên word_id đủ làm mốc).
  async function listMine({ userId }, { limit, cursor } = {}) {
    if (limit === undefined) {
      const { rows } = await pool.query('select * from word_progress where user_id = $1', [userId])
      return rows
    }
    const after = decodeCursor(cursor, progressCursor)
    const { rows } = await pool.query(
      `select * from word_progress
       where user_id = $1 and ($2::uuid is null or word_id > $2::uuid)
       order by word_id
       limit $3`,
      [userId, after?.id ?? null, limit + 1],
    )
    return toPage(rows, limit, (r) => ({ id: r.word_id }))
  }

  // Ghi (tạo nếu chưa có) tiến trình của MÌNH cho 1 từ. Chỉ các field gửi lên bị đổi.
  // Chưa có dòng là chuyện bình thường với từ người khác thêm vào chủ đề nhóm: trigger chỉ
  // tạo sẵn dòng cho người thêm từ, các thành viên khác có dòng khi học lần đầu.
  async function upsertMine(ctx, wordId, patch) {
    const { userId } = ctx
    if (!(await findVisibleWord(pool, wordId, ctx))) throw notFound('Không tìm thấy từ.')

    const keys = PROGRESS_FIELDS.filter((k) => patch[k] !== undefined) // tên cột từ danh sách cố định
    const cols = ['word_id', 'user_id', ...keys]
    const placeholders = cols.map((_, i) => `$${i + 1}`)
    const updates = keys.map((k) => `${k} = excluded.${k}`)
    try {
      const { rows } = await pool.query(
        `insert into word_progress (${cols.join(', ')}) values (${placeholders.join(', ')})
         on conflict (word_id, user_id) do update set ${updates.join(', ')}
         returning *`,
        [wordId, userId, ...keys.map((k) => patch[k])],
      )
      return rows[0]
    } catch (err) {
      if (err.code === '23503') throw notFound('Không tìm thấy từ.') // từ vừa bị xoá
      throw err
    }
  }

  return { listMine, upsertMine }
}
