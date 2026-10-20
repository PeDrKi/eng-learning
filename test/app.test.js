import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { FE_ORIGIN, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()

describe('Khung ứng dụng', () => {
  it('GET /health trả ngay, KHÔNG truy vấn DB (để Neon được ngủ khi rảnh)', async () => {
    const spy = vi.spyOn(pool, 'query')
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('GET /health/db kiểm tra kết nối DB', async () => {
    const res = await request(app).get('/health/db')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', database: 'ok' })
  })

  it('endpoint không tồn tại → 404 đúng định dạng lỗi chung', async () => {
    const res = await request(app).get('/khong-co')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })

  it('JSON hỏng → 400 invalid_json thay vì 500', async () => {
    const res = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{hỏng')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_json')
  })

  it('CORS: cho phép domain FE kèm credentials, không cho domain lạ', async () => {
    let res = await request(app)
      .options('/auth/login')
      .set('Origin', FE_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
    expect(res.headers['access-control-allow-origin']).toBe(FE_ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')

    res = await request(app)
      .options('/auth/login')
      .set('Origin', 'https://la.example')
      .set('Access-Control-Request-Method', 'POST')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('có header bảo mật của helmet', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'a'.repeat(32) }

  it('báo rõ biến môi trường bị thiếu/sai', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'ngan' })).toThrow(/32 ký tự/)
    expect(() => loadConfig({ ...base, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_URL/)
    expect(() => loadConfig({ ...base, MAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/)
    expect(() => loadConfig({ ...base, MAIL_DRIVER: 'brevo' })).toThrow(/BREVO_API_KEY/)
  })

  it('production mặc định cookie Secure; SameSite=none luôn kéo theo Secure', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).cookie.secure).toBe(true)
    expect(loadConfig({ ...base }).cookie.secure).toBe(false)
    expect(loadConfig({ ...base, COOKIE_SAMESITE: 'none' }).cookie.secure).toBe(true)
  })

  it('CORS_ORIGINS nhận nhiều domain, bỏ dấu / thừa ở cuối', () => {
    const c = loadConfig({ ...base, CORS_ORIGINS: 'https://a.com/, https://b.com' })
    expect(c.cors.origins).toEqual(['https://a.com', 'https://b.com'])
  })
})
