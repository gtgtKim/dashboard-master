# PMK Drive

팀이 Excel, PowerPoint, PDF 등 모든 형식의 파일을 폴더로 정리하고 공유하는 웹 앱입니다.
운영 주소: https://34.47.71.229/pmk_drive/

## 기능

- 중첩 폴더, 이름 변경, 이동, 검색, 형식 필터, 정렬, 목록/격자 보기
- 여러 파일 업로드, 드래그 앤 드롭, 진행률, 일시정지, 재개, 취소
- 개별 다운로드, 다중 선택 다운로드, 중요 파일, 최근 파일
- 하위 항목을 포함한 휴지통 이동과 복원
- 만료 기간 1/7/30일의 파일 공유 링크, 링크 해제
- 계정 로그인, 관리자에 의한 팀원 추가. 모든 계정은 하나의 팀 공간을 공동 관리합니다.
- 모바일 레이아웃과 키보드 검색 단축키 `/`
- 한국어/영어 선택(로그인·파일 관리·공유 화면), 언어 설정 저장. 전환 중 업로드·검색·선택 상태 유지
- 로그인 화면은 로고, 언어 선택, 아이디, 비밀번호, 로그인 버튼만 표시

파일 내용의 브라우저 내 편집, Office 미리보기, 버전 관리, 개인별 폴더 ACL, 폴더 ZIP 다운로드는 이 버전의 범위에 포함하지 않습니다. 휴지통은 자동 삭제되지 않으며 파일 저장 용량을 계속 사용합니다.

## 운영 구성

```
브라우저 ── HTTPS /pmk_drive/ ── Nginx ── FastAPI (127.0.0.1:4178)
    │                                       │
    └── 서명 URL로 조각 PUT/파일 GET ── GCS   └── SQLite (폴더·사용자·공유·진행 상태)
```

- GCP project: `gyutae-test-project`
- GCS: `gs://gyutae-test-project-pmk-drive`, Seoul (`asia-northeast3`), Standard
- Public access prevention + uniform bucket-level access
- Service account: `pmk-drive-storage@gyutae-test-project.iam.gserviceaccount.com`; 해당 버킷의 objectAdmin만 부여
- Linux service: `pmk-drive.service` / user `pmk-drive` / memory limit 512 MB
- Source release: `/opt/pmk_drive/current`
- Metadata DB: `/var/lib/pmk-drive/drive.sqlite3` (SQLite WAL, 영구 디렉터리)
- Runtime config: `/etc/pmk-drive/app.env` (root-only); storage key: `/etc/pmk-drive/storage-key.json` (root:pmk-drive 0640)
- Nginx: 기존 HTTPS server에 `deploy/nginx-location.conf` 블록만 추가

운영 초기 관리자는 `admin`입니다. 기존 `/pmk_hvc`의 PBKDF2 검증 값을 복사해 같은 비밀번호로 로그인하도록 설정했습니다. 기존 서비스의 비밀번호나 세션을 변경하지 않습니다. 이후 두 서비스의 비밀번호 변경은 자동 동기화되지 않습니다. 별도 계정은 오른쪽 상단 계정 메뉴 → 팀원 계정 추가에서 만듭니다.

## 업로드와 대용량 처리

기본 파일 한도는 100 GiB이며 `MAX_FILE_SIZE`로 설정합니다. 최소 8 MiB의 조각으로 나누고 최대 10,000개 이내가 되도록 크기를 조정합니다. 브라우저는 세 조각을 병렬 전송하며 네트워크 오류를 최대 세 번 재시도합니다. 파일 전체를 앱 서버 메모리나 디스크에 적재하지 않습니다.

GCS에서는 15분 유효한 서명 URL로 임시 조각을 직접 업로드합니다. 서버는 실제 저장된 조각 수·크기·generation을 검사한 후 최대 32개씩 단계적으로 compose하고 임시 조각을 삭제합니다. 최종 오브젝트가 준비되어야 파일 목록에 노출합니다. 완료 요청은 재시도할 수 있습니다. 임시 업로드 조각에는 7일 삭제 lifecycle을 적용합니다. 오래 중단된 파일은 다시 선택하면 없는 조각을 재전송합니다. GCS 기본 soft-delete 정책의 보존 기간 동안 삭제된 임시 조각에도 저장 비용이 발생할 수 있습니다.

새로고침 후 미완료 업로드가 표시됩니다. **같은 파일을 재선택**하면 이미 저장된 조각부터 확인해 이어서 올립니다. 파일 식별자는 이름·크기·수정 시각·처음과 끝 부분의 SHA-256으로 구성되므로 원본 파일을 변경하지 않은 상태에서 재개해야 합니다. 브라우저를 닫으면 전송은 중단됩니다.

다운로드는 60초 유효한 서명 URL로 GCS에서 직접 받습니다. 공유 링크를 해제하면 새 다운로드를 요청할 수 없으며 이미 발급된 다운로드 URL은 최대 60초간 유효할 수 있습니다. 취소 후에도 이미 발급된 조각 URL은 15분 동안 유효하지만, 취소한 파일은 등록되지 않으며 남은 조각은 lifecycle로 제거됩니다.

Google Cloud Storage의 [compose](https://docs.cloud.google.com/storage/docs/composing-objects)와 [composite object](https://docs.cloud.google.com/storage/docs/composite-objects) API를 사용합니다. `STORAGE_BACKEND=s3` 설정에서는 S3 multipart/presigned URL도 지원합니다. 채워진 설치의 backend 또는 bucket을 변경하려면 기존 오브젝트를 함께 이관해야 합니다.

## 로컬 실행

Python 3.12 이상:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# .env의 PMK_ADMIN_PASSWORD에 12자 이상의 비밀번호 설정
.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8090
```

http://127.0.0.1:8090/pmk_drive/ 에서 로그인합니다. 기본 local backend는 `data/`에 파일을 스트리밍 저장합니다. `.env`, 비밀키, 데이터베이스를 Git에 올리지 마세요. 운영 GCS 키는 로컬 테스트에 필요하지 않습니다.

## 검증

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
node --check app/static/app.js
```

테스트는 인증·CSRF·팀원 권한, 업로드 소유자 격리, 분할 업로드 재개와 크기 검증, 0바이트 파일, 바이트/Range 다운로드, 폴더 순환 방지, 충돌 시 원자적 복원, 공유 만료·해제, S3 multipart 통합을 다룹니다. 프로덕션 GCS는 실제 브라우저 및 다운로드 해시 검증으로 별도 확인합니다.

## 배포 및 백업

검증된 소스를 `/opt/pmk_drive/releases/<release-id>`로 전송한 후 `sudo python3 deploy/install.py`를 실행합니다. 초기 설치 전에 전용 GCS credential을 배치합니다. 설치 스크립트는 환경 파일을 덮어쓰지 않으며, 기존 Nginx 내용을 백업하고 지정 블록만 추가합니다. 실패 시 기존 링크와 Nginx를 복구합니다. 이 앱만 변경할 때 저장소의 `deploy-all.sh`를 실행할 필요가 없습니다.

현재 메타데이터는 단일 VM의 SQLite에 저장합니다. 다음 온라인 백업 방법으로 파일 저장소와 **메타데이터를 함께 보존**해야 폴더 구조와 계정을 복구할 수 있습니다. 백업 작업을 자동 실행하는 스케줄은 별도로 설정해야 합니다.

```sh
sudo -u pmk-drive /opt/pmk_drive/venv/bin/python -c 'import sqlite3; a=sqlite3.connect("/var/lib/pmk-drive/drive.sqlite3"); b=sqlite3.connect("/var/lib/pmk-drive/backup.sqlite3"); a.backup(b); b.close(); a.close()'
```

여러 앱 인스턴스로 확장하려면 SQLite를 PostgreSQL 등으로 이전해야 합니다. 원본 파일명은 오브젝트 경로나 로컬 경로로 사용하지 않으며 UUID 키로 저장합니다. 세션·공유 토큰은 해시로 저장하고, 쿠키는 HTTPS에서 Secure/HttpOnly/SameSite=Strict로 발급합니다. 사설 파일을 HTML로 inline 렌더링하지 않고 attachment로 다운로드합니다.

## 언어 UI 검증

테스트용 로컬 서버 실행 후 Playwright와 Chrome이 있는 환경에서 `node tests/localization.cjs`를 실행합니다. 기본 테스트 계정은 `admin` / `test-password-12345`이며 전용 테스트 데이터 디렉터리를 사용하세요. 다른 테스트 환경은 `PLAYWRIGHT_BASE_URL`, `PMK_TEST_USERNAME`, `PMK_TEST_PASSWORD`, `PMK_TEST_OUTPUT`으로 지정합니다. 입력값 보존, 언어 설정 유지, API 오류 번역, 업로드 중 언어 전환, 원본 파일명 보존, 공유 화면과 모바일 레이아웃을 확인합니다.
