import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const NOTE = { id: 'n1', type: 'word', text: 'proud', meaning: 'tự hào' }

// Bob chia sẻ 1 bài lẻ 2 đoạn (có bản dịch đoạn 1). includeContent: có cho xem nguyên văn không.
async function bobReading({ includeContent = true, includeTranslations = true } = {}) {
  const r = (
    await w.bob.post('/readings', {
      title: 'Tin',
      content: 'He was prowd of it.\n\nShe smiled.',
      notes: [NOTE],
      translations: ['Anh ấy tự hào về nó.'],
    })
  ).body
  await w.bob.put(`/community/readings/${r.id}/publish`, {
    include_content: includeContent,
    include_translations: includeTranslations,
  })
  return r
}

const suggest = (who, id, body) => who.post(`/community/readings/${id}/suggestions`, body)

describe('đề xuất sửa bài đọc — gửi', () => {
  it('chỉ gửi được cho bài công khai của người khác; chủ bài nhận thông báo', async () => {
    const priv = (await w.bob.post('/readings', { content: 'Secret.' })).body
    const add = { kind: 'add_note', proposed: { type: 'word', text: 'smiled', meaning: 'mỉm cười' } }
    expect((await suggest(w.alice, priv.id, add)).status).toBe(404)

    const r = await bobReading()
    expect((await suggest(w.bob, r.id, add)).body.error.code).toBe('own_reading')
    const res = await suggest(w.alice, r.id, { ...add, reason: 'Thiếu từ này' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'add_note', status: 'pending', mine: true, can_review: false })

    const { rows } = await pool.query(
      "select payload from notifications where type = 'reading_suggestion' and user_id = $1",
      [w.bob.id],
    )
    expect(rows[0].payload).toMatchObject({ kind: 'add_note', reading_id: r.id, url: `/explore?reading=${r.id}` })
  })

  it('sửa ghi chú: chỉ giữ trường thật sự đổi; ghi chú không có → 400', async () => {
    const r = await bobReading()
    const same = await suggest(w.alice, r.id, { kind: 'edit_note', note_id: 'n1', proposed: { meaning: 'tự hào' } })
    expect(same.body.error.code).toBe('no_change')
    expect(
      (await suggest(w.alice, r.id, { kind: 'edit_note', note_id: 'nope', proposed: { meaning: 'x' } })).body.error
        .code,
    ).toBe('note_not_found')
    const ok = await suggest(w.alice, r.id, {
      kind: 'edit_note',
      note_id: 'n1',
      proposed: { text: 'proud', meaning: 'kiêu hãnh, tự hào' },
    })
    expect(ok.status).toBe(201)
    expect(ok.body.proposed).toEqual({ meaning: 'kiêu hãnh, tự hào' })
  })

  it('chính tả: cần nguyên văn được chia sẻ và chữ phải có trong đoạn', async () => {
    const hidden = await bobReading({ includeContent: false })
    const typo = { kind: 'typo', paragraph: 0, proposed: { find: 'prowd', replace: 'proud' } }
    expect((await suggest(w.alice, hidden.id, typo)).body.error.code).toBe('content_not_shared')

    const r = await bobReading()
    expect((await suggest(w.alice, r.id, { ...typo, paragraph: 5 })).body.error.code).toBe('paragraph_not_found')
    expect((await suggest(w.alice, r.id, { ...typo, proposed: { find: 'zzz', replace: 'y' } })).body.error.code).toBe(
      'typo_not_found',
    )
    const ok = await suggest(w.alice, r.id, typo)
    expect(ok.status).toBe(201)
    // Người đề xuất không nhận lại base / current của nguyên văn.
    expect(ok.body.base).toBeNull()
    expect(ok.body.current).toBeNull()
  })

  it('bản dịch: được khi có nguyên văn hoặc bản dịch; ẩn cả hai → 400', async () => {
    const none = await bobReading({ includeContent: false, includeTranslations: false })
    const tr = { kind: 'translation', paragraph: 1, proposed: { text: 'Cô ấy mỉm cười.' } }
    expect((await suggest(w.alice, none.id, tr)).body.error.code).toBe('translation_not_shared')
    const onlyTr = await bobReading({ includeContent: false, includeTranslations: true })
    expect((await suggest(w.alice, onlyTr.id, tr)).status).toBe(201)
  })
})

describe('đề xuất sửa bài đọc — duyệt', () => {
  it('chủ bài thấy tất cả kèm `current`; người khác chỉ thấy của mình', async () => {
    const r = await bobReading()
    await suggest(w.alice, r.id, { kind: 'translation', paragraph: 1, proposed: { text: 'Cô ấy cười.' } })
    const owner = await w.bob.get(`/community/readings/${r.id}/suggestions`)
    expect(owner.body).toHaveLength(1)
    expect(owner.body[0]).toMatchObject({ can_review: true, current: { text: '' }, base: { text: '' } })
    expect((await w.carol.get(`/community/readings/${r.id}/suggestions`)).body).toEqual([])
    expect((await w.bob.get('/community/reading-suggestions/pending-counts')).body).toEqual([
      { reading_id: r.id, count: 1 },
    ])
  })

  it('áp dụng đủ 4 loại: ghi chú mới, sửa ghi chú, bản dịch, chính tả; người đề xuất nhận kết quả', async () => {
    const r = await bobReading()
    const ids = []
    for (const body of [
      { kind: 'add_note', proposed: { type: 'word', text: 'smiled', meaning: 'mỉm cười' } },
      { kind: 'edit_note', note_id: 'n1', proposed: { meaning: 'kiêu hãnh' } },
      { kind: 'translation', paragraph: 1, proposed: { text: 'Cô ấy mỉm cười.' } },
      { kind: 'typo', paragraph: 0, proposed: { find: 'prowd', replace: 'proud' } },
    ]) {
      ids.push((await suggest(w.alice, r.id, body)).body.id)
    }
    for (const id of ids) {
      const res = await w.bob.post(`/community/reading-suggestions/${id}/accept`, { note: 'Cảm ơn!' })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('accepted')
    }
    const after = (await w.bob.get(`/community/readings/${r.id}`)).body
    expect(after.content).toBe('He was proud of it.\n\nShe smiled.')
    expect(after.translations).toEqual(['Anh ấy tự hào về nó.', 'Cô ấy mỉm cười.'])
    expect(after.notes).toHaveLength(2)
    expect(after.notes[0]).toMatchObject({ id: 'n1', meaning: 'kiêu hãnh' })
    expect(after.notes[1]).toMatchObject({ type: 'word', text: 'smiled', meaning: 'mỉm cười', saved_to: null })

    const mine = (await w.alice.get('/community/reading-suggestions/mine')).body
    expect(mine.every((s) => s.status === 'accepted' && s.review_note === 'Cảm ơn!')).toBe(true)
    const { rowCount } = await pool.query("select 1 from notifications where type = 'reading_suggestion_result'")
    expect(rowCount).toBe(4)
  })

  it('xung đột: bài đã đổi sau khi đề xuất → 409, force mới áp dụng; người khác không duyệt được', async () => {
    const r = await bobReading()
    const s = (await suggest(w.alice, r.id, { kind: 'edit_note', note_id: 'n1', proposed: { meaning: 'kiêu hãnh' } }))
      .body
    expect((await w.carol.post(`/community/reading-suggestions/${s.id}/accept`, {})).status).toBe(404)
    await w.bob.patch(`/readings/${r.id}`, { notes: [{ ...NOTE, example: 'He was proud.' }] })
    const listed = (await w.bob.get(`/community/readings/${r.id}/suggestions`)).body[0]
    expect(listed.conflict).toBe(true)
    const res = await w.bob.post(`/community/reading-suggestions/${s.id}/accept`, {})
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('suggestion_conflict')
    expect((await w.bob.post(`/community/reading-suggestions/${s.id}/accept`, { force: true })).status).toBe(200)
    const note = (await w.bob.get(`/community/readings/${r.id}`)).body.notes[0]
    expect(note).toMatchObject({ meaning: 'kiêu hãnh', example: 'He was proud.' })
  })

  it('ghi chú đã bị xoá → stale; từ chối kèm ghi chú; rút lại đề xuất đang chờ', async () => {
    const r = await bobReading()
    const a = (await suggest(w.alice, r.id, { kind: 'edit_note', note_id: 'n1', proposed: { meaning: 'x' } })).body
    const b = (await suggest(w.alice, r.id, { kind: 'add_note', proposed: { type: 'phrase', text: 'of it' } })).body
    const c = (await suggest(w.alice, r.id, { kind: 'add_note', proposed: { type: 'word', text: 'she' } })).body
    await w.bob.patch(`/readings/${r.id}`, { notes: [] })
    const res = await w.bob.post(`/community/reading-suggestions/${a.id}/accept`, {})
    expect(res.body.error.code).toBe('suggestion_stale')
    const rej = await w.bob.post(`/community/reading-suggestions/${b.id}/reject`, { note: 'Không cần' })
    expect(rej.body).toMatchObject({ status: 'rejected', review_note: 'Không cần' })
    expect((await w.bob.post(`/community/reading-suggestions/${b.id}/accept`, {})).body.error.code).toBe(
      'suggestion_closed',
    )
    expect((await w.alice.del(`/community/reading-suggestions/${b.id}`)).status).toBe(404) // đã duyệt
    expect((await w.alice.del(`/community/reading-suggestions/${c.id}`)).status).toBe(204)
    const statuses = (await w.alice.get('/community/reading-suggestions/mine')).body.map((s) => s.status).toSorted()
    expect(statuses).toEqual(['rejected', 'stale'])
  })

  it('đề xuất qua BỘ: thông báo mở đúng trang trong bộ', async () => {
    const col = (await w.bob.post('/reading-collections', { name: 'HP' })).body
    const p = (await w.bob.post('/readings', { content: 'Page one.', collection_id: col.id })).body
    await w.bob.put(`/community/reading-collections/${col.id}/publish`, { publish_deck: false })
    const res = await suggest(w.alice, p.id, {
      kind: 'add_note',
      proposed: { type: 'word', text: 'page' },
      collection_id: col.id,
    })
    expect(res.body.collection_id).toBe(col.id)
    const { rows } = await pool.query("select payload from notifications where type = 'reading_suggestion'")
    expect(rows[0].payload.url).toBe(`/explore?rcollection=${col.id}&page=${p.id}`)
  })
})
