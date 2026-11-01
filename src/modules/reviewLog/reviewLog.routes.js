import { Router } from 'express'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createReviewLogSchema,
  dailyReviewLogQuery,
  exportReviewLogQuery,
  listReviewLogQuery,
} from './reviewLog.schemas.js'

const CSV_COLUMNS = [
  'reviewed_at',
  'source',
  'direction',
  'quality',
  'answer_ms',
  'wrong_answer',
  'session_id',
  'word_id',
  'word',
  'phrase_id',
  'phrase',
]
// Ô CSV: bọc nháy khi cần; ô bắt đầu bằng = + - @ thì thêm dấu nháy đơn để Excel không chạy như công thức.
function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function createReviewLogRouter({ reviewLogService }) {
  const router = Router()

  router.get('/', validateQuery(listReviewLogQuery), async (req, res) => {
    res.json(await reviewLogService.listMine(req.access, req.validQuery.since))
  })

  // Đặt TRƯỚC '/' không cần thiết (đường dẫn khác hẳn), nhưng để cạnh nhau cho dễ đọc.
  router.get('/daily', validateQuery(dailyReviewLogQuery), async (req, res) => {
    const { since, tz } = req.validQuery
    res.json(await reviewLogService.dailyCounts(req.access, { since, timeZone: tz }))
  })

  router.get('/summary', async (req, res) => {
    res.json(await reviewLogService.summary(req.access))
  })

  // Tải về toàn bộ nhật ký ôn của chính mình (JSON hoặc CSV).
  router.get('/export', validateQuery(exportReviewLogQuery), async (req, res) => {
    const rows = await reviewLogService.exportMine(req.access)
    const stamp = new Date().toISOString().slice(0, 10)
    if (req.validQuery.format === 'csv') {
      const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))
      const body = [CSV_COLUMNS.join(','), ...lines].join('\r\n')
      res.set('Content-Type', 'text/csv; charset=utf-8')
      res.set('Content-Disposition', `attachment; filename="lich-su-on-${stamp}.csv"`)
      // BOM để Excel đọc đúng tiếng Việt.
      res.send(`\uFEFF${body}`)
      return
    }
    res.set('Content-Disposition', `attachment; filename="lich-su-on-${stamp}.json"`)
    res.json({ exported_at: new Date().toISOString(), reviews: rows })
  })

  router.post('/', validateBody(createReviewLogSchema), async (req, res) => {
    res.status(201).json(await reviewLogService.add(req.access, req.body))
  })

  return router
}
