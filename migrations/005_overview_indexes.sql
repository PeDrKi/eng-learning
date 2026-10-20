-- ============================================================
-- 005 — index cho trang tổng quan của super admin (GET /admin/overview).
--
-- Trang tổng quan đếm lượt ôn và người đăng ký theo NGÀY trên toàn hệ thống. Index sẵn có của
-- review_log bắt đầu bằng user_id (phục vụ truy vấn theo từng người) nên không dùng được khi lọc
-- theo thời gian trên mọi người dùng — thiếu index này Postgres phải quét cả bảng review_log,
-- bảng lớn nhanh nhất của hệ thống.
-- ============================================================
create index if not exists review_log_time_idx on review_log (reviewed_at);
create index if not exists users_created_idx on users (created_at desc, id);
