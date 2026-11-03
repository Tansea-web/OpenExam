/**
 * 每日自动备份（设计参考题舟：启动时当日无备份 → wal_checkpoint(FULL) → 拷贝 → 修剪）
 *
 * 策略：
 * - 设置项 auto_backup = '0' 时关闭；缺省开启
 * - 同一天重复启动不重复备份（按文件名里的日期判断）
 * - 保留最近 N 份（backup_retention，默认 7），超出删除
 * - 任何失败都由调用方兜底，不阻塞应用启动
 */

const fs = require('fs');
const path = require('path');

const RETENTION_DEFAULT = 7;
const BACKUP_FILE_PATTERN = /^openexam-backup-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.db$/;

function getBackupDir(userDataPath) {
  return path.join(userDataPath, 'backups');
}

function todayStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => {
      const match = BACKUP_FILE_PATTERN.exec(name);
      if (!match) return null;
      const full = path.join(dir, name);
      try {
        return {
          name,
          path: full,
          date: match[1],
          mtime: fs.statSync(full).mtimeMs,
        };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

function prune(dir, backups, keep) {
  let removed = 0;
  backups.slice(Math.max(0, keep)).forEach((item) => {
    try {
      fs.unlinkSync(item.path);
      removed += 1;
    } catch (error) {
      console.error('[backup] 清理旧备份失败:', item.name, error.message);
    }
  });
  return removed;
}

/**
 * 执行每日备份。
 * @param {object} deps
 * @param {(targetPath: string) => void} deps.createBackup  WAL 检查点后拷贝数据库到目标路径
 * @param {string} deps.backupDir                          备份目录
 * @param {(key: string) => string|null} [deps.getSetting] 读取 app_settings 值
 * @param {number} [deps.retention]                        保留份数，缺省走设置或 7
 * @returns {{success?: boolean, skipped?: boolean, reason?: string, file?: string, count?: number, removed?: number}}
 */
function runDailyBackup({ createBackup, backupDir, getSetting, retention } = {}) {
  if (typeof createBackup !== 'function' || !backupDir) {
    return { skipped: true, reason: 'invalid-deps' };
  }

  const retentionValue = Number(
    retention ?? (typeof getSetting === 'function' ? getSetting('backup_retention') : null)
  );
  const keep = Number.isFinite(retentionValue) && retentionValue > 0 ? Math.floor(retentionValue) : RETENTION_DEFAULT;

  if (typeof getSetting === 'function' && String(getSetting('auto_backup') ?? '') === '0') {
    return { skipped: true, reason: 'disabled' };
  }

  const existing = listBackups(backupDir);
  const today = todayStamp();
  if (existing.some((item) => item.date === today)) {
    const removed = prune(backupDir, existing, keep);
    return { skipped: true, reason: 'already-backed-up', count: existing.length - removed, removed };
  }

  const target = path.join(backupDir, `openexam-backup-${today}.db`);
  createBackup(target);
  const backups = listBackups(backupDir);
  const removed = prune(backupDir, backups, keep);

  return {
    success: true,
    file: target,
    count: backups.length - removed,
    removed,
  };
}

module.exports = { getBackupDir, runDailyBackup, listBackups, todayStamp };
