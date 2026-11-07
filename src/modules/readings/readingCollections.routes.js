import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { createCollectionSchema, deleteCollectionQuery, updateCollectionSchema } from './readingCollections.schemas.js'

export function createReadingCollectionsRouter({ readingCollectionsService }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await readingCollectionsService.list(req.access))
  })

  router.post('/', validateBody(createCollectionSchema), async (req, res) => {
    res.status(201).json(await readingCollectionsService.create(req.access, req.body))
  })

  router.patch('/:id', uuidParam(), validateBody(updateCollectionSchema), async (req, res) => {
    res.json(await readingCollectionsService.update(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), validateQuery(deleteCollectionQuery), async (req, res) => {
    await readingCollectionsService.remove(req.access, req.params.id, {
      deleteReadings: req.validQuery.delete_readings === 'true',
    })
    res.status(204).end()
  })

  return router
}
