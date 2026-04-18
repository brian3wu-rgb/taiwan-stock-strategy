# ── Stage 1: 依賴安裝 ─────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# 安裝系統依賴（lxml 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: 執行映像 ─────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# 從 builder 複製已安裝的套件
COPY --from=builder /install /usr/local

# 系統執行時依賴
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

# 複製原始碼
COPY . .

# 建立資料庫目錄
RUN mkdir -p /app/data

# 非 root 使用者（安全性）
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# 生產模式：單執行緒 worker（掃描使用 asyncio，不需多 worker）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
