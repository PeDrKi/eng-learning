import { isIP } from 'node:net'

// Lấy IP người dùng từ header do proxy ngoài cùng gắn (VD Cloudflare `cf-connecting-ip`) thay vì
// đếm tầng trong X-Forwarded-For. Trên Render, X-Forwarded-For có dạng
// "<IP người dùng tự khai>, <IP thật>, <Cloudflare>, <proxy nội bộ 10.x>": Render nối thêm vào
// chứ không xoá phần người dùng gửi, nên đếm sai 1 tầng là hoặc mọi người chung 1 bộ đếm rate
// limit (IP proxy), hoặc ai cũng tự đổi được IP (giả header). Cloudflare luôn ghi đè header của
// nó bằng IP thật. Header thiếu hoặc không phải IP → giữ req.ip tính theo `trust proxy`.
export function clientIpFromHeader(header) {
  return (req, _res, next) => {
    const ip = req.get(header)?.trim()
    if (ip && isIP(ip)) Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true })
    next()
  }
}
