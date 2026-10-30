import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import { updatePhraseProgressSchema } from '../phrases/phrases.schemas.js'
import {
  bulkCreateCollocationsSchema,
  createCollocationSchema,
  updateCollocationSchema,
} from './collocations.schemas.js'

export function createCollocationsRouter({ collocationsService }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await collocationsService.list(req.access))
  })

  router.post('/', validateBody(createCollocationSchema), async (req, res) => {
    res.status(201).json(await collocationsService.create(req.access, req.body))
  })

  // Thêm nhiều mục một lần: nhập file sao lưu, thêm bộ có sẵn.
  router.post('/bulk', validateBody(bulkCreateCollocationsSchema), async (req, res) => {
    res.status(201).json(await collocationsService.bulkCreate(req.access, req.body.collocations))
  })

  router.patch('/:id', uuidParam(), validateBody(updateCollocationSchema), async (req, res) => {
    res.json(await collocationsService.update(req.access, req.params.id, req.body))
  })

  // Kết quả ôn — cùng dạng tiến trình với câu giao tiếp (FSRS, một chiều).
  router.patch('/:id/progress', uuidParam(), validateBody(updatePhraseProgressSchema), async (req, res) => {
    res.json(await collocationsService.updateProgress(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), async (req, res) => {
    await collocationsService.remove(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
