-- ============================================================
-- 030 — Thu thập dữ liệu cho "lịch ôn thông minh" (CHỈ THÊM cột, không xoá/sửa dữ liệu cũ).
--
-- review_log — 3 cột mới, đều có thể trống (app bản cũ và lượt ôn cũ không có):
--   answer_ms     — bao lâu (mili giây) từ lúc thẻ/câu hỏi hiện ra tới lúc trả lời.
--   wrong_answer  — đáp án SAI cụ thể đã chọn (Quiz) hoặc đã gõ (Chính tả), tối đa 200 ký tự.
--   session_id    — mã ngẫu nhiên của một lần mở app, để biết các lượt ôn nào thuộc cùng một buổi học.
--   Không ghi các cột này khi người học TẮT "Lịch ôn thông minh" (xem reviewLog.service.js).
--
-- user_settings:
--   personalization_enabled — người học cho phép dùng lịch sử ôn (đã ẩn danh) để cải thiện lịch ôn.
--                             Mặc định bật; tắt thì không ghi thêm 3 cột trên và loại khỏi mọi lần
--                             xuất dữ liệu phân tích (xem LICH-ON-THONG-MINH.md ở thư mục gốc).
--   ml_notice_seen_at       — lúc người học bấm "Đã hiểu" ở thông báo giới thiệu; trống = chưa xem.
-- ============================================================
alter table review_log
  add column if not exists answer_ms int,
  add column if not exists wrong_answer text,
  add column if not exists session_id uuid;

alter table review_log drop constraint if exists review_log_answer_ms_check;
alter table review_log add constraint review_log_answer_ms_check check (answer_ms is null or answer_ms between 0 and 3600000);
alter table review_log drop constraint if exists review_log_wrong_answer_check;
alter table review_log add constraint review_log_wrong_answer_check check (wrong_answer is null or char_length(wrong_answer) <= 200);

alter table user_settings
  add column if not exists personalization_enabled boolean not null default true,
  add column if not exists ml_notice_seen_at timestamptz;
