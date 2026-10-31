-- ============================================================
-- 029 — Trang đọc tách làm 2 phần + BẢN DỊCH CỦA NGƯỜI HỌC (không có dịch máy):
--   short — câu / đoạn ngắn (1 hoặc vài câu): một ô bản dịch.
--   long  — bài đọc dài (nhiều câu, nhiều đoạn): mỗi đoạn văn một ô bản dịch đặt song song.
--
-- `translations` là mảng chuỗi theo THỨ TỰ ĐOẠN (đoạn = khối cách nhau bởi dòng trống; bài ngắn chỉ
-- dùng phần tử 0). Bài đọc có từ trước đều là bài dài (`long`), chưa có bản dịch.
-- ============================================================
alter table readings add column if not exists kind text not null default 'long';
alter table readings add column if not exists translations jsonb not null default '[]'::jsonb;

alter table readings drop constraint if exists readings_kind_check;
alter table readings add constraint readings_kind_check check (kind in ('short', 'long'));
