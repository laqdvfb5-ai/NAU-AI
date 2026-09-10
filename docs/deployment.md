# Triển khai và vận hành

## Local

Node.js 24+, npm workspaces. `npm run setup`, `npm run dev`. PostgreSQL nhúng lưu ở `.data/postgres`, chỉ cho một API process sử dụng. Worker local chạy trong cùng tiến trình và không cần Redis. Tài liệu PDF có text đọc bằng PDF.js; OCR cần `pdftoppm` và `tesseract` có ngôn ngữ `vie+eng`. Thiếu OCR sẽ hiện nguồn chưa đọc được, không đưa nội dung rỗng vào tra cứu.

Các cổng: web 3000, API 4000. Dùng `localhost:3000` đúng `WEB_ORIGIN`. Có thể đổi cổng/tên miền bằng env, đồng thời đổi origin và địa chỉ proxy phù hợp. Web rewrite `API_INTERNAL_URL` được xác định khi build; thay địa chỉ này cần build lại.

## Docker Compose trên VPS Ubuntu

Bản pilot nên bắt đầu với Ubuntu 24.04 LTS, 4 vCPU, RAM 8 GB và SSD 100 GB. Khoảng 3.000 sinh viên nên benchmark từ 8 vCPU, RAM 16 GB và SSD 200 GB. Đây là mức khởi điểm để đo, không phải cam kết tải. Cài Docker Engine và Compose plugin từ kho `apt` chính thức theo [hướng dẫn Docker cho Ubuntu](https://docs.docker.com/engine/install/ubuntu/); không cần cài Node.js hoặc npm trên host.

Trước khi triển khai, tạo bản ghi DNS A/AAAA của tên miền về VPS và cho phép TCP 80/443 cùng UDP 443 ở firewall của nhà cung cấp. Không dùng IPv4 thô làm `DOMAIN`: Caddy sẽ phải dùng CA nội bộ, trình duyệt không tin chứng chỉ, trong khi cookie production yêu cầu HTTPS. Nếu chưa có tên miền, có thể dùng hostname tạm chứa IP do [sslip.io](https://sslip.io/) phân giải, ví dụ `203-0-113-10.sslip.io`, rồi thay bằng subdomain của trường sau. Docker cảnh báo cổng container được publish có thể đi vòng một số quy tắc UFW; Compose này chỉ publish Caddy trên 80/443, còn PostgreSQL, Redis, API và web chỉ ở mạng nội bộ.

### Tạo và chuyển gói release

Trên máy Windows hiện tại:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/package-release.ps1
Get-FileHash reports/releases/nau-ai-vps-*.tar.gz -Algorithm SHA256
scp reports/releases/nau-ai-vps-YYYYMMDD-HHMMSS.tar.gz ubuntu@IP_VPS:/tmp/
```

Script đóng gói loại `.env`, `.data`, `node_modules`, output build, log, backup và báo cáo cục bộ. Kiểm tra SHA-256 sau khi chuyển file. Trên VPS:

```sh
sudo mkdir -p /opt/nau-ai
sudo tar -xzf /tmp/nau-ai-vps-YYYYMMDD-HHMMSS.tar.gz -C /opt/nau-ai
sudo chown -R "$USER":"$USER" /opt/nau-ai
cd /opt/nau-ai
sh deploy/prepare-env.sh ai.ten-mien-truong.vn
```

`prepare-env.sh` tạo hoặc bổ sung `.env`, sinh giá trị hex cho secret còn trống, đặt quyền `600` và không in secret. Nó giữ nguyên `SESSION_SECRET`, mật khẩu và cấu hình model đã có. Trước lần chạy đầu, mở `.env` để kiểm tra `DATA_MODE`, demo login, ngân sách và retention. Có thể xem mật khẩu pilot ngay trên máy chủ bằng `grep -E '^(DEMO_PASSWORD|ADMIN_PASSWORD)=' .env`; không gửi file này qua kênh công khai.

### Kiểm tra và khởi động

```sh
cd /opt/nau-ai
sh deploy/preflight.sh
sh deploy/up.sh
docker compose ps
docker compose logs --tail=100 api web caddy
curl --fail --silent --show-error https://ai.ten-mien-truong.vn/api/v1/health
```

Preflight chặn domain/secret rỗng, mật khẩu PostgreSQL không an toàn cho URL, cấu hình demo mâu thuẫn với dữ liệu thật và Compose không hợp lệ. `up.sh` build image, khởi động theo thứ tự health check rồi đợi endpoint HTTPS công khai. PostgreSQL, Redis, API và web đều có health check; log Docker được xoay ở 5 file × 10 MB cho mỗi service.

Database PostgreSQL mới tự tạo schema và 120 hồ sơ khi `DATA_MODE=synthetic`. Cấu hình ProxyLLM trong `/admin/api-pool` hiện nằm ở database PGlite local và không nằm trong gói release. Sau lần deploy đầu, đăng nhập quản trị trên VPS, tạo lại provider, tải model, gửi thử completion, nhập giá 5 USD input/30 USD output mỗi triệu token cho cấu hình đã xác nhận, rồi chọn route chat. Không bật route nếu completion test chưa đạt.

Giữ nguyên `SESSION_SECRET` trong mọi lần cập nhật và khôi phục: giá trị này dùng để mã hóa API key của pool và định danh chủ hội thoại. Nếu migrate PostgreSQL sang máy khác, chuyển cả database và đúng secret; nếu không, phải nhập lại key và hội thoại cũ không còn ánh xạ đúng chủ sở hữu.

Caddy [tự cấp HTTPS](https://caddyserver.com/docs/automatic-https) khi DNS và cổng 80/443 truy cập được, chuyển `/api/*` thẳng tới API và flush stream ngay. Production dùng cookie Secure nên đăng nhập qua HTTP thuần không hoạt động. Caddy ghi đè `X-Forwarded-For`, API chỉ tin một proxy hop. Nếu thêm proxy/CDN phía trước, phải rà lại trust proxy, IP rate limit và chế độ TLS.

Dockerfile dùng Node 24, build Next standalone, chạy API và web bằng user không phải root, đồng thời cài Poppler/Tesseract `vie+eng` cho OCR. Worker BullMQ nằm trong API với concurrency 2. Redis giữ hàng đợi; dữ liệu nghiệp vụ, pool và ngân sách nằm trong PostgreSQL.

**Máy phát triển hiện tại không có Docker nên image, Compose, HTTPS và OCR trong container phải được xác nhận bằng `preflight.sh`/`up.sh` trên VPS staging.** Next production build và các route desktop/mobile đã được kiểm tra riêng trên máy phát triển.

### Cập nhật và quay lui

Trước mỗi cập nhật, chạy `sh scripts/backup.sh`, lưu `.env` trong kho bí mật và giữ gói release đang chạy. Sau đó giải nén bản mới vào `/opt/nau-ai`, giữ nguyên `.env`, chạy lại preflight và `up.sh`. Nếu health check thất bại, xem `docker compose logs`; khôi phục mã release trước rồi build/up lại. Không xóa named volumes khi quay lui. Thay đổi schema hiện chạy idempotent lúc API khởi động nhưng chưa có migration rollback tự động, vì vậy phải thử bản cập nhật với bản sao database trong staging trước.

## Cập nhật kiến thức

1. Đăng nhập quản trị, thêm URL hoặc khám phá liên kết từ website chính thức.
2. Tải/kiểm tra cập nhật. Nội dung mới vào trạng thái chờ duyệt; tài liệu quét được OCR nếu công cụ khả dụng.
3. Mở tài liệu gốc, kiểm tra văn bản/phiên bản/khóa áp dụng/trang/điều. Chỉ duyệt đoạn sạch, không có danh sách điểm/hồ sơ.
4. Nếu cấu hình embedding, tạo lại chỉ mục sau khi duyệt và sau khi đổi model/kích thước.
5. Xem nguồn lỗi/chưa đọc được và chủ đề còn thiếu. Khám phá liên kết có giới hạn và không đồng nghĩa đã thu thập toàn bộ website.

Thay đổi tài liệu được phát hiện bằng SHA-256. Khi nội dung thay đổi, nguồn bị gỡ khỏi truy vấn đến khi duyệt lại. Lịch sử phiên bản được giữ trong `source_versions`. Nguồn lỗi không dùng để tạo kết luận mới. Nội dung HTML loại script/form/navigation; PDF không thực thi JavaScript. Chuỗi trong tài liệu luôn là dữ liệu, không có quyền gọi API hay đổi danh tính.

## Lưu trữ, sao lưu và bảo trì

`RETENTION_DAYS=30` điều khiển xóa hội thoại không cập nhật quá số ngày này; messages được cascade. Phiên hết hạn, OIDC state hết hạn và feedback không còn hội thoại được dọn hằng ngày và khi khởi động. Audit giữ gấp 3 lần số ngày hội thoại. Usage chỉ chứa số token/chi phí và model, không chứa câu hỏi/hồ sơ. Source/version public được giữ phục vụ đối soát.

```sh
sh scripts/backup.sh
# Ví dụ lịch cron hằng ngày, từ thư mục repo:
# 15 2 * * * cd /opt/nau-ai && sh scripts/backup.sh
```

Backup PostgreSQL dạng custom tại `backups/`, quyền đọc hạn chế. Cần mã hóa và chuyển bản sao sang vị trí độc lập theo chính sách trường. Script không tự xóa bản cũ. Sao lưu `.env`/OIDC mapping riêng bằng kho bí mật, không bỏ vào backup công khai. Giữ Caddy volume để không xin chứng chỉ lại thường xuyên.

Khôi phục thử vào **database trống biệt lập**:

```sh
docker compose exec -T postgres createdb -U nau nau_ai_restore_check
docker compose exec -T postgres pg_restore -U nau -d nau_ai_restore_check < backups/TEN-BAN-SAO.dump
docker compose exec -T postgres psql -U nau -d nau_ai_restore_check -c 'SELECT count(*) FROM students;'
```

Không ghi đè database đang vận hành khi chưa có lịch bảo trì và bản sao được kiểm tra. Khi nâng phiên bản PostgreSQL cần quy trình migration/restore tương ứng; không thay tag major rồi mở lại volume cũ.

## Trước khi đưa dữ liệu thật vào dùng

- Có API/SSO/ánh xạ tài khoản được trường cấp; adapter kiểm tra đúng ID và schema, không fallback sang fake.
- Quy chế, quy tắc chuyển tiếp, đề cương/PI và chương trình được xác nhận theo từng khóa; kiểm thử biên và mâu thuẫn đạt.
- Tắt demo login; thiết lập `DATA_MODE=real`; cập nhật nhãn giao diện theo giai đoạn triển khai thật và chính sách lưu trữ.
- Đánh giá 200+ câu hỏi do người phụ trách kiểm tra, đo model thật, OCR thật và phục hồi backup trong staging.
- Kiểm thử tải trên VPS với model/embedding/Redis/PostgreSQL cấu hình thực tế, ngân sách và giới hạn phù hợp lưu lượng.

AI nội bộ: Qwen3.5 9B lượng tử hóa có thể bắt đầu thử với GPU 24 GB/RAM 64 GB/CPU 12 nhân/NVMe 1 TB; 27B FP8 với GPU 48 GB/RAM 128 GB/CPU 16 nhân/NVMe 2 TB. Đều cần benchmark độ trễ, context và concurrency. [Ollama 9B](https://ollama.com/library/qwen3.5:9b), [Qwen 27B FP8](https://huggingface.co/Qwen/Qwen3.5-27B-FP8).
