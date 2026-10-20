import { randomUUID } from 'node:crypto'

// Ghi 1 dòng JSON cho mỗi request khi phản hồi xong — đủ để trả lời "endpoint nào chậm, lỗi ở
// đâu, ai gọi nhiều" mà không cần công cụ ngoài; các nền tảng log (Render, Datadog, Grafana
// Loki...) đều đọc được JSON theo dòng.
//
//   {"t":"...","id":"...","method":"GET","route":"/words","status":200,"ms":42,"user":"<uuid>"}
//
// • `route` là MẪU đường dẫn (/words/:id), không phải URL thật → gom nhóm được, và không ghi
//   query string (có thể chứa dữ liệu người dùng). Không bao giờ ghi body, header hay token.
// • `id` cũng được trả về client qua header X-Request-Id — người dùng báo lỗi kèm mã này là tra
//   ra đúng dòng log; nhận lại mã do proxy phía trước gắn sẵn (nếu hợp lệ) để nối log 2 tầng.
// • /health bị bỏ qua: nền tảng host gọi liên tục, chỉ làm nhiễu log.
const VALID_ID = /^[\w-]{8,64}$/

export function requestLog({ enabled, slowMs, log = console.log }) {
  return (req, res, next) => {
    const incoming = req.get('x-request-id')
    req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID()
    res.set('X-Request-Id', req.id)
    if (!enabled || req.path.startsWith('/health')) return next()

    const startedAt = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6)
      const entry = {
        t: new Date().toISOString(),
        id: req.id,
        method: req.method,
        // req.route chỉ có khi khớp 1 route; 404 → ghi "(không khớp)" thay vì URL thật.
        route: req.route ? req.baseUrl + req.route.path : '(không khớp)',
        status: res.statusCode,
        ms,
      }
      if (req.user?.id) entry.user = req.user.id
      if (ms >= slowMs) entry.slow = true
      log(JSON.stringify(entry))
    })
    next()
  }
}
