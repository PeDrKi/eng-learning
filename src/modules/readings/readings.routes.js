import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import { createReadingSchema, updateReadingSchema } from './readings.schemas.js'

export function createReadingsRouter({ readingsService }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await readingsService.list(req.access))
  })

  router.post('/', validateBody(createReadingSchema), async (req, res) => {
    res.status(201).json(await readingsService.create(req.access, req.body))
  })

  router.patch('/:id', uuidParam(), validateBody(updateReadingSchema), async (req, res) => {
    res.json(await readingsService.update(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), async (req, res) => {
    await readingsService.remove(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
