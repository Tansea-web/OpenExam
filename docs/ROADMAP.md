# 功能整合路线图（借鉴题舟）

> 载体：OpenExam（JS + Electron 30 + React 18 + better-sqlite3）。
> 策略：题舟（D:/Work/Projects/Study/tizhou，MIT）的功能设计在现有技术栈内重写，不引入 TS/Fluent UI/node:sqlite；
> 题舟的 Python worker（OCR/文档转换）可跨项目原样复用。

## 分期总览

| 期次 | 包 | 状态 | 主要交付 |
|---|---|---|---|
| P0 | 快赢包 | 本计划实施 | 申论草稿自动保存、错因记录、申论无 AI 兜底评分、自适应抽题、每日自动备份、API Key 加密 |
| P1 | 训练体验包 | 本计划实施 | 断点续练快照、组题原子抽题、KaTeX 公式渲染、双更新源 |
| P2 | AI 工程包 | 待启动 | Prompt 防注入协议（UNTRUSTED_TASK_DATA 信封）、AI 变式训练页（生成+终审两段式）、Prompt 离线评测脚本 |
| P3 | PDF 直导生产线 | 待启动 | 本地 OCR 引擎安装器、规则切题、题本/解析册配对校验、审核-发布-撤销、导入质量闸门、simhash 去重 |
| P4 | 题库真值与知识中心 | 待启动 | Markdown 题库真值层（SQLite 只做索引、fs.watch 重索引）、知识文档中心（方法文档/规律中心）、证据链（页码+行号回看） |

## 依赖关系

```text
P0（快赢包）──────┬──> P2（AI 工程包）：错因协议/评分协议先稳定，再上防注入与评测
                  └──> P1（训练体验包）：快照/组题依赖错题与统计接口
P3（PDF 直导）────┴──> P4（Markdown 真值层）：直导产物先落 Markdown，真值层才有意义
P4 ──> 知识文档中心（同一 vault 机制复用）
```

建议顺序：P0 → P1 → P2 → P3 → P4。P3 与 P4 可并行开发（P3 产出 Markdown，P4 消费 Markdown）。

## 各期设计要点（照题舟方案移植）

### P2 AI 工程包
- 防注入：`src/main/ai/prompts.js` 增加 `COMMON_GUARDRAILS` + 场景护栏；题目/材料用 `<UNTRUSTED_TASK_DATA>` 信封包裹后再拼 Prompt。
- 变式训练：新页面 `/ai-training`（或复用 AI 老师），两段式 `variantCreate`（生成）+ `variantReview`（终审），结果存新表 `ai_training_attempts`。
- 离线评测：`eval/questions.jsonl` 固定题集 + `tests/ai-eval.test.js`，五类确定性指标：JSON 契约通过率、答案正确率、关键词引用率、禁含词、分数上限合理性；无 API Key 自动跳过。

### P3 PDF 直导生产线
- 引擎：RapidOCR（ONNX）+ markitdown，Python worker 以 stdout JSON 行通信（题舟 `tools/ocr-worker.py` / `markitdown-worker.py` 可直接复用）。
- 流程：知识源目录扫描 → 安装引擎（约 200MB）→ 构建任务（取消/重试）→ 产物审核 → 发布 → 按任务撤销。
- 切题：确定性正则（套标题/题号/选项/【参考答案】），零模型调用；组题（groupId/groupOrder）与来源页码行号证据。
- 配对校验：解析册重印题干摘录与题本做「字符二元组包含度」比对，错位剔除；质量报告 + 隔离区。
- 去重：`dedup-simhash`（3-gram → 64bit → 分带倒排 → Jaccard ≥ 0.72 → 并查集聚簇），离线报告人工处置。
- 依赖：用户机器需 Python 3.10+（仅扫描 PDF 需要）。

### P4 Markdown 题库真值层 + 知识文档中心
- 题目为带 frontmatter（subject/category/answer/tags/type）的 Markdown 文件，SQLite 只存索引与学习数据；外部编辑后 `fs.watch` 防抖重索引。
- 影响面大：导入（JSON/CSV/PDF）、导出、错题引用、搜索都改为「先写文件，后重索引」。
- 知识文档中心复用同一 vault：方法文档/规律中心为 Markdown 阅读页。

## 题舟参考设计索引（源文件，MIT 许可）

| 主题 | 题舟文件 | 关键点 |
|---|---|---|
| 自适应权重 | `src/main/services/study.ts` selectPractice L116-121 | 弱项类目×20 + 错题类目×12 + 标签×3 + 未做×8 − 近80题做过×40 |
| 组原子抽题 | 同上 buildQuestionUnits/takeUnits L43-79 | 以组为单位取样，组内保序 |
| 错题间隔表 | `src/main/database.ts` recordAttempt L955-1041 | 错+1天；对 easy+5/normal+3/hard+1；连对2次毕业 |
| 错因五类 | `src/shared/prompts.ts` L96 | 知识缺口/审题偏差/计算失误/策略不当/时间失控 |
| 申论本地评分 | `src/main/services/study.ts` localEvaluation L307-360 | 要点覆盖×0.5 + 结构×0.3 + 长度×0.2，provider=local-rubric |
| 草稿防抖 | `src/renderer/.../ShenlunSolutionPage.tsx` L59-66 | 1200ms 防抖存库，key=promptId |
| 每日备份 | `src/main/index.ts` L278-285 | 当日无备份 → wal_checkpoint(FULL) → 拷贝 → 修剪 |
| Key 加密 | `src/main/services/ai.ts` L466-472/L617-627 | safeStorage.encryptString → base64；不可用时拒存 |
| 断点会话 | `src/main/database.ts` learning_sessions L207-214 | metadata_json 存快照+currentIndex，翻题即写 |
| 更新双源 | `src/main/update-feed.ts` | GitHub + 国内镜像切换 |
| Prompt 护栏 | `src/shared/prompts.ts` L294-300 | COMMON_GUARDRAILS + UNTRUSTED_TASK_DATA 信封 |
| OCR worker | `tools/ocr-worker.py` / `markitdown-worker.py` | stdout JSON 行协议，可跨项目复用 |
| 配对校验 | `src/main/services/question-import.ts` L878-895/L959 | 字符二元组包含度 alignmentScore |
| simhash 去重 | `tools/dedup-simhash.mjs` | 3-gram→64bit→分带倒排→Jaccard→并查集 |

## 完成记录

- P0/P1：见 CHANGELOG（实施完成时追加）。
