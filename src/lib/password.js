import bcrypt from 'bcryptjs'

// bcrypt cost 10 — trùng với Supabase Auth, nên hash cũ chuyển sang vẫn so khớp được.
const COST = 10

export const hashPassword = (password) => bcrypt.hash(password, COST)
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash)

// Hash giả để so khớp khi email KHÔNG tồn tại: thời gian phản hồi đăng nhập như nhau dù email
// có hay không → không dò được email nào đã đăng ký qua độ trễ.
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', COST)
