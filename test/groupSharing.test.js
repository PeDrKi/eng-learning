import { beforeEach, describe, expect, it } from 'vitest'
import { loadAccessContext } from '../src/modules/access/accessContext.js'
import { canViewDeck, canViewWord } from '../src/modules/access/permissions.js'
import { buildWorld, setupTestApp } from './helpers.js'

// Thế giới mẫu: alice là trưởng nhóm, bob là thành viên, carol ở ngoài nhóm, sam là super admin.
// Chủ đề nhóm "Chủ đề nhóm" có từ "group-by-alice" và "group-by-bob" (bob — thành viên — thêm).
const { app, pool } = setupTestApp()
let w
let deckId
beforeEach(async () => {
  w = await buildWorld(app, pool)
  deckId = w.decks.group.id
})

const publish = (user = w.alice) => user.put(`/community/decks/${deckId}/publish`, { description: 'Bộ từ của lớp' })
const ids = (res) => res.body.map((x) => x.id)

describe('chia sẻ chủ đề nhóm ra cộng đồng', () => {
  it('trưởng nhóm bật được; thành viên thường → 403; người ngoài → 404', async () => {
    expect((await publish(w.bob)).status).toBe(403)
    expect((await publish(w.carol)).status).toBe(404)
    const res = await publish()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ is_public: true, group_name: expect.any(String), mine: true, word_count: 2 })
  })

  it('Khám phá ghi tên nhóm; mọi từ (kể cả do thành viên thêm) đều công khai; tìm được theo tên nhóm', async () => {
    await publish()
    const { rows } = await pool.query('select name from groups where id = $1', [w.groupId])
    const explore = (await w.carol.get('/community/decks')).body
    expect(explore[0]).toMatchObject({ id: deckId, group_name: rows[0].name, mine: false })
    const detail = (await w.carol.get(`/community/decks/${deckId}`)).body
    expect(detail.words.map((x) => x.word).toSorted()).toEqual(['group-by-alice', 'group-by-bob'])
    expect(ids(await w.carol.get(`/community/decks?q=${encodeURIComponent(rows[0].name)}`))).toEqual([deckId])
  })

  it('người ngoài lưu vào thư viện: học được nhưng chỉ đọc; thành viên vẫn học như cũ (không thành "đã lưu")', async () => {
    await publish()
    expect((await w.carol.post(`/community/decks/${deckId}/follow`)).status).toBe(200)
    const carolDeck = (await w.carol.get('/decks')).body.find((d) => d.id === deckId)
    expect(carolDeck).toMatchObject({ followed: true, chapter_id: null, group_name: expect.any(String) })
    expect((await w.carol.get('/words')).body.map((x) => x.id)).toContain(w.words.aliceInGroup.id)
    expect((await w.carol.patch(`/words/${w.words.aliceInGroup.id}`, { meaning: 'x' })).status).toBe(403)
    expect((await w.carol.post('/words', { word: 'x', meaning: 'y', deck_id: deckId })).status).toBe(403)

    const bobDeck = (await w.bob.get('/decks')).body.find((d) => d.id === deckId)
    expect(bobDeck.followed).toBe(false)
    // Thành viên mở chủ đề ở Khám phá: không phải người quản lý → không thấy hàng chờ duyệt của người khác.
    expect((await w.bob.get(`/community/decks/${deckId}`)).body.mine).toBe(false)
  })

  it('đề xuất & nhận xét: mọi trưởng nhóm nhận thông báo và duyệt được; thành viên thường thì không duyệt', async () => {
    await publish()
    const s = (
      await w.carol.post(`/community/decks/${deckId}/suggestions`, {
        kind: 'edit',
        word_id: w.words.bobInGroup.id,
        proposed: { meaning: 'nghĩa mới' },
      })
    ).body
    await w.carol.post(`/community/decks/${deckId}/comments`, { body: 'Hay' })
    const aliceNotes = (await w.alice.get('/community/notifications')).body
    expect(aliceNotes.items.map((n) => n.type).toSorted()).toEqual(['comment', 'suggestion'])
    expect((await w.bob.get('/community/notifications')).body.unread).toBe(0)

    expect((await w.bob.post(`/community/suggestions/${s.id}/accept`, {})).status).toBe(404)
    expect((await w.alice.get('/decks')).body.find((d) => d.id === deckId).pending_suggestions).toBe(1)
    expect((await w.alice.post(`/community/suggestions/${s.id}/accept`, {})).status).toBe(200)
    const word = (await w.bob.get('/words')).body.find((x) => x.id === w.words.bobInGroup.id)
    expect(word.meaning).toBe('nghĩa mới')

    // Trưởng nhóm xoá được nhận xét của người khác trên chủ đề nhóm.
    const c = (await w.alice.get(`/community/decks/${deckId}/comments`)).body[0]
    expect(c.can_delete).toBe(true)
    expect((await w.alice.del(`/community/comments/${c.id}`)).status).toBe(204)
  })

  it('trưởng nhóm không gửi đề xuất cho chủ đề mình quản lý; thành viên thường thì gửi được', async () => {
    await publish()
    const add = { kind: 'add', proposed: { word: 'kiwi', meaning: 'kiwi' } }
    expect((await w.alice.post(`/community/decks/${deckId}/suggestions`, add)).body.error.code).toBe('own_deck')
    expect((await w.bob.post(`/community/decks/${deckId}/suggestions`, add)).status).toBe(201)
  })

  it('quản trị viên ẩn chủ đề nhóm: người ngoài mất quyền xem, thành viên nhóm vẫn học bình thường', async () => {
    await publish()
    await w.carol.post(`/community/decks/${deckId}/follow`)
    expect((await w.sam.post(`/admin/community/decks/${deckId}/hide`)).status).toBe(204)
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).not.toContain(deckId)
    expect((await w.carol.get(`/community/decks/${deckId}`)).status).toBe(404)
    expect((await w.bob.get('/decks')).body.map((d) => d.id)).toContain(deckId)
    expect((await publish()).body.error.code).toBe('deck_hidden')
  })

  it('xoá nhóm thì chủ đề nhóm (và người đã lưu) đi theo', async () => {
    await publish()
    await w.carol.post(`/community/decks/${deckId}/follow`)
    await pool.query('delete from groups where id = $1', [w.groupId])
    expect((await w.carol.get('/community/decks')).body).toEqual([])
    expect((await w.carol.get('/decks')).body.map((d) => d.id)).not.toContain(deckId)
  })

  it('luật quyền JS khớp SQL danh sách khi người ngoài lưu chủ đề nhóm', async () => {
    await publish()
    await w.carol.post(`/community/decks/${deckId}/follow`)
    const { rows: allDecks } = await pool.query('select * from decks')
    const { rows: allWords } = await pool.query('select * from words')
    const deckById = new Map(allDecks.map((d) => [d.id, d]))
    for (const user of [w.alice, w.bob, w.carol, w.sam]) {
      const ctx = await loadAccessContext(pool, user.id)
      expect(ids(await user.get('/decks')).toSorted()).toEqual(
        allDecks
          .filter((d) => canViewDeck(d, ctx))
          .map((d) => d.id)
          .toSorted(),
      )
      expect(ids(await user.get('/words')).toSorted()).toEqual(
        allWords
          .filter((x) => canViewWord(x, deckById.get(x.deck_id) ?? null, ctx))
          .map((x) => x.id)
          .toSorted(),
      )
    }
  })
})
