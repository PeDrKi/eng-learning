import { badRequest, forbidden, notFound } from '../../lib/httpError.js'
import { canAddWordToDeck, canManageWord, canMoveWord, canViewWord } from '../access/permissions.js'
import { z } from 'zod'
import { assertWithinQuota } from '../../lib/quotas.js'
import { decodeCursor, toPage } from '../../lib/pagination.js'
import { findVisibleDeck } from '../decks/decks.service.js'

const CONTENT_FIELDS = ['word', 'meaning', 'example', 'ipa', 'audio_url', 'tags', 'pos', 'deck_id']

// Con trỏ trang: vị trí của dòng cuối trang trước theo thứ tự (created_at desc, id asc).
// `c` là created_at dạng TEXT của Postgres (đủ micro giây — Date của JS chỉ tới mili giây, dùng
// nó làm mốc sẽ lặp/sót dòng có cùng mili giây).
const wordCursor = z.object({ c: z.string().max(64), id: z.uuid() })

const deckNotFound = () => badRequest('deck_not_found', 'Chủ đề không tồn tại hoặc bạn không có quyền truy cập.')

// Lấy 1 từ (kèm chủ đề chứa nó) mà người dùng XEM ĐƯỢC; không tồn tại hoặc không được xem →
// null. Dùng chung cho mọi module thao tác trên 1 từ (tiến trình học, nhật ký ôn tập...).
export async function findVisibleWord(db, wordId, ctx) {
  const { rows } = await db.query(
    `select row_to_json(w.*) as word, row_to_json(d.*) as deck
     from words w left join decks d on d.id = w.deck_id
     where w.id = $1`,
    [wordId],
  )
  const found = rows[0]
  return found && canViewWord(found.word, found.deck, ctx) ? found : null
}

// Cột tiến trình học trả kèm mỗi từ. Trước đây frontend phải gọi THÊM GET /progress rồi tự ghép
// theo word_id — hai danh sách phân trang song song, gấp đôi số lượt đi-về trên mạng điện thoại,
// và mỗi dòng tiến trình còn gánh thêm id + word_id + user_id không dùng tới. Ghép sẵn ở đây rẻ
// hơn nhiều: đã có unique index (word_id, user_id) nên join chỉ là tra khoá.
//
// Từ của NGƯỜI KHÁC (nhìn thấy qua chủ đề chung của nhóm) không có dòng tiến trình của mình →
// các cột này là null, frontend tự điền giá trị mặc định. Đúng như khi gọi GET /progress riêng.
const PROGRESS_COLUMNS = `p.ease_factor, p.stability, p.difficulty, p.interval_days, p.repetitions, p.due_at,
          p.last_reviewed_at, p.ease_factor_rev, p.stability_rev, p.difficulty_rev, p.interval_days_rev,
          p.repetitions_rev, p.due_at_rev, p.last_reviewed_at_rev,
          p.quiz_correct, p.quiz_wrong, p.lapses, p.study_count`
const PROGRESS_JOIN = 'left join word_progress p on p.word_id = w.id and p.user_id = $1'

export function createWordsService({ pool, quotas }) {
  // Danh sách từ xem được: từ của chính mình (mọi chủ đề), cộng với từ trong chủ đề của các
  // nhóm mình là thành viên (super admin: mọi nhóm). Điều kiện tương đương canViewWord().
  // Không truyền `limit` → trả mảng đầy đủ; có `limit` → trả 1 trang { items, next_cursor }.
  async function list(ctx, { limit, cursor } = {}) {
    const { userId } = ctx
    const visible = `(w.user_id = $1
          or (d.group_id is not null and ($2 or exists (
                select 1 from group_members gm where gm.group_id = d.group_id and gm.user_id = $1))))`
    if (limit === undefined) {
      const { rows } = await pool.query(
        `select w.*, ${PROGRESS_COLUMNS} from words w
         left join decks d on d.id = w.deck_id
         ${PROGRESS_JOIN}
         where ${visible}
         order by w.created_at desc, w.id`,
        [userId, ctx.isSystemAdmin],
      )
      return rows
    }
    const after = decodeCursor(cursor, wordCursor)
    let rows
    try {
      ;({ rows } = await pool.query(
        `select w.*, ${PROGRESS_COLUMNS}, w.created_at::text as cursor_key from words w
         left join decks d on d.id = w.deck_id
         ${PROGRESS_JOIN}
         where ${visible}
           and ($3::timestamptz is null
                or w.created_at < $3::timestamptz
                or (w.created_at = $3::timestamptz and w.id > $4::uuid))
         order by w.created_at desc, w.id
         limit $5`,
        [userId, ctx.isSystemAdmin, after?.c ?? null, after?.id ?? null, limit + 1],
      ))
    } catch (err) {
      // 22007/22008: `c` trong con trỏ không phải thời gian hợp lệ (con trỏ bị sửa tay).
      if (err.code === '22007' || err.code === '22008') throw badRequest('invalid_cursor', 'cursor không hợp lệ.')
      throw err
    }
    const page = toPage(rows, limit, (r) => ({ c: r.cursor_key, id: r.id }))
    page.items = page.items.map(({ cursor_key, ...word }) => {
      void cursor_key // cột nội bộ chỉ để dựng con trỏ, không trả ra ngoài
      return word
    })
    return page
  }

  // Kiểm tra quyền thêm từ vào từng chủ đề (khác nhau) trong danh sách deck_id.
  async function assertCanAddTo(deckIds, ctx) {
    for (const deckId of new Set(deckIds.filter(Boolean))) {
      const deck = await findVisibleDeck(pool, deckId, ctx)
      if (!deck) throw deckNotFound()
      if (!canAddWordToDeck(deck, ctx)) throw forbidden('Bạn không có quyền thêm từ vào chủ đề này.')
    }
  }

  // Thêm 1 hoặc nhiều từ trong CÙNG 1 câu lệnh (tất cả hoặc không gì cả). Trigger
  // handle_new_word tự tạo dòng word_progress cho từng từ.
  async function insertMany(ctx, words) {
    const { userId } = ctx
    await assertCanAddTo(
      words.map((w) => w.deck_id),
      ctx,
    )
    await assertWithinQuota(pool, { table: 'words', userId, adding: words.length, max: quotas.words, what: 'từ' })
    try {
      const { rows } = await pool.query(
        `insert into words (user_id, deck_id, word, meaning, example, ipa, audio_url, tags, pos)
         select $1, x.deck_id, x.word, x.meaning, x.example, x.ipa, x.audio_url, x.tags, x.pos
         from unnest($2::jsonb[]) with ordinality as t(j, i),
              jsonb_to_record(t.j) as x(deck_id uuid, word text, meaning text, example text,
                                        ipa text, audio_url text, tags text[], pos text[])
         order by t.i
         returning *`,
        [userId, words.map((w) => JSON.stringify(w))],
      )
      return rows
    } catch (err) {
      // Chủ đề bị xoá đúng lúc giữa bước kiểm tra quyền và bước thêm.
      if (err.code === '23503') throw deckNotFound()
      throw err
    }
  }

  const create = async (ctx, word) => (await insertMany(ctx, [word]))[0]
  const bulkCreate = (ctx, words) => insertMany(ctx, words)

  // Lấy từ + chủ đề chứa nó, kèm ngữ cảnh quyền. Không xem được → 404.
  async function loadForChange(ctx, wordId) {
    const found = await findVisibleWord(pool, wordId, ctx)
    if (!found) throw notFound('Không tìm thấy từ.')
    return found
  }

  const cannotManage = () => forbidden('Chỉ trưởng nhóm mới sửa/xoá được từ trong chủ đề của nhóm.')

  async function update(ctx, wordId, patch) {
    const { word, deck } = await loadForChange(ctx, wordId)
    if (!canManageWord(word, deck, ctx)) throw cannotManage()

    if (patch.deck_id !== undefined && patch.deck_id !== word.deck_id) {
      const target = patch.deck_id ? await findVisibleDeck(pool, patch.deck_id, ctx) : null
      if (patch.deck_id && !target) throw deckNotFound()
      if (!canMoveWord(word, deck, target, ctx)) throw forbidden('Bạn không có quyền chuyển từ sang chủ đề này.')
    }

    const keys = CONTENT_FIELDS.filter((k) => patch[k] !== undefined)
    const sets = keys.map((k, i) => `${k} = $${i + 2}`) // tên cột lấy từ danh sách cố định, không từ client
    const { rows } = await pool.query(`update words set ${sets.join(', ')} where id = $1 returning *`, [
      wordId,
      ...keys.map((k) => patch[k]),
    ])
    return rows[0]
  }

  async function remove(ctx, wordId) {
    const { word, deck } = await loadForChange(ctx, wordId)
    if (!canManageWord(word, deck, ctx)) throw cannotManage()
    await pool.query('delete from words where id = $1', [wordId])
  }

  return { list, create, bulkCreate, update, remove }
}
