import { badRequest, forbidden, notFound } from '../../lib/httpError.js'
import { assertWithinQuota } from '../../lib/quotas.js'
import {
  canAddCollocationToDeck,
  canManageCollocation,
  canMoveCollocation,
  canViewCollocation,
} from '../access/permissions.js'
import { findVisibleDeck } from '../decks/decks.service.js'
import { COLUMN_OF_FIELD } from './collocations.schemas.js'

// Collocation = dòng trong bảng `phrases` có kind <> 'phrase' (migration 022). Chia sẻ theo luật
// của từ vựng (access/permissions.js): mục trong chủ đề nhóm thì mọi thành viên xem/ôn được, mỗi
// người một tiến trình học riêng (phrase_progress theo user_id).

const IS_COLLOCATION = "p.kind <> 'phrase'"

// Hình dạng trả ra ngoài: `phrase` đổi tên thành `pattern`, kèm tiến trình học của NGƯỜI GỌI ($1).
const SELECT_COLUMNS = `p.id, p.user_id, p.deck_id, p.kind, p.headword, p.phrase as pattern, p.answer,
       p.pattern_group, p.mistakes, p.meaning, p.usage_context, p.example, p.created_at,
       pp.ease_factor, pp.stability, pp.difficulty, pp.interval_days, pp.repetitions, pp.due_at, pp.last_reviewed_at`
const FROM = `from phrases p
       left join decks d on d.id = p.deck_id
       left join phrase_progress pp on pp.phrase_id = p.id and pp.user_id = $1`
// Tương đương canViewCollocation() — $1 = userId, $2 = isSystemAdmin.
const SQL_VISIBLE = `(p.user_id = $1
       or (d.group_id is not null and ($2 or exists (
             select 1 from group_members gm where gm.group_id = d.group_id and gm.user_id = $1))))`

const deckNotFound = () => badRequest('deck_not_found', 'Chủ đề không tồn tại hoặc bạn không có quyền truy cập.')
const notFoundCollocation = () => notFound('Không tìm thấy collocation.')
const cannotManage = () => forbidden('Chỉ trưởng nhóm mới sửa/xoá được collocation trong chủ đề của nhóm.')

// Lấy 1 collocation (kèm chủ đề chứa nó) mà người gọi XEM ĐƯỢC; không có hoặc không được xem → null.
// Dùng cả ở module nhật ký ôn tập.
export async function findVisibleCollocation(db, id, ctx) {
  const { rows } = await db.query(
    `select row_to_json(p.*) as item, row_to_json(d.*) as deck
       from phrases p left join decks d on d.id = p.deck_id
      where p.id = $1 and ${IS_COLLOCATION}`,
    [id],
  )
  const found = rows[0]
  return found && canViewCollocation(found.item, found.deck, ctx) ? found : null
}

// Đáp án không được nằm luôn trong danh sách "dạng sai" — nếu không bài luyện sẽ có 2 đáp án đúng.
function assertAnswerNotInMistakes({ answer, mistakes }) {
  const key = answer.trim().toLowerCase()
  if (mistakes.some((m) => m.toLowerCase() === key)) {
    throw badRequest('answer_in_mistakes', 'Phần cần nhớ không được trùng với một dạng sai.')
  }
}

export function createCollocationsService({ pool, quotas }) {
  async function getOne(ctx, id) {
    const { rows } = await pool.query(`select ${SELECT_COLUMNS} ${FROM} where p.id = $2`, [ctx.userId, id])
    return rows[0]
  }

  async function list(ctx) {
    const { rows } = await pool.query(
      `select ${SELECT_COLUMNS} ${FROM}
        where ${IS_COLLOCATION} and ${SQL_VISIBLE}
        order by p.created_at desc, p.id`,
      [ctx.userId, ctx.isSystemAdmin],
    )
    return rows
  }

  async function assertCanAddTo(deckIds, ctx) {
    for (const deckId of new Set(deckIds.filter(Boolean))) {
      const deck = await findVisibleDeck(pool, deckId, ctx)
      if (!deck) throw deckNotFound()
      if (!canAddCollocationToDeck(deck, ctx)) throw forbidden('Bạn không có quyền thêm vào chủ đề này.')
    }
  }

  // Thêm 1 hoặc nhiều mục trong CÙNG 1 câu lệnh (tất cả hoặc không gì cả). Trigger
  // phrases_after_insert tự tạo dòng phrase_progress cho người thêm.
  async function insertMany(ctx, items) {
    const { userId } = ctx
    items.forEach(assertAnswerNotInMistakes)
    await assertCanAddTo(
      items.map((c) => c.deck_id),
      ctx,
    )
    await assertWithinQuota(pool, {
      table: 'phrases',
      filter: "kind <> 'phrase'",
      userId,
      adding: items.length,
      max: quotas.collocations,
      what: 'collocation',
    })
    try {
      const { rows } = await pool.query(
        `insert into phrases (user_id, deck_id, kind, headword, phrase, answer, pattern_group, mistakes,
                              meaning, usage_context, example)
         select $1, x.deck_id, x.kind, x.headword, x.pattern, x.answer, x.pattern_group, x.mistakes,
                x.meaning, x.usage_context, x.example
         from unnest($2::jsonb[]) with ordinality as t(j, i),
              jsonb_to_record(t.j) as x(deck_id uuid, kind text, headword text, pattern text, answer text,
                                        pattern_group text, mistakes text[], meaning text,
                                        usage_context text, example text)
         order by t.i
         returning id`,
        [userId, items.map((c) => JSON.stringify(c))],
      )
      // Đọc lại theo đúng hình dạng trả ra ngoài (pattern + tiến trình), giữ thứ tự đã gửi.
      const { rows: full } = await pool.query(`select ${SELECT_COLUMNS} ${FROM} where p.id = any($2::uuid[])`, [
        userId,
        rows.map((r) => r.id),
      ])
      const byId = new Map(full.map((r) => [r.id, r]))
      return rows.map((r) => byId.get(r.id))
    } catch (err) {
      if (err.code === '23503') throw deckNotFound() // chủ đề bị xoá giữa lúc kiểm tra và thêm
      throw err
    }
  }

  const create = async (ctx, item) => (await insertMany(ctx, [item]))[0]
  const bulkCreate = (ctx, items) => insertMany(ctx, items)

  async function loadForChange(ctx, id) {
    const found = await findVisibleCollocation(pool, id, ctx)
    if (!found) throw notFoundCollocation()
    return found
  }

  async function update(ctx, id, patch) {
    const { item, deck } = await loadForChange(ctx, id)
    if (!canManageCollocation(item, deck, ctx)) throw cannotManage()

    if (patch.deck_id !== undefined && patch.deck_id !== item.deck_id) {
      const target = patch.deck_id ? await findVisibleDeck(pool, patch.deck_id, ctx) : null
      if (patch.deck_id && !target) throw deckNotFound()
      if (!canMoveCollocation(item, deck, target, ctx)) {
        throw forbidden('Bạn không có quyền chuyển collocation sang chủ đề này.')
      }
    }
    if (patch.answer !== undefined || patch.mistakes !== undefined) {
      assertAnswerNotInMistakes({ answer: patch.answer ?? item.answer, mistakes: patch.mistakes ?? item.mistakes })
    }

    const keys = Object.keys(COLUMN_OF_FIELD).filter((k) => patch[k] !== undefined)
    const sets = keys.map((k, i) => `${COLUMN_OF_FIELD[k]} = $${i + 2}`)
    await pool.query(`update phrases set ${sets.join(', ')} where id = $1`, [id, ...keys.map((k) => patch[k])])
    return getOne(ctx, id)
  }

  async function remove(ctx, id) {
    const { item, deck } = await loadForChange(ctx, id)
    if (!canManageCollocation(item, deck, ctx)) throw cannotManage()
    await pool.query('delete from phrases where id = $1', [id])
  }

  // Ghi kết quả ôn. Ai XEM được thì ôn được (thành viên nhóm ôn mục người khác thêm); người chưa
  // có dòng tiến trình (không phải người thêm) được tạo dòng mới ngay lúc này.
  async function updateProgress(ctx, id, fields) {
    if (!(await findVisibleCollocation(pool, id, ctx))) throw notFoundCollocation()
    const cols = Object.keys(fields) // đã qua schema: chỉ các cột SRS cố định
    const { rows } = await pool.query(
      `insert into phrase_progress (phrase_id, user_id, ${cols.join(', ')})
       values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')})
       on conflict (phrase_id, user_id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}
       returning *`,
      [id, ctx.userId, ...cols.map((c) => fields[c])],
    )
    return rows[0]
  }

  return { list, create, bulkCreate, update, remove, updateProgress }
}
