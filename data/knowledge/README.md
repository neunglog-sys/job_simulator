# 직무 지식 자료 (RAG)

직무별 자료를 이 폴더에 넣으면 서버 재기동 시 자동으로 벡터 DB에 적재됩니다.

## 사용법 (데이터 팀)

1. `knowledge/<직무코드>/` 폴더에 `.md` 또는 `.txt` 파일 추가
   - 직무코드는 `data/jobs/*.yaml`의 `code`와 일치해야 함 (예: `backend-developer`)
2. `docker compose restart api` → 새 파일/변경된 파일만 임베딩됨 (변경 없으면 스킵)
3. 확인: `GET /api/jobs/<직무코드>/knowledge?q=검색어` (Swagger: localhost:8000/docs)

## 자료 작성 팁

- 문단(빈 줄) 단위로 잘리므로, 주제가 바뀌면 문단을 나눌 것
- 출처가 있는 자료는 파일 하단에 출처 명시
- 나중에 시뮬레이션 게임의 NPC가 이 지식을 바탕으로 대답하게 됨
