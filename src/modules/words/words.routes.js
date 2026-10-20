import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { pageQuery } from '../../lib/pagination.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { bulkCreateWordsSchema, createWordSchema, updateWordSchema } from './words.schemas.js'

export function createWordsRouter({ wordsService }) {
  const router = Router()

  router.get('/', validateQuery(pageQuery), async (req, res) => {
    res.json(await wordsService.list(req.access, req.validQuery))
  })

  router.post('/', validateBody(createWordSchema), async (req, res) => {
    res.status(201).json(await wordsService.create(req.access, req.body))
  })

  router.post('/bulk', validateBody(bulkCreateWordsSchema), async (req, res) => {
    res.status(201).json(await wordsService.bulkCreate(req.access, req.body.words))
  })

  router.patch('/:id', uuidParam(), validateBody(updateWordSchema), async (req, res) => {
    res.json(await wordsService.update(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), async (req, res) => {
    await wordsService.remove(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
