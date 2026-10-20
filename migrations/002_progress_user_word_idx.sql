-- ============================================================
-- 002 — index cho phân trang GET /progress?limit=...
--
-- Truy vấn trang lọc theo user_id rồi xếp theo word_id. Ràng buộc unique (word_id, user_id) có
-- sẵn bắt đầu bằng word_id nên không dùng được cho việc này; index (user_id, word_id) cho phép
-- đọc thẳng đúng trang cần lấy thay vì quét + sắp xếp toàn bộ tiến trình của người dùng.
-- ============================================================
create index word_progress_user_word_idx on word_progress (user_id, word_id);
