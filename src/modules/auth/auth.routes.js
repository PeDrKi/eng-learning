import { Router } from 'express'
import { checkOrigin } from '../../middleware/checkOrigin.js'
import { createAuthLimiters } from '../../middleware/rateLimits.js'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.schemas.js'

export const REFRESH_COOKIE = 'tv_refresh'

// Hình dạng phản hồi phiên cố ý giống session của Supabase (access_token, expires_in, user)
// để phần FE đổi ít nhất. Refresh token KHÔNG nằm trong body — chỉ ở cookie httpOnly, JS
// của trang không đọc được → XSS không lấy trộm được phiên dài hạn.
export function createAuthRouter({ config, authService, requireUser, rateLimitStore }) {
  const router = Router()
  const limiters = createAuthLimiters(config.rateLimitEnabled, rateLimitStore)

  const cookieOptions = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/auth', // chỉ gửi kèm tới các endpoint /auth/*, không đính vào mọi request API
  }
  const meta = (req) => ({ userAgent: req.get('user-agent')?.slice(0, 300) })

  function sendSession(res, session, status = 200) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, expires: session.refreshExpiresAt })
    res.status(status).json({
      access_token: session.accessToken,
      token_type: 'bearer',
      expires_in: session.expiresIn,
      user: session.user,
    })
  }
  const clearCookie = (res) => res.clearCookie(REFRESH_COOKIE, cookieOptions)

  router.post('/register', limiters.credentials, limiters.register, validateBody(registerSchema), async (req, res) => {
    const session = await authService.register(req.body, meta(req))
    if (session) return sendSession(res, session, 201)
    // Đang bật xác nhận email: chưa có phiên, người dùng cần bấm link trong email. Câu trả lời
    // giống hệt nhau dù email đã có tài khoản hay chưa.
    res.status(202).json({
      verification_required: true,
      email: req.body.email,
      message: 'Đã gửi link xác nhận tới email của bạn. Hãy mở email và bấm link để kích hoạt tài khoản.',
    })
  })

  // Bấm link xác nhận trong email → kích hoạt tài khoản + đăng nhập luôn.
  router.post('/verify-email', limiters.credentials, validateBody(verifyEmailSchema), async (req, res) => {
    sendSession(res, await authService.verifyEmail(req.body, meta(req)))
  })

  router.post(
    '/resend-verification',
    limiters.verificationEmail,
    validateBody(resendVerificationSchema),
    async (req, res) => {
      await authService.resendVerification(req.body)
      res.status(202).json({
        ok: true,
        message: 'Nếu email này đang chờ xác nhận, bạn sẽ nhận được link mới trong vài phút.',
      })
    },
  )

  router.post('/login', limiters.credentials, validateBody(loginSchema), limiters.loginEmail, async (req, res) => {
    sendSession(res, await authService.login(req.body, meta(req)))
  })

  router.post('/refresh', checkOrigin(config.cors.origins), async (req, res) => {
    try {
      sendSession(res, await authService.refresh(req.cookies[REFRESH_COOKIE], meta(req)))
    } catch (err) {
      clearCookie(res) // cookie hỏng/hết hạn → xoá luôn cho sạch
      throw err
    }
  })

  router.post('/logout', checkOrigin(config.cors.origins), async (req, res) => {
    await authService.logout(req.cookies[REFRESH_COOKIE])
    clearCookie(res)
    res.status(204).end()
  })

  router.get('/me', requireUser, async (req, res) => {
    res.json({ user: await authService.getMe(req.user.id) })
  })

  // Đổi tên hiển thị. Không cần mật khẩu: tên chỉ để hiển thị, không ảnh hưởng đăng nhập.
  router.put('/profile', requireUser, validateBody(updateProfileSchema), async (req, res) => {
    res.json({ user: await authService.updateProfile(req.user.id, req.body) })
  })

  router.post('/forgot-password', limiters.passwordReset, validateBody(forgotPasswordSchema), async (req, res) => {
    await authService.requestPasswordReset(req.body)
    res.status(202).json({
      ok: true,
      message: 'Nếu email này đã đăng ký, bạn sẽ nhận được link đặt lại mật khẩu trong vài phút.',
    })
  })

  router.post('/reset-password', limiters.credentials, validateBody(resetPasswordSchema), async (req, res) => {
    sendSession(res, await authService.resetPassword(req.body, meta(req)))
  })

  router.put('/password', limiters.credentials, requireUser, validateBody(changePasswordSchema), async (req, res) => {
    sendSession(res, await authService.changePassword(req.user.id, req.body, meta(req)))
  })

  // ---- Thiết bị đang đăng nhập ----
  // Cookie refresh (path /auth) được gửi kèm → BE biết phiên nào là "thiết bị này".
  router.get('/sessions', requireUser, async (req, res) => {
    res.json(await authService.listSessions(req.user.id, req.cookies[REFRESH_COOKIE]))
  })

  // Đăng xuất mọi thiết bị khác, giữ phiên hiện tại.
  router.delete('/sessions', requireUser, async (req, res) => {
    res.json({ revoked: await authService.revokeOtherSessions(req.user.id, req.cookies[REFRESH_COOKIE]) })
  })

  router.delete('/sessions/:id', requireUser, uuidParam(), async (req, res) => {
    await authService.revokeSession(req.user.id, req.params.id)
    res.status(204).end()
  })

  // Xoá vĩnh viễn tài khoản — bắt buộc nhập lại mật khẩu; giới hạn số lần thử như đăng nhập.
  router.delete('/account', limiters.credentials, requireUser, validateBody(deleteAccountSchema), async (req, res) => {
    await authService.deleteAccount(req.user.id, req.body)
    clearCookie(res)
    res.status(204).end()
  })

  return router
}
