// Danh tính CÔNG KHAI của một người dùng (trang cộng đồng, chủ đề đã lưu, nhận xét): tên tự đặt
// (`<prefix>_name`, null nếu chưa đặt) và một mã ngắn cố định (`<prefix>_tag`, 4 ký tự hex lấy từ
// id) để giao diện tự ghép "Người học #3FA2" / "Learner #3FA2" theo ngôn ngữ đang dùng.
// KHÔNG BAO GIỜ dùng email — email là thông tin riêng tư. `u` là alias bảng users trong câu SQL.
export const sqlPublicIdentity = (prefix, alias = 'u') =>
  `${alias}.display_name as ${prefix}_name, upper(substr(replace(${alias}.id::text, '-', ''), 1, 4)) as ${prefix}_tag`
