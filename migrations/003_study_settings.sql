-- ============================================================
-- 003 — cài đặt cho kiểu học "tranh thủ lúc rảnh" (phiên ngắn).
--
--   • session_size    — số thẻ mỗi phiên học (phiên ngắn, có điểm kết thúc rõ).
--   • daily_goal      — mục tiêu số lượt ôn mỗi ngày (hiện thành thanh tiến độ ở tab Học).
--   • reviews_per_day — giới hạn số thẻ ÔN LẠI mỗi ngày, để nghỉ vài hôm quay lại không bị
--                       dồn hàng trăm thẻ một lúc (thẻ vượt giới hạn tự dàn sang các ngày sau).
--
-- Dòng cũ nhận giá trị mặc định → người dùng hiện tại không phải làm gì.
-- ============================================================
alter table user_settings
  add column session_size int not null default 10,
  add column daily_goal int not null default 20,
  add column reviews_per_day int not null default 100;
