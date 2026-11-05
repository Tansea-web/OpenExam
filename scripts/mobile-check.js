/**
 * 窄屏预览 / 回归工具
 *
 * 用法（先 npm run build）：
 *   npx electron scripts/mobile-check.js --page=all
 *   npx electron scripts/mobile-check.js --page=exam
 *   npx electron scripts/mobile-check.js --page=practice --hold
 *   npx electron scripts/mobile-check.js --page=practice --size=768x1024
 *
 * 参数：
 *   --page=home|practice|wrong|analytics|ai|center|settings|history|import|essay|exam|result|all
 *   --size=WxH      视口尺寸，默认 390x844
 *   --hold          不自动退出，停在目标页面手动体验
 *   --out=<dir>     截图目录，默认系统临时目录 openexam-mobile
 *   --beat=<ms>     每步等待时间，默认 1200
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

require(path.join(__dirname, '..', 'main.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const opt = { page: 'all', width: 390, height: 844, hold: false, out: '', beat: 1200, scroll: '' };
for (const item of process.argv.slice(2)) {
  if (!item.startsWith('--')) continue;
  const [key, value = ''] = item.slice(2).split('=');
  if (key === 'hold') opt.hold = true;
  else if (key === 'page') opt.page = value || 'all';
  else if (key === 'out') opt.out = value;
  else if (key === 'scroll') opt.scroll = value;
  else if (key === 'beat') opt.beat = Number(value) || opt.beat;
  else if (key === 'size') {
    const [w, h] = value.split('x').map(Number);
    if (w) opt.width = w;
    if (h) opt.height = h;
  }
}

const OUT_DIR = opt.out ? path.resolve(opt.out) : path.join(app.getPath('temp'), 'openexam-mobile');
fs.mkdirSync(OUT_DIR, { recursive: true });

const warnings = [];

const shot = async (win, name) => {
  const image = await win.webContents.capturePage();
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`  png  ${file}`);
};

const probe = (win) =>
  win.webContents.executeJavaScript(`(() => {
    const de = document.documentElement;
    const rail = document.querySelector('.rail');
    return {
      viewport: innerWidth + 'x' + innerHeight,
      overflowX: de.scrollWidth - de.clientWidth,
      railRow: rail ? getComputedStyle(rail).flexDirection : null,
    };
  })()`);

const click = async (win, selector) => {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) console.log(`  miss ${selector}`);
  return ok;
};

const clickText = async (win, text, selector = 'button') => {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) console.log(`  miss text "${text}"`);
  return ok;
};

const dismissAchievements = async (win) => {
  for (let i = 0; i < 16; i += 1) {
    const state = await win.webContents.executeJavaScript(`(() => {
      const accept = document.querySelector('.ach-ceremony-accept');
      if (accept) { accept.click(); return 'accept'; }
      const scrim = document.querySelector('.ach-ceremony-scrim');
      if (scrim) { scrim.click(); return 'scrim'; }
      if (document.querySelector('.ach-ceremony, .ach-keep-overlay')) {
        const close = document.querySelector('.ach-keep-close, [class*="keep"] button');
        if (close) { close.click(); return 'keep'; }
      }
      return 'none';
    })()`);
    if (state === 'none') break;
    await sleep(600);
  }
  await sleep(500);
};

const openPractice = async (win) => {
  await click(win, '.rail-icon.practice');
  await sleep(opt.beat);
};

const goExam = async (win) => {
  await openPractice(win);
  await click(win, '.practice-start-btn');
  await sleep(opt.beat);
};

const PAGES = {
  home: { label: '首页/今日', goto: (win) => clickText(win, '今日', '.tab') },
  trackopen: {
    label: '目标切换下拉',
    goto: (win) => click(win, '.header-track .oe-select-trigger'),
  },
  practice: { label: '题库练习', goto: openPractice },
  wrong: { label: '错题本', goto: (win) => click(win, '.rail-icon.wrong-book') },
  analytics: { label: '分析报告', goto: (win) => click(win, '.rail-icon.analytics') },
  ai: {
    label: 'AI 老师',
    goto: async (win) => {
      await click(win, '.rail-icon.ai-teacher');
      await sleep(opt.beat);
      if (await click(win, '.ait-panel-toggle')) {
        await sleep(600);
        await shot(win, 'ai-drawer');
        await click(win, '.ait-backdrop.is-open');
        await sleep(400);
      }
    },
  },
  center: { label: '学习中心', goto: (win) => clickText(win, '学习中心', '.tab') },
  papers: { label: '模拟考试', goto: (win) => clickText(win, '模拟考试', '.tab') },
  aigen: { label: 'AI 出卷', goto: (win) => clickText(win, 'AI出卷', '.tab') },
  growth: { label: '我的成长', goto: (win) => clickText(win, '我的成长', '.tab') },
  notify: {
    label: '通知面板',
    goto: async (win) => {
      await clickText(win, '今日', '.tab');
      await sleep(opt.beat);
      await click(win, '.home-notify-btn');
    },
  },
  usermenu: {
    label: '用户菜单',
    goto: async (win) => {
      await clickText(win, '今日', '.tab');
      await sleep(opt.beat);
      await click(win, '.user-trigger');
    },
  },
  tomomodal: {
    label: '待办设置弹窗',
    goto: async (win) => {
      await clickText(win, '今日', '.tab');
      await sleep(opt.beat);
      await click(win, '.today-manage');
    },
  },
  configmodal: {
    label: '练习设置弹窗',
    goto: async (win) => {
      await openPractice(win);
      await clickText(win, '练习设置');
    },
  },
  settings: { label: '设置', goto: (win) => click(win, '.settings-btn') },
  importset: {
    label: '设置-导入设置',
    goto: async (win) => {
      await click(win, '.settings-btn');
      await sleep(opt.beat);
      await clickText(win, '导入设置');
    },
  },

  essay: { label: '申论', goto: (win) => click(win, '.rail-icon.essay') },
  history: {
    label: '练习历史',
    goto: async (win) => {
      await openPractice(win);
      await clickText(win, '练习历史');
    },
  },
  import: {
    label: '导入试卷',
    goto: async (win) => {
      await openPractice(win);
      await clickText(win, '导入试卷');
    },
  },
  exam: {
    label: '答题页',
    goto: async (win) => {
      await goExam(win);
      if (await click(win, '.er-card-toggle')) {
        await sleep(600);
        await shot(win, 'exam-drawer');
        await click(win, '.er-backdrop.is-open');
        await sleep(400);
      }
    },
  },
  result: {
    label: '交卷结果',
    goto: async (win) => {
      // 已在答题页（--page=all 的顺序）就直接交卷，否则先进入答题页
      const inExam = await win.webContents.executeJavaScript(
        `Boolean(document.querySelector('.er-header'))`
      );
      if (!inExam) await goExam(win);
      await win.webContents.executeJavaScript(`(() => {
        const btn = [...document.querySelectorAll('.er-header button')].find((b) => b.textContent.trim() === '交卷');
        if (btn) btn.click();
      })()`);
      await sleep(800);
      await click(win, '.app-dialog-btn.primary');
      await sleep(1500);
      await dismissAchievements(win);
    },
  },
};

const ALL_ORDER = ['home', 'trackopen', 'notify', 'usermenu', 'practice', 'configmodal', 'wrong', 'analytics', 'ai', 'center', 'papers', 'aigen', 'growth', 'settings', 'history', 'import', 'essay', 'tomomodal', 'exam', 'result'];

// 找出超出视口左右的可见元素（弹层被裁切的典型症状）
const auditOffscreen = (win) =>
  win.webContents.executeJavaScript(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 12) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      // 收起状态的抽屉本来就是移到视口外，属于预期
      if (el.closest('.ait-aside, .er-aside')) continue;
      if (rect.right <= innerWidth + 1 && rect.left >= -1) continue;
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).slice(0, 2).join('.');
      out.push({ tag: el.tagName.toLowerCase(), cls, left: Math.round(rect.left), right: Math.round(rect.right) });
    }
    return out.slice(0, 6);
  })()`);

const openPage = async (win, name) => {
  const page = PAGES[name];
  if (!page) {
    console.log(`未知页面: ${name}（可选：${Object.keys(PAGES).join(' / ')} / all）`);
    return;
  }
  // 先用一次 mousedown 关掉上一页遗留的弹层（弹层靠 mousedown 判定外部点击）
  await win.webContents.executeJavaScript(
    `document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`
  );
  await sleep(120);

  await page.goto(win);
  await sleep(opt.beat);

  const info = await probe(win);
  const flag = info.overflowX > 0 ? `横向溢出 ${info.overflowX}px` : '无横向溢出';
  if (info.overflowX > 0) warnings.push(`${name}: ${info.overflowX}px`);
  console.log(`[${name}] ${page.label}  viewport=${info.viewport}  rail=${info.railRow}  ${flag}`);

  const offscreen = await auditOffscreen(win);
  if (offscreen.length) {
    console.log(`  越界元素: ${offscreen.map((item) => `${item.tag}.${item.cls}[${item.left},${item.right}]`).join('  ')}`);
    warnings.push(`${name}: ${offscreen.length} 个元素越界`);
  }

  if (opt.scroll === 'bottom') {
    await win.webContents.executeJavaScript(`(() => {
      const pv = document.querySelector('.page-view');
      if (pv && pv.scrollHeight > pv.clientHeight + 4) {
        pv.scrollTop = pv.scrollHeight;
        return 'page-view';
      }
      window.scrollTo(0, document.body.scrollHeight);
      return 'window';
    })()`);
    await sleep(500);
  }

  await shot(win, opt.scroll === 'bottom' ? `${name}-bottom` : name);
};

app.on('browser-window-created', (_event, win) => {
  let phase = 0;
  let finished = false;

  win.webContents.on('did-finish-load', async () => {
    // 第一次加载先写入「已完成引导」标记，重载后进入主界面
    if (phase === 0) {
      phase = 1;
      await win.webContents.executeJavaScript(
        `localStorage.setItem('openexam_onboarding_done_v1', '1')`
      );
      win.reload();
      return;
    }
    if (phase !== 1) return;
    phase = 2;

    try {
      win.setContentSize(opt.width, opt.height);
      await sleep(2500);

      if (opt.hold) {
        win.show();
        win.focus();
        console.log(`预览窗口 ${opt.width}x${opt.height} 已打开，关闭窗口退出`);
        return;
      }

      const targets = opt.page === 'all' ? ALL_ORDER : [opt.page];
      for (const name of targets) {
        await openPage(win, name);
      }

      console.log(warnings.length ? `\n存在横向溢出的页面：${warnings.join(', ')}` : '\n全部页面无横向溢出');
      console.log(`截图目录：${OUT_DIR}`);
    } catch (error) {
      console.error('[mobile-check] 失败:', error);
    } finally {
      if (!finished && !opt.hold) {
        finished = true;
        await sleep(300);
        app.quit();
      }
    }
  });
});
