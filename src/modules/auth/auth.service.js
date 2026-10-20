import { randomUUID } from 'node:crypto'
import { withTransaction } from '../../db/pool.js'
import {
  HttpError,
  accountDisabled,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from '../../lib/httpError.js'
import { isSuperAdmin, isSystemAdmin } from '../../lib/roles.js'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.js'
import { deleteUserKeepingGroupContent } from '../users/deleteUser.js'
import { generateOpaqueToken, hashToken, signAccessToken } from '../../lib/tokens.js'
import { alreadyRegisteredEmail, passwordResetEmail, verificationEmail } from '../../lib/emailTemplates.js'

// Cửa sổ ân hạn khi xoay vòng refresh token: nếu 2 tab cùng refresh gần như đồng thời bằng
// cùng 1 token, tab chậm hơn sẽ thấy token "đã bị thay thế". Trong vòng vài giây, đó gần như
// chắc chắn là 2 tab của chính người dùng chứ không phải kẻ trộm token → vẫn cấp token mới
// thay vì đăng xuất toàn bộ. Quá cửa sổ này mà token cũ bị dùng lại → coi là bị đánh cắp.
const REUSE_GRACE_SECONDS = 10

const invalidRefresh = () =>
  unauthorized('invalid_refresh_token', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.')

// Chỉ những field này được trả ra ngoài — tuyệt đối không bao giờ trả password_hash.
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name ?? null, // null = chưa đặt tên → giao diện hiện email
    role: row.role, // 'user' | 'admin' | 'super_admin'
    is_admin: isSystemAdmin(row.role), // admin hoặc super admin: quản lý mọi nhóm
    is_super_admin: isSuperAdmin(row.role), // thêm quyền quản lý tài khoản
    email_verified: row.email_verified_at != null,
    created_at: row.created_at,
  }
}

export function createAuthService({ pool, config, mailer }) {
  const { auth } = config

  // Tạo 1 phiên: access token (JWT) + refresh token (lưu hash vào DB).
  // `familyId` + `sessionStartedAt` truyền vào khi xoay vòng token; bỏ trống = phiên đăng nhập mới.
  // Hạn refresh token = 30 ngày kể từ lần dùng gần nhất, nhưng KHÔNG vượt quá lúc đăng nhập +
  // SESSION_MAX_DAYS: dùng đều đặn đến mấy thì quá mốc đó vẫn phải đăng nhập lại.
  async function issueSession(db, user, { familyId = randomUUID(), sessionStartedAt = new Date(), userAgent } = {}) {
    const refreshToken = generateOpaqueToken()
    const refreshExpiresAt = new Date(
      Math.min(
        Date.now() + auth.refreshTtlDays * 86_400_000,
        sessionStartedAt.getTime() + auth.sessionMaxDays * 86_400_000,
      ),
    )
    const { rows } = await db.query(
      `insert into refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, session_started_at)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [user.id, familyId, hashToken(refreshToken), refreshExpiresAt, userAgent ?? null, sessionStartedAt],
    )
    return {
      refreshTokenId: rows[0].id,
      refreshToken,
      refreshExpiresAt,
      accessToken: signAccessToken(user, { secret: auth.accessSecret, ttlSeconds: auth.accessTtlSeconds }),
      expiresIn: auth.accessTtlSeconds,
      user: publicUser(user),
    }
  }

  // Chờ đủ auth.resetMinResponseMs rồi mới trả lời, dù `fn` làm nhiều hay ít việc: các endpoint
  // trả lời "giống hệt nhau" cho email có/không có tài khoản không bị lộ qua độ trễ.
  async function withMinResponseTime(fn) {
    const startedAt = Date.now()
    try {
      return await fn()
    } finally {
      const remaining = auth.resetMinResponseMs - (Date.now() - startedAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    }
  }

  // Không chờ gửi xong: dịch vụ email chậm/lỗi không làm chậm phản hồi.
  function sendMailInBackground(msg, what) {
    Promise.resolve(mailer.send(msg)).catch((err) => console.error(`[mail] Gửi email ${what} thất bại:`, err.message))
  }

  // Đăng ký. Tắt xác nhận email → tạo tài khoản và đăng nhập luôn (trả về phiên).
  // Bật (EMAIL_VERIFICATION=required) → trả về null: tài khoản chờ xác nhận, link gửi qua email.
  async function register(input, meta = {}) {
    if (!auth.emailVerification) return registerAndSignIn(input, meta)
    await withMinResponseTime(() => registerPendingVerification(input))
    return null
  }

  async function registerAndSignIn({ email, password, display_name = null }, meta) {
    const passwordHash = await hashPassword(password)
    try {
      return await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning *',
          [email, passwordHash, display_name],
        )
        return issueSession(client, rows[0], meta)
      })
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'users_email_lower_idx') {
        throw conflict('email_taken', 'Email này đã có tài khoản, hãy đăng nhập.')
      }
      throw err
    }
  }

  // Câu trả lời LUÔN giống nhau (202 "kiểm tra hộp thư") dù email đã có tài khoản hay chưa →
  // không dò được email nào đã đăng ký. Khác nhau chỉ ở email gửi tới hộp thư đó:
  //  • chưa có tài khoản      → tạo tài khoản (chưa xác nhận) + gửi link xác nhận.
  //  • có nhưng chưa xác nhận → gửi link mới; link này mang mật khẩu VỪA nhập (áp khi bấm link).
  //  • đã xác nhận            → báo "bạn đã có tài khoản" kèm cách đăng nhập / lấy lại mật khẩu.
  async function registerPendingVerification({ email, password, display_name = null }) {
    const passwordHash = await hashPassword(password)
    const findUser = async () =>
      (
        await pool.query(
          'select id, email, display_name, email_verified_at, disabled_at from users where lower(email) = $1',
          [email],
        )
      ).rows[0]
    let user = await findUser()
    if (!user) {
      try {
        const { rows } = await pool.query(
          'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id, email, display_name',
          [email, passwordHash, display_name],
        )
        return sendVerificationLink(rows[0])
      } catch (err) {
        if (err.code !== '23505' || err.constraint !== 'users_email_lower_idx') throw err
        user = await findUser() // vừa được tạo ở 1 request song song
      }
    }
    if (user.disabled_at) return
    if (!user.email_verified_at) return sendVerificationLink(user, { passwordHash })
    sendMailInBackground(
      { to: user.email, ...alreadyRegisteredEmail({ email: user.email, appUrl: config.appUrl }) },
      'báo đã có tài khoản',
    )
  }

  // Gửi link xác nhận. Mỗi tài khoản tối đa 1 email / phút (chặn dùng app để spam hộp thư người
  // khác; giới hạn theo IP ở route không chặn được nhiều máy cùng gửi tới 1 email).
  async function sendVerificationLink(user, { passwordHash = null } = {}) {
    const { rows: recent } = await pool.query(
      "select 1 from email_verification_tokens where user_id = $1 and created_at > now() - interval '1 minute' limit 1",
      [user.id],
    )
    if (recent[0]) return

    const token = generateOpaqueToken()
    await pool.query(
      'insert into email_verification_tokens (user_id, token_hash, password_hash, expires_at) values ($1, $2, $3, $4)',
      [user.id, hashToken(token), passwordHash, new Date(Date.now() + auth.verifyTtlHours * 3_600_000)],
    )
    // Token sau dấu # như link đặt lại mật khẩu: không lọt vào log truy cập của nơi host FE.
    const link = `${config.appUrl}/#verify_token=${token}`
    sendMailInBackground(
      {
        to: user.email,
        ...verificationEmail({ email: user.email, name: user.display_name, link, ttlHours: auth.verifyTtlHours }),
      },
      'xác nhận',
    )
  }

  // Gửi lại link xác nhận (người dùng không thấy email, hoặc link hết hạn). Luôn "thành công".
  async function resendVerification({ email }) {
    await withMinResponseTime(async () => {
      if (!auth.emailVerification) return
      const { rows } = await pool.query(
        'select id, email, display_name, email_verified_at, disabled_at from users where lower(email) = $1',
        [email],
      )
      const user = rows[0]
      if (!user || user.disabled_at || user.email_verified_at) return
      await sendVerificationLink(user)
    })
  }

  // Bấm link xác nhận → tài khoản được kích hoạt và đăng nhập luôn.
  async function verifyEmail({ token }, meta = {}) {
    return withTransaction(pool, async (client) => {
      // 1 câu lệnh vừa kiểm tra vừa đánh dấu đã dùng → 1 link không dùng được 2 lần.
      const { rows } = await client.query(
        `update email_verification_tokens set used_at = now()
         where token_hash = $1 and used_at is null and expires_at > now()
         returning user_id, password_hash`,
        [hashToken(token)],
      )
      if (!rows[0]) {
        throw badRequest(
          'invalid_verify_token',
          'Link xác nhận không hợp lệ, đã dùng hoặc đã hết hạn. Hãy đăng nhập — nếu chưa xác nhận, bạn có thể gửi lại link.',
        )
      }
      const { user_id: userId, password_hash: passwordHash } = rows[0]
      // Các link khác của tài khoản này hết tác dụng: mỗi link mang 1 mật khẩu, chỉ 1 được áp.
      await client.query(
        'update email_verification_tokens set used_at = now() where user_id = $1 and used_at is null',
        [userId],
      )
      const { rows: users } = await client.query(
        `update users set email_verified_at = coalesce(email_verified_at, now()),
                          password_hash = coalesce($2, password_hash), updated_at = now()
         where id = $1 returning *`,
        [userId, passwordHash],
      )
      if (users[0].disabled_at) throw accountDisabled()
      // Mật khẩu vừa đổi theo link → phiên cũ (nếu có) không còn đáng tin.
      if (passwordHash) {
        await client.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [
          userId,
        ])
      }
      return issueSession(client, users[0], meta)
    })
  }

  async function login({ email, password }, meta = {}) {
    const { rows } = await pool.query('select * from users where lower(email) = $1', [email])
    const user = rows[0]
    // Luôn chạy bcrypt (dùng hash giả nếu không có user) để thời gian phản hồi như nhau.
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !ok) throw unauthorized('invalid_credentials', 'Sai email hoặc mật khẩu.')
    // Chỉ báo "bị khoá" SAU khi mật khẩu đúng — người lạ không dò được tài khoản nào bị khoá.
    if (user.disabled_at) throw accountDisabled()
    if (auth.emailVerification && !user.email_verified_at) {
      throw new HttpError(
        403,
        'email_not_verified',
        'Bạn chưa xác nhận email. Hãy bấm link trong email chúng tôi đã gửi (xem cả mục Spam), hoặc gửi lại link.',
      )
    }
    // Dọn token ĐÃ HẾT HẠN của người này (không dùng được nữa, chỉ làm phình bảng). Token bị
    // thu hồi nhưng còn hạn thì GIỮ — cần để phát hiện refresh token bị đánh cắp dùng lại.
    await pool.query('delete from refresh_tokens where user_id = $1 and expires_at < now()', [user.id])
    await pool.query('delete from password_reset_tokens where user_id = $1 and expires_at < now()', [user.id])
    await pool.query('delete from email_verification_tokens where user_id = $1 and expires_at < now()', [user.id])
    return issueSession(pool, user, meta)
  }

  async function refresh(rawToken, meta = {}) {
    if (!rawToken) throw invalidRefresh()
    const outcome = await withTransaction(pool, async (client) => {
      // FOR UPDATE: khoá dòng này tới hết transaction, để 2 request refresh đồng thời bằng
      // cùng 1 token được xử lý tuần tự thay vì cùng lúc cấp 2 token mới.
      const { rows } = await client.query('select * from refresh_tokens where token_hash = $1 for update', [
        hashToken(rawToken),
      ])
      const token = rows[0]
      if (!token) return { error: 'invalid' }
      if (token.expires_at <= new Date()) return { error: 'invalid' }
      // Quá hạn tuyệt đối của phiên (token cũ tạo trước khi có giới hạn này có thể còn hạn dài hơn).
      if (token.session_started_at.getTime() + auth.sessionMaxDays * 86_400_000 <= Date.now())
        return { error: 'invalid' }

      if (token.revoked_at) {
        const withinGrace = token.replaced_by && Date.now() - token.revoked_at.getTime() <= REUSE_GRACE_SECONDS * 1000
        const { rows: active } = await client.query(
          'select 1 from refresh_tokens where family_id = $1 and revoked_at is null and expires_at > now() limit 1',
          [token.family_id],
        )
        if (!withinGrace || active.length === 0) {
          // Token cũ bị dùng lại → nghi bị đánh cắp: thu hồi TOÀN BỘ phiên trong family này.
          await client.query(
            'update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null',
            [token.family_id],
          )
          return { error: 'reused' }
        }
      }

      const { rows: users } = await client.query('select * from users where id = $1', [token.user_id])
      if (!users[0] || users[0].disabled_at) return { error: 'invalid' }

      const session = await issueSession(client, users[0], {
        familyId: token.family_id,
        sessionStartedAt: token.session_started_at,
        ...meta,
      })
      if (!token.revoked_at) {
        await client.query('update refresh_tokens set revoked_at = now(), replaced_by = $2 where id = $1', [
          token.id,
          session.refreshTokenId,
        ])
      }
      return { session }
    })
    // Ném lỗi SAU khi transaction đã commit — để lệnh thu hồi family ở trên được lưu thật.
    if (outcome.error) throw invalidRefresh()
    return outcome.session
  }

  async function logout(rawToken) {
    if (!rawToken) return
    await pool.query('update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [
      hashToken(rawToken),
    ])
  }

  async function getMe(userId) {
    const { rows } = await pool.query('select * from users where id = $1', [userId])
    // Tài khoản đã bị xoá nhưng access token cũ vẫn còn hạn.
    if (!rows[0]) throw unauthorized('invalid_token', 'Tài khoản không còn tồn tại.')
    return publicUser(rows[0])
  }

  async function updateProfile(userId, { display_name }) {
    const { rows } = await pool.query(
      'update users set display_name = $2, updated_at = now() where id = $1 returning *',
      [userId, display_name],
    )
    if (!rows[0]) throw unauthorized('invalid_token', 'Tài khoản không còn tồn tại.')
    return publicUser(rows[0])
  }

  // Luôn "thành công" kể cả khi email không tồn tại — không để lộ email nào đã đăng ký.
  // Email có tồn tại thì tốn thêm 1 transaction ghi DB; nếu trả lời ngay, độ chênh thời gian
  // đó đủ để dò ra email nào đã đăng ký. Vì vậy cả 2 trường hợp đều chờ đủ một mức tối thiểu
  // (auth.resetMinResponseMs) rồi mới trả lời.
  async function requestPasswordReset(input) {
    await withMinResponseTime(() => sendPasswordResetLink(input))
  }

  async function sendPasswordResetLink({ email }) {
    const { rows } = await pool.query('select id, email, disabled_at from users where lower(email) = $1', [email])
    const user = rows[0]
    if (!user || user.disabled_at) return // tài khoản bị khoá không đặt lại mật khẩu được

    const token = generateOpaqueToken()
    await withTransaction(pool, async (client) => {
      // Vô hiệu hoá các link cũ chưa dùng: chỉ link mới nhất có hiệu lực.
      await client.query('update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null', [
        user.id,
      ])
      await client.query('insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)', [
        user.id,
        hashToken(token),
        new Date(Date.now() + auth.resetTtlMinutes * 60_000),
      ])
    })

    // Token để sau dấu # (fragment): trình duyệt không gửi phần này lên server nào, nên token
    // không bị lưu vào log truy cập của nơi host FE.
    const link = `${config.appUrl}/#reset_token=${token}`
    sendMailInBackground(
      { to: user.email, ...passwordResetEmail({ email: user.email, link, ttlMinutes: auth.resetTtlMinutes }) },
      'đặt lại mật khẩu',
    )
  }

  // Đặt lại mật khẩu bằng token trong email → đăng xuất mọi thiết bị khác, cấp phiên mới
  // (giống Supabase: bấm link khôi phục xong là đang đăng nhập). Bấm được link trong email cũng
  // là đã chứng minh nắm hộp thư → coi như đã xác nhận email; các link xác nhận cũ (mang mật
  // khẩu khác) hết tác dụng.
  async function resetPassword({ token, password }, meta = {}) {
    const passwordHash = await hashPassword(password)
    return withTransaction(pool, async (client) => {
      // 1 câu lệnh duy nhất vừa kiểm tra vừa đánh dấu đã dùng → 1 token không thể dùng 2 lần,
      // kể cả khi 2 request tới cùng lúc.
      const { rows } = await client.query(
        `update password_reset_tokens set used_at = now()
         where token_hash = $1 and used_at is null and expires_at > now()
         returning user_id`,
        [hashToken(token)],
      )
      if (!rows[0]) {
        throw badRequest(
          'invalid_reset_token',
          'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn — hãy yêu cầu link mới.',
        )
      }
      await client.query(
        'update email_verification_tokens set used_at = now() where user_id = $1 and used_at is null',
        [rows[0].user_id],
      )
      return setPasswordAndRestartSessions(client, rows[0].user_id, passwordHash, meta, { verifiesEmail: true })
    })
  }

  async function changePassword(userId, { current_password, password }, meta = {}) {
    const { rows } = await pool.query('select * from users where id = $1', [userId])
    if (!rows[0]) throw unauthorized('invalid_token', 'Tài khoản không còn tồn tại.')
    // `?? DUMMY_HASH`: tài khoản cũ tạo bằng Google chưa có mật khẩu → luôn báo sai (đặt mật khẩu
    // qua "Quên mật khẩu").
    if (!(await verifyPassword(current_password, rows[0].password_hash ?? DUMMY_HASH))) {
      throw badRequest('invalid_current_password', 'Mật khẩu hiện tại không đúng.')
    }
    const passwordHash = await hashPassword(password)
    return withTransaction(pool, (client) => setPasswordAndRestartSessions(client, userId, passwordHash, meta))
  }

  async function setPasswordAndRestartSessions(client, userId, passwordHash, meta, { verifiesEmail = false } = {}) {
    const { rows } = await client.query(
      `update users set password_hash = $2, updated_at = now(),
         email_verified_at = case when $3::boolean then coalesce(email_verified_at, now()) else email_verified_at end
       where id = $1 returning *`,
      [userId, passwordHash, verifiesEmail],
    )
    if (rows[0].disabled_at) throw accountDisabled()
    await client.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [
      userId,
    ])
    return issueSession(client, rows[0], meta)
  }

  // ---- Quản lý phiên đăng nhập (thiết bị) ----
  // 1 "phiên" = 1 family refresh token = 1 lần đăng nhập trên 1 trình duyệt/thiết bị.

  async function familyOfToken(db, rawToken, userId) {
    if (!rawToken) return null
    const { rows } = await db.query('select family_id from refresh_tokens where token_hash = $1 and user_id = $2', [
      hashToken(rawToken),
      userId,
    ])
    return rows[0]?.family_id ?? null
  }

  // Các phiên còn hiệu lực của mình. `current` = phiên của chính trình duyệt đang gọi (nhận ra
  // qua cookie refresh). Không bao giờ trả token hay hash ra ngoài.
  async function listSessions(userId, currentRawToken) {
    const currentFamily = await familyOfToken(pool, currentRawToken, userId)
    const { rows } = await pool.query(
      `select t.family_id as id, t.user_agent, t.created_at as last_active_at,
              (select min(f.created_at) from refresh_tokens f where f.family_id = t.family_id) as created_at
       from refresh_tokens t
       where t.user_id = $1 and t.revoked_at is null and t.expires_at > now()
       order by t.created_at desc`,
      [userId],
    )
    return rows.map((r) => ({ ...r, current: r.id === currentFamily }))
  }

  // Đăng xuất 1 thiết bị. Access token của thiết bị đó còn dùng được tới khi hết hạn (tối đa
  // ACCESS_TOKEN_TTL_SECONDS, mặc định 15 phút), sau đó không gia hạn được nữa.
  async function revokeSession(userId, familyId) {
    const { rowCount } = await pool.query(
      `update refresh_tokens set revoked_at = now()
       where user_id = $1 and family_id = $2 and revoked_at is null and expires_at > now()`,
      [userId, familyId],
    )
    if (rowCount === 0) throw notFound('Không tìm thấy phiên đăng nhập này.')
  }

  // Đăng xuất mọi thiết bị KHÁC, giữ lại phiên đang dùng. Trả về số phiên đã đăng xuất.
  async function revokeOtherSessions(userId, currentRawToken) {
    const currentFamily = await familyOfToken(pool, currentRawToken, userId)
    const { rows } = await pool.query(
      `update refresh_tokens set revoked_at = now()
       where user_id = $1 and revoked_at is null and expires_at > now()
         and ($2::uuid is null or family_id <> $2)
       returning family_id`,
      [userId, currentFamily],
    )
    return new Set(rows.map((r) => r.family_id)).size
  }

  // Xoá vĩnh viễn tài khoản (bắt buộc nhập lại mật khẩu). Dữ liệu CÁ NHÂN (chủ đề, từ, tiến
  // trình, nhật ký, câu giao tiếp, cài đặt, phiên đăng nhập) bị xoá theo khoá ngoại `on delete
  // cascade`. Nội dung DÙNG CHUNG của nhóm thì được GIỮ cho nhóm: với mỗi nhóm còn thành viên
  // khác, chủ đề nhóm + từ trong chủ đề nhóm do người này tạo được chuyển cho 1 trưởng nhóm
  // khác (nếu người này là trưởng nhóm duy nhất → thành viên vào nhóm sớm nhất lên làm trưởng
  // nhóm). Nhóm chỉ có mỗi người này thì xoá luôn nhóm.
  async function deleteAccount(userId, { password }) {
    const { rows } = await pool.query('select * from users where id = $1', [userId])
    if (!rows[0]) throw unauthorized('invalid_token', 'Tài khoản không còn tồn tại.')
    if (!(await verifyPassword(password, rows[0].password_hash ?? DUMMY_HASH))) {
      throw badRequest('invalid_current_password', 'Mật khẩu không đúng.')
    }
    if (isSuperAdmin(rows[0].role)) await assertNotLastSuperAdmin(userId)
    await withTransaction(pool, (client) => deleteUserKeepingGroupContent(client, userId))
  }

  // Hệ thống luôn phải còn ít nhất 1 super admin (nếu không sẽ không ai quản lý tài khoản được,
  // và quyền này chỉ gán lại được bằng SQL).
  async function assertNotLastSuperAdmin(userId) {
    const { rows } = await pool.query(
      "select 1 from users where role = 'super_admin' and disabled_at is null and id <> $1 limit 1",
      [userId],
    )
    if (!rows[0]) {
      throw forbidden('Bạn là super admin duy nhất — hãy chỉ định super admin khác (bằng SQL) trước khi xoá tài khoản.')
    }
  }

  return {
    register,
    resendVerification,
    verifyEmail,
    login,
    refresh,
    logout,
    getMe,
    updateProfile,
    requestPasswordReset,
    resetPassword,
    changePassword,
    listSessions,
    revokeSession,
    revokeOtherSessions,
    deleteAccount,
  }
}
