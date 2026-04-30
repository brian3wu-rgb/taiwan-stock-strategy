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
from simulation import (
    init_trades_table, get_simulation_data,
    get_trades, add_trade, record_exit, delete_trade,
)

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

# 圖表 API 並發限制：最多 5 個同時向 yfinance 抓資料，避免 rate limit
_chart_semaphore: asyncio.Semaphore = None  # type: ignore


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
    ma60:  Optional[float] = None
    ma100: Optional[float] = None


class ChartResponse(BaseModel):
    symbol:  str
    candles: List[CandlePoint]


class SimRow(BaseModel):
    date:         str
    open:         float
    high:         float
    low:          float
    close:        float
    ma5:          Optional[float] = None
    ma20:         Optional[float] = None
    ma60:         Optional[float] = None
    ma100:        Optional[float] = None
    k:            Optional[float] = None
    k_state:      str
    trend:        str
    ppp:          str
    sig:          str
    auto_hold:    str
    auto_entry:   float
    auto_pnl_twd: int
    cross_sig:    Optional[str] = None


class SimDataResponse(BaseModel):
    symbol:         str
    symbol_full:    str
    market:         str
    usd_twd:        float
    default_shares: int
    rows:           List[SimRow]


class TradeIn(BaseModel):
    direction:   str = '多單'   # '多單' | '空單'
    entry_date:  str
    entry_price: float
    shares:      int
    cost:        float
    notes:       Optional[str] = ""


class ExitIn(BaseModel):
    exit_date:   str
    exit_price:  float


class TradeOut(BaseModel):
    id:          int
    symbol:      str
    market:      str
    direction:   str = '多單'
    entry_date:  Optional[str]   = None
    entry_price: Optional[float] = None
    shares:      Optional[int]   = None
    cost:        Optional[float] = None
    exit_date:   Optional[str]   = None
    exit_price:  Optional[float] = None
    notes:       Optional[str]   = None
    created_at:  str


# ─────────────────────────────────────────────
#  Startup
# ─────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    global _chart_semaphore
    _chart_semaphore = asyncio.Semaphore(5)  # 同時最多 5 個 chart 請求打 yfinance
    init_db()
    init_trades_table()
    start_scheduler()
    logger.info("API ready. DB initialized. Scheduler running.")

    # 若今日尚無掃描結果，且已過 15:30（收盤後），才於背景自動補掃
    last_date = get_last_scan_date()
    today_str = str(date.today())
    now = datetime.now()
    is_weekday = now.weekday() < 5  # 0=Mon, 4=Fri
    is_after_close = now.hour > 15 or (now.hour == 15 and now.minute >= 30)

    if last_date != today_str and is_weekday and is_after_close:
        logger.info("No scan data for today (%s) and market is closed, triggering startup scan.", today_str)
        _scan_status["running"]  = True
        _scan_status["progress"] = "啟動時自動掃描中..."
        asyncio.create_task(_background_scan())
    else:
        logger.info("Startup scan skipped. last_date=%s, today=%s, weekday=%s, after_close=%s",
                    last_date, today_str, is_weekday, is_after_close)


# ─────────────────────────────────────────────
#  背景掃描（async，支援 FastAPI BackgroundTasks）
# ─────────────────────────────────────────────

async def _background_scan():
    """非同步背景掃描任務。每批完成即寫入 DB，支援前端漸進顯示。"""
    _scan_status["running"]  = True
    _scan_status["progress"] = "掃描啟動中..."
    started_at = datetime.now()

    try:
        today       = str(date.today())
        accumulated: list = []

        def on_batch(batch_results: list, batch_idx: int, total_batches: int):
            """每批完成後：累積結果並寫入 DB，前端 polling 即可看到最新資料。"""
            if batch_results:
                accumulated.extend(batch_results)
                save_scan_results(accumulated, today)
            _scan_status["progress"] = (
                f"掃描中 {batch_idx}/{total_batches} 批，已找到 {len(accumulated)} 個訊號..."
            )

        results = await run_scan_async(on_batch_done=on_batch)

        # 最終完整結果（已排序）再存一次，確保排序正確
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
    並發限制：最多 5 個同時向 yfinance 抓資料（30 分鐘 TTL cache 減少重複請求）。
    """
    async with _chart_semaphore:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, get_chart_data, symbol)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"找不到 {symbol} 的資料，請確認股票代碼是否正確。",
        )
    return ChartResponse(**data)


# ─────────────────────────────────────────────
#  模擬交易路由
# ─────────────────────────────────────────────

@app.get("/simulate/{symbol}", response_model=SimDataResponse, tags=["Simulate"])
def simulate_get(
    symbol:     str,
    market:     str = "TW",
    start_date: Optional[str] = None,   # YYYY-MM-DD
    end_date:   Optional[str] = None,   # YYYY-MM-DD
):
    """
    取得策略指標 + 自動策略損益模擬。
    market: TW（台股 TWSE/TPEx） | US（美股 yfinance）
    start_date / end_date: 指定顯示區間（不傳則預設最近 30 個交易日）
    """
    data = get_simulation_data(symbol, market, start_date, end_date)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"找不到 {symbol} 的資料，請確認股票代碼是否正確。",
        )
    return data


@app.get("/simulate/{symbol}/trades", response_model=List[TradeOut], tags=["Simulate"])
def simulate_list_trades(symbol: str, market: str = "TW"):
    """取得指定股票的所有已儲存交易記錄。"""
    return get_trades(symbol, market)


@app.post("/simulate/{symbol}/trades", response_model=dict, tags=["Simulate"])
def simulate_add_trade(symbol: str, market: str, body: TradeIn):
    """新增一筆手動交易記錄。"""
    result = add_trade(
        symbol=symbol,
        market=market,
        direction=body.direction,
        entry_date=body.entry_date,
        entry_price=body.entry_price,
        shares=body.shares,
        cost=body.cost,
        notes=body.notes or "",
    )
    return result


@app.patch("/simulate/trades/{trade_id}/exit", response_model=dict, tags=["Simulate"])
def simulate_record_exit(trade_id: int, body: ExitIn):
    """記錄出場日期與價格。"""
    ok = record_exit(trade_id, body.exit_date, body.exit_price)
    if not ok:
        raise HTTPException(status_code=404, detail="找不到此交易記錄")
    return {"updated": True}


@app.delete("/simulate/trades/{trade_id}", tags=["Simulate"])
def simulate_delete_trade(trade_id: int):
    """刪除指定 ID 的交易記錄。"""
    ok = delete_trade(trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="找不到此交易記錄")
    return {"deleted": True}
