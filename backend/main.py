"""
main.py
─────────────────────────────────────────────────────────────────────
FastAPI 主應用程式。

API 路由：
  GET  /               → 服務資訊
  GET  /health         → 健康檢查
  GET  /scan           → 最新掃描結果（依 cross_proximity 排序）
  POST /scan/trigger   → 觸發非同步背景掃描
  GET  /scan/status    → 掃描進度查詢
  GET  /chart/{symbol} → K 線 + MA 資料
"""

import os
import logging
from datetime import date, datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import (
    init_db, save_scan_results, get_latest_scan_results,
    get_last_scan_date, log_scan,
)
from scanner import run_scan_async, get_chart_data
from scheduler import start_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  App 初始化
# ─────────────────────────────────────────────

app = FastAPI(
    title="台股策略選股 API",
    description="均線交叉 + K線反轉 + 量能過濾，結果依交叉接近程度排序",
    version="2.0.0",
)

_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全域掃描狀態（單一 worker 實例下安全）
_scan_status = {
    "running":  False,
    "last_run": None,
    "progress": "尚未執行",
}


# ─────────────────────────────────────────────
#  Pydantic 模型
# ─────────────────────────────────────────────

class ScanResult(BaseModel):
    symbol:          str
    name:            str
    signal:          str            # "LONG" | "SHORT"
    price:           float
    ma5:             Optional[float] = None
    ma100:           Optional[float] = None
    cross_proximity: Optional[float] = None  # 越小越接近交叉點
    volume_ratio:    Optional[float] = None  # 今日量 / 20日均量
    scan_date:       str


class ScanResponse(BaseModel):
    results:   List[ScanResult]
    scan_date: Optional[str]
    total:     int


class ScanStatusResponse(BaseModel):
    running:  bool
    last_run: Optional[str]
    progress: str


class CandlePoint(BaseModel):
    time:  str
    open:  float
    high:  float
    low:   float
    close: float
    ma5:   Optional[float] = None
    ma100: Optional[float] = None


class ChartResponse(BaseModel):
    symbol:  str
    candles: List[CandlePoint]


# ─────────────────────────────────────────────
#  Startup
# ─────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    init_db()
    start_scheduler()
    logger.info("API ready. DB initialized. Scheduler running.")


# ─────────────────────────────────────────────
#  背景掃描（async，支援 FastAPI BackgroundTasks）
# ─────────────────────────────────────────────

async def _background_scan():
    """非同步背景掃描任務。結果寫入 SQLite 後更新全域狀態。"""
    _scan_status["running"]  = True
    _scan_status["progress"] = "掃描進行中..."
    started_at = datetime.now()

    try:
        today   = str(date.today())
        results = await run_scan_async()

        if results:
            save_scan_results(results, today)

        _scan_status["last_run"] = today
        _scan_status["progress"] = f"完成！找到 {len(results)} 個訊號（{today}）"

        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=len(results),
            status="success",
        )

    except Exception as e:
        _scan_status["progress"] = f"錯誤：{e}"
        logger.error("Background scan failed: %s", e)
        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=0,
            status="failed",
            error_msg=str(e),
        )
    finally:
        _scan_status["running"] = False


# ─────────────────────────────────────────────
#  路由
# ─────────────────────────────────────────────

@app.get("/", tags=["General"])
def root():
    return {
        "message": "台股策略選股 API v2.0",
        "docs":    "/docs",
        "features": ["asyncio 並行掃描", "成交量過濾", "交叉接近程度排序"],
    }


@app.get("/health", tags=["General"])
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/scan", response_model=ScanResponse, tags=["Scan"])
async def get_scan(
    force: bool = False,
    signal: Optional[str] = None,         # 篩選 "LONG" | "SHORT"
    background_tasks: BackgroundTasks = None,
):
    """
    取得最新掃描結果（已依 cross_proximity 升冪排序）。

    參數：
      - force=true   → 同時在背景觸發新掃描（先回傳舊資料）
      - signal=LONG  → 只回傳做多訊號
      - signal=SHORT → 只回傳做空訊號
    """
    if force and not _scan_status["running"] and background_tasks:
        background_tasks.add_task(_background_scan)

    rows      = get_latest_scan_results()
    scan_date = get_last_scan_date()

    results = [ScanResult(**r) for r in rows]

    if signal and signal.upper() in ("LONG", "SHORT"):
        results = [r for r in results if r.signal == signal.upper()]

    return ScanResponse(results=results, scan_date=scan_date, total=len(results))


@app.post("/scan/trigger", tags=["Scan"])
async def trigger_scan(background_tasks: BackgroundTasks):
    """手動觸發背景掃描。掃描完成前再次呼叫會直接回傳進行中狀態。"""
    if _scan_status["running"]:
        return {"message": "掃描進行中，請稍候", "status": _scan_status}

    background_tasks.add_task(_background_scan)
    _scan_status["progress"] = "已排入佇列，即將開始..."
    return {"message": "掃描已啟動", "status": _scan_status}


@app.get("/scan/status", response_model=ScanStatusResponse, tags=["Scan"])
def get_scan_status():
    """輪詢掃描進度（前端每 5 秒呼叫一次）。"""
    return ScanStatusResponse(**_scan_status)


@app.get("/chart/{symbol:path}", response_model=ChartResponse, tags=["Chart"])
async def get_chart(symbol: str):
    """
    取得 K 線 + MA5 + MA100 資料供前端圖表使用。
    symbol 範例：2330.TW、0050.TW、6415.TWO
    """
    data = get_chart_data(symbol)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"找不到 {symbol} 的資料，請確認股票代碼是否正確。",
        )
    return ChartResponse(**data)
