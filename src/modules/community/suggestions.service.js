import { withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/httpError.js'
import { assertCommunityAllowed } from './guard.js'
import { assertWithinQuota } from '../../lib/quotas.js'
import { sqlPublicIdentity } from '../../lib/publicName.js'
import { SUGGESTION_FIELDS } from './community.schemas.js'

// Đề xuất chỉnh sửa (giai đoạn 3) — giống "pull request" cho chủ đề công khai: người khác đề xuất
// sửa / thêm / xoá từ, CHỈ chủ chủ đề áp dụng (Đồng ý) hoặc từ chối, có thể kèm ghi chú. Người
// đề xuất xem kết quả ở "Đề xuất của tôi".
//
// `base` lưu nội dung từ lúc đề xuất. Lúc duyệt mà từ đã khác `base` (chủ sở hữu hoặc một đề xuất
// khác đã sửa) → XUNG ĐỘT: báo 409, người duyệt xem lại rồi gửi force=true nếu vẫn muốn áp dụng.
// Từ đã bị xoá / chuyển khỏi chủ đề → đề xuất sửa/xoá thành `stale` (hết ý nghĩa).

const notFoundSuggestion = () => notFound('Không tìm thấy đề xuất.')
const deckNotFound = () => notFound('Không tìm thấy chủ đề công khai.')

const pickFields = (row) => Object.fromEntries(SUGGESTION_FIELDS.map((f) => [f, row[f] ?? '']))
const sameContent = (a, b) => SUGGESTION_FIELDS.every((f) => (a?.[f] ?? '') === (b?.[f] ?? ''))

// Cột trả ra cho 1 đề xuất. $1 = người gọi. `current` = nội dung HIỆN TẠI của từ (để so sánh
// bản cũ/bản đề xuất), null nếu từ không còn.
const SUGGESTION_COLUMNS = `s.id, s.deck_id, s.word_id, s.kind, s.base, s.proposed, s.reason, s.status, s.review_note,
       s.created_at, s.reviewed_at, ${sqlPublicIdentity('author')}, (s.user_id = $1) as mine,
       case when w.id is null then null
            else jsonb_build_object('word', w.word, 'meaning', w.meaning, 'meaning_en', coalesce(w.meaning_en, ''),
                                    'example', coalesce(w.example, ''), 'ipa', coalesce(w.ipa, '')) end as current`

function withConflict(row) {
  const conflictNow =
    row.status === 'pending' && row.kind !== 'add' && row.current && !sameContent(row.current, row.base)
  return { ...row, conflict: Boolean(conflictNow) }
}

export function createSuggestionsService({ pool, quotas, requireVerifiedEmail = false, notify = async () => {} }) {
  async function findDeck(db, userId, deckId) {
    const { rows } = await db.query(
      `select d.*, exists (select 1 from deck_follows f where f.deck_id = d.id and f.user_id = $1) as followed
         from decks d where d.id = $2 and d.group_id is null`,
      [userId, deckId],
    )
    const deck = rows[0]
    if (!deck) return null
    if (deck.user_id !== userId && (deck.hidden_at || !(deck.is_public || deck.followed))) return null
    return deck
  }

  // Đề xuất sửa/xoá mà từ đã bị xoá hoặc chuyển khỏi chủ đề → stale. Chạy trước khi liệt kê/duyệt.
  async function markStale(db, deckId) {
    await db.query(
      `update edit_suggestions s set status = 'stale'
        where s.deck_id = $1 and s.status = 'pending' and s.kind <> 'add'
          and (s.word_id is null
               or not exists (select 1 from words w where w.id = s.word_id and w.deck_id = s.deck_id))`,
      [deckId],
    )
  }

  async function getOne(db, userId, id) {
    const { rows } = await db.query(
      `select ${SUGGESTION_COLUMNS}
         from edit_suggestions s join users u on u.id = s.user_id
         left join words w on w.id = s.word_id and w.deck_id = s.deck_id
        where s.id = $2`,
      [userId, id],
    )
    return rows[0] ? withConflict(rows[0]) : null
  }

  async function create(ctx, deckId, input) {
    const { userId } = ctx
    const deck = await findDeck(pool, userId, deckId)
    if (!deck || !deck.is_public || deck.hidden_at) throw deckNotFound()
    if (deck.user_id === userId) {
      throw badRequest('own_deck', 'Đây là chủ đề của bạn — hãy sửa trực tiếp thay vì gửi đề xuất.')
    }
    await assertCommunityAllowed(pool, userId, { requireVerifiedEmail })

    let base = null
    let proposed = input.proposed ?? null
    if (input.kind !== 'add') {
      const { rows } = await pool.query('select * from words where id = $1 and deck_id = $2', [input.word_id, deckId])
      if (!rows[0]) throw badRequest('word_not_in_deck', 'Từ này không thuộc chủ đề.')
      base = pickFields(rows[0])
    }
    if (input.kind === 'edit') {
      // Chỉ giữ các trường THẬT SỰ khác bản hiện tại.
      proposed = Object.fromEntries(Object.entries(proposed).filter(([k, v]) => v !== undefined && v !== base[k]))
      if (Object.keys(proposed).length === 0) {
        throw badRequest('no_change', 'Nội dung đề xuất giống hệt bản hiện tại.')
      }
    }
    const { rows } = await pool.query(
      `insert into edit_suggestions (deck_id, word_id, user_id, kind, base, proposed, reason)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [deckId, input.word_id ?? null, userId, input.kind, base, proposed, input.reason ?? ''],
    )
    await notify(deck.user_id, {
      type: 'suggestion',
      deckId,
      actorId: userId,
      payload: { deck_name: deck.name, suggestion_id: rows[0].id, kind: input.kind },
    })
    return getOne(pool, userId, rows[0].id)
  }

  // Chủ chủ đề thấy mọi đề xuất; người khác chỉ thấy đề xuất của chính mình.
  async function listForDeck(ctx, deckId, { status }) {
    const { userId } = ctx
    const deck = await findDeck(pool, userId, deckId)
    if (!deck) throw deckNotFound()
    await markStale(pool, deckId)
    const { rows } = await pool.query(
      `select ${SUGGESTION_COLUMNS}
         from edit_suggestions s join users u on u.id = s.user_id
         left join words w on w.id = s.word_id and w.deck_id = s.deck_id
        where s.deck_id = $2 and ($3 = 'all' or s.status = $3) and ($4 or s.user_id = $1)
        order by s.created_at asc, s.id`,
      [userId, deckId, status, deck.user_id === userId],
    )
    return rows.map(withConflict)
  }

  // "Đề xuất của tôi": 50 đề xuất gần nhất kèm tên chủ đề và kết quả duyệt.
  async function listMine({ userId }) {
    const { rows } = await pool.query(
      `select ${SUGGESTION_COLUMNS}, d.name as deck_name
         from edit_suggestions s join users u on u.id = s.user_id join decks d on d.id = s.deck_id
         left join words w on w.id = s.word_id and w.deck_id = s.deck_id
        where s.user_id = $1
        order by s.created_at desc, s.id
        limit 50`,
      [userId],
    )
    return rows.map(withConflict)
  }

  // Lấy đề xuất ĐANG CHỜ của 1 chủ đề mình sở hữu (khoá dòng tới hết transaction: 2 người duyệt
  // cùng lúc không áp dụng 2 lần).
  async function loadForReview(client, userId, id) {
    const { rows } = await client.query(
      `select s.*, d.user_id as deck_owner from edit_suggestions s join decks d on d.id = s.deck_id
        where s.id = $1 for update of s`,
      [id],
    )
    const s = rows[0]
    if (!s || s.deck_owner !== userId) throw notFoundSuggestion()
    await markStale(client, s.deck_id)
    const { rows: fresh } = await client.query('select status from edit_suggestions where id = $1', [id])
    if (fresh[0].status === 'stale') {
      throw conflict('suggestion_stale', 'Từ này đã bị xoá hoặc chuyển khỏi chủ đề — đề xuất không còn áp dụng được.')
    }
    if (fresh[0].status !== 'pending') throw conflict('suggestion_closed', 'Đề xuất này đã được xử lý.')
    return s
  }

  async function accept(ctx, id, { note, force }) {
    const { userId } = ctx
    await withTransaction(pool, async (client) => {
      const s = await loadForReview(client, userId, id)
      let appliedWordId = null
      if (s.kind === 'add') {
        await assertWithinQuota(client, { table: 'words', userId, max: quotas.words, what: 'từ' })
        const p = s.proposed
        const { rows } = await client.query(
          `insert into words (user_id, deck_id, word, meaning, meaning_en, example, ipa)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [userId, s.deck_id, p.word, p.meaning, p.meaning_en ?? '', p.example ?? '', p.ipa ?? ''],
        )
        appliedWordId = rows[0].id
      } else {
        const { rows } = await client.query('select * from words where id = $1 for update', [s.word_id])
        if (!force && !sameContent(pickFields(rows[0]), s.base)) {
          throw conflict(
            'suggestion_conflict',
            'Từ này đã được sửa sau khi người ta gửi đề xuất — hãy xem lại nội dung hiện tại trước khi áp dụng.',
          )
        }
        if (s.kind === 'delete') {
          await client.query('delete from words where id = $1', [s.word_id])
        } else {
          const keys = SUGGESTION_FIELDS.filter((k) => s.proposed[k] !== undefined)
          const sets = keys.map((k, i) => `${k} = $${i + 2}`) // tên cột từ danh sách cố định
          await client.query(`update words set ${sets.join(', ')} where id = $1`, [
            s.word_id,
            ...keys.map((k) => s.proposed[k]),
          ])
          appliedWordId = s.word_id
        }
      }
      await client.query(
        `update edit_suggestions set status = 'accepted', review_note = $2, reviewed_by = $3, reviewed_at = now(),
                applied_word_id = $4 where id = $1`,
        [id, note, userId, appliedWordId],
      )
    })
    await notifyResult(id, userId)
    return getOne(pool, userId, id)
  }

  // Báo người đề xuất kết quả duyệt (sau khi transaction đã ghi xong).
  async function notifyResult(id, ownerId) {
    const { rows } = await pool.query(
      `select s.user_id, s.deck_id, s.status, s.kind, d.name as deck_name
         from edit_suggestions s join decks d on d.id = s.deck_id where s.id = $1`,
      [id],
    )
    const s = rows[0]
    if (!s) return
    await notify(s.user_id, {
      type: 'suggestion_result',
      deckId: s.deck_id,
      actorId: ownerId,
      payload: { deck_name: s.deck_name, suggestion_id: id, kind: s.kind, status: s.status },
    })
  }

  async function reject(ctx, id, { note }) {
    const { userId } = ctx
    await withTransaction(pool, async (client) => {
      await loadForReview(client, userId, id)
      await client.query(
        `update edit_suggestions set status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = now()
          where id = $1`,
        [id, note, userId],
      )
    })
    await notifyResult(id, userId)
    return getOne(pool, userId, id)
  }

  // Người đề xuất rút lại đề xuất CHƯA được duyệt.
  async function withdraw({ userId }, id) {
    const { rowCount } = await pool.query(
      "delete from edit_suggestions where id = $1 and user_id = $2 and status = 'pending'",
      [id, userId],
    )
    if (!rowCount) throw notFoundSuggestion()
  }

  return { create, listForDeck, listMine, accept, reject, withdraw }
}
