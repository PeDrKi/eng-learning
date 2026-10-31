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

const comment = (user, body, word_id) => user.post(`/community/decks/${deckId}/comments`, { body, word_id })
const list = (user, word_id) => user.get(`/community/decks/${deckId}/comments${word_id ? `?word_id=${word_id}` : ''}`)

describe('nhận xét cộng đồng', () => {
  it('nhận xét chung cho chủ đề và cho từng từ được tách riêng; hiện tên công khai, không email', async () => {
    const banana = w.words.bobPersonal.id
    const res = await comment(w.carol, '  Hay quá! ')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ body: 'Hay quá!', word_id: null, mine: true, can_delete: true, author_name: null })
    expect(res.body.author_tag).toMatch(/^[0-9A-F]{4}$/)
    await comment(w.alice, 'Nên thêm ví dụ', banana)

    expect((await list(w.bob)).body.map((c) => c.body)).toEqual(['Hay quá!'])
    expect((await list(w.bob, banana)).body.map((c) => c.body)).toEqual(['Nên thêm ví dụ'])
    expect(JSON.stringify((await list(w.bob)).body)).not.toContain('@example.com')

    const deck = (await w.carol.get(`/community/decks/${deckId}`)).body
    expect(deck.comment_count).toBe(1)
    expect(deck.words.find((x) => x.id === banana).comment_count).toBe(1)
  })

  it('chủ đề chưa công khai (và chưa lưu) → không xem/viết được; từ không thuộc chủ đề → 400', async () => {
    expect((await w.carol.post(`/community/decks/${w.decks.alice.id}/comments`, { body: 'x' })).status).toBe(404)
    expect((await w.carol.get(`/community/decks/${w.decks.alice.id}/comments`)).status).toBe(404)
    const wrong = await comment(w.carol, 'x', w.words.alicePersonal.id)
    expect(wrong.status).toBe(400)
    expect(wrong.body.error.code).toBe('word_not_in_deck')
    expect((await comment(w.carol, '   ')).status).toBe(400)
    expect((await comment(w.carol, 'a'.repeat(1001))).status).toBe(400)
  })

  it('xoá: người viết và chủ chủ đề xoá được, người khác thì không; xoá mềm (vẫn còn trong DB)', async () => {
    const byCarol = (await comment(w.carol, 'của Carol')).body
    const byAlice = (await comment(w.alice, 'của Alice')).body
    const asAlice = (await list(w.alice)).body
    expect(asAlice.find((c) => c.id === byCarol.id)).toMatchObject({ mine: false, can_delete: false })
    expect((await w.alice.del(`/community/comments/${byCarol.id}`)).status).toBe(403)

    expect((await w.carol.del(`/community/comments/${byCarol.id}`)).status).toBe(204) // người viết
    expect((await list(w.bob)).body.find((c) => c.id === byAlice.id).can_delete).toBe(true) // chủ chủ đề
    expect((await w.bob.del(`/community/comments/${byAlice.id}`)).status).toBe(204)
    expect((await list(w.bob)).body).toEqual([])
    expect((await w.bob.del(`/community/comments/${byAlice.id}`)).status).toBe(404)

    const { rows } = await pool.query('select deleted_at, deleted_by from comments where id = $1', [byAlice.id])
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe(w.bob.id)
  })

  it('người đã lưu vẫn nhận xét được sau khi chủ đề ngừng chia sẻ; người khác thì không', async () => {
    await w.carol.post(`/community/decks/${deckId}/follow`)
    await w.bob.post(`/community/decks/${deckId}/unpublish`, {})
    expect((await comment(w.carol, 'vẫn học')).status).toBe(201)
    expect((await comment(w.alice, 'không được')).status).toBe(404)
  })
})
