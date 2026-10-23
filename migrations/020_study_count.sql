-- ============================================================
-- 020 — SỐ LẦN HỌC mỗi từ (word_progress.study_count).
--
-- Trạng thái học của một từ chia theo số lần học: 0 = chưa học, 1–19 = đang học, từ 20 = đã
-- học. Một lần học = một lượt ôn từ đó ở tab Học, Quiz hoặc Chính tả, chiều nào cũng tính — tức
-- mỗi dòng review_log có word_id. Không dùng `repetitions` vì cột đó là số lần nhớ LIÊN TIẾP
-- (về 0 khi chấm "Quên").
--
-- Đếm sẵn ở đây thay vì đếm review_log mỗi lần tải danh sách từ: nhật ký của người học chăm
-- lên tới hàng chục nghìn dòng, và có thể bị dọn bớt (REVIEW_LOG_RETENTION_DAYS) — bộ đếm thì
-- không mất. Trigger trên review_log là đường cộng DUY NHẤT; client không ghi được cột này.
-- ============================================================
alter table word_progress add column if not exists study_count int not null default 0;

-- Tính lại từ nhật ký đang có. Có lượt ôn mà chưa có dòng tiến trình (hiếm: từ nhóm) thì tạo dòng.
insert into word_progress (word_id, user_id, study_count)
select word_id, user_id, count(*)::int
from review_log
where word_id is not null
group by word_id, user_id
on conflict (word_id, user_id) do update set study_count = excluded.study_count;

create or replace function count_word_study()
returns trigger
language plpgsql
as $$
begin
  if new.word_id is not null then
    insert into word_progress (word_id, user_id, study_count) values (new.word_id, new.user_id, 1)
    on conflict (word_id, user_id) do update set study_count = word_progress.study_count + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists review_log_count_study on review_log;
create trigger review_log_count_study
after insert on review_log
for each row execute function count_word_study();
