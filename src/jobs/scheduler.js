import cron from 'node-cron';
import logger from '../utils/logger.js';
import WeatherRefreshJob from './jobs/weatherRefresh.job.js';
import {
  FwiRecalculationJob,
  CacheMaintenanceJob,
} from './jobs/fwiRecalculation.job.js';

/**
 * Background job scheduler.
 *
 * All jobs are guarded against overlapping runs and wrap their execution in
 * try/catch so a failing job never takes the process down. Jobs are prepared
 * for future expansion (notifications, satellite data ingestion, etc.) and
 * can be disabled with JOBS_ENABLED=false.
 */
class Scheduler {
  constructor() {
    this.tasks = [];
  }

  /**
   * Register and start every scheduled job.
   *
   * @returns {boolean} true when the scheduler started
   */
  start() {
    const jobs = [
      new WeatherRefreshJob(),
      new FwiRecalculationJob(),
      new CacheMaintenanceJob(),
    ];

    for (const job of jobs) {
      try {
        const task = cron.schedule(job.cronExpression, () => {
          job.run().catch((err) => {
            logger.error(`[scheduler] job ${job.constructor.name} crashed: ${err.message}`);
          });
        });
        this.tasks.push({ job: job.constructor.name, cron: job.cronExpression, task });
        logger.info(`[scheduler] scheduled ${job.constructor.name} (${job.cronExpression})`);
      } catch (err) {
        logger.error(
          `[scheduler] failed to schedule ${job.constructor.name}: ${err.message}`
        );
      }
    }

    return this.tasks.length > 0;
  }

  /**
   * Stop every scheduled job. Safe to call multiple times.
   */
  stop() {
    for (const entry of this.tasks) {
      try {
        entry.task.stop();
      } catch (err) {
        logger.warn(`[scheduler] error stopping ${entry.job}: ${err.message}`);
      }
    }
    this.tasks = [];
  }
}

/** Singleton scheduler for the application. */
export const scheduler = new Scheduler();

export default scheduler;
