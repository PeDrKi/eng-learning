import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const RELY = {
  kind: 'dependent_prep',
  headword: 'rely',
  pattern: 'rely on sb/sth',
  answer: 'on',
  mistakes: ['in', 'at'],
  meaning: 'dựa vào, tin cậy',
  example: 'You can rely on me.',
}
const PREVENT = {
  kind: 'verb_pattern',
  headword: 'prevent',
  pattern: 'prevent sb from V-ing',
  answer: 'from V-ing',
  pattern_group: 'V + sb + from + V-ing',
  mistakes: ['to V'],
  meaning: 'ngăn ai làm gì',
}
const add = (user, body) => user.post('/collocations', { ...RELY, ...body })
const ids = (res) => res.body.map((c) => c.id).toSorted()

describe('POST /collocations', () => {
  it('tạo mục: làm sạch dữ liệu, giá trị mặc định, trả `pattern` và tiến trình của người thêm', async () => {
    const res = await add(w.bob, { headword: ' rely ', mistakes: ['in', ' IN ', '', 'at'], user_id: w.alice.id })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      user_id: w.bob.id,
      kind: 'dependent_prep',
      headword: 'rely',
      pattern: 'rely on sb/sth',
      answer: 'on',
      mistakes: ['in', 'at'],
      pattern_group: '',
      usage_context: '',
      deck_id: null,
      repetitions: 0,
    })
    expect(res.body.phrase).toBeUndefined()
  })

  it('thiếu trường bắt buộc / loại lạ / đáp án nằm trong dạng sai → 400', async () => {
    expect((await w.bob.post('/collocations', { kind: 'dependent_prep' })).status).toBe(400)
    expect((await add(w.bob, { kind: 'phrase' })).status).toBe(400)
    const res = await add(w.bob, { mistakes: ['ON'] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('answer_in_mistakes')
  })

  it('thêm hàng loạt: đúng thứ tự, một mục vào chủ đề không có quyền → từ chối cả lô', async () => {
    const ok = await w.bob.post('/collocations/bulk', { collocations: [RELY, PREVENT] })
    expect(ok.status).toBe(201)
    expect(ok.body.map((c) => c.headword)).toEqual(['rely', 'prevent'])
    const bad = await w.bob.post('/collocations/bulk', {
      collocations: [RELY, { ...PREVENT, deck_id: w.decks.carol.id }],
    })
    expect(bad.status).toBe(400)
    expect((await w.bob.get('/collocations')).body).toHaveLength(2)
  })
})

describe('chia sẻ theo luật của từ vựng', () => {
  it('mục trong chủ đề nhóm: thành viên + trưởng nhóm + super admin thấy; người ngoài không', async () => {
    const shared = (await add(w.bob, { deck_id: w.decks.group.id })).body
    const mine = (await add(w.bob, { deck_id: w.decks.bob.id })).body
    expect(ids(await w.bob.get('/collocations'))).toEqual([shared.id, mine.id].toSorted())
    expect(ids(await w.alice.get('/collocations'))).toEqual([shared.id])
    expect(ids(await w.sam.get('/collocations'))).toEqual([shared.id])
    expect((await w.carol.get('/collocations')).body).toEqual([])
  })

  it('thành viên thêm được vào chủ đề nhóm; người ngoài thì không', async () => {
    expect((await add(w.bob, { deck_id: w.decks.group.id })).status).toBe(201)
    expect((await add(w.carol, { deck_id: w.decks.group.id })).status).toBe(400)
    expect((await add(w.bob, { deck_id: w.decks.alice.id })).status).toBe(400)
  })

  it('trong chủ đề nhóm chỉ trưởng nhóm sửa/xoá được, kể cả mục người khác thêm', async () => {
    const byBob = (await add(w.bob, { deck_id: w.decks.group.id })).body
    expect((await w.bob.patch(`/collocations/${byBob.id}`, { meaning: 'x' })).status).toBe(403)
    expect((await w.bob.del(`/collocations/${byBob.id}`)).status).toBe(403)
    expect((await w.carol.patch(`/collocations/${byBob.id}`, { meaning: 'x' })).status).toBe(404)
    const res = await w.alice.patch(`/collocations/${byBob.id}`, { meaning: 'dựa vào', mistakes: ['upon'] })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ meaning: 'dựa vào', mistakes: ['upon'], pattern: 'rely on sb/sth' })
    expect((await w.alice.del(`/collocations/${byBob.id}`)).status).toBe(204)
  })

  it('mục riêng: chỉ chủ sở hữu sửa; sửa đáp án trùng dạng sai cũ → 400', async () => {
    const c = (await add(w.bob)).body
    expect((await w.alice.patch(`/collocations/${c.id}`, { meaning: 'x' })).status).toBe(404)
    expect((await w.bob.patch(`/collocations/${c.id}`, { answer: 'in' })).body.error.code).toBe('answer_in_mistakes')
    const res = await w.bob.patch(`/collocations/${c.id}`, { pattern: 'rely on/upon sb', answer: 'on' })
    expect(res.body.pattern).toBe('rely on/upon sb')
  })

  it('mỗi thành viên có tiến trình học riêng; ôn mục người khác thêm cũng ghi được nhật ký', async () => {
    const shared = (await add(w.alice, { deck_id: w.decks.group.id })).body
    const due = '2030-01-01T00:00:00.000Z'
    const res = await w.bob.patch(`/collocations/${shared.id}/progress`, { repetitions: 3, due_at: due })
    expect(res.status).toBe(200)
    const bobView = (await w.bob.get('/collocations')).body[0]
    const aliceView = (await w.alice.get('/collocations')).body[0]
    expect(bobView.repetitions).toBe(3)
    expect(new Date(bobView.due_at).toISOString()).toBe(due)
    expect(aliceView.repetitions).toBe(0)

    const log = await w.bob.post('/review-log', { phrase_id: shared.id, quality: 3, direction: 'production' })
    expect(log.status).toBe(201)
    expect((await w.carol.patch(`/collocations/${shared.id}/progress`, { repetitions: 1 })).status).toBe(404)
    const carolLog = await w.carol.post('/review-log', { phrase_id: shared.id, quality: 3, direction: 'production' })
    expect(carolLog.status).toBe(404)
  })
})

describe('tách biệt với câu giao tiếp', () => {
  it('collocation không lẫn vào /phrases và ngược lại; /phrases không sửa/xoá được collocation', async () => {
    const c = (await add(w.bob)).body
    const p = (await w.bob.post('/phrases', { phrase: 'How are you?', meaning: 'Bạn khoẻ không?' })).body
    expect((await w.bob.get('/phrases')).body.map((x) => x.id)).toEqual([p.id])
    expect((await w.bob.get('/collocations')).body.map((x) => x.id)).toEqual([c.id])
    expect((await w.bob.patch(`/phrases/${c.id}`, { meaning: 'x' })).status).toBe(404)
    expect((await w.bob.del(`/phrases/${c.id}`)).status).toBe(404)
    expect((await w.bob.patch(`/collocations/${p.id}`, { meaning: 'x' })).status).toBe(404)
  })

  it('DB chặn collocation thiếu từ gốc/đáp án (phòng khi code bỏ sót kiểm tra)', async () => {
    await expect(
      pool.query("insert into phrases (user_id, kind, phrase, meaning) values ($1, 'verb_pattern', 'x', 'y')", [
        w.bob.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('xoá tài khoản', () => {
  it('collocation trong chủ đề nhóm được giữ cho nhóm; mục riêng bị xoá theo tài khoản', async () => {
    const shared = (await add(w.bob, { deck_id: w.decks.group.id })).body
    await add(w.bob, { deck_id: w.decks.bob.id })
    const { deleteUserKeepingGroupContent } = await import('../src/modules/users/deleteUser.js')
    const client = await pool.connect()
    try {
      await client.query('begin')
      await deleteUserKeepingGroupContent(client, w.bob.id)
      await client.query('commit')
    } finally {
      client.release()
    }
    const left = (await w.alice.get('/collocations')).body
    expect(left.map((c) => [c.id, c.user_id])).toEqual([[shared.id, w.alice.id]])
  })
})
