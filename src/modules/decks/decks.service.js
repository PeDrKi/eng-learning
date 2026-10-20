import { assertWithinQuota } from '../../lib/quotas.js'
import { badRequest, forbidden, notFound } from '../../lib/httpError.js'
import { SQL_CAN_VIEW_DECK } from '../access/accessContext.js'
import { assertChapterFitsDeck } from '../chapters/chapters.service.js'
import { canCreateDeck, canManageDeck, canViewDeck } from '../access/permissions.js'

const DEFAULT_COLOR = '#C9A15E'

// Lấy 1 chủ đề mà người dùng XEM ĐƯỢC. Không tồn tại và không được xem đều trả 404 như nhau
// — không để lộ chủ đề của người khác có tồn tại hay không.
export async function findVisibleDeck(db, deckId, ctx) {
  const { rows } = await db.query('select * from decks where id = $1', [deckId])
  const deck = rows[0]
  return deck && canViewDeck(deck, ctx) ? deck : null
}

export function createDecksService({ pool, quotas }) {
  const assertDeckQuota = (userId, adding) =>
    assertWithinQuota(pool, { table: 'decks', userId, adding, max: quotas.decks, what: 'chủ đề con' })

  async function list(ctx) {
    const { userId } = ctx
    const { rows } = await pool.query(
      `select d.* from decks d where ${SQL_CAN_VIEW_DECK} order by d.created_at asc, d.id`,
      [userId, ctx.isSystemAdmin],
    )
    return rows
  }

  async function create(ctx, { name, color, group_id, chapter_id }) {
    const { userId } = ctx
    if (!canCreateDeck(group_id, ctx)) {
      throw forbidden('Chỉ trưởng nhóm mới tạo được chủ đề con cho nhóm.')
    }
    await assertChapterFitsDeck(pool, chapter_id, { user_id: userId, group_id: group_id ?? null }, ctx)
    await assertDeckQuota(userId, 1)
    try {
      const { rows } = await pool.query(
        'insert into decks (user_id, group_id, name, color, chapter_id) values ($1, $2, $3, $4, $5) returning *',
        [userId, group_id ?? null, name, color ?? DEFAULT_COLOR, chapter_id ?? null],
      )
      return rows[0]
    } catch (err) {
      // Chỉ super admin mới tới được đây với group_id không tồn tại.
      if (err.code === '23503') throw badRequest('group_not_found', 'Nhóm không tồn tại.')
      throw err
    }
  }

  async function bulkCreate({ userId }, decks) {
    await assertDeckQuota(userId, decks.length)
    const { rows } = await pool.query(
      `insert into decks (user_id, name, color)
       select $1, x.name, coalesce(x.color, $3)
       from unnest($2::jsonb[]) with ordinality as t(j, i),
            jsonb_to_record(t.j) as x(name text, color text)
       order by t.i
       returning *`,
      [userId, decks.map((d) => JSON.stringify(d)), DEFAULT_COLOR],
    )
    return rows
  }

  async function getManageable(ctx, deckId) {
    const deck = await findVisibleDeck(pool, deckId, ctx)
    if (!deck) throw notFound('Không tìm thấy chủ đề con.')
    if (!canManageDeck(deck, ctx)) throw forbidden('Chỉ trưởng nhóm mới sửa/xoá được chủ đề con của nhóm.')
    return deck
  }

  async function update(ctx, deckId, patch) {
    const deck = await getManageable(ctx, deckId)
    const chapterGiven = patch.chapter_id !== undefined
    if (chapterGiven) await assertChapterFitsDeck(pool, patch.chapter_id, deck, ctx)
    const { rows } = await pool.query(
      `update decks set name = coalesce($2, name), color = coalesce($3, color),
         chapter_id = case when $4 then $5::uuid else chapter_id end
       where id = $1 returning *`,
      [deckId, patch.name ?? null, patch.color ?? null, chapterGiven, patch.chapter_id ?? null],
    )
    return rows[0]
  }

  // Xoá chủ đề: từ vựng & câu giao tiếp bên trong KHÔNG bị xoá mà chuyển về "chưa phân loại"
  // (deck_id = null, do khoá ngoại `on delete set null`) — với chủ đề nhóm, mỗi từ trở thành
  // từ cá nhân của chính người đã thêm từ đó. Giữ nguyên hành vi của bản Supabase.
  async function remove(ctx, deckId) {
    await getManageable(ctx, deckId)
    await pool.query('delete from decks where id = $1', [deckId])
  }

  return { list, create, bulkCreate, update, remove }
}
