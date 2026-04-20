"""
scheduler.py
─────────────────────────────────────────────────────────────────────
APScheduler 排程模組。
每個交易日（週一至週五）台灣時間 15:30 自動執行掃描，
並將結果儲存至 SQLite 資料庫。
"""

import logging
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from scanner import run_scan
from database import save_scan_results, log_scan
from datetime import datetime

logger = logging.getLogger(__name__)


def _scheduled_scan_job():
    """排程觸發的掃描任務。"""
    logger.info("Scheduled scan triggered.")
    started_at = datetime.now()
    today = str(date.today())

    try:
        results = run_scan()
        if results:
            save_scan_results(results, today)

        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=len(results),
            status="success",
        )
        logger.info("Scheduled scan done: %d signals on %s", len(results), today)

    except Exception as e:
        logger.error("Scheduled scan error: %s", e)
        log_scan(
            started_at=started_at,
            finished_at=datetime.now(),
            total_scanned=0,
            signals_found=0,
            status="failed",
            error_msg=str(e),
        )


def start_scheduler() -> BackgroundScheduler:
    """
    啟動排程器。
    預設：週一至週五，台灣時間（Asia/Taipei）15:30 執行。
    """
    scheduler = BackgroundScheduler(timezone="Asia/Taipei")

    scheduler.add_job(
        _scheduled_scan_job,
        CronTrigger(
            day_of_week="mon-fri",
            hour=15,
            minute=30,
            timezone="Asia/Taipei",
        ),
        id="daily_scan",
        name="每日收盤後掃描",
        replace_existing=True,
    )

    scheduler.start()

    # 顯示下次執行時間
    job = scheduler.get_job("daily_scan")
    next_run = job.next_run_time if job else None
    logger.info("Scheduler started. Next scan: %s (weekdays 15:30 Asia/Taipei)", next_run)
    return scheduler
