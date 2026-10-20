import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadAccessContext } from '../src/modules/access/accessContext.js'
import { canViewDeck } from '../src/modules/access/permissions.js'
import { buildWorld, setupTestApp } from './helpers.js'

const PASSWORD = 'matkhau123'

// Chương gom nhiều chủ đề (bài). Phân quyền y như chủ đề; chủ đề chỉ vào được chương cùng phạm vi.
const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const chapter = async (user, name, group_id) => (await user.post('/chapters', { name, group_id })).body

describe('GET/POST /chapters', () => {
  it('tạo chương cá nhân; chủ sở hữu luôn là người gọi', async () => {
    const res = await w.bob.post('/chapters', { name: '  Chương 1 ', user_id: w.alice.id })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Chương 1', user_id: w.bob.id, group_id: null })
  })

  it.each([
    ['alice', 201],
    ['bob', 403],
    ['carol', 403],
    ['sam', 201],
  ])('tạo chương cho nhóm: %s → %i', async (who, status) => {
    expect((await w[who].post('/chapters', { name: 'Chương nhóm', group_id: w.groupId })).status).toBe(status)
  })

  it('mỗi người chỉ thấy chương của mình + chương của nhóm mình (khớp luật canViewDeck)', async () => {
    await chapter(w.alice, 'A riêng')
    await chapter(w.carol, 'C riêng')
    await chapter(w.alice, 'Nhóm', w.groupId)
    const names = async (u) => (await u.get('/chapters')).body.map((c) => c.name).toSorted()
    expect(await names(w.alice)).toEqual(['A riêng', 'Nhóm'])
    expect(await names(w.bob)).toEqual(['Nhóm'])
    expect(await names(w.carol)).toEqual(['C riêng'])
    expect(await names(w.sam)).toEqual(['Nhóm'])
    const { rows: all } = await pool.query('select * from chapters')
    for (const user of [w.alice, w.bob, w.carol, w.sam]) {
      const ctx = await loadAccessContext(pool, user.id)
      const expected = all.filter((c) => canViewDeck(c, ctx)).map((c) => c.id)
      expect((await user.get('/chapters')).body.map((c) => c.id).toSorted()).toEqual(expected.toSorted())
    }
  })

  it('tên rỗng → 400; bắt buộc đăng nhập', async () => {
    expect((await w.alice.post('/chapters', { name: '   ' })).status).toBe(400)
    expect((await request(app).get('/chapters')).status).toBe(401)
  })
})

describe('PATCH/DELETE /chapters/:id', () => {
  it('đổi tên chương của mình; chương người khác → 404', async () => {
    const c = await chapter(w.alice, 'Cũ')
    expect((await w.alice.patch(`/chapters/${c.id}`, { name: 'Mới' })).body.name).toBe('Mới')
    expect((await w.carol.patch(`/chapters/${c.id}`, { name: 'X' })).status).toBe(404)
  })

  it('thành viên thấy chương nhóm nhưng không sửa/xoá được (403)', async () => {
    const c = await chapter(w.alice, 'Nhóm', w.groupId)
    expect((await w.bob.patch(`/chapters/${c.id}`, { name: 'X' })).status).toBe(403)
    expect((await w.bob.del(`/chapters/${c.id}`)).status).toBe(403)
  })

  it('xoá chương: các chủ đề bên trong GIỮ NGUYÊN, chỉ ra khỏi chương', async () => {
    const c = await chapter(w.alice, 'Chương 1')
    await w.alice.patch(`/decks/${w.decks.alice.id}`, { chapter_id: c.id })
    expect((await w.alice.del(`/chapters/${c.id}`)).status).toBe(204)
    const deck = (await w.alice.get('/decks')).body.find((d) => d.id === w.decks.alice.id)
    expect(deck).toMatchObject({ name: 'Alice riêng', chapter_id: null })
  })
})

describe('Xếp chủ đề vào chương', () => {
  it('tạo chủ đề thẳng trong chương, rồi chuyển ra (null) và vào lại', async () => {
    const c = await chapter(w.alice, 'Chương 1')
    const d = (await w.alice.post('/decks', { name: 'Bài 1', chapter_id: c.id })).body
    expect(d.chapter_id).toBe(c.id)
    expect((await w.alice.patch(`/decks/${d.id}`, { chapter_id: null })).body.chapter_id).toBeNull()
    const back = await w.alice.patch(`/decks/${d.id}`, { chapter_id: c.id })
    expect(back.body).toMatchObject({ chapter_id: c.id, name: 'Bài 1' })
  })

  it('đổi tên chủ đề không làm rơi chương (không gửi chapter_id = giữ nguyên)', async () => {
    const c = await chapter(w.alice, 'Chương 1')
    await w.alice.patch(`/decks/${w.decks.alice.id}`, { chapter_id: c.id })
    const res = await w.alice.patch(`/decks/${w.decks.alice.id}`, { name: 'Bài 1' })
    expect(res.body).toMatchObject({ name: 'Bài 1', chapter_id: c.id })
  })

  it('không xếp được chủ đề vào chương của người khác (400 chapter_not_found)', async () => {
    const c = await chapter(w.carol, 'Của Carol')
    const res = await w.alice.patch(`/decks/${w.decks.alice.id}`, { chapter_id: c.id })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('chapter_not_found')
  })

  it('chủ đề nhóm không vào chương cá nhân, chủ đề cá nhân không vào chương nhóm', async () => {
    const personal = await chapter(w.alice, 'Riêng')
    const group = await chapter(w.alice, 'Nhóm', w.groupId)
    const a = await w.alice.patch(`/decks/${w.decks.group.id}`, { chapter_id: personal.id })
    const b = await w.alice.patch(`/decks/${w.decks.alice.id}`, { chapter_id: group.id })
    expect([a.status, a.body.error.code]).toEqual([400, 'chapter_scope_mismatch'])
    expect([b.status, b.body.error.code]).toEqual([400, 'chapter_scope_mismatch'])
    expect((await w.alice.patch(`/decks/${w.decks.group.id}`, { chapter_id: group.id })).status).toBe(200)
  })

  it('thành viên không xếp chủ đề nhóm vào chương được (không quản lý chủ đề đó)', async () => {
    const group = await chapter(w.alice, 'Nhóm', w.groupId)
    expect((await w.bob.patch(`/decks/${w.decks.group.id}`, { chapter_id: group.id })).status).toBe(403)
  })

  it('trưởng nhóm duy nhất xoá tài khoản → chương nhóm chuyển cho người kế nhiệm, không mất', async () => {
    const group = await chapter(w.alice, 'Nhóm', w.groupId)
    await w.alice.patch(`/decks/${w.decks.group.id}`, { chapter_id: group.id })
    expect((await w.alice.del('/auth/account', { password: PASSWORD })).status).toBe(204)
    const { rows } = await pool.query('select user_id from chapters where id = $1', [group.id])
    expect(rows[0].user_id).toBe(w.bob.id)
    const deck = (await w.bob.get('/decks')).body.find((d) => d.id === w.decks.group.id)
    expect(deck.chapter_id).toBe(group.id)
  })
})
