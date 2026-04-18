"""
scanner.py
─────────────────────────────────────────────────────────────────────
高效能股票掃描核心模組。

效能優化策略：
  1. asyncio + ThreadPoolExecutor — 多批次平行下載，最多 MAX_WORKERS 個
     批次同時執行，I/O 等待不阻塞。
  2. asyncio.Semaphore — 限制同時請求數，避免觸發 Yahoo Finance 速率限制。
  3. 資料範圍縮減 — 僅抓 160 個日曆天（≈ 112 個交易日）而非 1 年，
     下載量減少約 55%。MA100 需要 100 個交易日，160 天可確保足夠。
  4. batch_size 可調 — 預設 40 支/批，避免單次請求過大。

新增功能：
  - 成交量過濾：當天成交量 > 20 日均量才算訊號
  - cross_proximity 欄位：用於前端排序
  - volume_ratio 欄位：顯示量能比率
"""

import os
import asyncio
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from functools import partial
from typing import List, Dict, Optional, Tuple

import pandas as pd
import yfinance as yf
import requests
from bs4 import BeautifulSoup

from indicators import (
    calculate_ma,
    check_long_signal,
    check_short_signal,
    check_volume_filter,
    compute_cross_proximity,
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  環境設定
# ─────────────────────────────────────────────

# 平行批次數上限（建議 2-4，過高會觸發 Yahoo Finance 封鎖）
MAX_WORKERS: int = int(os.getenv("MAX_WORKERS", "3"))

# 批次大小
BATCH_SIZE: int = int(os.getenv("BATCH_SIZE", "40"))

# 抓取日曆天數（160天 ≈ 112 交易日，足夠計算 MA100）
HISTORY_DAYS: int = int(os.getenv("HISTORY_DAYS", "160"))


# ─────────────────────────────────────────────
#  熱門股備援清單
# ─────────────────────────────────────────────

POPULAR_STOCKS: List[Dict] = [
    {"symbol": "2330.TW",  "name": "台積電"},
    {"symbol": "2317.TW",  "name": "鴻海"},
    {"symbol": "2454.TW",  "name": "聯發科"},
    {"symbol": "2308.TW",  "name": "台達電"},
    {"symbol": "2412.TW",  "name": "中華電"},
    {"symbol": "2882.TW",  "name": "國泰金"},
    {"symbol": "2881.TW",  "name": "富邦金"},
    {"symbol": "1301.TW",  "name": "台塑"},
    {"symbol": "1303.TW",  "name": "南亞"},
    {"symbol": "2002.TW",  "name": "中鋼"},
    {"symbol": "2886.TW",  "name": "兆豐金"},
    {"symbol": "2891.TW",  "name": "中信金"},
    {"symbol": "3711.TW",  "name": "日月光投控"},
    {"symbol": "2303.TW",  "name": "聯電"},
    {"symbol": "2357.TW",  "name": "華碩"},
    {"symbol": "2382.TW",  "name": "廣達"},
    {"symbol": "2395.TW",  "name": "研華"},
    {"symbol": "2379.TW",  "name": "瑞昱"},
    {"symbol": "2345.TW",  "name": "智邦"},
    {"symbol": "2408.TW",  "name": "南亞科"},
    {"symbol": "0050.TW",  "name": "元大台灣50"},
    {"symbol": "0056.TW",  "name": "元大高股息"},
    {"symbol": "00878.TW", "name": "國泰永續高股息"},
    {"symbol": "6415.TWO", "name": "矽力-KY"},
    {"symbol": "3081.TWO", "name": "聯亞"},
    {"symbol": "6669.TWO", "name": "緯穎"},
    {"symbol": "3105.TWO", "name": "穩懋"},
    {"symbol": "2337.TW",  "name": "旺宏"},
    {"symbol": "2492.TW",  "name": "華新科"},
    {"symbol": "3034.TW",  "name": "聯詠"},
]


# ─────────────────────────────────────────────
#  股票清單取得
# ─────────────────────────────────────────────

def _parse_isin_page(url: str, suffix: str) -> List[Dict]:
    """解析 TWSE ISIN 頁面，回傳股票清單。"""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.encoding = "big5"
    soup = BeautifulSoup(resp.text, "lxml")
    table = soup.find("table", class_="h4")
    if not table:
        return []

    stocks: List[Dict] = []
    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        text = cells[0].text.strip()
        if "\u3000" not in text:
            continue
        parts = text.split("\u3000")
        code  = parts[0].strip()
        name  = parts[1].strip() if len(parts) > 1 else code
        if code.isdigit() and 4 <= len(code) <= 6:
            stocks.append({"symbol": code + suffix, "name": name})
    return stocks


def get_all_tw_stocks(limit: int = 0) -> List[Dict]:
    """
    取得完整台股清單（上市 + 上櫃）。
    limit > 0 → 使用備援熱門股清單（快速測試）。
    """
    if limit > 0:
        logger.info("Popular stocks mode (limit=%d)", limit)
        return POPULAR_STOCKS[:limit]

    try:
        twse = _parse_isin_page("https://isin.twse.com.tw/isin/C_public.jsp?strMode=2", ".TW")
        tpex = _parse_isin_page("https://isin.twse.com.tw/isin/C_public.jsp?strMode=4", ".TWO")
        total = twse + tpex
        if total:
            logger.info("Fetched %d stocks (TWSE=%d, TPEx=%d)", len(total), len(twse), len(tpex))
            return total
    except Exception as e:
        logger.error("Failed to fetch stock list: %s", e)

    logger.warning("Using fallback popular stocks list")
    return POPULAR_STOCKS


# ─────────────────────────────────────────────
#  批次下載（同步，在執行緒池中執行）
# ─────────────────────────────────────────────

def _build_date_range() -> Tuple[str, str]:
    """計算起始日期：今天往前 HISTORY_DAYS 個日曆天。"""
    end   = date.today()
    start = end - timedelta(days=HISTORY_DAYS)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """將 yfinance MultiIndex 欄名攤平為單層。"""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _download_batch_sync(symbols: List[str]) -> Dict[str, pd.DataFrame]:
    """
    [同步] 下載一批股票的歷史資料。
    - 使用日期範圍而非 period 字串（速度更快、更精確）
    - 回傳 {symbol: DataFrame}，只保留資料筆數 ≥ 105 的股票
    """
    if not symbols:
        return {}

    start_date, end_date = _build_date_range()

    try:
        if len(symbols) == 1:
            df = yf.download(
                symbols[0],
                start=start_date, end=end_date,
                auto_adjust=True, progress=False,
            )
            df = _flatten_columns(df)
            return {symbols[0]: df} if len(df) >= 105 else {}

        raw = yf.download(
            symbols,
            start=start_date, end=end_date,
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,          # yfinance 內建執行緒加速
        )

        result: Dict[str, pd.DataFrame] = {}
        for sym in symbols:
            try:
                df = raw[sym].copy().dropna(how="all")
                df = _flatten_columns(df)
                if len(df) >= 105:
                    result[sym] = df
            except (KeyError, Exception):
                pass
        return result

    except Exception as e:
        logger.error("Batch download failed: %s", e)
        return {}


# ─────────────────────────────────────────────
#  單股分析
# ─────────────────────────────────────────────

def _analyze_stock(symbol: str, name: str, df: pd.DataFrame) -> Optional[Dict]:
    """
    分析單支股票：
      1. 計算 MA5、MA100
      2. 成交量過濾（當天量 > 20日均量）
      3. 判斷做多 / 做空訊號
      4. 計算 cross_proximity 與 volume_ratio
    """
    try:
        required = ["Open", "High", "Low", "Close"]
        if not all(c in df.columns for c in required):
            return None

        df = df.dropna(subset=required).copy()
        if len(df) < 105:
            return None

        df["MA5"]   = calculate_ma(df["Close"], 5)
        df["MA100"] = calculate_ma(df["Close"], 100)

        # ── 成交量過濾 ───────────────────────────
        vol_pass, vol_ratio = check_volume_filter(df, period=20)
        if not vol_pass:
            return None   # 量能不足，跳過

        # ── 訊號判斷（取最後 2 根 K 線）────────
        recent = df.tail(2)
        today  = recent.iloc[-1]

        price = float(today["Close"])
        ma5   = float(today["MA5"])   if pd.notna(today["MA5"])   else None
        ma100 = float(today["MA100"]) if pd.notna(today["MA100"]) else None
        dt    = str(df.index[-1].date())

        if ma5 is None or ma100 is None:
            return None

        proximity = compute_cross_proximity(ma5, ma100)

        signal: Optional[str] = None
        if check_long_signal(recent):
            signal = "LONG"
        elif check_short_signal(recent):
            signal = "SHORT"

        if signal is None:
            return None

        return {
            "symbol":          symbol,
            "name":            name,
            "signal":          signal,
            "price":           price,
            "ma5":             round(ma5,       2),
            "ma100":           round(ma100,     2),
            "cross_proximity": round(proximity, 6),
            "volume_ratio":    vol_ratio,
            "date":            dt,
        }

    except Exception as e:
        logger.debug("Analyze error %s: %s", symbol, e)
        return None


# ─────────────────────────────────────────────
#  批次處理工作（下載 + 分析合併）
# ─────────────────────────────────────────────

def _process_batch(batch_symbols: List[str], name_map: Dict[str, str]) -> List[Dict]:
    """
    [同步，在執行緒池中執行]
    1. 下載一批股票資料
    2. 逐支分析訊號
    3. 批次結束後 sleep，做速率限制
    """
    batch_data = _download_batch_sync(batch_symbols)
    results: List[Dict] = []

    for sym in batch_symbols:
        if sym in batch_data:
            r = _analyze_stock(sym, name_map[sym], batch_data[sym])
            if r:
                results.append(r)
                logger.info("  ✅ %s (%s) → %s  proximity=%.4f  vol_ratio=%.2f",
                            sym, r["name"], r["signal"],
                            r["cross_proximity"], r["volume_ratio"])

    # 每批次結束後稍停，避免連續請求觸發速率限制
    time.sleep(1.2)
    return results


# ─────────────────────────────────────────────
#  非同步掃描主流程
# ─────────────────────────────────────────────

async def run_scan_async(
    stock_list: Optional[List[Dict]] = None,
) -> List[Dict]:
    """
    [非同步] 主掃描流程。

    並行策略：
      - 使用 asyncio.Semaphore 限制最多 MAX_WORKERS 個批次同時執行
      - 每個批次在 ThreadPoolExecutor 的執行緒中執行（不阻塞 event loop）
      - 批次間有隨機小延遲（stagger）避免請求同時爆發

    回傳：符合訊號的股票清單，已按 cross_proximity 升冪排序。
    """
    scan_limit = int(os.getenv("SCAN_LIMIT", "0"))
    if stock_list is None:
        stock_list = get_all_tw_stocks(limit=scan_limit)

    name_map = {s["symbol"]: s["name"] for s in stock_list}
    symbols  = list(name_map.keys())
    total    = len(symbols)

    batches: List[List[str]] = [
        symbols[i : i + BATCH_SIZE]
        for i in range(0, total, BATCH_SIZE)
    ]
    num_batches = len(batches)
    logger.info("Scan started: %d stocks → %d batches × %d workers",
                total, num_batches, MAX_WORKERS)

    semaphore = asyncio.Semaphore(MAX_WORKERS)
    loop      = asyncio.get_event_loop()

    # 使用專屬執行緒池，避免污染 FastAPI 預設池
    executor = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="scanner")

    async def run_batch(batch: List[str], idx: int) -> List[Dict]:
        async with semaphore:
            # 批次間錯開啟動時間，減少同時發出請求
            await asyncio.sleep(idx * 0.4 % 2.0)
            logger.info("Batch %d/%d start: %s → %s",
                        idx + 1, num_batches, batch[0], batch[-1])
            result = await loop.run_in_executor(
                executor,
                partial(_process_batch, batch, name_map),
            )
            logger.info("Batch %d/%d done: %d signals", idx + 1, num_batches, len(result))
            return result

    tasks        = [run_batch(b, i) for i, b in enumerate(batches)]
    batch_results = await asyncio.gather(*tasks, return_exceptions=True)
    executor.shutdown(wait=False)

    all_results: List[Dict] = []
    for br in batch_results:
        if isinstance(br, list):
            all_results.extend(br)
        elif isinstance(br, Exception):
            logger.error("Batch exception: %s", br)

    # 依交叉接近程度排序（值越小越接近交叉點）
    all_results.sort(key=lambda r: r["cross_proximity"])

    logger.info("Scan complete: %d signals from %d stocks", len(all_results), total)
    return all_results


def run_scan(stock_list: Optional[List[Dict]] = None) -> List[Dict]:
    """
    [同步包裝] 供 APScheduler 或 CLI 直接呼叫。
    內部建立新的 event loop 執行非同步掃描。
    """
    return asyncio.run(run_scan_async(stock_list))


# ─────────────────────────────────────────────
#  圖表資料
# ─────────────────────────────────────────────

def get_chart_data(symbol: str) -> Optional[Dict]:
    """
    取得指定股票的 K 線 + MA5 + MA100 資料，供前端 Lightweight Charts 使用。
    使用相同的 HISTORY_DAYS 範圍。
    """
    start_date, end_date = _build_date_range()
    try:
        df = yf.download(
            symbol,
            start=start_date, end=end_date,
            auto_adjust=True, progress=False,
        )
        df = _flatten_columns(df)

        if df.empty or len(df) < 5:
            logger.warning("No chart data for %s", symbol)
            return None

        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        df["MA5"]   = calculate_ma(df["Close"], 5)
        df["MA100"] = calculate_ma(df["Close"], 100)

        candles = [
            {
                "time":  str(idx.date()),
                "open":  round(float(row["Open"]),  2),
                "high":  round(float(row["High"]),  2),
                "low":   round(float(row["Low"]),   2),
                "close": round(float(row["Close"]), 2),
                "ma5":   round(float(row["MA5"]),   2) if pd.notna(row["MA5"])   else None,
                "ma100": round(float(row["MA100"]), 2) if pd.notna(row["MA100"]) else None,
            }
            for idx, row in df.iterrows()
        ]
        return {"symbol": symbol, "candles": candles}

    except Exception as e:
        logger.error("Chart data error for %s: %s", symbol, e)
        return None
