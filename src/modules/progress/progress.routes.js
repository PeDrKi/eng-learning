import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { pageQuery } from '../../lib/pagination.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { updateProgressSchema } from './progress.schemas.js'

export function createProgressRouter({ progressService }) {
  const router = Router()

  router.get('/', validateQuery(pageQuery), async (req, res) => {
    res.json(await progressService.listMine(req.access, req.validQuery))
  })

  router.patch('/:wordId', uuidParam('wordId'), validateBody(updateProgressSchema), async (req, res) => {
    res.json(await progressService.upsertMine(req.access, req.params.wordId, req.body))
  })

  return router
}
