"""
simulation.py
─────────────────────────────────────────────────────────────────────
模擬交易模組：
  - 取得 30 日指標資料（台股 TWSE/TPEx、美股 yfinance）
  - 計算 MA5/MA20/MA60/MA100、RSV/K 值、PPP、短期訊號
  - 自動策略持倉/損益計算（含出場當日實現損益邏輯）
  - 交易記錄 CRUD（SQLite）
"""

import time
import logging
from datetime import date, timedelta
from typing import Optional, List, Dict, Any

import pandas as pd
import requests

from indicators import calculate_ma, check_long_signal, check_short_signal
from scanner import _fetch_tw_stock, _fetch_twse_month, _fetch_tpex_month

logger = logging.getLogger(__name__)

# 歷史資料天數：確保 MA100 + 30 日顯示有足夠資料
HISTORY_DAYS_SIM = 220

# 顯示天數
DISPLAY_DAYS = 30

# 預設股數（自動策略損益計算用）
DEFAULT_SHARES_TW = 1000
DEFAULT_SHARES_US = 10

# ─────────────────────────────────────────────
#  匯率
# ─────────────────────────────────────────────

_rate_cache: Dict[str, Any] = {"rate": 32.0, "date": None}


def get_usd_twd_rate() -> float:
    today_str = str(date.today())
    if _rate_cache["date"] == today_str:
        return _rate_cache["rate"]

    # 嘗試多個免費匯率 API（無需 API key）
    sources = [
        ("https://open.er-api.com/v6/latest/USD", lambda d: float(d["rates"]["TWD"])),
        ("https://api.exchangerate-api.com/v4/latest/USD", lambda d: float(d["rates"]["TWD"])),
        ("https://api.frankfurter.app/latest?from=USD&to=TWD", lambda d: float(d["rates"]["TWD"])),
    ]
    for url, extractor in sources:
        try:
            resp = requests.get(url, timeout=6)
            rate = extractor(resp.json())
            _rate_cache["rate"] = rate
            _rate_cache["date"] = today_str
            logger.info("USD/TWD rate refreshed: %.2f from %s", rate, url)
            return rate
        except Exception as e:
            logger.warning("Rate source %s failed: %s", url, e)

    return _rate_cache["rate"]


# ─────────────────────────────────────────────
#  台股資料（日期範圍版，供模擬交易用）
# ─────────────────────────────────────────────

def _month_offset(base_year: int, base_month: int, months_back: int):
    """回傳 base - months_back 個月的 (year, month)。"""
    total = base_year * 12 + (base_month - 1) - months_back
    return total // 12, total % 12 + 1


def _fetch_tw_yfinance(symbol: str, fetch_start: date, fetch_end: date) -> Optional[pd.DataFrame]:
    """yfinance fallback（TWSE API 被封鎖時使用）。"""
    try:
        import yfinance as yf
        end_str   = (fetch_end + timedelta(days=1)).isoformat()
        start_str = fetch_start.isoformat()
        df = yf.download(symbol, start=start_str, end=end_str,
                         auto_adjust=True, progress=False)
        if df is None or df.empty:
            return None
        # yfinance 1.x 回傳 MultiIndex columns (Price, Ticker)，攤平
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.index = pd.to_datetime(df.index)
        df.index.name = "Date"
        return df
    except Exception as e:
        logger.error("yfinance fallback failed for %s: %s", symbol, e)
        return None


def _fetch_tw_stock_range(symbol: str, fetch_start: date, fetch_end: date) -> Optional[pd.DataFrame]:
    """取得指定日期區間的台股資料（含 MA100 計算暖身期）。
    優先使用 TWSE/TPEx 官方 API；若 Render 伺服器被封鎖則 fallback 到 yfinance。
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

    months_count = (fetch_end.year - fetch_start.year) * 12 + \
                   (fetch_end.month - fetch_start.month) + 1

    all_rows: List[Dict] = []
    for i in range(months_count):
        y, m = _month_offset(fetch_end.year, fetch_end.month, i)
        rows = fetch_func(stock_no, y, m)
        all_rows.extend(rows)
        time.sleep(0.3)

    if all_rows:
        df = pd.DataFrame(all_rows).set_index("Date").sort_index()
        df = df[~df.index.duplicated(keep="first")]
        return df

    # TWSE API 無資料（Render 伺服器可能被封鎖）→ fallback 到 yfinance
    logger.warning("TWSE/TPEx API returned no data for %s, falling back to yfinance", symbol)
    return _fetch_tw_yfinance(symbol, fetch_start, fetch_end)


# ─────────────────────────────────────────────
#  美股資料（yfinance >= 1.2.0）
# ─────────────────────────────────────────────

def _fetch_us_stock(symbol: str,
                    fetch_start: Optional[date] = None,
                    fetch_end:   Optional[date] = None) -> Optional[pd.DataFrame]:
    """yf.download 下載美股歷史資料，相容 yfinance 1.x MultiIndex 格式。"""
    try:
        import yfinance as yf
        end   = fetch_end   or date.today()
        start = fetch_start or (end - timedelta(days=HISTORY_DAYS_SIM))
        # yfinance end 為不含，加 1 天確保包含 end_date 當天
        df = yf.download(
            symbol, start=str(start), end=str(end + timedelta(days=1)),
            interval="1d", progress=False, auto_adjust=True,
        )
        if df.empty or len(df) < 30:
            logger.warning("yfinance %s: empty or too few rows", symbol)
            return None

        # yfinance 1.x 回傳 MultiIndex columns (Price, Ticker)，需攤平
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        df.index = pd.to_datetime(df.index).tz_localize(None)
        return df[["Open", "High", "Low", "Close", "Volume"]].astype(float)

    except Exception as e:
        logger.error("yfinance fetch %s: %s", symbol, e)
        return None


# ─────────────────────────────────────────────
#  指標計算
# ─────────────────────────────────────────────

def _calc_rsv(df: pd.DataFrame, period: int = 9) -> pd.Series:
    """RSV = (Close - Lowest Low_period) / (Highest High_period - Lowest Low_period) × 100"""
    low_min  = df["Low"].rolling(window=period,  min_periods=period).min()
    high_max = df["High"].rolling(window=period, min_periods=period).max()
    denom    = (high_max - low_min).replace(0, float("nan"))
    return ((df["Close"] - low_min) / denom * 100).fillna(50.0)


def _calc_k(rsv: pd.Series, smooth: int = 3) -> pd.Series:
    """K 值遞迴計算：K = prev_K × (n-1)/n + RSV/n，初始值 50。"""
    k_vals  = []
    prev_k  = 50.0
    for v in rsv:
        if pd.isna(v):
            k_vals.append(float("nan"))
        else:
            k = prev_k * (smooth - 1) / smooth + v / smooth
            k_vals.append(k)
            prev_k = k
    return pd.Series(k_vals, index=rsv.index)


def _k_state(k: float, prev_k: float) -> str:
    if pd.isna(k):
        return "—"
    if k >= 80:
        return "🔴超買"
    if k <= 20:
        return "🟢超賣"
    if k > prev_k:
        return "📈轉強"
    return "📉轉弱"


def _trend(ma5: float, ma100: float) -> str:
    if pd.isna(ma5) or pd.isna(ma100):
        return "—"
    return "🟢多頭趨勢" if ma5 >= ma100 else "🔴空頭趨勢"


def _ppp(trend: str, close: float, ma5: float, ma5_prev: float,
         ma20: float, ma60: float, ma100: float) -> str:
    """PPP 指標（對齊 Google Sheet P 欄公式）。
    🟢多頭趨勢：均線多頭排列(MA5>MA20>MA60>MA100) + 下半身(close>MA5) → 做多
                收盤<MA5 或 MA5 下彎(MA5<prev_MA5) → 多單平倉
    🔴空頭趨勢：均線空頭排列(MA5<MA20<MA60<MA100) + 反下半身(close<MA5) → 做空
                收盤>MA5 或 MA5 上彎(MA5>prev_MA5) → 空單回補
    """
    if any(pd.isna(v) for v in [ma5, ma20, ma60, ma100]):
        return "⌛觀望/整理中"

    if trend == "🟢多頭趨勢":
        if ma5 > ma20 > ma60 > ma100 and close > ma5:
            return "⚾做多：強勢PPP+下半身"
        if close < ma5 or (not pd.isna(ma5_prev) and ma5 < ma5_prev):
            return "✋多單平倉：反下半身出現"

    elif trend == "🔴空頭趨勢":
        if ma5 < ma20 < ma60 < ma100 and close < ma5:
            return "🥎做空：跌勢PPP+反下半身"
        if close > ma5 or (not pd.isna(ma5_prev) and ma5 > ma5_prev):
            return "✋空單回補：下半身出現"

    return "⌛觀望/整理中"


def _short_sig(close: float, open_: float, ma5: float, ma100: float) -> str:
    """短期交易訊號（對齊 Google Sheet R 欄公式）。
    條件（IFS 順序）：
    1. |close - MA100| < MA100×0.003  → 趨勢不明：出清
    2. close>MA100 且 紅K 且 中點>MA5  → 做多：下半身
    3. close>MA100 且 close<MA5 且 中點<MA5 → 多單撤退：反下半身
    4. close<MA100 且 黑K 且 中點<MA5  → 做空：反下半身
    5. close<MA100 且 close>MA5 且 中點>MA5 → 空單回補：下半身
    """
    if pd.isna(ma5) or pd.isna(ma100):
        return "⌛等待好球 (K線未達標)"

    mid = (close + open_) / 2  # K 線中點（body midpoint）

    # 趨勢不明：收盤與 MA100 差距 < 0.3%
    if abs(close - ma100) < ma100 * 0.003:
        return "🛑趨勢不明：出清所有部位"

    # 多頭區（close > MA100）
    if close > ma100:
        if close > open_ and mid > ma5:          # 紅K + 中點過5MA = 下半身
            return "⚾做多：下半身(紅K過5MA)"
        if close < ma5 and mid < ma5:            # 收盤跌破5MA + 中點在5MA下 = 反下半身
            return "✋多單撤退：反下半身出現"

    # 空頭區（close < MA100）
    else:
        if close < open_ and mid < ma5:          # 黑K + 中點破5MA = 反下半身
            return "🥎做空：反下半身(黑K破5MA)"
        if close > ma5 and mid > ma5:            # 收盤站上5MA + 中點在5MA上 = 下半身
            return "✋空單回補：下半身出現"

    return "⌛等待好球 (K線未達標)"


# ─────────────────────────────────────────────
#  自動策略模擬（含出場日實現損益）
# ─────────────────────────────────────────────

def _simulate_auto(rows: List[Dict], shares: int, usd_twd: float,
                   is_us: bool) -> List[Dict]:
    """
    自動策略持倉模擬（對齊 Google Sheet T 欄持倉公式）。

    持倉邏輯（直接從 sig 首字元判斷，不做狀態轉移）：
      ✋ 或 🛑 開頭 → 空手   （出場，含方向轉換前的舊倉）
      ⚾ 開頭      → 多單   （可從空手或空單直接進）
      🥎 開頭      → 空單   （可從空手或多單直接進）
      其他         → 繼承前一日持倉

    出場損益：prev_hold=多/空單 且 new_hold≠prev_hold 時，
              以當日收盤計算實現損益。
    """
    hold        = "空手"
    entry_price = 0.0
    result      = []

    for row in rows:
        close          = row["close"]
        sig            = row["sig"]
        prev_hold      = hold
        entry_snapshot = entry_price  # 出場前的進場價（供損益計算用）

        # ── GS 持倉公式：首字元決定新持倉 ──────
        first = sig[0] if sig else ""
        if first in ("✋", "🛑"):
            new_hold = "空手"
        elif first == "⚾":
            new_hold = "多單"
        elif first == "🥎":
            new_hold = "空單"
        else:
            new_hold = hold  # 繼承前一日

        # ── 是否出場（含方向直接轉換） ──────────
        is_exit = prev_hold != "空手" and new_hold != prev_hold

        # ── 更新進場價 ────────────────────────
        if new_hold == "空手":
            entry_price = 0.0
        elif new_hold != prev_hold:
            entry_price = close   # 新進場（含方向轉換後的新倉）

        hold = new_hold

        # ── 損益計算 ──────────────────────────
        if is_exit:
            # 出場（用 prev_hold 判斷方向）
            raw_pnl = (close - entry_snapshot) if prev_hold == "多單" \
                      else (entry_snapshot - close)
        elif hold == "多單" and entry_price > 0:
            raw_pnl = close - entry_price          # 多單浮動損益
        elif hold == "空單" and entry_price > 0:
            raw_pnl = entry_price - close          # 空單浮動損益
        else:
            raw_pnl = 0.0

        pnl_twd = round(raw_pnl * shares * (usd_twd if is_us else 1.0))

        # ── 顯示欄位 ─────────────────────────
        # 純出場（到空手）：顯示"空手" + 原進場價（參考用）
        # 方向轉換：顯示新方向 + 新進場價（同日收盤）
        if is_exit and hold == "空手":
            display_hold  = "空手"
            display_entry = entry_snapshot
        else:
            display_hold  = hold
            display_entry = entry_price if hold != "空手" else 0.0

        result.append({
            **row,
            "auto_hold":    display_hold,
            "auto_entry":   round(display_entry, 2) if display_entry else 0.0,
            "auto_pnl_twd": pnl_twd,
        })

    return result


# ─────────────────────────────────────────────
#  主要對外函式：取得 30 日模擬資料
# ─────────────────────────────────────────────

def get_simulation_data(symbol: str, market: str,
                        start_date: Optional[str] = None,
                        end_date:   Optional[str] = None) -> Optional[Dict]:
    """
    回傳指定區間帶有完整指標與自動策略損益的資料表。
    market: 'TW' | 'US'
    start_date / end_date: YYYY-MM-DD（不傳則預設最近 30 個交易日）
    """
    market  = market.upper()
    usd_twd = get_usd_twd_rate()
    shares  = DEFAULT_SHARES_US if market == "US" else DEFAULT_SHARES_TW

    today = date.today()
    # 解析顯示區間
    disp_end   = date.fromisoformat(end_date)   if end_date   else today
    disp_start = date.fromisoformat(start_date) if start_date else None

    # 計算抓取區間（需要額外 200 個日曆天做指標暖身）
    WARMUP_DAYS = 200
    fetch_end   = disp_end
    fetch_start = (disp_start - timedelta(days=WARMUP_DAYS)) if disp_start \
                  else (disp_end - timedelta(days=HISTORY_DAYS_SIM))

    # ── 取得原始資料 ────────────────────────
    if market == "TW":
        # 支援 2330 / 2330.TW / 2330.TWO
        if symbol.endswith(".TW") or symbol.endswith(".TWO"):
            sym_full = symbol
        else:
            sym_full = f"{symbol}.TW"   # 預設 TWSE，找不到時再試 TWO
        df = _fetch_tw_stock_range(sym_full, fetch_start, fetch_end)
        if df is None or df.empty:
            sym_full = f"{symbol}.TWO"
            df = _fetch_tw_stock_range(sym_full, fetch_start, fetch_end)
        display_symbol = symbol.split(".")[0]
    else:
        sym_full       = symbol.upper()
        df             = _fetch_us_stock(sym_full, fetch_start, fetch_end)
        display_symbol = sym_full

    if df is None or df.empty or len(df) < 30:
        logger.warning("No data for %s (%s)", symbol, market)
        return None

    df = df.dropna(subset=["Open", "High", "Low", "Close"]).copy()

    # ── 指標計算（全歷史，確保準確）────────
    df["MA5"]   = calculate_ma(df["Close"], 5)
    df["MA20"]  = calculate_ma(df["Close"], 20)
    df["MA60"]  = calculate_ma(df["Close"], 60)
    df["MA100"] = calculate_ma(df["Close"], 100)

    rsv         = _calc_rsv(df)
    df["RSV"]   = rsv
    df["K"]     = _calc_k(rsv)

    # ── MA100 穿越訊號（近3日）────────────────
    # 在全歷史資料上計算，確保顯示範圍邊界也有正確的3日回溯
    cross_sig_map: Dict[str, str] = {}
    for i in range(3, len(df)):
        window = df.iloc[i - 3: i + 1]
        dt_key = str(df.index[i].date())
        if check_long_signal(window):
            cross_sig_map[dt_key] = "LONG"
        elif check_short_signal(window):
            cross_sig_map[dt_key] = "SHORT"

    # ── 篩選顯示範圍 ────────────────────────
    if disp_start:
        ts_start = pd.Timestamp(disp_start)
        ts_end   = pd.Timestamp(disp_end)
        df_show  = df[(df.index.normalize() >= ts_start) &
                      (df.index.normalize() <= ts_end)].copy()
    else:
        df_show  = df.tail(DISPLAY_DAYS).copy()

    if df_show.empty:
        logger.warning("No rows in display range for %s", symbol)
        return None

    rows: List[Dict] = []
    prev_k   = 50.0
    prev_ma5 = float("nan")  # 追蹤前一日 MA5，供 PPP 判斷均線彎頭

    for i, (idx, row) in enumerate(df_show.iterrows()):
        close  = float(row["Close"])
        open_  = float(row["Open"])
        high   = float(row["High"])
        low    = float(row["Low"])
        ma5    = float(row["MA5"])   if pd.notna(row["MA5"])   else float("nan")
        ma20   = float(row["MA20"])  if pd.notna(row["MA20"])  else float("nan")
        ma60   = float(row["MA60"])  if pd.notna(row["MA60"])  else float("nan")
        ma100  = float(row["MA100"]) if pd.notna(row["MA100"]) else float("nan")
        k_val  = float(row["K"])     if pd.notna(row["K"])     else float("nan")

        trend_str = _trend(ma5, ma100)
        k_st      = _k_state(k_val, prev_k)
        prev_k    = k_val if not pd.isna(k_val) else prev_k

        rows.append({
            "date":    str(idx.date()),
            "open":    round(open_,  2),
            "high":    round(high,   2),
            "low":     round(low,    2),
            "close":   round(close,  2),
            "ma5":     round(ma5,    2) if not pd.isna(ma5)   else None,
            "ma20":    round(ma20,   2) if not pd.isna(ma20)  else None,
            "ma60":    round(ma60,   2) if not pd.isna(ma60)  else None,
            "ma100":   round(ma100,  2) if not pd.isna(ma100) else None,
            "k":       round(k_val,  1) if not pd.isna(k_val) else None,
            "k_state": k_st,
            "trend":     trend_str,
            "ppp":       _ppp(trend_str, close, ma5, prev_ma5, ma20, ma60, ma100),
            "sig":       _short_sig(close, open_, ma5, ma100),
            "cross_sig": cross_sig_map.get(str(idx.date())),
        })

        prev_ma5 = ma5  # 更新前一日 MA5

    # ── 自動策略損益模擬 ─────────────────────
    rows = _simulate_auto(rows, shares, usd_twd, is_us=(market == "US"))

    return {
        "symbol":        display_symbol,
        "symbol_full":   sym_full,
        "market":        market,
        "usd_twd":       round(usd_twd, 2),
        "default_shares": shares,
        "rows":          rows,
    }


# ─────────────────────────────────────────────
#  交易記錄 CRUD
# ─────────────────────────────────────────────

import os
from database import _connect, _is_postgres, _column_exists


def init_trades_table() -> None:
    """建立 trades 資料表（若不存在），並自動補齊新欄位。"""
    auto = "SERIAL" if _is_postgres() else "INTEGER"
    now  = "NOW()" if _is_postgres() else "(datetime('now'))"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS trades (
            id          {auto} PRIMARY KEY,
            symbol      TEXT    NOT NULL,
            market      TEXT    NOT NULL,
            direction   TEXT    NOT NULL DEFAULT '多單',
            entry_date  TEXT,
            entry_price REAL,
            shares      INTEGER,
            cost        REAL,
            exit_date   TEXT,
            exit_price  REAL,
            notes       TEXT,
            created_at  TEXT    DEFAULT {now}
        )
    """)
    for col, dtype in [("direction", "TEXT NOT NULL DEFAULT '多單'"),
                       ("exit_date",  "TEXT"),
                       ("exit_price", "REAL")]:
        if not _column_exists(cur, "trades", col):
            cur.execute(f"ALTER TABLE trades ADD COLUMN {col} {dtype}")
    conn.commit()
    conn.close()


def get_trades(symbol: str, market: str) -> List[Dict]:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(
        f"SELECT * FROM trades WHERE symbol={ph} AND market={ph} ORDER BY entry_date ASC, created_at ASC",
        (symbol.upper(), market.upper()),
    )
    if _is_postgres():
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    else:
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    conn.close()
    return rows


def add_trade(symbol: str, market: str, direction: str, entry_date: str,
              entry_price: float, shares: int,
              cost: float, notes: str = "") -> Dict:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    if _is_postgres():
        cur.execute(
            f"""INSERT INTO trades (symbol, market, direction, entry_date, entry_price, shares, cost, notes)
               VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph}) RETURNING id""",
            (symbol.upper(), market.upper(), direction,
             entry_date, entry_price, shares, cost, notes),
        )
        trade_id = cur.fetchone()[0]
    else:
        cur.execute(
            f"""INSERT INTO trades (symbol, market, direction, entry_date, entry_price, shares, cost, notes)
               VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph})""",
            (symbol.upper(), market.upper(), direction,
             entry_date, entry_price, shares, cost, notes),
        )
        trade_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": trade_id}


def record_exit(trade_id: int, exit_date: str, exit_price: float) -> bool:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(
        f"UPDATE trades SET exit_date={ph}, exit_price={ph} WHERE id={ph}",
        (exit_date, exit_price, trade_id),
    )
    conn.commit()
    updated = cur.rowcount > 0
    conn.close()
    return updated


def delete_trade(trade_id: int) -> bool:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(f"DELETE FROM trades WHERE id={ph}", (trade_id,))
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted
