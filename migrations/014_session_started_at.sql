-- ============================================================
-- 014 — hạn tối đa tuyệt đối cho mỗi phiên đăng nhập.
--
-- Trước đây mỗi lần gia hạn (refresh) lại cấp token mới hạn +30 ngày, nên người dùng đều đặn
-- thì phiên KHÔNG BAO GIỜ hết. `session_started_at` = lúc đăng nhập của cả family (chép sang
-- mọi token nối tiếp); hạn của token mới không vượt quá session_started_at + SESSION_MAX_DAYS,
-- quá mốc đó phải đăng nhập lại.
--
-- Không suy ra từ min(created_at) của family vì job dọn dẹp xoá token cũ đã hết hạn → mốc đó
-- sẽ trôi dần về sau. Dữ liệu cũ: lấy token sớm nhất còn lại của family (gần đúng, chấp nhận được).
-- ============================================================
alter table refresh_tokens add column session_started_at timestamptz;

update refresh_tokens t
set session_started_at = f.started
from (select family_id, min(created_at) as started from refresh_tokens group by family_id) f
where f.family_id = t.family_id;

alter table refresh_tokens
  alter column session_started_at set not null,
  alter column session_started_at set default now();
