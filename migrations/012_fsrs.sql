-- ============================================================
-- 012 — trạng thái trí nhớ FSRS cho mỗi thẻ (thay lịch ôn SM-2).
--
-- stability (ngày): sau chừng ấy ngày không ôn, khả năng còn nhớ giảm còn 90%.
-- difficulty (1–10): độ khó của thẻ với người học này.
-- Frontend tính hai giá trị này sau mỗi lần chấm (tuvung-react/src/lib/fsrs.js) và gửi lên cùng
-- due_at như trước. Để null nghĩa là thẻ mới, hoặc thẻ học từ thời SM-2: lần chấm kế tiếp sẽ ước
-- lượng từ interval_days/ease_factor cũ (lib/srs.js legacyMemoryState) nên không mất tiến độ.
-- Các cột SM-2 cũ (ease_factor) giữ nguyên, không xoá, để có thể quay lại nếu cần.
-- ============================================================
alter table word_progress add column if not exists stability real;
alter table word_progress add column if not exists difficulty real;
alter table word_progress add column if not exists stability_rev real;
alter table word_progress add column if not exists difficulty_rev real;
alter table phrase_progress add column if not exists stability real;
alter table phrase_progress add column if not exists difficulty real;
