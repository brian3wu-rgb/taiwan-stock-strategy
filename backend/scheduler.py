"""
scheduler.py
─────────────────────────────────────────────────────────────────────
APScheduler 排程模組。

排程：
  台股掃描 — 週一至週五，台灣時間 15:30（收盤後）
  美股掃描 — 週二至週六，台灣時間 05:30
             （美股 4pm EST = 台灣 05:00 冬令 / 04:00 夏令，
               05:30 可確保夏令冬令都已收盤）
"""

import asyncio
import logging
from datetime import date, datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from scanner import run_scan, run_us_scan_async
from database import save_scan_results, log_scan

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
#  台股定時掃描
# ─────────────────────────────────────────────

def _scheduled_scan_job():
    """排程觸發的台股掃描任務。"""
    logger.info("Scheduled TW scan triggered.")
    started_at = datetime.now()
    today = str(date.today())

    try:
        results = run_scan()
        if results:
            save_scan_results(results, today, market="TW")

        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=len(results),
            status="success",
        )
        logger.info("Scheduled TW scan done: %d signals on %s", len(results), today)

    except Exception as e:
        logger.error("Scheduled TW scan error: %s", e)
        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=0,
            status="failed",
            error_msg=str(e),
        )


# ─────────────────────────────────────────────
#  美股定時掃描
# ─────────────────────────────────────────────

def _scheduled_us_scan_job():
    """排程觸發的美股掃描任務（在新 event loop 中執行 async）。"""
    logger.info("Scheduled US scan triggered.")
    started_at = datetime.now()
    today = str(date.today())

    try:
        results = asyncio.run(run_us_scan_async())
        if results:
            save_scan_results(results, today, market="US")

        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=len(results),
            status="success",
        )
        logger.info("Scheduled US scan done: %d signals on %s", len(results), today)

    except Exception as e:
        logger.error("Scheduled US scan error: %s", e)
        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=0,
            status="failed",
            error_msg=str(e),
        )


# ─────────────────────────────────────────────
#  啟動排程器
# ─────────────────────────────────────────────

def start_scheduler() -> BackgroundScheduler:
    """
    啟動排程器。
      台股：週一～週五 15:30 Asia/Taipei
      美股：週二～週六 05:30 Asia/Taipei
            （週一至週五美股收盤 → 台灣時間次日凌晨，
              因此排程日移一天：mon→tue, ..., fri→sat）
    """
    scheduler = BackgroundScheduler(timezone="Asia/Taipei")

    # ── 台股 ─────────────────────────────────
    scheduler.add_job(
        _scheduled_scan_job,
        CronTrigger(
            day_of_week="mon-fri",
            hour=15,
            minute=30,
            timezone="Asia/Taipei",
        ),
        id="daily_tw_scan",
        name="台股每日收盤後掃描",
        replace_existing=True,
    )

    # ── 美股 ─────────────────────────────────
    scheduler.add_job(
        _scheduled_us_scan_job,
        CronTrigger(
            day_of_week="tue-sat",   # 美股週一收盤 → 台灣時間週二凌晨
            hour=5,
            minute=30,
            timezone="Asia/Taipei",
        ),
        id="daily_us_scan",
        name="美股每日收盤後掃描",
        replace_existing=True,
    )

    scheduler.start()

    tw_job = scheduler.get_job("daily_tw_scan")
    us_job = scheduler.get_job("daily_us_scan")
    logger.info("Scheduler started. TW next: %s | US next: %s",
                tw_job.next_run_time if tw_job else None,
                us_job.next_run_time if us_job else None)
    return scheduler
