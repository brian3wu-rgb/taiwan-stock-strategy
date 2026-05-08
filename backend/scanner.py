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

# yfinance TzCache 使用 /tmp 避免 Docker 容器權限問題
try:
    yf.set_tz_cache_location("/tmp/yfinance_tz_cache")
except Exception:
    pass

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

# 圖表專用天數（280天 ≈ 200 交易日，確保 MA60/MA100 從起點即可見）
CHART_HISTORY_DAYS: int = int(os.getenv("CHART_HISTORY_DAYS", "280"))


# ─────────────────────────────────────────────
#  美股清單（SOX + Nasdaq-100 合併去重，共 84 支）
# ─────────────────────────────────────────────

US_STOCKS: List[Dict] = [
    # ── Mega Cap ────────────────────────────────────────────────────────
    {"symbol": "AAPL",  "name": "Apple"},
    {"symbol": "MSFT",  "name": "Microsoft"},
    {"symbol": "NVDA",  "name": "NVIDIA"},
    {"symbol": "AMZN",  "name": "Amazon"},
    {"symbol": "META",  "name": "Meta"},
    {"symbol": "GOOG",  "name": "Alphabet"},
    {"symbol": "TSLA",  "name": "Tesla"},
    {"symbol": "AVGO",  "name": "Broadcom"},
    {"symbol": "COST",  "name": "Costco"},
    # ── Semiconductor（SOX ∩ Nasdaq-100）────────────────────────────────
    {"symbol": "AMD",   "name": "AMD"},
    {"symbol": "QCOM",  "name": "Qualcomm"},
    {"symbol": "TXN",   "name": "Texas Instruments"},
    {"symbol": "MU",    "name": "Micron Technology"},
    {"symbol": "AMAT",  "name": "Applied Materials"},
    {"symbol": "LRCX",  "name": "Lam Research"},
    {"symbol": "KLAC",  "name": "KLA Corp"},
    {"symbol": "ADI",   "name": "Analog Devices"},
    {"symbol": "MCHP",  "name": "Microchip Technology"},
    {"symbol": "ON",    "name": "ON Semiconductor"},
    {"symbol": "MPWR",  "name": "Monolithic Power"},
    {"symbol": "MRVL",  "name": "Marvell Technology"},
    {"symbol": "INTC",  "name": "Intel"},
    {"symbol": "ASML",  "name": "ASML Holding"},
    {"symbol": "ARM",   "name": "Arm Holdings"},
    {"symbol": "NXPI",  "name": "NXP Semiconductors"},
    {"symbol": "GFS",   "name": "GlobalFoundries"},
    # ── SOX Only（非 Nasdaq-100 成份）───────────────────────────────────
    {"symbol": "SWKS",  "name": "Skyworks Solutions"},
    {"symbol": "QRVO",  "name": "Qorvo"},
    {"symbol": "ENTG",  "name": "Entegris"},
    {"symbol": "TSM",   "name": "TSMC ADR"},
    {"symbol": "STM",   "name": "STMicroelectronics"},
    {"symbol": "CRUS",  "name": "Cirrus Logic"},
    {"symbol": "ACLS",  "name": "Axcelis Technologies"},
    {"symbol": "COHU",  "name": "Cohu"},
    {"symbol": "MKSI",  "name": "MKS Instruments"},
    {"symbol": "POWI",  "name": "Power Integrations"},
    # ── Software / Cloud / Cybersecurity ────────────────────────────────
    {"symbol": "ADBE",  "name": "Adobe"},
    {"symbol": "CSCO",  "name": "Cisco"},
    {"symbol": "SNPS",  "name": "Synopsys"},
    {"symbol": "CDNS",  "name": "Cadence Design"},
    {"symbol": "PANW",  "name": "Palo Alto Networks"},
    {"symbol": "FTNT",  "name": "Fortinet"},
    {"symbol": "CRWD",  "name": "CrowdStrike"},
    {"symbol": "TEAM",  "name": "Atlassian"},
    {"symbol": "WDAY",  "name": "Workday"},
    {"symbol": "ZS",    "name": "Zscaler"},
    # ── Consumer / Retail / E-Commerce ──────────────────────────────────
    {"symbol": "NFLX",  "name": "Netflix"},
    {"symbol": "MELI",  "name": "MercadoLibre"},
    {"symbol": "PDD",   "name": "PDD Holdings"},
    {"symbol": "ABNB",  "name": "Airbnb"},
    {"symbol": "EBAY",  "name": "eBay"},
    {"symbol": "PYPL",  "name": "PayPal"},
    {"symbol": "ORLY",  "name": "O'Reilly Automotive"},
    {"symbol": "ROST",  "name": "Ross Stores"},
    {"symbol": "DLTR",  "name": "Dollar Tree"},
    {"symbol": "MNST",  "name": "Monster Beverage"},
    {"symbol": "SBUX",  "name": "Starbucks"},
    {"symbol": "LULU",  "name": "Lululemon"},
    # ── Biotech / Healthcare ─────────────────────────────────────────────
    {"symbol": "AMGN",  "name": "Amgen"},
    {"symbol": "BKNG",  "name": "Booking Holdings"},
    {"symbol": "ISRG",  "name": "Intuitive Surgical"},
    {"symbol": "REGN",  "name": "Regeneron"},
    {"symbol": "BIIB",  "name": "Biogen"},
    {"symbol": "ILMN",  "name": "Illumina"},
    {"symbol": "MRNA",  "name": "Moderna"},
    {"symbol": "DXCM",  "name": "DexCom"},
    {"symbol": "IDXX",  "name": "IDEXX Laboratories"},
    {"symbol": "GEHC",  "name": "GE HealthCare"},
    {"symbol": "ALGN",  "name": "Align Technology"},
    # ── Industrials / Energy / Utilities ────────────────────────────────
    {"symbol": "PCAR",  "name": "PACCAR"},
    {"symbol": "PAYX",  "name": "Paychex"},
    {"symbol": "FAST",  "name": "Fastenal"},
    {"symbol": "ODFL",  "name": "Old Dominion Freight"},
    {"symbol": "VRSK",  "name": "Verisk Analytics"},
    {"symbol": "CTSH",  "name": "Cognizant"},
    {"symbol": "ANSS",  "name": "ANSYS"},
    {"symbol": "MDLZ",  "name": "Mondelez"},
    {"symbol": "KDP",   "name": "Keurig Dr Pepper"},
    {"symbol": "EXC",   "name": "Exelon"},
    {"symbol": "XEL",   "name": "Xcel Energy"},
    {"symbol": "CEG",   "name": "Constellation Energy"},
    {"symbol": "ENPH",  "name": "Enphase Energy"},
    # ── Gaming ───────────────────────────────────────────────────────────
    {"symbol": "EA",    "name": "Electronic Arts"},
    {"symbol": "TTWO",  "name": "Take-Two Interactive"},
]


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
        if code.isdigit() and len(code) == 4:
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

    # 使用完整備援清單（1,970 支，本機從 TWSE 抓取後固化在 repo 中）
    try:
        from tw_stocks_fallback import TW_STOCKS_FALLBACK
        logger.warning("TWSE ISIN blocked — using built-in fallback list (%d stocks)", len(TW_STOCKS_FALLBACK))
        return TW_STOCKS_FALLBACK
    except ImportError:
        logger.warning("Fallback list not found — using popular stocks list")
        return POPULAR_STOCKS


# ─────────────────────────────────────────────
#  HTTP Session（官方 TWSE/TPEx API 用）
# ─────────────────────────────────────────────

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
})


# ─────────────────────────────────────────────
#  官方 TWSE / TPEx API 資料取得
# ─────────────────────────────────────────────

def _fetch_twse_month(stock_no: str, year: int, month: int) -> List[Dict]:
    """從證交所 API 抓取單月日 K 資料。"""
    date_str = f"{year}{month:02d}01"
    url = (
        f"https://www.twse.com.tw/exchangeReport/STOCK_DAY"
        f"?response=json&date={date_str}&stockNo={stock_no}"
    )
    try:
        resp = _SESSION.get(url, timeout=12)
        data = resp.json()
        if data.get("stat") != "OK" or not data.get("data"):
            return []
        rows = []
        for row in data["data"]:
            try:
                parts = row[0].strip().split("/")
                yr = int(parts[0]) + 1911
                dt = pd.Timestamp(f"{yr}-{parts[1]}-{parts[2]}")
                rows.append({
                    "Date":   dt,
                    "Open":   float(row[3].replace(",", "")),
                    "High":   float(row[4].replace(",", "")),
                    "Low":    float(row[5].replace(",", "")),
                    "Close":  float(row[6].replace(",", "")),
                    "Volume": float(row[1].replace(",", "")),
                })
            except (ValueError, IndexError):
                continue
        return rows
    except Exception as e:
        logger.debug("TWSE month fetch %s %d/%02d: %s", stock_no, year, month, e)
        return []


def _fetch_tpex_month(stock_no: str, year: int, month: int) -> List[Dict]:
    """從櫃買中心 API 抓取單月日 K 資料。"""
    roc_year = year - 1911
    url = (
        f"https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/"
        f"st43_result.php?l=zh-tw&d={roc_year}/{month:02d}&stkno={stock_no}&o=json"
    )
    try:
        resp = _SESSION.get(url, timeout=12)
        data = resp.json()
        if not data.get("aaData"):
            return []
        rows = []
        for row in data["aaData"]:
            try:
                parts = row[0].strip().split("/")
                yr = int(parts[0]) + 1911
                dt = pd.Timestamp(f"{yr}-{parts[1]}-{parts[2]}")
                rows.append({
                    "Date":   dt,
                    "Open":   float(row[4].replace(",", "")),
                    "High":   float(row[5].replace(",", "")),
                    "Low":    float(row[6].replace(",", "")),
                    "Close":  float(row[7].replace(",", "")),
                    "Volume": float(row[1].replace(",", "")),
                })
            except (ValueError, IndexError):
                continue
        return rows
    except Exception as e:
        logger.debug("TPEx month fetch %s %d/%02d: %s", stock_no, year, month, e)
        return []


def _fetch_tw_stock(symbol: str, history_days: Optional[int] = None) -> Optional[pd.DataFrame]:
    """
    使用 TWSE / TPEx 官方 API 取得歷史 OHLCV 資料。
    不依賴 Yahoo Finance，雲端 IP 不受封鎖限制。
    history_days: 抓取天數，預設為 HISTORY_DAYS；圖表用途請傳 CHART_HISTORY_DAYS
    """
    if symbol.endswith(".TW"):
        stock_no   = symbol[:-3]
        fetch_func = _fetch_twse_month
    elif symbol.endswith(".TWO"):
        stock_no   = symbol[:-4]
        fetch_func = _fetch_tpex_month
    else:
        logger.warning("Unknown symbol format: %s", symbol)
        return None

    days          = history_days if history_days is not None else HISTORY_DAYS
    today         = date.today()
    months_needed = (days // 25) + 2   # 確保足夠交易日
    all_rows: List[Dict] = []

    for i in range(months_needed):
        target = (today.replace(day=1) - timedelta(days=30 * i))
        rows   = fetch_func(stock_no, target.year, target.month)
        all_rows.extend(rows)
        time.sleep(0.3)

    if not all_rows:
        return None

    df = pd.DataFrame(all_rows).set_index("Date").sort_index()
    df = df[~df.index.duplicated(keep="first")]
    return df


# ─────────────────────────────────────────────
#  批次下載（同步，在執行緒池中執行）
# ─────────────────────────────────────────────

def _build_date_range() -> Tuple[str, str]:
    """計算起始日期：今天往前 HISTORY_DAYS 個日曆天。"""
    end   = date.today()
    start = end - timedelta(days=HISTORY_DAYS)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _download_batch_sync(symbols: List[str]) -> Dict[str, pd.DataFrame]:
    """
    [同步] 批次下載股票歷史資料。
    優先使用 yfinance 一次下載整批（1 次 API call → 全批 40 支）；
    yfinance 未取得的個股再 fallback 到 TWSE 官方 API 逐支補齊。
    """
    if not symbols:
        return {}

    result: Dict[str, pd.DataFrame] = {}
    today  = date.today()
    start  = today - timedelta(days=HISTORY_DAYS + 90)  # 加緩衝確保 MA100
    end    = today + timedelta(days=1)

    # ── yfinance 批次下載 ────────────────────────────────────────────
    try:
        raw = yf.download(
            symbols,
            start=start.isoformat(),
            end=end.isoformat(),
            auto_adjust=True,
            progress=False,
            group_by="ticker",
        )

        if raw is not None and not raw.empty:
            fetched: set = set()

            if len(symbols) == 1:
                # 單支：flat columns
                sym = symbols[0]
                df  = raw.copy()
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                df.index = pd.to_datetime(df.index)
                df = df.dropna(subset=["Close"])
                if len(df) >= 105:
                    result[sym] = df
                    fetched.add(sym)
            else:
                # 多支：MultiIndex (Ticker, Price)
                for sym in symbols:
                    try:
                        df = raw[sym].copy()
                        df.index = pd.to_datetime(df.index)
                        df = df.dropna(subset=["Close"])
                        if len(df) >= 105:
                            result[sym] = df
                            fetched.add(sym)
                    except (KeyError, Exception):
                        pass

            logger.debug("yfinance batch: %d/%d fetched", len(fetched), len(symbols))

    except Exception as e:
        logger.warning("yfinance batch failed: %s — will fallback to TWSE", e)

    # ── TWSE fallback：只補 yfinance 沒抓到的 ────────────────────────
    missing = [s for s in symbols if s not in result]
    if missing:
        logger.debug("TWSE fallback for %d missing stocks", len(missing))
    for sym in missing:
        df = _fetch_tw_stock(sym)
        if df is not None and not df.empty and len(df) >= 105:
            result[sym] = df
        elif df is not None:
            logger.debug("Insufficient data for %s: %d rows", sym, len(df))

    return result


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

        # ── 成交量比率（僅計算供顯示用，不過濾）───────────────────────────
        _, vol_ratio = check_volume_filter(df, period=20)

        # ── 訊號判斷（取最後 6 根 K 線，供5日突破判斷用）──
        recent = df.tail(6)
        today  = recent.iloc[-1]

        price = float(today["Close"])
        ma5   = float(today["MA5"])   if pd.notna(today["MA5"])   else None
        ma100 = float(today["MA100"]) if pd.notna(today["MA100"]) else None
        dt    = str(df.index[-1].date())

        if ma5 is None or ma100 is None:
            return None

        # ── 漲跌計算 ──────────────────────────────────────────────────
        if len(df) >= 2:
            prev_close = float(df["Close"].iloc[-2])
            change     = round(price - prev_close, 2)
            change_pct = round(change / prev_close * 100, 2) if prev_close != 0 else 0.0
        else:
            change     = 0.0
            change_pct = 0.0

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
            "change":          change,
            "change_pct":      change_pct,
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
    on_batch_done: Optional[callable] = None,
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
            await asyncio.sleep(idx * 1.0 % 4.0)
            logger.info("Batch %d/%d start: %s → %s",
                        idx + 1, num_batches, batch[0], batch[-1])
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(
                        executor,
                        partial(_process_batch, batch, name_map),
                    ),
                    timeout=360.0,  # 每批最多等 6 分鐘，逾時跳過
                )
            except asyncio.TimeoutError:
                logger.warning("Batch %d/%d timed out (>360s), skipping",
                               idx + 1, num_batches)
                result = []
            except Exception as exc:
                logger.error("Batch %d/%d error: %s", idx + 1, num_batches, exc)
                result = []
            logger.info("Batch %d/%d done: %d signals", idx + 1, num_batches, len(result))
            # 每批完成後通知主流程（供漸進儲存用）
            if on_batch_done is not None:
                on_batch_done(result, idx + 1, num_batches)
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
#  美股批次處理（yfinance only，無 TWSE fallback）
# ─────────────────────────────────────────────

def _download_us_batch_sync(symbols: List[str]) -> Dict[str, pd.DataFrame]:
    """yfinance 批次下載美股，不需 TWSE fallback。"""
    if not symbols:
        return {}

    result: Dict[str, pd.DataFrame] = {}
    today  = date.today()
    start  = today - timedelta(days=HISTORY_DAYS + 90)
    end    = today + timedelta(days=1)

    try:
        raw = yf.download(
            symbols,
            start=start.isoformat(),
            end=end.isoformat(),
            auto_adjust=True,
            progress=False,
            group_by="ticker",
        )
        if raw is None or raw.empty:
            return {}

        if len(symbols) == 1:
            sym = symbols[0]
            df  = raw.copy()
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df.index = pd.to_datetime(df.index)
            df = df.dropna(subset=["Close"])
            if len(df) >= 105:
                result[sym] = df
        else:
            for sym in symbols:
                try:
                    df = raw[sym].copy()
                    df.index = pd.to_datetime(df.index)
                    df = df.dropna(subset=["Close"])
                    if len(df) >= 105:
                        result[sym] = df
                except (KeyError, Exception):
                    pass

    except Exception as e:
        logger.warning("US batch yfinance error: %s", e)

    return result


def _process_us_batch(batch_symbols: List[str], name_map: Dict[str, str]) -> List[Dict]:
    """[同步，在執行緒池中執行] 美股批次下載 + 分析。"""
    batch_data = _download_us_batch_sync(batch_symbols)
    results: List[Dict] = []
    for sym in batch_symbols:
        if sym in batch_data:
            r = _analyze_stock(sym, name_map[sym], batch_data[sym])
            if r:
                results.append(r)
                logger.info("  ✅ US %s (%s) → %s  proximity=%.4f",
                            sym, r["name"], r["signal"], r["cross_proximity"])
    time.sleep(0.5)   # 短暫停頓，避免 rate limit
    return results


# ─────────────────────────────────────────────
#  美股非同步掃描主流程
# ─────────────────────────────────────────────

US_BATCH_SIZE = 15   # 美股每批 15 支（yfinance 對美股更穩定，可稍大）

async def run_us_scan_async(
    on_batch_done: Optional[callable] = None,
) -> List[Dict]:
    """
    [非同步] 美股掃描主流程。
    使用 US_STOCKS 清單（SOX + Nasdaq-100，~84 支），yfinance 直接下載。
    """
    name_map    = {s["symbol"]: s["name"] for s in US_STOCKS}
    symbols     = list(name_map.keys())
    total       = len(symbols)

    batches     = [symbols[i : i + US_BATCH_SIZE] for i in range(0, total, US_BATCH_SIZE)]
    num_batches = len(batches)
    logger.info("US Scan started: %d stocks → %d batches × %d workers",
                total, num_batches, MAX_WORKERS)

    semaphore = asyncio.Semaphore(MAX_WORKERS)
    loop      = asyncio.get_event_loop()
    executor  = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="us-scanner")

    async def run_batch(batch: List[str], idx: int) -> List[Dict]:
        async with semaphore:
            await asyncio.sleep(idx * 0.5 % 2.0)
            logger.info("US Batch %d/%d: %s→%s", idx + 1, num_batches, batch[0], batch[-1])
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(
                        executor,
                        partial(_process_us_batch, batch, name_map),
                    ),
                    timeout=120.0,   # 美股批次小，2 分鐘已足夠
                )
            except asyncio.TimeoutError:
                logger.warning("US Batch %d timed out, skipping", idx + 1)
                result = []
            except Exception as exc:
                logger.error("US Batch %d error: %s", idx + 1, exc)
                result = []
            logger.info("US Batch %d/%d done: %d signals", idx + 1, num_batches, len(result))
            if on_batch_done is not None:
                on_batch_done(result, idx + 1, num_batches)
            return result

    tasks         = [run_batch(b, i) for i, b in enumerate(batches)]
    batch_results = await asyncio.gather(*tasks, return_exceptions=True)
    executor.shutdown(wait=False)

    all_results: List[Dict] = []
    for br in batch_results:
        if isinstance(br, list):
            all_results.extend(br)
        elif isinstance(br, Exception):
            logger.error("US Batch exception: %s", br)

    all_results.sort(key=lambda r: r["cross_proximity"])
    logger.info("US Scan complete: %d signals from %d stocks", len(all_results), total)
    return all_results


# ─────────────────────────────────────────────
#  圖表資料
# ─────────────────────────────────────────────

# ─────────────────────────────────────────────
#  圖表資料 TTL Cache（30 分鐘，最多 600 支）
# ─────────────────────────────────────────────

import time as _time
_chart_cache: dict = {}          # symbol → (data, cached_at)
_CHART_CACHE_TTL = 1800          # 30 分鐘


def _fetch_chart_yfinance(symbol: str, history_days: int) -> Optional[pd.DataFrame]:
    """yfinance fallback for chart data（TWSE API 被封鎖時使用）。"""
    try:
        import yfinance as yf
        from datetime import date, timedelta
        end   = date.today()
        start = end - timedelta(days=history_days)
        df = yf.download(symbol, start=start.isoformat(), end=(end + timedelta(days=1)).isoformat(),
                         auto_adjust=True, progress=False)
        if df is None or df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.index = pd.to_datetime(df.index)
        return df
    except Exception as e:
        logger.error("yfinance chart fallback failed for %s: %s", symbol, e)
        return None


def get_chart_data(symbol: str) -> Optional[Dict]:
    """
    取得指定股票的 K 線 + MA5 + MA60 + MA100 資料，供前端 Lightweight Charts 使用。
    使用 CHART_HISTORY_DAYS（280天）確保 MA 線從起點即可見。
    直接使用 yfinance（Render US 伺服器 TWSE API 被封鎖，跳過 TWSE 減少噪音）。
    內建 TTL Cache：同一支股票 30 分鐘內不重複呼叫 yfinance，避免觸發 rate limit。
    """
    # ── TTL Cache 命中 ──────────────────────────────────────────────
    cached = _chart_cache.get(symbol)
    if cached is not None:
        data, ts = cached
        if _time.time() - ts < _CHART_CACHE_TTL:
            return data

    try:
        df = _fetch_chart_yfinance(symbol, CHART_HISTORY_DAYS)
        if df is None or df.empty or len(df) < 5:
            logger.warning("No chart data for %s (yfinance failed)", symbol)
            return None

        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        df["MA5"]   = calculate_ma(df["Close"], 5)
        df["MA60"]  = calculate_ma(df["Close"], 60)
        df["MA100"] = calculate_ma(df["Close"], 100)

        candles = [
            {
                "time":  str(idx.date()),
                "open":  round(float(row["Open"]),  2),
                "high":  round(float(row["High"]),  2),
                "low":   round(float(row["Low"]),   2),
                "close": round(float(row["Close"]), 2),
                "ma5":   round(float(row["MA5"]),   2) if pd.notna(row["MA5"])   else None,
                "ma60":  round(float(row["MA60"]),  2) if pd.notna(row["MA60"])  else None,
                "ma100": round(float(row["MA100"]), 2) if pd.notna(row["MA100"]) else None,
            }
            for idx, row in df.iterrows()
        ]
        result = {"symbol": symbol, "candles": candles}
        # 存入 TTL Cache（超過 600 筆時清除最舊的 100 筆）
        if len(_chart_cache) >= 600:
            oldest = sorted(_chart_cache.items(), key=lambda x: x[1][1])[:100]
            for k, _ in oldest:
                _chart_cache.pop(k, None)
        _chart_cache[symbol] = (result, _time.time())
        return result

    except Exception as e:
        logger.error("Chart data error for %s: %s", symbol, e)
        return None
