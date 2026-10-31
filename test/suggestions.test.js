import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
let deckId
let banana
beforeEach(async () => {
  w = await buildWorld(app, pool)
  deckId = w.decks.bob.id // chủ đề công khai của Bob, có từ "banana" (nghĩa "nghĩa")
  banana = w.words.bobPersonal.id
  await w.bob.put(`/community/decks/${deckId}/publish`, {})
})

const suggest = (user, body) => user.post(`/community/decks/${deckId}/suggestions`, body)
const pending = (user) => user.get(`/community/decks/${deckId}/suggestions`)
const bobWord = async (id) => (await w.bob.get('/words')).body.find((x) => x.id === id)

describe('gửi đề xuất', () => {
  it('đề xuất sửa: chỉ giữ trường thật sự đổi, lưu bản gốc; giống hệt bản hiện tại → 400', async () => {
    const res = await suggest(w.carol, {
      kind: 'edit',
      word_id: banana,
      proposed: { word: 'banana', meaning: 'quả chuối' },
      reason: 'nghĩa đang sai',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'edit',
      status: 'pending',
      mine: true,
      proposed: { meaning: 'quả chuối' },
      base: { word: 'banana', meaning: 'nghĩa' },
      conflict: false,
    })
    const same = await suggest(w.carol, { kind: 'edit', word_id: banana, proposed: { meaning: 'nghĩa' } })
    expect(same.body.error.code).toBe('no_change')
  })

  it('đề xuất xoá bắt buộc lý do; đề xuất thêm cần từ + nghĩa', async () => {
    expect((await suggest(w.carol, { kind: 'delete', word_id: banana, reason: '' })).status).toBe(400)
    expect((await suggest(w.carol, { kind: 'delete', word_id: banana, reason: 'trùng' })).status).toBe(201)
    expect((await suggest(w.carol, { kind: 'add', proposed: { word: 'mango' } })).status).toBe(400)
    expect((await suggest(w.carol, { kind: 'add', proposed: { word: 'mango', meaning: 'xoài' } })).status).toBe(201)
  })

  it('chủ chủ đề không tự đề xuất; chủ đề chưa công khai → 404; từ ngoài chủ đề → 400', async () => {
    expect((await suggest(w.bob, { kind: 'add', proposed: { word: 'x', meaning: 'y' } })).body.error.code).toBe(
      'own_deck',
    )
    const other = await w.carol.post(`/community/decks/${w.decks.alice.id}/suggestions`, {
      kind: 'add',
      proposed: { word: 'x', meaning: 'y' },
    })
    expect(other.status).toBe(404)
    const wrong = await suggest(w.carol, {
      kind: 'edit',
      word_id: w.words.alicePersonal.id,
      proposed: { meaning: 'z' },
    })
    expect(wrong.body.error.code).toBe('word_not_in_deck')
  })
})

describe('duyệt đề xuất', () => {
  it('chủ chủ đề thấy mọi đề xuất; người khác chỉ thấy của mình; số chờ duyệt hiện ở /decks', async () => {
    await suggest(w.carol, { kind: 'add', proposed: { word: 'mango', meaning: 'xoài' } })
    await suggest(w.alice, { kind: 'add', proposed: { word: 'kiwi', meaning: 'kiwi' } })
    expect((await pending(w.bob)).body).toHaveLength(2)
    expect((await pending(w.carol)).body.map((s) => s.proposed.word)).toEqual(['mango'])
    expect((await w.bob.get('/decks')).body.find((d) => d.id === deckId).pending_suggestions).toBe(2)
  })

  it('đồng ý đề xuất sửa → áp dụng vào từ; người đề xuất thấy kết quả + ghi chú', async () => {
    const s = (await suggest(w.carol, { kind: 'edit', word_id: banana, proposed: { meaning: 'quả chuối' } })).body
    expect((await w.carol.post(`/community/suggestions/${s.id}/accept`, {})).status).toBe(404) // không phải chủ
    const res = await w.bob.post(`/community/suggestions/${s.id}/accept`, { note: 'Cảm ơn bạn!' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'accepted', review_note: 'Cảm ơn bạn!' })
    expect((await bobWord(banana)).meaning).toBe('quả chuối')
    expect((await w.bob.post(`/community/suggestions/${s.id}/accept`, {})).body.error.code).toBe('suggestion_closed')

    const mine = (await w.carol.get('/community/suggestions/mine')).body
    expect(mine[0]).toMatchObject({ id: s.id, status: 'accepted', review_note: 'Cảm ơn bạn!', deck_name: 'Bob riêng' })
  })

  it('đồng ý đề xuất thêm → từ mới thuộc chủ chủ đề, nằm trong chủ đề; đề xuất xoá → từ bị xoá', async () => {
    const add = (await suggest(w.carol, { kind: 'add', proposed: { word: 'mango', meaning: 'xoài' } })).body
    await w.bob.post(`/community/suggestions/${add.id}/accept`, {})
    const mango = (await w.bob.get('/words')).body.find((x) => x.word === 'mango')
    expect(mango).toMatchObject({ user_id: w.bob.id, deck_id: deckId, meaning: 'xoài' })

    const del = (await suggest(w.carol, { kind: 'delete', word_id: mango.id, reason: 'không cần' })).body
    await w.bob.post(`/community/suggestions/${del.id}/accept`, {})
    expect(await bobWord(mango.id)).toBeUndefined()
  })

  it('từ chối kèm ghi chú; người đề xuất rút lại được đề xuất đang chờ', async () => {
    const s = (await suggest(w.carol, { kind: 'add', proposed: { word: 'x', meaning: 'y' } })).body
    const res = await w.bob.post(`/community/suggestions/${s.id}/reject`, { note: 'Ngoài chủ đề' })
    expect(res.body).toMatchObject({ status: 'rejected', review_note: 'Ngoài chủ đề' })
    expect((await w.carol.del(`/community/suggestions/${s.id}`)).status).toBe(404) // đã xử lý thì không rút

    const t = (await suggest(w.carol, { kind: 'add', proposed: { word: 'z', meaning: 'z' } })).body
    expect((await w.alice.del(`/community/suggestions/${t.id}`)).status).toBe(404)
    expect((await w.carol.del(`/community/suggestions/${t.id}`)).status).toBe(204)
  })

  it('XUNG ĐỘT: từ bị sửa sau khi đề xuất → báo conflict, 409 khi duyệt, force=true mới áp dụng', async () => {
    const s = (await suggest(w.carol, { kind: 'edit', word_id: banana, proposed: { meaning: 'quả chuối' } })).body
    await w.bob.patch(`/words/${banana}`, { meaning: 'chuối (Bob tự sửa)' })
    const listed = (await pending(w.bob)).body[0]
    expect(listed).toMatchObject({ conflict: true, current: { meaning: 'chuối (Bob tự sửa)' } })
    const res = await w.bob.post(`/community/suggestions/${s.id}/accept`, {})
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('suggestion_conflict')
    expect((await w.bob.post(`/community/suggestions/${s.id}/accept`, { force: true })).status).toBe(200)
    expect((await bobWord(banana)).meaning).toBe('quả chuối')
  })

  it('từ đã bị xoá → đề xuất sửa thành stale, không duyệt được nữa', async () => {
    const s = (await suggest(w.carol, { kind: 'edit', word_id: banana, proposed: { meaning: 'quả chuối' } })).body
    await w.bob.del(`/words/${banana}`)
    expect((await pending(w.bob)).body).toEqual([])
    const all = (await w.bob.get(`/community/decks/${deckId}/suggestions?status=all`)).body
    expect(all[0]).toMatchObject({ id: s.id, status: 'stale' })
    expect((await w.bob.post(`/community/suggestions/${s.id}/accept`, {})).body.error.code).toBe('suggestion_stale')
  })
})
