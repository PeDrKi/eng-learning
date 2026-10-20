import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadAccessContext } from '../src/modules/access/accessContext.js'
import { canViewDeck } from '../src/modules/access/permissions.js'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w // thế giới mẫu, dựng lại trước mỗi test (xem buildWorld trong helpers.js)
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const names = (res) => res.body.map((d) => d.name).toSorted()

describe('GET /decks', () => {
  it('mỗi người chỉ thấy chủ đề của mình + chủ đề của nhóm mình tham gia', async () => {
    expect(names(await w.alice.get('/decks'))).toEqual(['Alice riêng', 'Chủ đề nhóm'])
    expect(names(await w.bob.get('/decks'))).toEqual(['Bob riêng', 'Chủ đề nhóm'])
    expect(names(await w.carol.get('/decks'))).toEqual(['Carol riêng'])
  })

  it('super admin thấy chủ đề của mọi nhóm, nhưng KHÔNG thấy chủ đề cá nhân của ai', async () => {
    expect(names(await w.sam.get('/decks'))).toEqual(['Chủ đề nhóm'])
  })

  it('bị mời ra khỏi nhóm → mất quyền xem chủ đề nhóm NGAY LẬP TỨC (không chờ token hết hạn)', async () => {
    await pool.query('delete from group_members where user_id = $1', [w.bob.id])
    expect(names(await w.bob.get('/decks'))).toEqual(['Bob riêng'])
  })

  it('lọc bằng SQL cho kết quả KHỚP với luật canViewDeck() cho mọi người dùng', async () => {
    const { rows: allDecks } = await pool.query('select * from decks')
    for (const user of [w.alice, w.bob, w.carol, w.sam]) {
      const ctx = await loadAccessContext(pool, user.id)
      const expected = allDecks.filter((d) => canViewDeck(d, ctx)).map((d) => d.id)
      const actual = (await user.get('/decks')).body.map((d) => d.id)
      expect(actual.toSorted()).toEqual(expected.toSorted())
    }
  })

  it('bắt buộc đăng nhập', async () => {
    expect((await request(app).get('/decks')).status).toBe(401)
  })
})

describe('POST /decks', () => {
  it('tạo chủ đề cá nhân; chủ sở hữu luôn là người gọi, bỏ qua user_id client tự gửi', async () => {
    const res = await w.bob.post('/decks', { name: '  Động vật ', user_id: w.alice.id })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Động vật', user_id: w.bob.id, group_id: null, color: '#C9A15E' })
  })

  it.each([
    ['alice (trưởng nhóm)', 'alice', 201],
    ['bob (thành viên)', 'bob', 403],
    ['carol (người ngoài)', 'carol', 403],
    ['sam (super admin)', 'sam', 201],
  ])('tạo chủ đề cho nhóm: %s %s → %i', async (_label, who, status) => {
    const res = await w[who].post('/decks', { name: 'Mới', group_id: w.groupId })
    expect(res.status).toBe(status)
  })

  it('kiểm tra dữ liệu: tên trống, màu sai định dạng', async () => {
    let res = await w.bob.post('/decks', { name: '   ' })
    expect(res.body.error.message).toBe('Tên chủ đề con không được để trống.')
    res = await w.bob.post('/decks', { name: 'A', color: 'red' })
    expect(res.body.error.message).toBe('Màu phải có dạng #RRGGBB.')
  })
})

describe('POST /decks/bulk', () => {
  it('tạo nhiều chủ đề cá nhân một lần, giữ đúng thứ tự', async () => {
    const res = await w.carol.post('/decks/bulk', {
      decks: [{ name: 'Một' }, { name: 'Hai', color: '#6FA98A' }, { name: 'Ba' }],
    })
    expect(res.status).toBe(201)
    expect(res.body.map((d) => [d.name, d.color, d.user_id, d.group_id])).toEqual([
      ['Một', '#C9A15E', w.carol.id, null],
      ['Hai', '#6FA98A', w.carol.id, null],
      ['Ba', '#C9A15E', w.carol.id, null],
    ])
  })

  it('1 mục sai → từ chối cả lô, không tạo gì', async () => {
    const res = await w.carol.post('/decks/bulk', { decks: [{ name: 'Tốt' }, { name: '' }] })
    expect(res.status).toBe(400)
    expect(res.body.error.details[0].field).toBe('decks.1.name')
    expect(names(await w.carol.get('/decks'))).toEqual(['Carol riêng'])
  })
})

describe('PATCH /decks/:id', () => {
  it('chủ sở hữu đổi tên/màu chủ đề cá nhân', async () => {
    const res = await w.bob.patch(`/decks/${w.decks.bob.id}`, { name: 'Tên mới', color: '#7A93C9' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'Tên mới', color: '#7A93C9' })
  })

  it('chủ đề cá nhân của người khác → 404 (không lộ là có tồn tại), kể cả với super admin', async () => {
    expect((await w.bob.patch(`/decks/${w.decks.alice.id}`, { name: 'x' })).status).toBe(404)
    expect((await w.sam.patch(`/decks/${w.decks.alice.id}`, { name: 'x' })).status).toBe(404)
  })

  it.each([
    ['alice', 200],
    ['sam', 200],
    ['bob', 403],
    ['carol', 404],
  ])('đổi tên chủ đề nhóm: %s → %i', async (who, status) => {
    expect((await w[who].patch(`/decks/${w.decks.group.id}`, { name: 'Đổi' })).status).toBe(status)
  })

  it('id sai định dạng → 404; không có gì để sửa → 400', async () => {
    expect((await w.bob.patch('/decks/khong-phai-uuid', { name: 'x' })).status).toBe(404)
    expect((await w.bob.patch(`/decks/${w.decks.bob.id}`, {})).status).toBe(400)
  })
})

describe('DELETE /decks/:id', () => {
  it('thành viên không xoá được chủ đề nhóm', async () => {
    expect((await w.bob.del(`/decks/${w.decks.group.id}`)).status).toBe(403)
  })

  it('trưởng nhóm xoá chủ đề nhóm → từ bên trong thành từ "chưa phân loại" của chính người đã thêm', async () => {
    expect((await w.alice.del(`/decks/${w.decks.group.id}`)).status).toBe(204)

    const bobWords = (await w.bob.get('/words')).body
    const moved = bobWords.find((x) => x.id === w.words.bobInGroup.id)
    expect(moved.deck_id).toBeNull()
    // từ của bob giờ là từ cá nhân của bob → alice không còn thấy
    const aliceWordIds = (await w.alice.get('/words')).body.map((x) => x.id)
    expect(aliceWordIds).not.toContain(w.words.bobInGroup.id)
    expect(aliceWordIds).toContain(w.words.aliceInGroup.id)
  })

  it('chủ sở hữu xoá chủ đề cá nhân', async () => {
    expect((await w.carol.del(`/decks/${w.decks.carol.id}`)).status).toBe(204)
    expect(names(await w.carol.get('/decks'))).toEqual([])
  })
})
