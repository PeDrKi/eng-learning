-- ============================================================
-- 021 — nghĩa tiếng Anh (định nghĩa Anh–Anh) của mỗi từ, đặt cạnh nghĩa tiếng Việt.
--
-- Không bắt buộc: chuỗi rỗng = chưa nhập, giống example/ipa. Từ đã có giữ nguyên, nhận ''.
-- ============================================================
alter table words add column if not exists meaning_en text not null default '';
