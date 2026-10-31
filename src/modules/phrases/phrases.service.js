import { assertWithinQuota } from '../../lib/quotas.js'
import { badRequest, notFound } from '../../lib/httpError.js'
import { findVisibleDeck } from '../decks/decks.service.js'
import { PHRASE_FIELDS } from './phrases.schemas.js'

// Câu giao tiếp là sổ tay CÁ NHÂN: chỉ chủ sở hữu xem/sửa/xoá, không chia sẻ trong nhóm, kể
// cả với super admin. Được gắn vào bất kỳ chủ đề nào mình đang XEM ĐƯỢC (chủ đề riêng hoặc
// chủ đề của nhóm mình tham gia) — giống danh sách chủ đề FE cho chọn trong form.
// Sau này mất quyền xem chủ đề đó (rời nhóm) thì câu vẫn giữ deck_id cũ; FE tự ẩn nhãn chủ
// đề vì không tìm thấy tên, câu giao tiếp vẫn còn nguyên.
//
// Bảng `phrases` còn chứa collocation (kind <> 'phrase', migration 022) — module này CHỈ đụng
// tới câu giao tiếp; collocation có module riêng (modules/collocations) với luật chia sẻ khác.

const deckNotFound = () => badRequest('deck_not_found', 'Chủ đề không tồn tại hoặc bạn không có quyền truy cập.')

export function createPhrasesService({ pool, quotas }) {
  async function assertDeckUsable(ctx, deckId) {
    if (!deckId) return
    const deck = await findVisibleDeck(pool, deckId, ctx)
    // Chủ đề cộng đồng đã lưu (của người khác) chỉ để học, không gắn câu của mình vào được.
    if (!deck || (!deck.group_id && deck.user_id !== ctx.userId)) throw deckNotFound()
  }

  // Trả kèm tiến trình học của câu (migration 006) — như GET /words, để FE không phải gọi thêm.
  async function list({ userId }) {
    const { rows } = await pool.query(
      `select p.*, pp.ease_factor, pp.stability, pp.difficulty, pp.interval_days, pp.repetitions, pp.due_at, pp.last_reviewed_at
         from phrases p
         left join phrase_progress pp on pp.phrase_id = p.id and pp.user_id = p.user_id
        where p.user_id = $1 and p.kind = 'phrase'
        order by p.created_at desc, p.id`,
      [userId],
    )
    return rows
  }

  // Ghi kết quả ôn một câu. Chỉ nhận các trường SRS; câu không phải của mình → 404 như mọi thao
  // tác khác trong module này.
  async function updateProgress({ userId }, phraseId, fields) {
    await findOwn(userId, phraseId)
    const cols = Object.keys(fields)
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ')
    const { rows } = await pool.query(
      `update phrase_progress set ${sets} where phrase_id = $1 and user_id = $2 returning *`,
      [phraseId, userId, ...cols.map((c) => fields[c])],
    )
    if (!rows[0]) throw notFound('Không tìm thấy tiến trình học của câu này.')
    return rows[0]
  }

  async function create(ctx, data) {
    const { userId } = ctx
    await assertDeckUsable(ctx, data.deck_id)
    await assertWithinQuota(pool, {
      table: 'phrases',
      filter: "kind = 'phrase'",
      userId,
      max: quotas.phrases,
      what: 'câu giao tiếp',
    })
    try {
      const { rows } = await pool.query(
        `insert into phrases (user_id, deck_id, phrase, meaning, usage_context, example, formality)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [userId, data.deck_id, data.phrase, data.meaning, data.usage_context, data.example, data.formality],
      )
      return rows[0]
    } catch (err) {
      if (err.code === '23503') throw deckNotFound()
      throw err
    }
  }

  // Không phải của mình → 404 (không phân biệt với "không tồn tại").
  async function findOwn(userId, id) {
    const { rows } = await pool.query("select * from phrases where id = $1 and user_id = $2 and kind = 'phrase'", [
      id,
      userId,
    ])
    if (!rows[0]) throw notFound('Không tìm thấy câu giao tiếp.')
    return rows[0]
  }

  async function update(ctx, id, patch) {
    const { userId } = ctx
    const current = await findOwn(userId, id)
    if (patch.deck_id !== undefined && patch.deck_id !== current.deck_id) {
      await assertDeckUsable(ctx, patch.deck_id)
    }
    const keys = PHRASE_FIELDS.filter((k) => patch[k] !== undefined) // tên cột từ danh sách cố định
    const sets = keys.map((k, i) => `${k} = $${i + 3}`)
    try {
      const { rows } = await pool.query(
        `update phrases set ${sets.join(', ')} where id = $1 and user_id = $2 and kind = 'phrase' returning *`,
        [id, userId, ...keys.map((k) => patch[k])],
      )
      return rows[0]
    } catch (err) {
      if (err.code === '23503') throw deckNotFound()
      throw err
    }
  }

  async function remove({ userId }, id) {
    const { rowCount } = await pool.query("delete from phrases where id = $1 and user_id = $2 and kind = 'phrase'", [
      id,
      userId,
    ])
    if (rowCount === 0) throw notFound('Không tìm thấy câu giao tiếp.')
  }

  return { list, create, updateProgress, update, remove }
}
