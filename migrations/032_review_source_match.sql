-- ============================================================
-- 032 — Thêm nguồn lượt ôn 'match' (trò "Ghép thẻ": ghép từ với nghĩa). CHỈ nới ràng buộc, không
-- sửa dữ liệu. Giống Quiz / Chính tả: tính vào mục tiêu ngày và chuỗi ngày học, KHÔNG đổi lịch ôn FSRS.
-- ============================================================
alter table review_log drop constraint if exists review_log_source_check;
alter table review_log add constraint review_log_source_check check (source in ('study', 'quiz', 'spelling', 'match'));
