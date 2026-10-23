import { assertWithinQuota } from '../../lib/quotas.js'
import { notFound } from '../../lib/httpError.js'

// Bài đọc + ghi chú (migration 019) — sổ tay CÁ NHÂN: không phải của mình thì coi như không tồn tại.
export function createReadingsService({ pool, quotas }) {
  async function list({ userId }) {
    const { rows } = await pool.query('select * from readings where user_id = $1 order by updated_at desc, id', [
      userId,
    ])
    return rows
  }

  async function create({ userId }, data) {
    await assertWithinQuota(pool, { table: 'readings', userId, max: quotas.readings, what: 'bài đọc' })
    const { rows } = await pool.query(
      'insert into readings (user_id, title, content, notes) values ($1, $2, $3, $4) returning *',
      [userId, data.title, data.content, JSON.stringify(data.notes)],
    )
    return rows[0]
  }

  async function update({ userId }, id, patch) {
    const sets = []
    const values = [id, userId]
    for (const key of ['title', 'content', 'notes']) {
      if (patch[key] === undefined) continue
      values.push(key === 'notes' ? JSON.stringify(patch[key]) : patch[key])
      sets.push(`${key} = $${values.length}`)
    }
    const { rows } = await pool.query(
      `update readings set ${sets.join(', ')}, updated_at = now() where id = $1 and user_id = $2 returning *`,
      values,
    )
    if (!rows[0]) throw notFound('Không tìm thấy bài đọc.')
    return rows[0]
  }

  async function remove({ userId }, id) {
    const { rowCount } = await pool.query('delete from readings where id = $1 and user_id = $2', [id, userId])
    if (rowCount === 0) throw notFound('Không tìm thấy bài đọc.')
  }

  return { list, create, update, remove }
}
