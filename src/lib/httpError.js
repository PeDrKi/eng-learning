// Lỗi "có chủ đích" trả về cho client: mã HTTP + `code` ổn định (FE dựa vào code để xử lý,
// VD: token_expired → tự refresh) + `message` tiếng Việt hiển thị được luôn.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details)
export const unauthorized = (code = 'unauthorized', message = 'Bạn cần đăng nhập để tiếp tục.') =>
  new HttpError(401, code, message)
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') =>
  new HttpError(403, 'forbidden', message)
export const notFound = (message = 'Không tìm thấy.') => new HttpError(404, 'not_found', message)
export const conflict = (code, message) => new HttpError(409, code, message)
export const accountDisabled = () =>
  new HttpError(403, 'account_disabled', 'Tài khoản đã bị khoá. Liên hệ quản trị viên nếu bạn cho là nhầm lẫn.')
