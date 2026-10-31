import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadAccessContext } from '../src/modules/access/accessContext.js'
import { canViewDeck, canViewWord } from '../src/modules/access/permissions.js'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

// Bob công khai chủ đề riêng "Bob riêng" (có từ "banana").
const publish = (description = 'Từ vựng trái cây') =>
  w.bob.put(`/community/decks/${w.decks.bob.id}/publish`, { description })
const ids = (res) => res.body.map((d) => d.id)

describe('công khai chủ đề', () => {
  it('chủ sở hữu công khai chủ đề cá nhân; mọi người đã đăng nhập thấy ở Khám phá kèm tên công khai', async () => {
    const res = await publish()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ is_public: true, description: 'Từ vựng trái cây', mine: true, word_count: 1 })

    const explore = await w.carol.get('/community/decks')
    expect(ids(explore)).toEqual([w.decks.bob.id])
    expect(explore.body[0]).toMatchObject({ mine: false, followed: false, follower_count: 0 })
    // Chưa đặt tên hiển thị → name null + mã 4 ký tự (giao diện ghép "Người học #XXXX"), không lộ email.
    expect(explore.body[0]).toMatchObject({ owner_name: null, owner_tag: expect.stringMatching(/^[0-9A-F]{4}$/) })
    expect(JSON.stringify(explore.body)).not.toContain('@example.com')
    expect((await request(app).get('/community/decks')).status).toBe(401)
  })

  it('có tên hiển thị thì dùng tên đó; tìm theo tên chủ đề, mô tả, tên người chia sẻ', async () => {
    await pool.query("update users set display_name = 'Bob Lê' where id = $1", [w.bob.id])
    await publish()
    expect((await w.carol.get('/community/decks')).body[0].owner_name).toBe('Bob Lê')
    for (const q of ['trái cây', 'BOB riêng', 'Lê']) {
      expect(ids(await w.carol.get(`/community/decks?q=${encodeURIComponent(q)}`))).toEqual([w.decks.bob.id])
    }
    expect((await w.carol.get('/community/decks?q=xyz')).body).toEqual([])
    expect((await w.carol.get('/community/decks?q=%25')).body).toEqual([]) // % là chữ thường, không phải ký tự đại diện
  })

  it('chỉ chủ sở hữu bật được; chủ đề nhóm không công khai được', async () => {
    expect((await w.alice.put(`/community/decks/${w.decks.bob.id}/publish`, {})).status).toBe(404)
    const group = await w.alice.put(`/community/decks/${w.decks.group.id}/publish`, {})
    expect(group.status).toBe(400)
    expect(group.body.error.code).toBe('group_deck_not_publishable')
    await expect(
      pool.query('update decks set is_public = true where id = $1', [w.decks.group.id]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('xem chi tiết: chỉ nội dung từ, không tiến trình học; chủ đề chưa công khai → 404', async () => {
    expect((await w.carol.get(`/community/decks/${w.decks.bob.id}`)).status).toBe(404)
    await publish()
    const res = await w.carol.get(`/community/decks/${w.decks.bob.id}`)
    expect(res.status).toBe(200)
    expect(res.body.words.map((x) => x.word)).toEqual(['banana'])
    expect(res.body.words[0]).not.toHaveProperty('due_at')
    expect(res.body.words[0]).not.toHaveProperty('user_id')
    expect(res.body).not.toHaveProperty('user_id')
  })
})

describe('Lưu vào thư viện (theo dõi)', () => {
  it('lưu → chủ đề + từ hiện trong /decks, /words của người lưu; học được với tiến trình riêng; chỉ đọc', async () => {
    await publish()
    const res = await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ followed: true, follower_count: 1 })

    const decks = (await w.carol.get('/decks')).body
    const followed = decks.find((d) => d.id === w.decks.bob.id)
    expect(followed).toMatchObject({ followed: true, chapter_id: null })
    expect(followed.owner_tag).toMatch(/^[0-9A-F]{4}$/)
    expect((await w.bob.get('/decks')).body.find((d) => d.id === w.decks.bob.id)).toMatchObject({
      followed: false,
      follower_count: 1,
    })

    const banana = w.words.bobPersonal
    expect((await w.carol.get('/words')).body.map((x) => x.id)).toContain(banana.id)
    const prog = await w.carol.patch(`/progress/${banana.id}`, { repetitions: 2 })
    expect(prog.status).toBeLessThan(300)
    const bobView = (await w.bob.get('/words')).body.find((x) => x.id === banana.id)
    expect(bobView.repetitions ?? 0).not.toBe(2)

    // Chỉ đọc: không sửa/xoá từ, không thêm từ / câu giao tiếp / collocation vào chủ đề đó.
    expect((await w.carol.patch(`/words/${banana.id}`, { meaning: 'x' })).status).toBe(403)
    expect((await w.carol.post('/words', { word: 'x', meaning: 'y', deck_id: w.decks.bob.id })).status).toBe(403)
    expect((await w.carol.patch(`/decks/${w.decks.bob.id}`, { name: 'x' })).status).toBe(403)
    expect((await w.carol.post('/phrases', { phrase: 'Hi', meaning: 'Chào', deck_id: w.decks.bob.id })).status).toBe(
      400,
    )
  })

  it('chỉnh sửa của chủ sở hữu hiện ngay với người đã lưu', async () => {
    await publish()
    await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)
    await w.bob.patch(`/words/${w.words.bobPersonal.id}`, { meaning: 'quả chuối' })
    const seen = (await w.carol.get('/words')).body.find((x) => x.id === w.words.bobPersonal.id)
    expect(seen.meaning).toBe('quả chuối')
  })

  it('không lưu được chủ đề chưa công khai hay của chính mình; bỏ lưu thì mất khỏi thư viện', async () => {
    expect((await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)).status).toBe(404)
    await publish()
    expect((await w.bob.post(`/community/decks/${w.decks.bob.id}/follow`)).body.error.code).toBe('own_deck')
    await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)
    expect((await w.carol.del(`/community/decks/${w.decks.bob.id}/follow`)).status).toBe(204)
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).not.toContain(w.decks.bob.id)
    expect((await w.carol.get('/words')).body.map((x) => x.id)).not.toContain(w.words.bobPersonal.id)
  })

  it('tắt công khai: người đã lưu vẫn học tiếp, người mới không thấy; "thu hồi" thì người đã lưu mất quyền', async () => {
    await publish()
    await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)
    expect((await w.bob.post(`/community/decks/${w.decks.bob.id}/unpublish`, {})).body).toEqual({ revoked: 0 })
    expect((await w.alice.get('/community/decks')).body).toEqual([])
    expect((await w.alice.post(`/community/decks/${w.decks.bob.id}/follow`)).status).toBe(404)
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).toContain(w.decks.bob.id)

    await publish()
    const res = await w.bob.post(`/community/decks/${w.decks.bob.id}/unpublish`, { revoke_followers: true })
    expect(res.body).toEqual({ revoked: 1 })
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).not.toContain(w.decks.bob.id)
  })

  it('luật quyền JS khớp với SQL danh sách khi có chủ đề đã lưu', async () => {
    await publish()
    await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)
    const { rows: allDecks } = await pool.query('select * from decks')
    const { rows: allWords } = await pool.query('select * from words')
    const deckById = new Map(allDecks.map((d) => [d.id, d]))
    for (const user of [w.alice, w.bob, w.carol, w.sam]) {
      const ctx = await loadAccessContext(pool, user.id)
      const expectedDecks = allDecks.filter((d) => canViewDeck(d, ctx)).map((d) => d.id)
      expect(ids(await user.get('/decks')).toSorted()).toEqual(expectedDecks.toSorted())
      const expectedWords = allWords
        .filter((x) => canViewWord(x, deckById.get(x.deck_id) ?? null, ctx))
        .map((x) => x.id)
      expect(ids(await user.get('/words')).toSorted()).toEqual(expectedWords.toSorted())
    }
  })
})

describe('Sao chép', () => {
  it('tạo chủ đề cá nhân mới với bản sao các từ; độc lập với bản gốc', async () => {
    await publish()
    const res = await w.carol.post(`/community/decks/${w.decks.bob.id}/copy`)
    expect(res.status).toBe(201)
    expect(res.body.words_copied).toBe(1)
    expect(res.body.deck).toMatchObject({ user_id: w.carol.id, name: 'Bob riêng', is_public: false })
    const copied = (await w.carol.get('/words')).body.find((x) => x.deck_id === res.body.deck.id)
    expect(copied).toMatchObject({ word: 'banana', user_id: w.carol.id })
    // Sửa bản sao không ảnh hưởng bản gốc.
    await w.carol.patch(`/words/${copied.id}`, { meaning: 'chuối của Carol' })
    expect((await w.bob.get('/words')).body.find((x) => x.id === w.words.bobPersonal.id).meaning).toBe('nghĩa')
  })

  it('không sao chép được chủ đề chưa công khai (trừ khi đã lưu) hay của chính mình', async () => {
    expect((await w.carol.post(`/community/decks/${w.decks.bob.id}/copy`)).status).toBe(404)
    await publish()
    expect((await w.bob.post(`/community/decks/${w.decks.bob.id}/copy`)).body.error.code).toBe('own_deck')
    await w.carol.post(`/community/decks/${w.decks.bob.id}/follow`)
    await w.bob.post(`/community/decks/${w.decks.bob.id}/unpublish`, {})
    // Đã lưu thì vẫn sao chép được sau khi chủ sở hữu tắt công khai — để giữ lại bản riêng.
    expect((await w.carol.post(`/community/decks/${w.decks.bob.id}/copy`)).status).toBe(201)
  })
})
