import { randomUUID } from 'node:crypto'
import { withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/httpError.js'
import { readingParagraphs } from '../../lib/paragraphs.js'
import { sqlPublicIdentity } from '../../lib/publicName.js'
import { MAX_NOTES } from '../readings/readings.schemas.js'
import { assertCommunityAllowed } from './guard.js'

// Đề xuất sửa BÀI ĐỌC công khai (migration 034, đợt 2) — như "pull request" của chủ đề cộng đồng:
// người xem đề xuất thêm / sửa ghi chú, bản dịch cho một đoạn, sửa lỗi chính tả nguyên văn; CHỈ chủ bài
// áp dụng hoặc từ chối (có thể kèm ghi chú). Người đề xuất xem kết quả ở "Đề xuất của tôi".
//
// `base` lưu nội dung lúc đề xuất. Lúc duyệt mà bài đã khác `base` → XUNG ĐỘT (409), người duyệt xem lại
// rồi gửi force=true nếu vẫn muốn áp dụng. Ghi chú / đoạn không còn → đề xuất thành `stale`.
// Người đề xuất KHÔNG bao giờ nhận lại `base` / `current` của bản dịch & nguyên văn (có thể là phần
// người chia sẻ đã ẩn) — chỉ chủ bài thấy.

export const NOTE_FIELDS = ['type', 'text', 'meaning', 'explanation', 'example']

const notFoundSuggestion = () => notFound('Không tìm thấy đề xuất.')
const notFoundReading = () => notFound('Không tìm thấy bài đọc công khai.')

const pickNote = (n) => Object.fromEntries(NOTE_FIELDS.map((f) => [f, n?.[f] ?? '']))
const sameNote = (a, b) => NOTE_FIELDS.every((f) => (a?.[f] ?? '') === (b?.[f] ?? ''))

// Nội dung HIỆN TẠI ứng với một đề xuất (null = không còn → stale). Dùng cả khi liệt kê lẫn khi duyệt.
function currentFor(s, reading) {
  if (s.kind === 'add_note') return {}
  if (s.kind === 'edit_note') {
    const note = (reading.notes ?? []).find((n) => n.id === s.note_id)
    return note ? pickNote(note) : null
  }
  const paragraphs = readingParagraphs(reading)
  if (s.paragraph >= paragraphs.length) return null
  if (s.kind === 'translation') return { text: reading.translations?.[s.paragraph] ?? '' }
  return { text: paragraphs[s.paragraph].text }
}

function hasConflict(s, current) {
  if (s.status !== 'pending' || !current || s.kind === 'add_note') return false
  if (s.kind === 'edit_note') return !sameNote(current, s.base)
  return current.text !== s.base?.text
}

export function createReadingSuggestionsService({
  pool,
  requireVerifiedEmail = false,
  notify = async () => {},
  readingCommunityService,
}) {
  const COLUMNS = `s.id, s.reading_id, s.collection_id, s.kind, s.note_id, s.paragraph, s.base, s.proposed, s.reason,
       s.status, s.review_note, s.created_at, s.reviewed_at, ${sqlPublicIdentity('author')}, (s.user_id = $1) as mine,
       r.user_id as owner_id, r.title as reading_title, r.kind as reading_kind, r.content as reading_content,
       r.notes as reading_notes, r.translations as reading_translations`

  // Một dòng → dạng trả ra. Chủ bài thấy `current` + `conflict`; người khác không thấy phần bị ẩn.
  function shape(row, userId) {
    const { owner_id, reading_kind, reading_content, reading_notes, reading_translations, ...rest } = row
    const isOwner = owner_id === userId
    const current = currentFor(row, {
      kind: reading_kind,
      content: reading_content,
      notes: reading_notes,
      translations: reading_translations,
    })
    const hideText = !isOwner && (row.kind === 'translation' || row.kind === 'typo')
    return {
      ...rest,
      reading_title: rest.reading_title || reading_content.trim().slice(0, 60),
      base: hideText ? null : rest.base,
      current: isOwner ? current : null,
      conflict: isOwner ? hasConflict(row, current) : false,
      can_review: isOwner,
    }
  }

  async function markStale(db, readingId) {
    const { rows } = await db.query(
      `select s.*, r.kind as reading_kind, r.content as reading_content, r.notes as reading_notes,
              r.translations as reading_translations
         from reading_suggestions s join readings r on r.id = s.reading_id
        where s.reading_id = $1 and s.status = 'pending' and s.kind <> 'add_note'`,
      [readingId],
    )
    const stale = rows
      .filter(
        (s) =>
          currentFor(s, {
            kind: s.reading_kind,
            content: s.reading_content,
            notes: s.reading_notes,
            translations: s.reading_translations,
          }) === null,
      )
      .map((s) => s.id)
    if (stale.length) {
      await db.query(`update reading_suggestions set status = 'stale' where id = any($1::uuid[])`, [stale])
    }
  }

  async function getOne(userId, id) {
    const { rows } = await pool.query(
      `select ${COLUMNS}
         from reading_suggestions s join users u on u.id = s.user_id join readings r on r.id = s.reading_id
        where s.id = $2`,
      [userId, id],
    )
    return rows[0] ? shape(rows[0], userId) : null
  }

  async function create(ctx, readingId, input) {
    const { userId } = ctx
    // Đúng góc nhìn người xem: nguyên văn / bản dịch có được chia sẻ cho họ không.
    const view = await readingCommunityService.getReading(ctx, readingId).catch(() => null)
    if (!view || view.hidden) throw notFoundReading()
    if (view.mine) {
      throw badRequest('own_reading', 'Đây là bài của bạn — hãy sửa trực tiếp thay vì gửi đề xuất.')
    }
    await assertCommunityAllowed(pool, userId, { requireVerifiedEmail })
    const { rows: raw } = await pool.query('select * from readings where id = $1', [readingId])
    const reading = raw[0]
    const paragraphs = readingParagraphs(reading)

    let base = null
    let proposed = input.proposed
    if (input.kind === 'edit_note') {
      const note = (reading.notes ?? []).find((n) => n.id === input.note_id)
      if (!note) throw badRequest('note_not_found', 'Ghi chú này không còn trong bài.')
      base = pickNote(note)
      proposed = Object.fromEntries(Object.entries(proposed).filter(([k, v]) => v !== undefined && v !== base[k]))
      if (Object.keys(proposed).length === 0) {
        throw badRequest('no_change', 'Nội dung đề xuất giống hệt bản hiện tại.')
      }
    }
    if (input.kind === 'translation' || input.kind === 'typo') {
      if (input.kind === 'typo' && !view.content_shared) {
        throw badRequest('content_not_shared', 'Người chia sẻ ẩn nguyên văn — không đề xuất sửa chính tả được.')
      }
      if (input.kind === 'translation' && !view.content_shared && !view.translations_shared) {
        throw badRequest('translation_not_shared', 'Bài này không chia sẻ nguyên văn lẫn bản dịch.')
      }
      if (input.paragraph >= paragraphs.length) throw badRequest('paragraph_not_found', 'Không có đoạn này.')
      if (input.kind === 'translation') {
        base = { text: reading.translations?.[input.paragraph] ?? '' }
        if (base.text === proposed.text) throw badRequest('no_change', 'Bản dịch đề xuất giống hệt bản hiện tại.')
      } else {
        base = { text: paragraphs[input.paragraph].text }
        if (!base.text.includes(proposed.find)) {
          throw badRequest('typo_not_found', 'Không tìm thấy đoạn chữ cần sửa trong đoạn này.')
        }
      }
    }
    // Ngữ cảnh: đang xem qua bộ nào (để thông báo mở đúng chỗ).
    const collectionId = input.collection_id && view.collection?.id === input.collection_id ? input.collection_id : null
    const { rows } = await pool.query(
      `insert into reading_suggestions (reading_id, collection_id, user_id, kind, note_id, paragraph, base, proposed, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        readingId,
        collectionId,
        userId,
        input.kind,
        input.note_id ?? null,
        input.paragraph ?? null,
        base,
        proposed,
        input.reason ?? '',
      ],
    )
    await notify(reading.user_id, {
      type: 'reading_suggestion',
      deckId: null,
      actorId: userId,
      payload: {
        title: reading.title || reading.content.trim().slice(0, 60),
        suggestion_id: rows[0].id,
        kind: input.kind,
        reading_id: readingId,
        collection_id: collectionId,
        url: urlFor(collectionId, readingId),
      },
    })
    return getOne(userId, rows[0].id)
  }

  const urlFor = (collectionId, readingId) =>
    collectionId ? `/explore?rcollection=${collectionId}&page=${readingId}` : `/explore?reading=${readingId}`

  // Đề xuất của 1 bài: chủ bài thấy tất cả; người khác chỉ thấy của chính mình.
  async function listForReading(ctx, readingId, { status }) {
    const view = await readingCommunityService.getReading(ctx, readingId).catch(() => null)
    if (!view) throw notFoundReading()
    await markStale(pool, readingId)
    const { rows } = await pool.query(
      `select ${COLUMNS}
         from reading_suggestions s join users u on u.id = s.user_id join readings r on r.id = s.reading_id
        where s.reading_id = $2 and ($3 = 'all' or s.status = $3) and (r.user_id = $1 or s.user_id = $1)
        order by s.created_at asc, s.id`,
      [ctx.userId, readingId, status],
    )
    return rows.map((r) => shape(r, ctx.userId))
  }

  // Số đề xuất ĐANG CHỜ ở từng bài của mình (trang Đọc & ghi chú hiện nhãn).
  async function pendingCounts({ userId }) {
    const { rows } = await pool.query(
      `select s.reading_id, count(*)::int as count
         from reading_suggestions s join readings r on r.id = s.reading_id
        where r.user_id = $1 and s.status = 'pending'
        group by s.reading_id`,
      [userId],
    )
    return rows
  }

  // "Đề xuất của tôi" (bài đọc): 50 đề xuất gần nhất.
  async function listMine({ userId }) {
    const { rows } = await pool.query(
      `select ${COLUMNS}
         from reading_suggestions s join users u on u.id = s.user_id join readings r on r.id = s.reading_id
        where s.user_id = $1
        order by s.created_at desc, s.id
        limit 50`,
      [userId],
    )
    return rows.map((r) => shape(r, userId))
  }

  // Khoá dòng đề xuất + bài tới hết transaction (2 lần duyệt cùng lúc không áp dụng 2 lần).
  async function loadForReview(client, ctx, id) {
    const { rows } = await client.query(
      `select s.*, r.user_id as owner_id from reading_suggestions s join readings r on r.id = s.reading_id
        where s.id = $1 for update of s, r`,
      [id],
    )
    const s = rows[0]
    if (!s || s.owner_id !== ctx.userId) throw notFoundSuggestion()
    await markStale(client, s.reading_id)
    const { rows: fresh } = await client.query('select status from reading_suggestions where id = $1', [id])
    if (fresh[0].status === 'stale') {
      throw conflict('suggestion_stale', 'Ghi chú / đoạn này không còn trong bài — đề xuất không áp dụng được nữa.')
    }
    if (fresh[0].status !== 'pending') throw conflict('suggestion_closed', 'Đề xuất này đã được xử lý.')
    return s
  }

  async function accept(ctx, id, { note, force }) {
    const { userId } = ctx
    await withTransaction(pool, async (client) => {
      const s = await loadForReview(client, ctx, id)
      const { rows } = await client.query('select * from readings where id = $1', [s.reading_id])
      const reading = rows[0]
      const current = currentFor(s, reading)
      if (!force && hasConflict(s, current)) {
        throw conflict(
          'suggestion_conflict',
          'Bài đã được sửa sau khi người ta gửi đề xuất — hãy xem lại nội dung hiện tại trước khi áp dụng.',
        )
      }
      const patch = {}
      if (s.kind === 'add_note') {
        if ((reading.notes ?? []).length >= MAX_NOTES) {
          throw badRequest('too_many_notes', `Mỗi bài tối đa ${MAX_NOTES} ghi chú.`)
        }
        patch.notes = [...(reading.notes ?? []), { id: randomUUID(), ...pickNote(s.proposed), saved_to: null }]
      } else if (s.kind === 'edit_note') {
        patch.notes = reading.notes.map((n) => (n.id === s.note_id ? { ...n, ...s.proposed } : n))
      } else if (s.kind === 'translation') {
        const list = [...(reading.translations ?? [])]
        while (list.length <= s.paragraph) list.push('')
        list[s.paragraph] = s.proposed.text
        patch.translations = list
      } else {
        const para = readingParagraphs(reading)[s.paragraph]
        const at = para.text.indexOf(s.proposed.find)
        if (at < 0) throw conflict('typo_not_found', 'Đoạn chữ cần sửa không còn trong đoạn này.')
        const pos = para.start + at
        patch.content =
          reading.content.slice(0, pos) + s.proposed.replace + reading.content.slice(pos + s.proposed.find.length)
      }
      const keys = Object.keys(patch) // chỉ notes / translations / content
      await client.query(
        `update readings set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`,
        [s.reading_id, ...keys.map((k) => (k === 'content' ? patch[k] : JSON.stringify(patch[k])))],
      )
      await client.query(
        `update reading_suggestions set status = 'accepted', review_note = $2, reviewed_by = $3, reviewed_at = now()
          where id = $1`,
        [id, note, userId],
      )
    })
    await notifyResult(id, userId)
    return getOne(userId, id)
  }

  async function reject(ctx, id, { note }) {
    await withTransaction(pool, async (client) => {
      await loadForReview(client, ctx, id)
      await client.query(
        `update reading_suggestions set status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = now()
          where id = $1`,
        [id, note, ctx.userId],
      )
    })
    await notifyResult(id, ctx.userId)
    return getOne(ctx.userId, id)
  }

  async function notifyResult(id, ownerId) {
    const { rows } = await pool.query(
      `select s.user_id, s.reading_id, s.collection_id, s.status, s.kind, r.title, r.content
         from reading_suggestions s join readings r on r.id = s.reading_id where s.id = $1`,
      [id],
    )
    const s = rows[0]
    if (!s) return
    await notify(s.user_id, {
      type: 'reading_suggestion_result',
      deckId: null,
      actorId: ownerId,
      payload: {
        title: s.title || s.content.trim().slice(0, 60),
        suggestion_id: id,
        kind: s.kind,
        status: s.status,
        reading_id: s.reading_id,
        collection_id: s.collection_id,
        url: urlFor(s.collection_id, s.reading_id),
      },
    })
  }

  async function withdraw({ userId }, id) {
    const { rowCount } = await pool.query(
      "delete from reading_suggestions where id = $1 and user_id = $2 and status = 'pending'",
      [id, userId],
    )
    if (!rowCount) throw notFoundSuggestion()
  }

  return { create, listForReading, pendingCounts, listMine, accept, reject, withdraw }
}
