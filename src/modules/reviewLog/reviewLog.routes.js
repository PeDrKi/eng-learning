import { Router } from 'express'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { createReviewLogSchema, dailyReviewLogQuery, listReviewLogQuery } from './reviewLog.schemas.js'

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

  router.post('/', validateBody(createReviewLogSchema), async (req, res) => {
    res.status(201).json(await reviewLogService.add(req.access, req.body))
  })

  return router
}
