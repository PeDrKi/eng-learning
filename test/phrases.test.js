import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const add = (user, body) => user.post('/phrases', { phrase: 'How are you?', meaning: 'Bạn khoẻ không?', ...body })

describe('/phrases', () => {
  it('tạo câu giao tiếp: làm sạch dữ liệu, giá trị mặc định, bỏ qua user_id client gửi', async () => {
    const res = await add(w.bob, { phrase: '  Long time no see ', user_id: w.alice.id })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      user_id: w.bob.id,
      phrase: 'Long time no see',
      usage_context: '',
      example: '',
      formality: 'neutral',
      deck_id: null,
    })
  })

  it('là sổ tay CÁ NHÂN: không ai khác thấy, kể cả trưởng nhóm và super admin', async () => {
    const own = (await add(w.bob, { deck_id: w.decks.group.id })).body
    expect((await w.bob.get('/phrases')).body.map((p) => p.id)).toEqual([own.id])
    for (const other of [w.alice, w.carol, w.sam]) {
      expect((await other.get('/phrases')).body).toEqual([])
      expect((await other.patch(`/phrases/${own.id}`, { meaning: 'x' })).status).toBe(404)
      expect((await other.del(`/phrases/${own.id}`)).status).toBe(404)
    }
  })

  it.each([
    ['chủ đề riêng của mình', 'bob', 201],
    ['chủ đề nhóm mình tham gia', 'group', 201],
    ['chủ đề riêng của người khác', 'alice', 400],
  ])('gắn vào %s %s → %i', async (_label, deckKey, status) => {
    const res = await add(w.bob, { deck_id: w.decks[deckKey].id })
    expect(res.status).toBe(status)
    if (status === 400) expect(res.body.error.code).toBe('deck_not_found')
  })

  it('người ngoài nhóm không gắn được vào chủ đề nhóm', async () => {
    expect((await add(w.carol, { deck_id: w.decks.group.id })).status).toBe(400)
  })

  it('sửa: chỉ đổi field gửi lên; đổi chủ đề cũng kiểm tra quyền', async () => {
    const p = (await add(w.bob, { formality: 'informal', example: 'Hey, how are you?' })).body
    let res = await w.bob.patch(`/phrases/${p.id}`, { meaning: 'Dạo này sao rồi?', deck_id: w.decks.bob.id })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ meaning: 'Dạo này sao rồi?', formality: 'informal', deck_id: w.decks.bob.id })

    res = await w.bob.patch(`/phrases/${p.id}`, { deck_id: w.decks.carol.id })
    expect(res.status).toBe(400)
    res = await w.bob.patch(`/phrases/${p.id}`, { deck_id: null })
    expect(res.body.deck_id).toBeNull()
  })

  it('rời nhóm vẫn giữ nguyên câu đã gắn chủ đề nhóm; sửa field khác vẫn được', async () => {
    const p = (await add(w.bob, { deck_id: w.decks.group.id })).body
    await pool.query('delete from group_members where user_id = $1', [w.bob.id])
    const res = await w.bob.patch(`/phrases/${p.id}`, { meaning: 'mới' })
    expect(res.status).toBe(200)
    expect(res.body.deck_id).toBe(w.decks.group.id)
  })

  it('xoá chủ đề → câu giao tiếp về "chưa phân loại", không bị xoá theo', async () => {
    const p = (await add(w.bob, { deck_id: w.decks.bob.id })).body
    await w.bob.del(`/decks/${w.decks.bob.id}`)
    const [after] = (await w.bob.get('/phrases')).body
    expect(after).toMatchObject({ id: p.id, deck_id: null })
  })

  it('kiểm tra dữ liệu', async () => {
    let res = await w.bob.post('/phrases', {})
    expect(res.body.error.details.map((d) => d.message)).toEqual([
      'Vui lòng nhập câu tiếng Anh.',
      'Vui lòng nhập nghĩa.',
    ])
    res = await add(w.bob, { formality: 'casual' })
    expect(res.status).toBe(400)
    const p = (await add(w.bob)).body
    expect((await w.bob.patch(`/phrases/${p.id}`, {})).status).toBe(400)
  })

  it('danh sách mới nhất trước; xoá rồi xoá lại → 404', async () => {
    const a = (await add(w.bob, { phrase: 'A' })).body
    const b = (await add(w.bob, { phrase: 'B' })).body
    expect((await w.bob.get('/phrases')).body.map((p) => p.id)).toEqual([b.id, a.id])
    expect((await w.bob.del(`/phrases/${a.id}`)).status).toBe(204)
    expect((await w.bob.del(`/phrases/${a.id}`)).status).toBe(404)
  })
})

// Câu giao tiếp học được như từ vựng (migration 006): mỗi câu có tiến trình SRS riêng, chấm được,
// và lượt ôn vào chung nhật ký để tính chuỗi ngày học.
describe('học câu giao tiếp', () => {
  it('thêm câu là có sẵn dòng tiến trình, và GET /phrases trả kèm tiến trình đó', async () => {
    const { body: created } = await add(w.bob, { phrase: 'See you later' })
    const { n } = (
      await pool.query('select count(*)::int as n from phrase_progress where phrase_id = $1 and user_id = $2', [
        created.id,
        w.bob.id,
      ])
    ).rows[0]
    expect(n).toBe(1)

    const listed = (await w.bob.get('/phrases')).body.find((p) => p.id === created.id)
    expect(listed).toMatchObject({ repetitions: 0, ease_factor: 2.5, interval_days: 0 })
    expect(listed.due_at).toBeTruthy()
  })

  it('chấm điểm một câu: lưu đúng tiến trình, không đụng tới câu của người khác', async () => {
    const { body: mine } = await add(w.bob, { phrase: 'Take care' })
    const res = await w.bob.patch(`/phrases/${mine.id}/progress`, {
      ease_factor: 2.6,
      interval_days: 6,
      repetitions: 2,
      due_at: '2030-01-01T00:00:00.000Z',
      last_reviewed_at: '2026-10-03T00:00:00.000Z',
      stability: 6.2,
      difficulty: 4.5,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ repetitions: 2, interval_days: 6 })
    expect(res.body.stability).toBeCloseTo(6.2, 4)
    const listed = (await w.bob.get('/phrases')).body.find((p) => p.id === mine.id)
    expect(listed.difficulty).toBeCloseTo(4.5, 4)

    expect((await w.alice.patch(`/phrases/${mine.id}/progress`, { repetitions: 9 })).status).toBe(404)
  })

  it('giá trị tiến trình vô lý bị từ chối', async () => {
    const { body: p } = await add(w.bob, { phrase: 'No worries' })
    expect((await w.bob.patch(`/phrases/${p.id}/progress`, { repetitions: -1 })).status).toBe(400)
    expect((await w.bob.patch(`/phrases/${p.id}/progress`, {})).status).toBe(400)
    expect((await w.bob.patch(`/phrases/${p.id}/progress`, { difficulty: 12 })).status).toBe(400)
  })

  it('ghi lượt ôn câu vào nhật ký; không cho gửi kèm cả word_id lẫn phrase_id', async () => {
    const { body: p } = await add(w.bob, { phrase: 'Sounds good' })
    const ok = await w.bob.post('/review-log', { phrase_id: p.id, quality: 2 })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ phrase_id: p.id, word_id: null })

    const both = await w.bob.post('/review-log', { phrase_id: p.id, word_id: w.words.bobPersonal.id, quality: 2 })
    expect(both.status).toBe(400)
    const neither = await w.bob.post('/review-log', { quality: 2 })
    expect(neither.status).toBe(400)
  })

  it('câu của người khác → không ghi được lượt ôn', async () => {
    const { body: p } = await add(w.bob, { phrase: 'My treat' })
    expect((await w.alice.post('/review-log', { phrase_id: p.id, quality: 2 })).status).toBe(404)
  })

  it('xoá câu thì xoá luôn tiến trình học của nó', async () => {
    const { body: p } = await add(w.bob, { phrase: 'Catch you later' })
    await w.bob.del(`/phrases/${p.id}`)
    const { n } = (await pool.query('select count(*)::int as n from phrase_progress where phrase_id = $1', [p.id]))
      .rows[0]
    expect(n).toBe(0)
  })
})
