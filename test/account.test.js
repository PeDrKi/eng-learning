import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildWorld, createUser, refreshCookieOf, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()

const PASSWORD = 'matkhau123'
const login = (email, userAgent) =>
  request(app).post('/auth/login').set('User-Agent', userAgent).send({ email, password: PASSWORD })
const authed = (req, session) =>
  req
    .set('Authorization', `Bearer ${session.body.access_token}`)
    .set('Cookie', `tv_refresh=${refreshCookieOf(session)}`)
const refresh = (cookie) => request(app).post('/auth/refresh').set('Cookie', `tv_refresh=${cookie}`)

describe('Thiết bị đang đăng nhập — /auth/sessions', () => {
  it('liệt kê các phiên còn hiệu lực của mình, đánh dấu đúng phiên hiện tại, không lộ token', async () => {
    await createUser(app, 'an@example.com') // phiên 1 (lúc đăng ký)
    const laptop = await login('an@example.com', 'Laptop')
    const phone = await login('an@example.com', 'Phone')

    const res = await authed(request(app).get('/auth/sessions'), phone)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body.filter((s) => s.current).map((s) => s.user_agent)).toEqual(['Phone'])
    expect(Object.keys(res.body[0]).toSorted()).toEqual(['created_at', 'current', 'id', 'last_active_at', 'user_agent'])

    // Xoay vòng token không tạo thêm phiên: vẫn là 1 thiết bị.
    await refresh(refreshCookieOf(laptop))
    expect((await authed(request(app).get('/auth/sessions'), phone)).body).toHaveLength(3)
  })

  it('đăng xuất 1 thiết bị: thiết bị đó không gia hạn phiên được nữa, thiết bị khác không ảnh hưởng', async () => {
    await createUser(app, 'an@example.com')
    const laptop = await login('an@example.com', 'Laptop')
    const phone = await login('an@example.com', 'Phone')
    const sessions = (await authed(request(app).get('/auth/sessions'), phone)).body
    const laptopSession = sessions.find((s) => s.user_agent === 'Laptop')

    expect((await authed(request(app).delete(`/auth/sessions/${laptopSession.id}`), phone)).status).toBe(204)
    expect((await refresh(refreshCookieOf(laptop))).status).toBe(401)
    expect((await refresh(refreshCookieOf(phone))).status).toBe(200)
    // đã đăng xuất rồi → 404
    expect((await authed(request(app).delete(`/auth/sessions/${laptopSession.id}`), phone)).status).toBe(404)
  })

  it('đăng xuất mọi thiết bị KHÁC, giữ lại thiết bị đang dùng', async () => {
    await createUser(app, 'an@example.com')
    const laptop = await login('an@example.com', 'Laptop')
    const phone = await login('an@example.com', 'Phone')

    const res = await authed(request(app).delete('/auth/sessions'), phone)
    expect(res.body).toEqual({ revoked: 2 })
    expect((await refresh(refreshCookieOf(laptop))).status).toBe(401)
    const left = (await authed(request(app).get('/auth/sessions'), phone)).body
    expect(left.map((s) => s.user_agent)).toEqual(['Phone'])
  })

  it('không xem/đăng xuất được phiên của người khác; bắt buộc đăng nhập', async () => {
    await createUser(app, 'an@example.com')
    const binh = await createUser(app, 'binh@example.com')
    const an = await login('an@example.com', 'Laptop')
    const anSession = (await authed(request(app).get('/auth/sessions'), an)).body[0]

    expect((await binh.get('/auth/sessions')).body.every((s) => s.id !== anSession.id)).toBe(true)
    expect((await binh.del(`/auth/sessions/${anSession.id}`)).status).toBe(404)
    expect((await refresh(refreshCookieOf(an))).status).toBe(200)
    expect((await request(app).get('/auth/sessions')).status).toBe(401)
  })
})

describe('DELETE /auth/account — xoá tài khoản', () => {
  it('sai mật khẩu → 400, không xoá gì', async () => {
    const an = await createUser(app, 'an@example.com')
    const res = await an.del('/auth/account', { password: 'saimatkhau' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_current_password')
    expect((await an.get('/auth/me')).status).toBe(200)
  })

  it('đúng mật khẩu → xoá tài khoản và toàn bộ dữ liệu cá nhân; token cũ hết dùng được', async () => {
    const w = await buildWorld(app, pool)
    const session = await login('carol@example.com', 'Laptop')

    expect((await w.carol.del('/auth/account', { password: PASSWORD })).status).toBe(204)

    expect((await w.carol.get('/auth/me')).status).toBe(401)
    expect((await w.carol.get('/decks')).status).toBe(401)
    expect((await w.carol.put('/settings', { new_cards_per_day: 5 })).status).toBe(401)
    expect((await refresh(refreshCookieOf(session))).status).toBe(401)
    expect((await login('carol@example.com', 'Laptop')).status).toBe(401)
    for (const table of ['decks', 'words', 'word_progress', 'refresh_tokens']) {
      const { rows } = await pool.query(`select 1 from ${table} where user_id = $1`, [w.carol.id])
      expect(rows).toHaveLength(0)
    }
    // người khác không bị ảnh hưởng
    expect((await w.bob.get('/words')).body.map((x) => x.word)).toContain('banana')
  })

  it('trưởng nhóm duy nhất xoá tài khoản → thành viên vào sớm nhất lên trưởng nhóm, nội dung chung được giữ', async () => {
    const w = await buildWorld(app, pool)
    expect((await w.alice.del('/auth/account', { password: PASSWORD })).status).toBe(204)

    const group = (await w.bob.get('/groups')).body.find((g) => g.id === w.groupId)
    expect(group.my_role).toBe('admin')
    const decks = (await w.bob.get('/decks')).body
    expect(decks.find((d) => d.id === w.decks.group.id)).toMatchObject({ name: 'Chủ đề nhóm', user_id: w.bob.id })
    const words = (await w.bob.get('/words')).body.map((x) => x.word)
    expect(words).toEqual(expect.arrayContaining(['group-by-alice', 'group-by-bob']))
    expect(words).not.toContain('apple') // từ cá nhân của alice đã bị xoá
    // bob (trưởng nhóm mới) sửa được từ alice để lại
    expect((await w.bob.patch(`/words/${w.words.aliceInGroup.id}`, { meaning: 'mới' })).status).toBe(200)
  })

  it('thành viên thường xoá tài khoản → từ đã góp vào chủ đề nhóm được giữ cho nhóm', async () => {
    const w = await buildWorld(app, pool)
    expect((await w.bob.del('/auth/account', { password: PASSWORD })).status).toBe(204)

    const words = (await w.alice.get('/words')).body
    expect(words.find((x) => x.word === 'group-by-bob')).toMatchObject({ user_id: w.alice.id })
    expect(words.map((x) => x.word)).not.toContain('banana')
    const group = (await w.alice.get('/groups')).body[0]
    expect(group.members.map((m) => m.user_id)).toEqual([w.alice.id])
  })

  it('người duy nhất trong nhóm xoá tài khoản → nhóm bị xoá theo', async () => {
    const an = await createUser(app, 'an@example.com')
    const group = (await an.post('/groups', { name: 'Một mình' })).body
    await an.post('/decks', { name: 'Chung', group_id: group.id })
    expect((await an.del('/auth/account', { password: PASSWORD })).status).toBe(204)
    expect((await pool.query('select 1 from groups where id = $1', [group.id])).rows).toHaveLength(0)
  })
})
