FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./

EXPOSE 8000
CMD ["sh", "-c", "python -m app.init_db && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"]
