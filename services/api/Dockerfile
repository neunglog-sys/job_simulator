FROM python:3.11-slim

WORKDIR /app

# ffmpeg — Colab의 조각난 HLS를 연속 타임라인 HLS로 재인코딩(끊김 제거)하는 데 사용
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
# 아바타 소스 이미지 — 발화 요청마다 GPU 서버로 업로드한다
COPY assets ./assets

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
