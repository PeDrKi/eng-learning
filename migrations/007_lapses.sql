-- ============================================================
-- 007 — đếm số lần QUÊN một từ, để nhận ra "từ mãi không thuộc".
--
-- Trước đây không có cách nào biết một từ đã bị quên bao nhiêu lần: `repetitions` bị reset về 0
-- mỗi lần chấm "Quên", còn `quiz_wrong` chỉ đếm ở màn Quiz. Hệ quả là một từ sai đi sai lại hàng
-- chục lần vẫn lặng lẽ quay vòng trong hàng đợi, ăn hết thời gian của phiên học mà không ai biết.
--
-- Cột này chỉ tăng, không bao giờ reset — nó là "lý lịch" của từ, không phải trạng thái SRS.
-- ============================================================
alter table word_progress add column if not exists lapses int not null default 0;
