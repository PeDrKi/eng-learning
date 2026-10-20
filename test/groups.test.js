import { beforeEach, describe, expect, it } from 'vitest'
import { generateInviteCode } from '../src/modules/groups/groups.service.js'
import { buildWorld, createApp, setupTestApp, testConfig } from './helpers.js'

const { app, pool, mailer } = setupTestApp()
let w
const setRole = (actor, target, role) => actor.patch(`/groups/${w.groupId}/members/${target.id}`, { role })

beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const inviteCodeOf = async (groupId) =>
  (await pool.query('select invite_code from groups where id = $1', [groupId])).rows[0].invite_code
const groupOf = async (user, groupId) => (await user.get('/groups')).body.find((g) => g.id === groupId)

describe('GET /groups', () => {
  it('trưởng nhóm: thấy mã mời + toàn bộ thành viên kèm email', async () => {
    const [g] = (await w.alice.get('/groups')).body
    expect(g).toMatchObject({ id: w.groupId, my_role: 'admin', invite_code: await inviteCodeOf(w.groupId) })
    expect(g.members.map((m) => [m.email, m.role])).toEqual([
      ['alice@example.com', 'admin'],
      ['bob@example.com', 'member'],
    ])
    // Tên hiển thị đi kèm (null = chưa đặt); đặt tên xong thì trưởng nhóm thấy ngay.
    expect(g.members.every((m) => m.display_name === null)).toBe(true)
    await w.bob.put('/auth/profile').send({ display_name: 'Bob' })
    const after = (await w.alice.get('/groups')).body[0]
    expect(after.members.map((m) => m.display_name)).toEqual([null, 'Bob'])
  })

  it('thành viên thường: KHÔNG thấy mã mời, chỉ thấy chính mình trong danh sách thành viên', async () => {
    const [g] = (await w.bob.get('/groups')).body
    expect(g).toMatchObject({ my_role: 'member', invite_code: null })
    expect(g.members.map((m) => m.email)).toEqual(['bob@example.com'])
  })

  it('người ngoài không thấy nhóm; super admin thấy mọi nhóm (my_role = null)', async () => {
    expect((await w.carol.get('/groups')).body).toEqual([])
    const [g] = (await w.sam.get('/groups')).body
    expect(g).toMatchObject({ my_role: null, invite_code: await inviteCodeOf(w.groupId) })
    expect(g.members).toHaveLength(2)
  })
})

describe('POST /groups', () => {
  it('tạo nhóm: người tạo thành trưởng nhóm, có mã mời 8 ký tự', async () => {
    const res = await w.carol.post('/groups', { name: '  Lớp tối thứ 3 ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Lớp tối thứ 3', my_role: 'admin', created_by: w.carol.id })
    expect(res.body.invite_code).toMatch(/^[a-z2-9]{8}$/)
    expect(res.body.members.map((m) => m.email)).toEqual(['carol@example.com'])
    // có quyền trưởng nhóm ngay: tạo được chủ đề cho nhóm
    expect((await w.carol.post('/decks', { name: 'Chung', group_id: res.body.id })).status).toBe(201)
  })

  it('tên trống → 400', async () => {
    const res = await w.carol.post('/groups', { name: '  ' })
    expect(res.body.error.message).toBe('Tên nhóm không được để trống.')
  })

  it('mã mời không chứa ký tự dễ nhầm (0, o, 1, l, i)', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(/^[a-hjkmnp-z2-9]{8}$/)
  })
})

describe('POST /groups/join', () => {
  it('tham gia bằng mã (không phân biệt hoa/thường, bỏ khoảng trắng) → thấy ngay chủ đề + từ của nhóm', async () => {
    const code = await inviteCodeOf(w.groupId)
    const res = await w.carol.post('/groups/join', { code: `  ${code.toUpperCase()} ` })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: w.groupId, my_role: 'member', invite_code: null })
    expect((await w.carol.get('/decks')).body.map((d) => d.name)).toContain('Chủ đề nhóm')
  })

  it('mã sai → 404 kèm thông báo dễ hiểu', async () => {
    const res = await w.carol.post('/groups/join', { code: 'saimaroi' })
    expect(res.status).toBe(404)
    expect(res.body.error.message).toBe('Mã mời không đúng — kiểm tra lại với trưởng nhóm.')
  })

  it('trưởng nhóm nhập lại mã nhóm mình → vẫn giữ vai trò trưởng nhóm', async () => {
    const res = await w.alice.post('/groups/join', { code: await inviteCodeOf(w.groupId) })
    expect(res.body.my_role).toBe('admin')
  })

  it('mã cũ dạng md5 từ bản Supabase vẫn dùng được', async () => {
    await pool.query("update groups set invite_code = '3f9a1c0b' where id = $1", [w.groupId])
    expect((await w.carol.post('/groups/join', { code: '3F9A1C0B' })).status).toBe(200)
  })

  it('chặn dò mã: quá 20 lần / 15 phút → 429', async () => {
    const limitedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer })
    const { default: request } = await import('supertest')
    const token = (
      await request(limitedApp).post('/auth/login').send({ email: 'carol@example.com', password: 'matkhau123' })
    ).body.access_token
    let last
    for (let i = 0; i < 21; i++) {
      last = await request(limitedApp)
        .post('/groups/join')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: `sai${i}` })
    }
    expect(last.status).toBe(429)
  })
})

describe('Quản lý nhóm', () => {
  it.each([
    ['alice (trưởng nhóm)', 'alice', 200],
    ['sam (super admin)', 'sam', 200],
    ['bob (thành viên)', 'bob', 403],
    ['carol (người ngoài)', 'carol', 404],
  ])('đổi tên nhóm: %s %s → %i', async (_label, who, status) => {
    const res = await w[who].patch(`/groups/${w.groupId}`, { name: 'Tên mới' })
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body.name).toBe('Tên mới')
  })

  it('tạo lại mã mời: mã cũ ngừng hoạt động ngay', async () => {
    const oldCode = await inviteCodeOf(w.groupId)
    const res = await w.alice.post(`/groups/${w.groupId}/invite-code`)
    expect(res.status).toBe(200)
    expect(res.body.invite_code).not.toBe(oldCode)
    expect((await w.carol.post('/groups/join', { code: oldCode })).status).toBe(404)
    expect((await w.carol.post('/groups/join', { code: res.body.invite_code })).status).toBe(200)
  })

  it('thành viên không tạo lại được mã mời', async () => {
    expect((await w.bob.post(`/groups/${w.groupId}/invite-code`)).status).toBe(403)
  })
})

describe('DELETE /groups/:id/members/:userId', () => {
  const remove = (actor, target) => actor.del(`/groups/${w.groupId}/members/${target.id}`)

  it('thành viên tự rời nhóm → mất quyền xem chủ đề nhóm, vẫn giữ từ mình đã thêm', async () => {
    expect((await remove(w.bob, w.bob)).status).toBe(204)
    expect((await w.bob.get('/groups')).body).toEqual([])
    expect((await w.bob.get('/decks')).body.map((d) => d.name)).toEqual(['Bob riêng'])
    expect((await w.bob.get('/words')).body.map((x) => x.word)).toContain('group-by-bob')
  })

  it('thành viên không mời được người khác ra', async () => {
    expect((await remove(w.bob, w.alice)).status).toBe(403)
  })

  it('trưởng nhóm / super admin mời thành viên ra', async () => {
    expect((await remove(w.alice, w.bob)).status).toBe(204)
    expect((await groupOf(w.alice, w.groupId)).members.map((m) => m.email)).toEqual(['alice@example.com'])
  })

  it('super admin mời được thành viên ra, nhưng không "rời" nhóm mình không tham gia', async () => {
    expect((await remove(w.sam, w.bob)).status).toBe(204)
    expect((await remove(w.sam, w.sam)).status).toBe(403)
  })

  it('trưởng nhóm duy nhất KHÔNG rời được khi còn thành viên khác; chuyển quyền xong thì rời được', async () => {
    const blocked = await remove(w.alice, w.alice)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('last_admin')
    // super admin cũng không gỡ được trưởng nhóm duy nhất
    expect((await remove(w.sam, w.alice)).status).toBe(409)

    expect((await setRole(w.alice, w.bob, 'admin')).status).toBe(200)
    expect((await remove(w.alice, w.alice)).status).toBe(204)
    expect((await w.bob.get('/decks')).body.map((d) => d.name)).toContain('Chủ đề nhóm')
    expect((await w.bob.patch(`/groups/${w.groupId}`, { name: 'Bob quản lý' })).status).toBe(200)
  })

  it('người cuối cùng trong nhóm rời tự do, kể cả khi là trưởng nhóm duy nhất', async () => {
    expect((await remove(w.alice, w.bob)).status).toBe(204)
    expect((await remove(w.alice, w.alice)).status).toBe(204)
  })

  it('người ngoài → 404; mời ra người không thuộc nhóm → 404', async () => {
    expect((await remove(w.carol, w.bob)).status).toBe(404)
    expect((await remove(w.alice, w.carol)).status).toBe(404)
  })
})

describe('PATCH /groups/:id/members/:userId — đổi vai trò', () => {
  it('trưởng nhóm đặt thành viên làm trưởng nhóm; người đó có ngay quyền quản lý', async () => {
    const res = await setRole(w.alice, w.bob, 'admin')
    expect(res.status).toBe(200)
    expect(res.body.members.find((m) => m.user_id === w.bob.id).role).toBe('admin')
    expect((await w.bob.patch(`/groups/${w.groupId}`, { name: 'Bob đổi' })).status).toBe(200)
    // có 2 trưởng nhóm → hạ 1 người xuống được
    expect((await setRole(w.bob, w.alice, 'member')).status).toBe(200)
  })

  it('không hạ được trưởng nhóm duy nhất', async () => {
    const res = await setRole(w.alice, w.alice, 'member')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('last_admin')
  })

  it('phân quyền & dữ liệu: thành viên → 403, người ngoài → 404, super admin → 200, vai trò lạ → 400', async () => {
    expect((await setRole(w.bob, w.bob, 'admin')).status).toBe(403)
    expect((await setRole(w.carol, w.bob, 'admin')).status).toBe(404)
    expect((await setRole(w.alice, w.carol, 'admin')).status).toBe(404) // carol không thuộc nhóm
    expect((await setRole(w.alice, w.bob, 'owner')).status).toBe(400)
    expect((await setRole(w.sam, w.bob, 'admin')).status).toBe(200)
  })
})

describe('GET /groups/:id/stats — dashboard tiến độ (tính gộp trong database)', () => {
  const statsOf = async (viewer, member) =>
    (await viewer.get(`/groups/${w.groupId}/stats`)).body.find((s) => s.user_id === member.id)

  it('1 dòng cho mỗi thành viên hiện tại; từ chưa học coi như đến hạn; chỉ tính trên từ dùng chung', async () => {
    const res = await w.alice.get(`/groups/${w.groupId}/stats`)
    expect(res.status).toBe(200)
    expect(res.body.map((s) => s.user_id)).toEqual([w.alice.id, w.bob.id])
    // nhóm có 2 từ dùng chung; bob chưa học từ nào → 2 lượt đến hạn (chiều Anh→Việt), chưa có lượt Việt→Anh
    expect(await statsOf(w.alice, w.bob)).toEqual({
      user_id: w.bob.id,
      total_words: 2,
      started: 0,
      due: 2,
      quiz_correct: 0,
      quiz_wrong: 0,
      last_reviewed_at: null,
    })
  })

  it('cộng đúng tiến trình: đã học, đến hạn 2 chiều, quiz, lần ôn gần nhất; KHÔNG tính từ cá nhân', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const reviewedAt = new Date(Date.now() - 3_600_000).toISOString()
    // từ chung 1: đã học, chiều Anh→Việt chưa đến hạn, chiều Việt→Anh đến hạn
    await w.bob.patch(`/progress/${w.words.aliceInGroup.id}`, {
      repetitions: 2,
      due_at: future,
      due_at_rev: past,
      quiz_correct: 3,
      quiz_wrong: 1,
      last_reviewed_at_rev: reviewedAt,
    })
    // từ chung 2: chưa học (đến hạn Anh→Việt)
    // từ CÁ NHÂN của bob: không được tính vào thống kê nhóm
    await w.bob.patch(`/progress/${w.words.bobPersonal.id}`, { repetitions: 9, quiz_correct: 50 })

    const bob = await statsOf(w.alice, w.bob)
    expect(bob).toMatchObject({ total_words: 2, started: 1, due: 2, quiz_correct: 3, quiz_wrong: 1 })
    expect(new Date(bob.last_reviewed_at).toISOString()).toBe(reviewedAt)
  })

  it('nhóm chưa có từ dùng chung nào → mọi số liệu bằng 0', async () => {
    const empty = (await w.carol.post('/groups', { name: 'Nhóm trống' })).body
    expect((await w.carol.get(`/groups/${empty.id}/stats`)).body).toEqual([
      {
        user_id: w.carol.id,
        total_words: 0,
        started: 0,
        due: 0,
        quiz_correct: 0,
        quiz_wrong: 0,
        last_reviewed_at: null,
      },
    ])
  })

  it('không gồm người đã rời nhóm; phân quyền như các thao tác quản lý nhóm khác', async () => {
    expect((await w.sam.get(`/groups/${w.groupId}/stats`)).status).toBe(200)
    expect((await w.bob.get(`/groups/${w.groupId}/stats`)).status).toBe(403)
    expect((await w.carol.get(`/groups/${w.groupId}/stats`)).status).toBe(404)
    await w.bob.del(`/groups/${w.groupId}/members/${w.bob.id}`)
    expect((await w.alice.get(`/groups/${w.groupId}/stats`)).body.map((s) => s.user_id)).toEqual([w.alice.id])
  })
})

describe('GET /groups/:id/progress — bản cũ, giữ cho FE cũ trong cache PWA', () => {
  it('trưởng nhóm thấy tiến trình của thành viên CHỈ trên từ dùng chung của nhóm', async () => {
    await w.bob.patch(`/progress/${w.words.aliceInGroup.id}`, { repetitions: 3 })
    await w.bob.patch(`/progress/${w.words.bobPersonal.id}`, { repetitions: 9 })

    const res = await w.alice.get(`/groups/${w.groupId}/progress`)
    expect(res.status).toBe(200)
    const groupWordIds = new Set([w.words.aliceInGroup.id, w.words.bobInGroup.id])
    expect(res.body.every((p) => groupWordIds.has(p.word_id))).toBe(true) // không lộ từ cá nhân
    const bobRow = res.body.find((p) => p.user_id === w.bob.id && p.word_id === w.words.aliceInGroup.id)
    expect(bobRow.repetitions).toBe(3)
  })

  it('không trả tiến trình của người đã rời nhóm', async () => {
    await w.bob.del(`/groups/${w.groupId}/members/${w.bob.id}`)
    const rows = (await w.alice.get(`/groups/${w.groupId}/progress`)).body
    expect(rows.some((p) => p.user_id === w.bob.id)).toBe(false)
  })

  it.each([
    ['sam (super admin)', 'sam', 200],
    ['bob (thành viên)', 'bob', 403],
    ['carol (người ngoài)', 'carol', 404],
  ])('%s %s → %i', async (_label, who, status) => {
    expect((await w[who].get(`/groups/${w.groupId}/progress`)).status).toBe(status)
  })
})
