"""
indicators.py
─────────────────────────────────────────────────────────────────────
技術指標計算模組：MA5、MA100、成交量比率、交叉接近程度，
以及做多 / 做空訊號判斷。

策略邏輯：
  共同前置條件（做多 & 做空）：
    - 成交量 > 20 日平均成交量（確認市場積極參與）

  做多（LONG）：
    1. |MA5 - MA100| / MA100 < 0.02  → 均線交叉區附近
    2. 當日為紅K（收 > 開）
    3. 收盤 > 昨日最高價（突破）
    4. 收盤 > MA5 且 收盤 > MA100

  做空（SHORT）：
    1. |MA5 - MA100| / MA100 < 0.02  → 均線交叉區附近
    2. 當日為黑K（收 < 開）
    3. 收盤 < 昨日最低價（跌破）
    4. 收盤 < MA5 且 收盤 < MA100

排序欄位：
  cross_proximity = |MA5 - MA100| / MA100
  值越小 = 越接近交叉點 = 排列越前面
"""

import pandas as pd
from typing import Tuple


# ─────────────────────────────────────────────
#  均線計算
# ─────────────────────────────────────────────

def calculate_ma(series: pd.Series, period: int) -> pd.Series:
    """計算簡單移動平均線（SMA）。資料不足 period 筆時回傳 NaN。"""
    return series.rolling(window=period, min_periods=period).mean()


# ─────────────────────────────────────────────
#  成交量過濾
# ─────────────────────────────────────────────

def check_volume_filter(df: pd.DataFrame, period: int = 20) -> Tuple[bool, float]:
    """
    當天成交量是否大於 N 日平均成交量。
    回傳 (pass: bool, volume_ratio: float)

    - pass=True  → 通過過濾（量能放大）
    - volume_ratio = 今日量 / N 日均量
    - 無法計算時預設放行（ratio=1.0）
    """
    if "Volume" not in df.columns or len(df) < period + 1:
        return True, 1.0

    vol_today = float(df["Volume"].iloc[-1])
    vol_avg   = float(df["Volume"].iloc[-(period + 1) : -1].mean())

    if vol_avg == 0 or pd.isna(vol_avg) or pd.isna(vol_today):
        return True, 1.0

    ratio = vol_today / vol_avg
    return ratio > 1.0, round(ratio, 3)


# ─────────────────────────────────────────────
#  交叉接近程度
# ─────────────────────────────────────────────

def compute_cross_proximity(ma5: float, ma100: float) -> float:
    """
    計算 MA5 與 MA100 的交叉接近程度。
    回傳 |MA5 - MA100| / MA100，值越小代表越接近交叉點。
    """
    if ma100 == 0:
        return float("inf")
    return abs(ma5 - ma100) / ma100


# ─────────────────────────────────────────────
#  訊號判斷
# ─────────────────────────────────────────────

def check_long_signal(df: pd.DataFrame) -> bool:
    """
    判斷做多訊號。
    傳入含 MA5、MA100 欄位的 DataFrame（至少 2 列）。
    注意：成交量過濾應在呼叫此函式前完成。
    """
    if len(df) < 2:
        return False

    today     = df.iloc[-1]
    yesterday = df.iloc[-2]

    ma5   = today.get("MA5")
    ma100 = today.get("MA100")

    if pd.isna(ma5) or pd.isna(ma100) or ma100 == 0:
        return False

    near_cross      = abs(ma5 - ma100) / ma100 < 0.02   # 條件 1：交叉區
    bullish_candle  = today["Close"] > today["Open"]     # 條件 2：紅 K
    above_prev_high = today["Close"] > yesterday["High"] # 條件 3：突破昨高
    above_mas       = today["Close"] > ma5 and today["Close"] > ma100  # 條件 4

    return near_cross and bullish_candle and above_prev_high and above_mas


def check_short_signal(df: pd.DataFrame) -> bool:
    """
    判斷做空訊號。
    傳入含 MA5、MA100 欄位的 DataFrame（至少 2 列）。
    """
    if len(df) < 2:
        return False

    today     = df.iloc[-1]
    yesterday = df.iloc[-2]

    ma5   = today.get("MA5")
    ma100 = today.get("MA100")

    if pd.isna(ma5) or pd.isna(ma100) or ma100 == 0:
        return False

    near_cross     = abs(ma5 - ma100) / ma100 < 0.02   # 條件 1：交叉區
    bearish_candle = today["Close"] < today["Open"]     # 條件 2：黑 K
    below_prev_low = today["Close"] < yesterday["Low"]  # 條件 3：跌破昨低
    below_mas      = today["Close"] < ma5 and today["Close"] < ma100  # 條件 4

    return near_cross and bearish_candle and below_prev_low and below_mas
