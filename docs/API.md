# Tài liệu API — tuvung-api

Tài liệu đầy đủ mọi endpoint của backend. Mã nguồn là nguồn gốc: mỗi bảng dưới đây khớp với các file
`src/modules/*/*.routes.js` (cùng `src/app.js`, `settings.js`, `push.js`). Test `test/apiDocs.test.js`
báo lỗi nếu có endpoint trong code mà chưa có trong tài liệu này, hoặc ngược lại.

Dữ liệu mẫu trong tài liệu được chụp từ API chạy thật (12/10/2026), đã rút gọn id.

## Mục lục

1. [Quy ước chung](#quy-ước-chung)
2. [Xác thực `/auth`](#xác-thực-auth)
3. [Chủ đề con `/decks`](#chủ-đề-con-decks)
4. [Chủ đề `/chapters`](#chủ-đề-chapters)
5. [Từ vựng `/words`](#từ-vựng-words)
6. [Tiến trình học `/progress`](#tiến-trình-học-progress)
7. [Nhật ký ôn `/review-log`](#nhật-ký-ôn-review-log)
8. [Cài đặt học `/settings`](#cài-đặt-học-settings)
9. [Nhắc học `/push`](#nhắc-học-push)
10. [Câu giao tiếp `/phrases`](#câu-giao-tiếp-phrases)
11. [Bài đọc `/readings`](#bài-đọc-readings)
12. [Nhóm học tập `/groups`](#nhóm-học-tập-groups)
13. [Quản trị `/admin`](#quản-trị-admin)
14. [Kiểm tra sức khoẻ `/health`](#kiểm-tra-sức-khoẻ-health)
15. [Mã lỗi](#mã-lỗi)

## Quy ước chung

**Địa chỉ gốc.** Máy local: `http://localhost:3000` (mặc định `PORT=3000`). Không có tiền tố `/api` hay số phiên bản.

**Định dạng.** Gửi và nhận JSON (`Content-Type: application/json`), tối đa 2 MB mỗi request. Thời gian theo
ISO 8601 có múi giờ, ví dụ `2026-10-12T04:20:23.532Z`. Id là UUID.

**Đăng nhập.** Trừ `/health*` và một số endpoint `/auth`, mọi endpoint cần header
`Authorization: Bearer <access_token>`. Access token sống 15 phút (`expires_in: 900`). Refresh token nằm
trong cookie `httpOnly` tên `tv_refresh`, chỉ gửi kèm tới `/auth/*`; gọi `/auth/*` từ trình duyệt phải
có `credentials: 'include'`. Luồng chi tiết: [Phiên đăng nhập](#phiên-đăng-nhập).

**Chủ sở hữu luôn là người đang đăng nhập.** Field thừa client gửi kèm (ví dụ `user_id`) bị bỏ qua.

**Cập nhật một phần.** Mọi `PATCH` và `PUT /settings` chỉ đổi field được gửi lên. Gửi body không có field
nào hợp lệ trả 400 `validation_error` ("Không có gì để cập nhật.").

**Phân trang** (`GET /words`, `GET /progress`, `GET /admin/users`). Không truyền `limit` thì nhận mảng đầy
đủ (riêng `/admin/users` luôn phân trang, mặc định 50). Truyền `?limit=N` (1–1000) thì nhận
`{ "items": [...], "next_cursor": "..." | null }`; gọi tiếp với `&cursor=<next_cursor>` tới khi
`next_cursor` là `null`. Con trỏ là chuỗi mờ, gửi lại nguyên văn; con trỏ sai trả 400 `invalid_cursor`.

**Lỗi.** Mọi lỗi có chung một dạng:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Vui lòng nhập từ.",
    "details": [{ "field": "word", "message": "Vui lòng nhập từ." }]
  }
}
```

`code` cố định để client xử lý theo logic; `message` là tiếng Việt, hiển thị thẳng được; `details` chỉ có ở
`validation_error`. Danh sách mã: [Mã lỗi](#mã-lỗi).

**Quyền xem và quyền sửa.**

- 404 `not_found`: không tồn tại **hoặc** không có quyền xem (cố ý giống nhau để không lộ dữ liệu người khác).
- 403 `forbidden`: xem được nhưng không được sửa/xoá.

**Giới hạn tần suất** (429 `rate_limited`):

| Phạm vi                                                                             | Giới hạn                       |
| ----------------------------------------------------------------------------------- | ------------------------------ |
| Mọi endpoint dữ liệu (sau đăng nhập)                                                | 300 request / phút / tài khoản |
| `register`, `login`, `reset-password`, `PUT /auth/password`, `DELETE /auth/account` | 10 lần / 15 phút / IP          |
| Đăng nhập **sai**                                                                   | 10 lần / 15 phút / email       |
| `register` (thêm)                                                                   | 10 lần / giờ / IP              |
| `forgot-password`                                                                   | 5 lần / giờ / IP               |
| `resend-verification`                                                               | 5 lần / giờ / IP               |
| `verify-email`                                                                      | 10 lần / 15 phút / IP          |
| `POST /groups/join`                                                                 | 20 lần / 15 phút / IP          |

**Hạn mức dữ liệu mỗi tài khoản** (409 `quota_exceeded`): 20.000 từ, 500 chủ đề, 5.000 câu giao tiếp, 500
bài đọc, 50 nhóm. Chỉnh bằng biến môi trường `QUOTA_WORDS`, `QUOTA_DECKS`, `QUOTA_PHRASES`, `QUOTA_READINGS`,
`QUOTA_GROUPS`.

## Xác thực `/auth`

| Method | Đường dẫn                   | Cần             | Body                                 | Thành công        |
| ------ | --------------------------- | --------------- | ------------------------------------ | ----------------- |
| POST   | `/auth/register`            | —               | `{ email, password, display_name? }` | 201 phiên / 202   |
| POST   | `/auth/verify-email`        | —               | `{ token }`                          | 200 phiên         |
| POST   | `/auth/resend-verification` | —               | `{ email }`                          | 202 (luôn luôn)   |
| POST   | `/auth/login`               | —               | `{ email, password }`                | 200 phiên         |
| POST   | `/auth/refresh`             | cookie + Origin | —                                    | 200 phiên         |
| POST   | `/auth/logout`              | cookie + Origin | —                                    | 204               |
| GET    | `/auth/me`                  | Bearer          | —                                    | 200 `{ user }`    |
| PUT    | `/auth/profile`             | Bearer          | `{ display_name }`                   | 200 `{ user }`    |
| POST   | `/auth/forgot-password`     | —               | `{ email }`                          | 202 (luôn luôn)   |
| POST   | `/auth/reset-password`      | —               | `{ token, password }`                | 200 phiên         |
| PUT    | `/auth/password`            | Bearer          | `{ current_password, password }`     | 200 phiên         |
| GET    | `/auth/sessions`            | Bearer + cookie | —                                    | 200 `[session]`   |
| DELETE | `/auth/sessions`            | Bearer + cookie | —                                    | 200 `{ revoked }` |
| DELETE | `/auth/sessions/:id`        | Bearer          | —                                    | 204               |
| DELETE | `/auth/account`             | Bearer          | `{ password }`                       | 204               |

**Ràng buộc.** `email` tối đa 254 ký tự, tự chuyển chữ thường. Mật khẩu **mới** (đăng ký, đặt lại, đổi) từ 8
ký tự đến 72 byte; mật khẩu khi đăng nhập không kiểm tra độ dài.

**Phiên** là body dưới đây, kèm cookie `tv_refresh`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 900,
  "user": {
    "id": "fc94bb32-…",
    "email": "a@b.vn",
    "display_name": "Lan",
    "role": "user",
    "is_admin": false,
    "is_super_admin": false,
    "email_verified": true,
    "created_at": "2026-10-12T04:20:23.304Z"
  }
}
```

`display_name` là tên hiển thị tự đặt (tối đa 40 ký tự, không cần duy nhất, không dùng để đăng nhập); khoảng
trắng thừa bị cắt, chuỗi rỗng thành `null` (chưa đặt tên, giao diện hiện email). Thành viên nhóm (`members`) và
`GET /admin/users` cũng trả `display_name`; ô tìm `q` của trang quản trị tìm theo cả email lẫn tên.

`email_verified` đúng khi chủ email đã bấm link xác nhận (hoặc đặt lại mật khẩu qua email). Tài khoản tạo trước
khi có tính năng xác nhận email được coi là đã xác nhận.

`user.role` là `user`, `admin` hoặc `super_admin`; `is_admin` đúng với admin và super admin.

**`session`** (thiết bị đang đăng nhập): `{ id, user_agent, created_at, last_active_at, current }`. `current`
là thiết bị đang gọi. Thiết bị bị đăng xuất không gia hạn được nữa, nhưng access token nó đang giữ còn dùng
được tới khi hết hạn (tối đa 15 phút).

**Ghi chú từng endpoint.**

- `register`: khi **tắt** xác nhận email (`EMAIL_VERIFICATION=off`, mặc định) trả 201 phiên; email đã có trả 409
  `email_taken`. Khi **bật** (`EMAIL_VERIFICATION=required`) luôn trả 202
  `{ verification_required: true, email, message }`, không có phiên, dù email đã có tài khoản hay chưa (không dò
  được email nào đã đăng ký). Email gửi tới hộp thư đó: chưa có tài khoản thì tạo tài khoản chờ xác nhận và gửi
  link `APP_URL/#verify_token=...` (hết hạn sau `EMAIL_VERIFY_TTL_HOURS`, mặc định 24 giờ); đang chờ xác nhận
  thì gửi link mới mang mật khẩu vừa nhập (áp vào tài khoản khi bấm link); đã xác nhận thì gửi email "bạn đã có
  tài khoản". Mỗi tài khoản tối đa 1 email xác nhận / phút.
- `verify-email`: `token` lấy từ link trong email. Đúng thì kích hoạt tài khoản và trả phiên (đăng nhập luôn);
  mọi link khác của tài khoản đó hết tác dụng. Sai, hết hạn hoặc đã dùng trả 400 `invalid_verify_token`.
- `resend-verification`: luôn trả 202 `{ ok: true, message }` và chờ đủ thời gian tối thiểu; chỉ gửi khi tài
  khoản đang chờ xác nhận.
- `login`: sai email hoặc mật khẩu đều trả 401 `invalid_credentials`, cùng thời gian phản hồi. Đang bật xác nhận
  email mà tài khoản chưa xác nhận trả 403 `email_not_verified` (chỉ sau khi mật khẩu đúng).
- `refresh`: mỗi lần cấp refresh token mới, token cũ mất hiệu lực. Dùng lại token cũ (dấu hiệu bị trộm) thì cả
  phiên bị thu hồi; có ân hạn 10 giây cho hai tab refresh cùng lúc. Lỗi trả 401 `invalid_refresh_token` và xoá cookie.
- `forgot-password`: luôn trả 202 `{ ok: true, message }` và luôn chờ đủ thời gian tối thiểu, dù email có tồn
  tại hay không. Link gửi qua email có dạng `APP_URL/#reset_token=...`, dùng một lần, hết hạn sau 60 phút.
- `reset-password`, `PUT /auth/password`: đăng xuất mọi thiết bị khác. Token sai trả 400 `invalid_reset_token`;
  mật khẩu hiện tại sai trả 400 `invalid_current_password`.
- `DELETE /auth/account`: Xoá vĩnh viễn dữ liệu cá nhân. Chủ đề nhóm và từ trong chủ đề nhóm do người này tạo
  được chuyển cho trưởng nhóm khác; trưởng nhóm duy nhất thì người vào nhóm sớm nhất lên thay; nhóm chỉ có
  mỗi người này thì bị xoá. Super admin duy nhất không tự xoá được.

### Phiên đăng nhập

1. Mở app: gọi `POST /auth/refresh`. 200 là vẫn đăng nhập; 401 thì hiện màn đăng nhập.
2. Giữ `access_token` trong bộ nhớ (không dùng localStorage), gửi qua header `Authorization`.
3. API trả 401 `token_expired`: refresh một lần rồi gửi lại request. Nhiều request cùng hết hạn thì dùng chung
   một lần refresh.

## Chủ đề con `/decks`

| Method | Đường dẫn     | Body                                       | Thành công   |
| ------ | ------------- | ------------------------------------------ | ------------ |
| GET    | `/decks`      | —                                          | 200 `[deck]` |
| POST   | `/decks`      | `{ name, color?, group_id?, chapter_id? }` | 201 `deck`   |
| POST   | `/decks/bulk` | `{ decks: [{ name, color? }] }`            | 201 `[deck]` |
| PATCH  | `/decks/:id`  | `{ name?, color?, chapter_id? }`           | 200 `deck`   |
| DELETE | `/decks/:id`  | —                                          | 204          |

`deck`: `{ id, user_id, group_id, name, color, chapter_id, created_at }`. `chapter_id` là chủ đề (cấp trên) chứa chủ đề con
này (`null` = chưa thuộc chủ đề nào). Ở `PATCH`, gửi `chapter_id: null` để bỏ ra khỏi chủ đề; không gửi thì giữ nguyên. `name` 1–100 ký tự; `color` dạng `#RRGGBB`.
`group_id` có giá trị là chủ đề của nhóm (chỉ trưởng nhóm, admin tạo được). `bulk` tạo tối đa 200 chủ đề cá
nhân. `GET` trả chủ đề xem được (của mình và của nhóm mình), cũ trước mới sau. Xoá chủ đề thì từ và câu giao
tiếp bên trong chuyển về "chưa phân loại" (`deck_id = null`).

```json
{
  "id": "79049c08-…",
  "user_id": "fc94bb32-…",
  "group_id": null,
  "name": "Du lịch",
  "color": "#3366ff",
  "chapter_id": null,
  "created_at": "2026-10-12T04:20:23.513Z"
}
```

**Quyền.** Chủ đề cá nhân: chỉ chủ sở hữu. Chủ đề nhóm: thành viên xem và thêm từ; trưởng nhóm, admin, super
admin đổi tên, xoá chủ đề và sửa/xoá mọi từ bên trong.

## Chủ đề `/chapters`

Hai cấp: từ vựng nằm trong **chủ đề con** (`deck`), nhiều chủ đề con gom thành một **chủ đề** (`chapter`), VD chủ
đề "Unit 1" gồm các chủ đề con "Bài 1" … "Bài 10". Trong code và API vẫn gọi là `decks`/`chapters`.

| Method | Đường dẫn       | Body                  | Thành công      |
| ------ | --------------- | --------------------- | --------------- |
| GET    | `/chapters`     | —                     | 200 `[chapter]` |
| POST   | `/chapters`     | `{ name, group_id? }` | 201 `chapter`   |
| PATCH  | `/chapters/:id` | `{ name }`            | 200 `chapter`   |
| DELETE | `/chapters/:id` | —                     | 204             |

`chapter`: `{ id, user_id, group_id, name, created_at }`. `name` 1–100 ký tự. Phân quyền giống hệt chủ đề con:
chủ đề cá nhân chỉ chủ sở hữu thấy và sửa; chủ đề nhóm thì thành viên thấy, trưởng nhóm và admin tạo, đổi tên,
xoá. Xếp chủ đề con vào chủ đề bằng `chapter_id` ở `POST /decks` hoặc `PATCH /decks/:id`. Chỉ xếp được khi
**cùng phạm vi**: chủ đề con cá nhân vào chủ đề cá nhân của cùng người, chủ đề con của nhóm vào chủ đề của đúng
nhóm đó; sai thì 400 `chapter_scope_mismatch`. Chủ đề không xem được thì 400 `chapter_not_found`. Xoá chủ đề không
xoá chủ đề con nào: chúng về `chapter_id = null`. Số chủ đề mỗi tài khoản dùng chung hạn mức với chủ đề con
(`quotas.decks`).

## Từ vựng `/words`

| Method | Đường dẫn     | Body                                                                                | Thành công              |
| ------ | ------------- | ----------------------------------------------------------------------------------- | ----------------------- |
| GET    | `/words`      | query `limit?`, `cursor?`                                                           | 200 `[word]` hoặc trang |
| POST   | `/words`      | `{ word, meaning, meaning_en?, example?, ipa?, audio_url?, tags?, pos?, deck_id? }` | 201 `word`              |
| POST   | `/words/bulk` | `{ words: [ ... ] }`                                                                | 201 `[word]`            |
| PATCH  | `/words/:id`  | các field như POST, đều không bắt buộc                                              | 200 `word`              |
| DELETE | `/words/:id`  | —                                                                                   | 204                     |

**Ràng buộc.** `word` 1–200 ký tự; `meaning` (nghĩa tiếng Việt) 1–1000; `meaning_en` (nghĩa tiếng Anh, không bắt buộc) tối đa 1000; `example` tối đa 2000; `ipa` tối đa 200; `audio_url` tối
đa 2000 và phải bắt đầu bằng `http://` hoặc `https://` (hoặc rỗng); `tags` tối đa 30 nhãn, mỗi nhãn tối đa 50
ký tự, tự bỏ nhãn trùng (không phân biệt hoa/thường); `pos` (từ loại) là mảng mã trong danh sách `noun`,
`verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `determiner`, `article`, `interjection`,
`numeral`, `auxiliary`, `modal`, `phrasal_verb`, `idiom`, `abbreviation`, `prefix`, `suffix` (tự bỏ mã trùng,
mặc định `[]`); `deck_id` là UUID hoặc `null`. `bulk` nhận tối đa 1000
từ; một từ sai là từ chối cả lô. `deck_id` không xem được trả 400 `deck_not_found`.

`POST` trả từ vừa tạo (và tự tạo dòng tiến trình). `GET` trả từ xem được, mới trước cũ sau, **gộp sẵn tiến
trình học của chính người gọi**:

```json
{
  "id": "baffc5e5-…",
  "user_id": "fc94bb32-…",
  "deck_id": "79049c08-…",
  "word": "luggage",
  "meaning": "hành lý",
  "meaning_en": "bags and cases that you take with you when you travel",
  "example": "",
  "ipa": "",
  "audio_url": "",
  "tags": ["travel"],
  "pos": ["noun"],
  "created_at": "2026-10-12T04:20:23.532Z",
  "ease_factor": 2.5,
  "stability": null,
  "difficulty": null,
  "interval_days": 0,
  "repetitions": 0,
  "due_at": "2026-10-12T04:20:23.532Z",
  "last_reviewed_at": null,
  "ease_factor_rev": 2.5,
  "stability_rev": null,
  "difficulty_rev": null,
  "interval_days_rev": 0,
  "repetitions_rev": 0,
  "due_at_rev": "2026-10-12T04:20:23.532Z",
  "last_reviewed_at_rev": null,
  "quiz_correct": 0,
  "quiz_wrong": 0,
  "lapses": 0,
  "study_count": 0
}
```

Các field có đuôi `_rev` là lịch ôn chiều Việt → Anh; không đuôi là chiều Anh → Việt. `study_count` là số lần học
từ này (xem bên dưới).

## Tiến trình học `/progress`

| Method | Đường dẫn           | Body                      | Thành công                  |
| ------ | ------------------- | ------------------------- | --------------------------- |
| GET    | `/progress`         | query `limit?`, `cursor?` | 200 `[progress]` hoặc trang |
| PATCH  | `/progress/:wordId` | các field bên dưới        | 200 `progress`              |

Chỉ đọc/ghi tiến trình của chính mình, và chỉ cho từ mình xem được (404 nếu không). Chưa có dòng thì `PATCH`
tạo mới.

`progress`: `{ id, word_id, user_id, ease_factor, stability, difficulty, interval_days, repetitions, due_at,
last_reviewed_at, ease_factor_rev, stability_rev, difficulty_rev, interval_days_rev, repetitions_rev, due_at_rev,
last_reviewed_at_rev, quiz_correct, quiz_wrong, lapses, study_count }`.

`study_count`: số lần học từ này = số lượt ôn đã ghi qua `POST /review-log` (tab Học, Quiz, Chính tả, cả hai chiều).
Máy chủ tự cộng mỗi khi ghi lượt ôn; **không** ghi được qua `PATCH`. Frontend dùng nó để chia trạng thái: 0 = chưa
học, 1–19 = đang học, từ 20 = đã học.

Field ghi được: `ease_factor` (1–10), `stability` (0,001–36500 hoặc `null`), `difficulty` (1–10 hoặc `null`),
`interval_days` (0–36500), `repetitions`, `quiz_correct`, `quiz_wrong`,
`lapses` (số nguyên ≥ 0), `due_at`, `last_reviewed_at` (ISO, `last_reviewed_at` nhận `null`), cùng bộ `_rev`
tương ứng.

Lịch ôn do frontend tính bằng mô hình trí nhớ FSRS-6 (`tuvung-react/src/lib/fsrs.js`). `stability` là số ngày
đến khi khả năng nhớ còn 90%, `difficulty` là độ khó của thẻ với người học (1–10). `null` nghĩa là thẻ mới hoặc thẻ
học từ thời SM-2; khi đó lần chấm kế tiếp ước lượng từ `interval_days`/`ease_factor` cũ. `ease_factor` không còn
được cập nhật, chỉ giữ lại để có thể quay về SM-2.

## Nhật ký ôn `/review-log`

| Method | Đường dẫn           | Body / query                                                           | Thành công             |
| ------ | ------------------- | ---------------------------------------------------------------------- | ---------------------- |
| GET    | `/review-log`       | query `since?`                                                         | 200 `[entry]`          |
| GET    | `/review-log/daily` | query `since?`, `tz?`                                                  | 200 `[{ day, count }]` |
| POST   | `/review-log`       | `{ word_id \| phrase_id, quality, direction?, source?, reviewed_at? }` | 201 `entry`            |

`entry`: `{ id, word_id, phrase_id, quality, direction, source, reviewed_at }`.

- `quality`: 0 Quên, 1 Khó, 2 Tốt, 3 Dễ.
- Cần **đúng một** trong `word_id` hoặc `phrase_id`.
- `direction`: `recognition` (Anh → Việt, mặc định) hoặc `production` (Việt → Anh).
- `source`: `study` (mặc định), `quiz` hoặc `spelling`. FE chỉ tính lượt `study` của từ vào giới hạn thẻ mỗi
  ngày; mọi lượt đều tính vào mục tiêu ngày và chuỗi ngày học.
- `reviewed_at`: mặc định giờ server. Chỉ dùng khi đồng bộ lượt ôn lúc mất mạng; giá trị được giữ nếu nằm trong
  7 ngày gần nhất và không ở tương lai, ngoài khoảng đó thì dùng giờ server.

`GET /review-log` trả nhật ký của mình từ `since` (mặc định 90 ngày trước), mới nhất trước.
`GET /review-log/daily` trả số lượt ôn mỗi ngày từ `since` (mặc định 90 ngày), gộp theo ngày ở múi giờ `tz`
(tên IANA như `Asia/Ho_Chi_Minh`, mặc định `UTC`). Dùng cho chuỗi ngày học và biểu đồ.

```json
[{ "day": "2026-10-12", "count": 1 }]
```

## Cài đặt học `/settings`

| Method | Đường dẫn   | Body               | Thành công     |
| ------ | ----------- | ------------------ | -------------- |
| GET    | `/settings` | —                  | 200 `settings` |
| PUT    | `/settings` | các field bên dưới | 200 `settings` |

Chưa từng lưu thì `GET` trả giá trị mặc định.

| Field               | Kiểu      | Khoảng  | Mặc định           | Ý nghĩa                               |
| ------------------- | --------- | ------- | ------------------ | ------------------------------------- |
| `new_cards_per_day` | số nguyên | 0–200   | 5                  | Từ mới mỗi ngày (0 = tạm dừng từ mới) |
| `session_size`      | số nguyên | 3–50    | 10                 | Số thẻ mỗi phiên học                  |
| `daily_goal`        | số nguyên | 1–500   | 20                 | Mục tiêu lượt ôn mỗi ngày             |
| `reviews_per_day`   | số nguyên | 10–1000 | 100                | Thẻ ôn lại tối đa mỗi ngày            |
| `reminder_enabled`  | boolean   |         | `false`            | Bật nhắc học hằng ngày                |
| `reminder_hour`     | số nguyên | 0–23    | 20                 | Giờ nhắc, theo múi giờ bên dưới       |
| `reminder_tz`       | chuỗi     | IANA    | `Asia/Ho_Chi_Minh` | Múi giờ của người học                 |

BE chỉ lưu các con số; việc chia phiên và áp giới hạn do FE làm (`lib/studyQueue.js`).

## Nhắc học `/push`

| Method | Đường dẫn           | Body                                   | Thành công                      |
| ------ | ------------------- | -------------------------------------- | ------------------------------- |
| GET    | `/push/public-key`  | —                                      | 200 `{ enabled, public_key }`   |
| POST   | `/push/subscribe`   | `{ endpoint, keys: { p256dh, auth } }` | 201 `{ ok: true }`              |
| POST   | `/push/unsubscribe` | `{ endpoint }`                         | 204                             |
| POST   | `/push/test`        | —                                      | 200 `{ sent, failed, removed }` |

Mỗi thiết bị/trình duyệt một đăng ký (Web Push). `enabled: false` nghĩa là máy chủ chưa cấu hình khoá VAPID:
`subscribe` và `test` khi đó trả 503 `push_not_configured`. `test` gửi một thông báo thử tới mọi thiết bị của
mình; không còn đăng ký nào hoạt động thì trả 409 `no_active_subscription`. Lời nhắc thật do job
`npm run reminders` gửi theo `reminder_hour` / `reminder_tz`.

## Câu giao tiếp `/phrases`

| Method | Đường dẫn               | Body                                                                                    | Thành công     |
| ------ | ----------------------- | --------------------------------------------------------------------------------------- | -------------- |
| GET    | `/phrases`              | —                                                                                       | 200 `[phrase]` |
| POST   | `/phrases`              | `{ phrase, meaning, usage_context?, example?, formality?, deck_id? }`                   | 201 `phrase`   |
| PATCH  | `/phrases/:id`          | các field như POST, đều không bắt buộc                                                  | 200 `phrase`   |
| PATCH  | `/phrases/:id/progress` | `{ stability?, difficulty?, interval_days?, repetitions?, due_at?, last_reviewed_at? }` | 200 tiến trình |
| DELETE | `/phrases/:id`          | —                                                                                       | 204            |

Sổ tay **cá nhân**: chỉ chủ sở hữu xem, sửa, xoá (kể cả trưởng nhóm hay super admin cũng không thấy).
`phrase` 1–500 ký tự; `meaning` 1–1000; `usage_context`, `example` tối đa 2000; `formality` là `formal`,
`informal` hoặc `neutral` (mặc định); `deck_id` phải là chủ đề mình xem được.

`phrase`: `{ id, user_id, deck_id, phrase, meaning, usage_context, example, formality, created_at }`. `GET` gộp
sẵn `ease_factor, stability, difficulty, interval_days, repetitions, due_at, last_reviewed_at`, mới nhất trước.
`PATCH …/progress` trả `{ id, phrase_id, user_id, ease_factor, stability, difficulty, interval_days, repetitions,
due_at, last_reviewed_at }`. Body vẫn nhận `ease_factor` để tương thích với bản cũ.

## Bài đọc `/readings`

| Method | Đường dẫn       | Body                                   | Thành công      |
| ------ | --------------- | -------------------------------------- | --------------- |
| GET    | `/readings`     | —                                      | 200 `[reading]` |
| POST   | `/readings`     | `{ title?, content?, notes? }`         | 201 `reading`   |
| PATCH  | `/readings/:id` | các field như POST, đều không bắt buộc | 200 `reading`   |
| DELETE | `/readings/:id` | —                                      | 204             |

Trang "Đọc & ghi chú": một đoạn văn / bài văn / hội thoại kèm ghi chú người học trích ra. Sổ tay **cá nhân**
như câu giao tiếp. `title` tối đa 200 ký tự; `content` tối đa 50.000; `notes` tối đa 300 mục, mỗi mục
`{ id, type, text, meaning?, explanation?, example?, saved_to? }`: `type` là `word`, `grammar` hoặc `phrase`;
`text` 1–500 ký tự; `meaning` tối đa 1000; `explanation`, `example` tối đa 2000; `saved_to` là
`{ kind: 'word' | 'phrase', id }` khi ghi chú đã được thêm vào Sổ từ / Câu giao tiếp, hoặc `null`. `PATCH` với
`notes` thay **cả danh sách**.

`reading`: `{ id, user_id, title, content, notes, created_at, updated_at }`, sửa gần nhất trước.

## Nhóm học tập `/groups`

| Method | Đường dẫn                     | Ai được gọi                                         | Body       | Thành công            |
| ------ | ----------------------------- | --------------------------------------------------- | ---------- | --------------------- |
| GET    | `/groups`                     | mọi người (nhóm mình tham gia; admin thấy mọi nhóm) | —          | 200 `[group]`         |
| POST   | `/groups`                     | mọi người; người tạo thành trưởng nhóm              | `{ name }` | 201 `group`           |
| POST   | `/groups/join`                | mọi người                                           | `{ code }` | 200 `group`           |
| PATCH  | `/groups/:id`                 | trưởng nhóm, admin                                  | `{ name }` | 200 `group`           |
| POST   | `/groups/:id/invite-code`     | trưởng nhóm, admin; mã cũ mất hiệu lực ngay         | —          | 200 `{ invite_code }` |
| PATCH  | `/groups/:id/members/:userId` | trưởng nhóm, admin                                  | `{ role }` | 200 `group`           |
| DELETE | `/groups/:id/members/:userId` | chính mình (rời nhóm); trưởng nhóm, admin (mời ra)  | —          | 204                   |
| GET    | `/groups/:id/stats`           | trưởng nhóm, admin                                  | —          | 200 `[stats]`         |
| GET    | `/groups/:id/progress`        | trưởng nhóm, admin (bản cũ, giữ cho FE cũ)          | —          | 200 `[progress]`      |

"Admin" ở bảng này gồm cả admin và super admin toàn hệ thống. `name` 1–100 ký tự; `role` là `admin` (trưởng
nhóm) hoặc `member`; `code` là mã mời 8 ký tự, không phân biệt hoa/thường.

```json
{
  "id": "121d0f05-…",
  "name": "Lớp 10A",
  "created_by": "fc94bb32-…",
  "created_at": "2026-10-12T04:20:23.694Z",
  "invite_code": "kxac5j7n",
  "my_role": "admin",
  "members": [{ "user_id": "fc94bb32-…", "role": "admin", "joined_at": "2026-10-12T04:20:23.694Z", "email": "a@b.vn" }]
}
```

- `invite_code`: chỉ trưởng nhóm và admin thấy; thành viên thường nhận `null`.
- `members`: trưởng nhóm và admin thấy cả nhóm kèm email; thành viên thường chỉ thấy chính mình.
- `my_role`: `admin`, `member`, hoặc `null` nếu là admin hệ thống không tham gia nhóm.

`stats`: một dòng cho mỗi thành viên hiện tại, chỉ tính trên từ trong chủ đề của nhóm:
`{ user_id, total_words, started, due, quiz_correct, quiz_wrong, last_reviewed_at }`.

**Nhóm luôn có trưởng nhóm.** Trưởng nhóm duy nhất không rời nhóm, không bị mời ra, không bị hạ vai trò khi nhóm
còn thành viên khác (409 `last_admin`). Mã mời sai trả 404 `not_found`.

## Quản trị `/admin`

Chỉ **super admin** gọi được; người khác nhận 403 `forbidden`.

| Method | Đường dẫn          | Body / query                      | Thành công                   |
| ------ | ------------------ | --------------------------------- | ---------------------------- |
| GET    | `/admin/overview`  | query `days?` (7–90, mặc định 30) | 200 `overview`               |
| GET    | `/admin/users`     | query `q?`, `limit?`, `cursor?`   | 200 `{ items, next_cursor }` |
| PATCH  | `/admin/users/:id` | `{ role?, disabled? }`            | 200 `user`                   |
| DELETE | `/admin/users/:id` | —                                 | 204                          |

`overview` chỉ có số gộp toàn hệ thống, được nhớ 60 giây:
`{ generated_at, time_zone, totals: { users, admins, disabled_users, groups, decks, words, phrases },
new_users: { last_7_days, last_30_days }, active_users: { today, last_7_days, last_30_days },
reviews: { today, last_7_days }, daily: [...] }`.

`user` ở đây: `{ id, email, role, is_admin, is_super_admin, created_at, disabled_at, word_count, last_active_at }`.
`q` tìm theo email (chứa chuỗi). `role` là `user` hoặc `admin` (super admin chỉ cấp bằng SQL). `disabled: true`
khoá tài khoản ngay: mọi phiên bị thu hồi, mọi endpoint trả 403 `account_disabled`.

Super admin không tự thao tác trên mình và không thao tác trên super admin khác (403).

## Kiểm tra sức khoẻ `/health`

| Method | Đường dẫn    | Thành công                                   | Lỗi                                                |
| ------ | ------------ | -------------------------------------------- | -------------------------------------------------- |
| GET    | `/health`    | 200 `{ status: "ok" }` (không chạm database) | —                                                  |
| GET    | `/health/db` | 200 `{ status: "ok", database: "ok" }`       | 503 `{ status: "error", database: "unreachable" }` |

## Mã lỗi

| HTTP | `code`                     | Khi nào                                                        |
| ---- | -------------------------- | -------------------------------------------------------------- |
| 400  | `validation_error`         | Body/query sai; `details` liệt kê từng field                   |
| 400  | `invalid_json`             | Body không phải JSON hợp lệ                                    |
| 400  | `invalid_cursor`           | Con trỏ phân trang sai                                         |
| 400  | `deck_not_found`           | `deck_id` không tồn tại hoặc không xem được                    |
| 400  | `group_not_found`          | `group_id` khi tạo chủ đề không tồn tại                        |
| 400  | `chapter_not_found`        | `chapter_id` không tồn tại hoặc không xem được                 |
| 400  | `chapter_scope_mismatch`   | Chủ đề con và chủ đề không cùng phạm vi (cá nhân / cùng nhóm)  |
| 400  | `invalid_time_zone`        | Múi giờ `tz` không hợp lệ                                      |
| 400  | `invalid_reset_token`      | Token đặt lại mật khẩu sai, hết hạn hoặc đã dùng               |
| 400  | `invalid_verify_token`     | Link xác nhận email sai, hết hạn hoặc đã dùng                  |
| 400  | `invalid_current_password` | Mật khẩu hiện tại sai (đổi mật khẩu, xoá tài khoản)            |
| 401  | `invalid_credentials`      | Sai email hoặc mật khẩu                                        |
| 401  | `token_expired`            | Access token hết hạn: refresh rồi thử lại                      |
| 401  | `invalid_token`            | Thiếu hoặc sai access token                                    |
| 401  | `invalid_refresh_token`    | Cookie refresh thiếu, sai, hết hạn hoặc bị thu hồi             |
| 403  | `forbidden`                | Xem được nhưng không có quyền làm thao tác này                 |
| 403  | `account_disabled`         | Tài khoản đã bị khoá                                           |
| 403  | `email_not_verified`       | Đăng nhập khi tài khoản chưa bấm link xác nhận email           |
| 404  | `not_found`                | Không tồn tại, hoặc không có quyền xem; endpoint không tồn tại |
| 409  | `email_taken`              | Email đã có tài khoản                                          |
| 409  | `quota_exceeded`           | Vượt hạn mức dữ liệu của tài khoản                             |
| 409  | `last_admin`               | Thao tác làm nhóm mất trưởng nhóm cuối cùng                    |
| 409  | `no_active_subscription`   | Gửi thử nhắc học nhưng thiết bị chưa đăng ký                   |
| 413  | `payload_too_large`        | Body lớn hơn 2 MB                                              |
| 429  | `rate_limited`             | Gọi quá giới hạn tần suất                                      |
| 500  | `internal_error`           | Lỗi máy chủ ngoài dự kiến (chi tiết chỉ ghi ở log server)      |
| 503  | `push_not_configured`      | Máy chủ chưa cấu hình khoá VAPID                               |
