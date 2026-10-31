import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Tài liệu docs/API.md phải liệt kê ĐÚNG các endpoint có trong code — thêm route mà quên ghi tài
// liệu (hoặc xoá route mà tài liệu còn) thì test này đỏ. Đọc mã nguồn tĩnh, không cần database.
// fileURLToPath thay cho .pathname: trên Windows .pathname ra "/C:/..." nên đọc file hỏng.
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')

// Tiền tố gắn router trong app.js: app.use('/words', auth, createWordsRouter(...)).
function mountPrefixes() {
  const app = read('src/app.js')
  const prefixes = {}
  for (const m of app.matchAll(/app\.use\(\s*'(\/[a-z/-]*)'[\s\S]*?create(\w+)Router\(/g)) prefixes[m[2]] = m[1]
  return prefixes
}

function routerFiles() {
  const files = { Settings: 'src/modules/settings/settings.js', Push: 'src/modules/push/push.js' }
  for (const dir of readdirSync(join(root, 'src/modules'))) {
    for (const f of readdirSync(join(root, 'src/modules', dir))) {
      const m = f.match(/^(\w+)\.routes\.js$/)
      if (m) files[m[1][0].toUpperCase() + m[1].slice(1)] = `src/modules/${dir}/${f}`
    }
  }
  return files
}

function codeEndpoints() {
  const prefixes = mountPrefixes()
  const out = new Set()
  for (const [name, file] of Object.entries(routerFiles())) {
    const prefix = prefixes[name]
    expect(prefix, `không tìm thấy app.use(...) cho create${name}Router`).toBeTruthy()
    for (const m of read(file).matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const path = m[2] === '/' ? prefix : prefix + m[2]
      out.add(`${m[1].toUpperCase()} ${path}`)
    }
  }
  for (const m of read('src/app.js').matchAll(/app\.(get|post)\(\s*'([^']*)'/g))
    out.add(`${m[1].toUpperCase()} ${m[2]}`)
  return out
}

// Mỗi dòng bảng dạng "| GET | `/words/:id` | ..." trong tài liệu.
function documentedEndpoints() {
  const out = new Set()
  for (const m of read('docs/API.md').matchAll(/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`/gm)) {
    out.add(`${m[1]} ${m[2]}`)
  }
  return out
}

describe('docs/API.md', () => {
  it('liệt kê đúng và đủ mọi endpoint trong code', () => {
    const code = codeEndpoints()
    const docs = documentedEndpoints()
    expect(code.size).toBeGreaterThan(40) // chặn trường hợp regex hỏng, đọc ra 0 = 0 rồi "đạt"
    expect(
      [...code].filter((e) => !docs.has(e)),
      'endpoint có trong code nhưng chưa ghi tài liệu',
    ).toEqual([])
    expect(
      [...docs].filter((e) => !code.has(e)),
      'endpoint trong tài liệu nhưng không còn trong code',
    ).toEqual([])
  })
})
