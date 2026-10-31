import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
let deckId
beforeEach(async () => {
  w = await buildWorld(app, pool)
  deckId = w.decks.bob.id
  await w.bob.put(`/community/decks/${deckId}/publish`, {})
})

const comment = (user, body = 'Hay') => user.post(`/community/decks/${deckId}/comments`, { body })
const report = (user, target_type, target_id, reason = 'spam') =>
  user.post('/community/reports', { target_type, target_id, reason })

describe('thông báo', () => {
  it('nhận xét / đề xuất mới báo cho chủ chủ đề; kết quả duyệt báo cho người đề xuất; không tự báo chính mình', async () => {
    await comment(w.carol)
    await comment(w.bob) // chủ chủ đề tự nhận xét → không có thông báo
    const s = (
      await w.carol.post(`/community/decks/${deckId}/suggestions`, {
        kind: 'add',
        proposed: { word: 'kiwi', meaning: 'kiwi' },
      })
    ).body
    const bob = (await w.bob.get('/community/notifications')).body
    expect(bob.unread).toBe(2)
    expect(bob.items.map((n) => n.type)).toEqual(['suggestion', 'comment'])
    expect(bob.items[0]).toMatchObject({ deck_id: deckId, payload: { deck_name: 'Bob riêng' }, actor_name: null })
    expect(bob.items[0].actor_tag).toMatch(/^[0-9A-F]{4}$/)

    await w.bob.post(`/community/suggestions/${s.id}/accept`, {})
    const carol = (await w.carol.get('/community/notifications')).body
    expect(carol.items[0]).toMatchObject({ type: 'suggestion_result', payload: { status: 'accepted' } })

    expect((await w.bob.post('/community/notifications/read')).status).toBe(204)
    expect((await w.bob.get('/community/notifications')).body.unread).toBe(0)
  })
})

describe('báo cáo vi phạm và kiểm duyệt', () => {
  it('báo cáo chủ đề / nhận xét; gửi lại không tạo bản trùng; nội dung không xem được → 404', async () => {
    const c = (await comment(w.carol, 'nội dung xấu')).body
    expect((await report(w.alice, 'deck', deckId)).status).toBe(201)
    expect((await report(w.alice, 'deck', deckId)).status).toBe(201)
    expect((await report(w.alice, 'comment', c.id)).status).toBe(201)
    expect((await report(w.alice, 'deck', w.decks.carol.id)).status).toBe(404)
    const { rows } = await pool.query("select count(*)::int as n from reports where status = 'open'")
    expect(rows[0].n).toBe(2)
  })

  it('chỉ super admin xem được trang kiểm duyệt; báo cáo kèm tóm tắt nội dung và người tạo', async () => {
    await report(w.alice, 'deck', deckId, 'nội dung sai')
    expect((await w.alice.get('/admin/community/reports')).status).toBe(403)
    const res = await w.sam.get('/admin/community/reports')
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      target_type: 'deck',
      reason: 'nội dung sai',
      target: { title: 'Bob riêng', deck_id: deckId, owner_id: w.bob.id, hidden: false, owner_blocked: false },
    })
    expect(JSON.stringify(res.body)).not.toContain('@example.com')
  })

  it('ẩn chủ đề: biến mất khỏi Khám phá và khỏi thư viện người đã lưu; chủ sở hữu không công khai lại được; bỏ ẩn thì trở lại', async () => {
    await w.carol.post(`/community/decks/${deckId}/follow`)
    await report(w.alice, 'deck', deckId)
    expect((await w.sam.post(`/admin/community/decks/${deckId}/hide`)).status).toBe(204)

    expect((await w.alice.get('/community/decks')).body).toEqual([])
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).not.toContain(deckId)
    expect((await w.carol.get('/words')).body.map((x) => x.id)).not.toContain(w.words.bobPersonal.id)
    expect((await w.carol.get(`/community/decks/${deckId}`)).status).toBe(404)
    const own = (await w.bob.get('/decks')).body.find((d) => d.id === deckId)
    expect(own.hidden_at).not.toBeNull() // chủ sở hữu vẫn thấy chủ đề của mình
    expect((await w.bob.put(`/community/decks/${deckId}/publish`, {})).body.error.code).toBe('deck_hidden')
    // Ẩn xong thì báo cáo về chủ đề đó tự đóng.
    expect((await w.sam.get('/admin/community/reports')).body).toEqual([])

    await w.sam.post(`/admin/community/decks/${deckId}/unhide`)
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).toContain(deckId)
  })

  it('ẩn / bỏ ẩn nhận xét; đóng báo cáo bằng "bỏ qua"', async () => {
    const c = (await comment(w.carol, 'spam')).body
    await w.sam.post(`/admin/community/comments/${c.id}/hide`)
    expect((await w.alice.get(`/community/decks/${deckId}/comments`)).body).toEqual([])
    await w.sam.post(`/admin/community/comments/${c.id}/unhide`)
    expect((await w.alice.get(`/community/decks/${deckId}/comments`)).body).toHaveLength(1)

    await report(w.alice, 'comment', c.id)
    const r = (await w.sam.get('/admin/community/reports')).body[0]
    expect((await w.sam.post(`/admin/community/reports/${r.id}/close`, { status: 'dismissed' })).status).toBe(204)
    expect((await w.sam.get('/admin/community/reports?status=dismissed')).body[0].id).toBe(r.id)
  })

  it('chặn người dùng: không chia sẻ / nhận xét / đề xuất / báo cáo được, nhưng vẫn lưu & học được; không chặn được super admin', async () => {
    await w.sam.post(`/admin/community/users/${w.carol.id}/block`)
    expect((await comment(w.carol)).body.error.code).toBe('community_blocked')
    const sug = await w.carol.post(`/community/decks/${deckId}/suggestions`, {
      kind: 'add',
      proposed: { word: 'x', meaning: 'y' },
    })
    expect(sug.body.error.code).toBe('community_blocked')
    expect((await report(w.carol, 'deck', deckId)).body.error.code).toBe('community_blocked')
    expect((await w.carol.put(`/community/decks/${w.decks.carol.id}/publish`, {})).body.error.code).toBe(
      'community_blocked',
    )
    expect((await w.carol.post(`/community/decks/${deckId}/follow`)).status).toBe(200)

    await w.sam.post(`/admin/community/users/${w.carol.id}/unblock`)
    expect((await comment(w.carol)).status).toBe(201)
    expect((await w.sam.post(`/admin/community/users/${w.sam.id}/block`)).body.error.code).toBe('cannot_block_admin')
  })
})
