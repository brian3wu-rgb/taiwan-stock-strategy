# 台股策略選股系統

自動掃描台股（上市 + 上櫃），找出符合「**均線交叉 + K線反轉 + 量能確認**」條件的標的，並提供互動式技術分析圖表。

---

## 策略邏輯

### 做多訊號 (LONG)
| 條件 | 說明 |
|------|------|
| 均線交叉區 | `\|MA5 - MA100\| / MA100 < 2%` |
| 紅 K | 收盤 > 開盤 |
| 突破昨高 | 收盤 > 昨日最高價 |
| 站上均線 | 收盤 > MA5 且 > MA100 |
| 量能確認 | 當日成交量 > 20 日均量 |

### 做空訊號 (SHORT)
| 條件 | 說明 |
|------|------|
| 均線交叉區 | `\|MA5 - MA100\| / MA100 < 2%` |
| 黑 K | 收盤 < 開盤 |
| 跌破昨低 | 收盤 < 昨日最低價 |
| 跌破均線 | 收盤 < MA5 且 < MA100 |
| 量能確認 | 當日成交量 > 20 日均量 |

結果依「**交叉接近程度**」（`cross_proximity = \|MA5-MA100\|/MA100`）升冪排序，越小的越接近交叉點。

---

## 技術架構

```
taiwan-stock-strategy/
├── backend/              ← FastAPI + Python
│   ├── main.py           ← API 路由
│   ├── scanner.py        ← asyncio + ThreadPoolExecutor 並行掃描
│   ├── indicators.py     ← MA / 訊號 / 成交量 計算
│   ├── database.py       ← SQLite 讀寫
│   ├── scheduler.py      ← APScheduler 每日 15:30 自動掃描
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/             ← Next.js 14 + TypeScript + Tailwind
│   ├── app/
│   │   ├── page.tsx      ← 選股列表頁
│   │   └── chart/[symbol]/page.tsx  ← 圖表頁
│   ├── components/
│   │   ├── ChartView.tsx        ← Lightweight Charts
│   │   ├── SignalBadge.tsx
│   │   └── ScanProgressBar.tsx
│   ├── lib/api.ts
│   └── Dockerfile
├── docker-compose.yml    ← 本地一鍵啟動
├── railway.toml          ← Railway 部署設定
└── render.yaml           ← Render 部署設定
```

---

## 效能優化

| 優化項目 | 說明 |
|---------|------|
| **asyncio + ThreadPoolExecutor** | MAX_WORKERS 個批次同時下載，I/O 等待不阻塞 |
| **Semaphore 速率限制** | 控制最大並行數，避免 Yahoo Finance 封鎖 |
| **批次間延遲** | 每批結束後 sleep 1.2s + 啟動錯開 0.4s/批 |
| **資料範圍縮減** | 160 天（≈112 交易日）取代 1 年，下載量減少 ~55% |
| **日期範圍 API** | 用 `start=` 日期取代 `period=`，更精確省流量 |

---

## 快速啟動（本地）

### 方式一：Docker（推薦）

```bash
# 複製專案
git clone <your-repo> taiwan-stock-strategy
cd taiwan-stock-strategy

# 一鍵建置並啟動（首次約 3-5 分鐘）
docker compose up --build

# 前端：http://localhost:3000
# 後端：http://localhost:8000
# API 文件：http://localhost:8000/docs
```

### 方式二：本地直接執行

#### 後端

```bash
cd backend

# 建立虛擬環境
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 安裝依賴
pip install -r requirements.txt

# 啟動 (開發模式)
uvicorn main:app --reload --port 8000
```

#### 前端

```bash
cd frontend

# 安裝依賴
npm install

# 啟動 (開發模式)
npm run dev
# → http://localhost:3000
```

---

## 環境變數

### 後端 (`backend/.env`)

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `DATABASE_URL` | `./data/stocks.db` | SQLite 路徑 |
| `CORS_ORIGINS` | `http://localhost:3000` | 允許的前端來源 |
| `SCAN_LIMIT` | `0` | 0=全掃；正整數=只用熱門清單前 N 支（測試用） |
| `MAX_WORKERS` | `3` | 並行批次數（建議 2-4） |
| `BATCH_SIZE` | `40` | 每批股票數 |
| `HISTORY_DAYS` | `160` | 歷史資料天數（≥140 確保 MA100） |

### 前端 (`frontend/.env.local`)

| 變數 | 說明 |
|------|------|
| `NEXT_PUBLIC_API_URL` | 後端 API 位址 |

---

## API 文件

啟動後端後前往 **http://localhost:8000/docs** 查看完整 Swagger 文件。

| Method | Path | 說明 |
|--------|------|------|
| GET | `/scan` | 最新掃描結果（依交叉接近度排序） |
| GET | `/scan?signal=LONG` | 只看做多 |
| POST | `/scan/trigger` | 觸發背景掃描 |
| GET | `/scan/status` | 掃描進度查詢 |
| GET | `/chart/{symbol}` | K線 + MA 資料 |
| GET | `/health` | 健康檢查 |

---

## 部署到 Render（免費）

1. 將專案 push 到 GitHub
2. 登入 [render.com](https://render.com) → New → Blueprint
3. 選擇你的 repo
4. Render 自動讀取 `render.yaml`，建立前後端兩個服務
5. **務必更新** `render.yaml` 中的 URL：
   - `CORS_ORIGINS` → 你的前端 URL
   - `NEXT_PUBLIC_API_URL` → 你的後端 URL

---

## 部署到 Railway

1. 登入 [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. 分別建立 **backend** 和 **frontend** 兩個服務
3. backend：Root Directory = `backend`，`railway.toml` 會自動套用
4. frontend：Root Directory = `frontend`，加入 `NEXT_PUBLIC_API_URL` 環境變數

---

## 排程說明

系統每個**交易日（週一至週五）台灣時間 15:30** 自動執行掃描（APScheduler）。
也可在前端點擊「**立即掃描**」手動觸發。

---

## 注意事項

- 資料來源為 **Yahoo Finance**，有時會觸發速率限制，請勿將 `MAX_WORKERS` 設定過高
- 全部台股約 2500 支，完整掃描約需 **8-15 分鐘**（依網路速度）
- 快速測試請設定 `SCAN_LIMIT=30` 使用熱門股清單
- 本工具僅供學習研究，不構成投資建議
