import { assertWithinQuota } from '../../lib/quotas.js'
import { badRequest, forbidden, notFound } from '../../lib/httpError.js'
import { SQL_CAN_VIEW_DECK } from '../access/accessContext.js'
import { canCreateDeck, canManageDeck, canViewDeck } from '../access/permissions.js'

// Chương có cùng hình dạng phân quyền với chủ đề (user_id + group_id): cá nhân thì chỉ chủ sở
// hữu thấy và sửa; của nhóm thì thành viên thấy, trưởng nhóm sửa. Nên dùng lại đúng các luật
// của chủ đề thay vì viết bộ luật thứ hai dễ lệch nhau.

export async function findVisibleChapter(db, chapterId, ctx) {
  const { rows } = await db.query('select * from chapters where id = $1', [chapterId])
  const chapter = rows[0]
  return chapter && canViewDeck(chapter, ctx) ? chapter : null
}

// Chủ đề chỉ vào được chương CÙNG PHẠM VI: chủ đề cá nhân → chương cá nhân của cùng người;
// chủ đề nhóm → chương của đúng nhóm đó. Không để chủ đề nhóm lọt vào chương cá nhân của ai
// (thành viên khác sẽ không thấy chương đó), và ngược lại.
export function sameScope(deck, chapter) {
  if ((deck.group_id ?? null) !== (chapter.group_id ?? null)) return false
  return deck.group_id ? true : deck.user_id === chapter.user_id
}

// Kiểm tra `chapterId` gắn được vào `deck`. null = bỏ khỏi chương (luôn được).
export async function assertChapterFitsDeck(db, chapterId, deck, ctx) {
  if (chapterId == null) return
  const chapter = await findVisibleChapter(db, chapterId, ctx)
  if (!chapter) throw badRequest('chapter_not_found', 'Chủ đề không tồn tại.')
  if (!sameScope(deck, chapter)) {
    throw badRequest('chapter_scope_mismatch', 'Chủ đề con và chủ đề phải cùng là của bạn, hoặc cùng của một nhóm.')
  }
}

export function createChaptersService({ pool, quotas }) {
  async function list(ctx) {
    const { rows } = await pool.query(
      `select d.* from chapters d where ${SQL_CAN_VIEW_DECK} order by d.created_at asc, d.id`,
      [ctx.userId, ctx.isSystemAdmin],
    )
    return rows
  }

  async function create(ctx, { name, group_id }) {
    if (!canCreateDeck(group_id, ctx)) throw forbidden('Chỉ trưởng nhóm mới tạo được chủ đề cho nhóm.')
    await assertWithinQuota(pool, { table: 'chapters', userId: ctx.userId, max: quotas.decks, what: 'chủ đề' })
    try {
      const { rows } = await pool.query(
        'insert into chapters (user_id, group_id, name) values ($1, $2, $3) returning *',
        [ctx.userId, group_id ?? null, name],
      )
      return rows[0]
    } catch (err) {
      if (err.code === '23503') throw badRequest('group_not_found', 'Nhóm không tồn tại.')
      throw err
    }
  }

  async function getManageable(ctx, chapterId) {
    const chapter = await findVisibleChapter(pool, chapterId, ctx)
    if (!chapter) throw notFound('Không tìm thấy chủ đề.')
    if (!canManageDeck(chapter, ctx)) throw forbidden('Chỉ trưởng nhóm mới sửa/xoá được chủ đề của nhóm.')
    return chapter
  }

  async function update(ctx, chapterId, { name }) {
    await getManageable(ctx, chapterId)
    const { rows } = await pool.query('update chapters set name = $2 where id = $1 returning *', [chapterId, name])
    return rows[0]
  }

  // Xoá chương KHÔNG xoá chủ đề bên trong: khoá ngoại `on delete set null` đưa chúng về "chưa
  // xếp chương".
  async function remove(ctx, chapterId) {
    await getManageable(ctx, chapterId)
    await pool.query('delete from chapters where id = $1', [chapterId])
  }

  return { list, create, update, remove }
}
