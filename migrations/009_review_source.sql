-- ============================================================
-- 009 — nhật ký ôn ghi rõ lượt ôn đến từ ĐÂU: tab Học, Quiz hay Chính tả.
--
-- Trước đây chỉ tab Học ghi nhật ký, nên 5 phút làm Quiz hay Chính tả không được tính vào mục
-- tiêu ngày lẫn chuỗi ngày học — với người chỉ có ít phút rảnh, đó là "hôm nay chưa học". Nay
-- Quiz và Chính tả cũng ghi, nhưng phải phân biệt được: giới hạn thẻ ôn / từ mới mỗi ngày của
-- tab Học chỉ tính lượt ở tab Học (làm quiz không được "ăn" mất suất ôn của thẻ đến hạn).
--
-- Dòng cũ đều là 'study' (giá trị mặc định) — đúng với thực tế trước migration này.
-- ============================================================
alter table review_log add column if not exists source text not null default 'study';
alter table review_log drop constraint if exists review_log_source_check;
alter table review_log add constraint review_log_source_check check (source in ('study', 'quiz', 'spelling'));
