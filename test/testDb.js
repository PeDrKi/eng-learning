// Database RIÊNG cho test — bị xoá sạch mỗi lần chạy test, TUYỆT ĐỐI không trỏ vào DB thật.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tuvung:tuvung@localhost:5432/tuvung_test'
