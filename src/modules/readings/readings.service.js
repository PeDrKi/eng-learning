import { assertWithinQuota } from '../../lib/quotas.js'
import { badRequest, notFound } from '../../lib/httpError.js'
import { MAX_SHORT_CONTENT, SHORT_TOO_LONG } from './readings.schemas.js'

// Bài đọc + ghi chú (migration 019) — sổ tay CÁ NHÂN: không phải của mình thì coi như không tồn tại.
export function createReadingsService({ pool, quotas }) {
  // Bộ bài đọc phải là của chính mình (migration 031). Trả về vị trí cuối bộ để xếp bài mới vào sau cùng.
  async function nextPositionIn(userId, collectionId) {
    const { rows } = await pool.query(
      `select coalesce((select max(position) + 1 from readings where collection_id = c.id), 0) as next
         from reading_collections c where c.id = $1 and c.user_id = $2`,
      [collectionId, userId],
    )
    if (!rows[0]) throw badRequest('collection_not_found', 'Bộ bài đọc không tồn tại.')
    return rows[0].next
  }

  async function list({ userId }) {
    const { rows } = await pool.query('select * from readings where user_id = $1 order by updated_at desc, id', [
      userId,
    ])
    return rows
  }

  async function create({ userId }, data) {
    await assertWithinQuota(pool, { table: 'readings', userId, max: quotas.readings, what: 'bài đọc' })
    let position = 0
    if (data.collection_id) {
      const next = await nextPositionIn(userId, data.collection_id)
      position = data.position ?? next
    }
    const { rows } = await pool.query(
      `insert into readings (user_id, kind, title, content, notes, translations, collection_id, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        userId,
        data.kind,
        data.title,
        data.content,
        JSON.stringify(data.notes),
        JSON.stringify(data.translations),
        data.collection_id,
        position,
      ],
    )
    return rows[0]
  }

  async function update({ userId }, id, patch) {
    // Chuyển bài sang bộ khác (hoặc về "Ghi chú"): không chỉ định vị trí thì xếp cuối bộ mới.
    if (patch.collection_id !== undefined && patch.position === undefined) {
      patch = { ...patch, position: patch.collection_id ? await nextPositionIn(userId, patch.collection_id) : 0 }
    } else if (patch.collection_id) await nextPositionIn(userId, patch.collection_id)
    const sets = []
    const values = [id, userId]
    let guard = ''
    for (const key of ['title', 'content', 'notes', 'translations', 'collection_id', 'position']) {
      if (patch[key] === undefined) continue
      values.push(key === 'notes' || key === 'translations' ? JSON.stringify(patch[key]) : patch[key])
      sets.push(`${key} = $${values.length}`)
      // Bài NGẮN có giới hạn độ dài riêng; loại bài nằm ở DB (không có trong body) nên kiểm tra ngay
      // trong câu UPDATE.
      if (key === 'content') guard = ` and (kind <> 'short' or char_length($${values.length}) <= ${MAX_SHORT_CONTENT})`
    }
    const { rows } = await pool.query(
      `update readings set ${sets.join(', ')}, updated_at = now() where id = $1 and user_id = $2${guard} returning *`,
      values,
    )
    if (rows[0]) return rows[0]
    if (guard) {
      const { rowCount } = await pool.query('select 1 from readings where id = $1 and user_id = $2', [id, userId])
      if (rowCount) throw badRequest('validation_failed', SHORT_TOO_LONG)
    }
    throw notFound('Không tìm thấy bài đọc.')
  }

  async function remove({ userId }, id) {
    const { rowCount } = await pool.query('delete from readings where id = $1 and user_id = $2', [id, userId])
    if (rowCount === 0) throw notFound('Không tìm thấy bài đọc.')
  }

  return { list, create, update, remove }
}
