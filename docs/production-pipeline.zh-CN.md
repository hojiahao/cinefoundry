# 影工坊如何对应真实的影视制作

[English](production-pipeline.md) · **简体中文**

影工坊（Cinefoundry）制作三种片型：广告片、创作者短视频和微短剧。每种片型都按该行业专业团队的流程来做：每个岗位是一个
Skill（`.agents/skills/<name>/SKILL.md`），每个制作环节是流水线中的一个阶段（`src/pipelines`），岗位之间的每次交接都是一道
由代码执行的质检门。本文说明三者如何一一对应：行业流程、岗位与 25 个 Skill、每条流水线的阶段、质检门和交付规格。行业依据见
[`research/film-shortvideo-drama-standards.md`](research/film-shortvideo-drama-standards.md)。

## 一、行业流程

### 广告片

一支顶级广告片由三类公司接力完成：广告代理商（客户策划、策略、创意、文案、法务）、制作公司（导演、摄影指导、美术、选角、
摄制组）和后期公司（剪辑、调色、字幕包装、声音、版本、质检）。

| 阶段 | 环节 | 岗位 |
|---|---|---|
| 前期 | 客户简报：目标、受众、单一主张、投放渠道、规格 | 客户经理、策划 |
| | 洞察、创意概念、导演阐述（视觉概念、光线、色彩、节奏、声音） | 策略、创意总监、导演 |
| | 脚本与播音文案 | 文案 |
| | 法务预审：功效声称、用语、音乐与肖像授权 | 代理商法务 |
| | 分镜与镜头表 | 导演、分镜师 |
| | 选角、美术置景、产品造型、布光方案 | 选角导演、美术指导、造型师、摄影指导 |
| 拍摄 | 现场执导：表演、机位、灯光 | 导演、摄影指导、灯光师、摄制组 |
| | 现场监看与素材检查：焦点、曝光、产品是否走样、是否穿帮 | 现场监看、DIT |
| 后期 | 剪辑：节奏、叙事、时长 | 剪辑师 |
| | 调色、标题与定版 | 调色师、字幕包装设计 |
| | 播音、声音设计、配乐，按电视或网络响度混音 | 配音导演、声音设计、作曲、混音师 |
| | 版本剪辑：30 秒主片，15 秒和 6 秒剪辑版 | 版本剪辑师 |
| | 技术质检与交付 | 质检与交付 |

### 创作者短视频

头部创作者团队把制作拆成固定岗位，一人只负责一件事，每个岗位都有固定检查项（调研 §2.2）。结构为信息流而设计：前 3 秒钩子，
每隔几秒一次视觉变化，剧情类每 30 到 60 秒一次反转，包装决定视频会不会被点开。

| 阶段 | 环节 | 岗位 |
|---|---|---|
| 选题 | 题目与角度；形态：口播、测评、科普、剧情短片、产品短片 | 创作者、内容编剧 |
| 写作 | 钩子、留存结构、节奏打断、台词 | 内容编剧 |
| 审核 | 平台规则、AI 标识、肖像权 | 平台合规 |
| 拍摄 | 出镜人或演员、B-roll、插入镜头 | 导演、摄影 |
| 后期 | 留存剪辑、竖屏安全区内的字幕、声音，按平台响度混音 | 剪辑、字幕、声音 |
| 包装 | 三个标题做 A/B 测试、封面帧与封面字、简介、话题标签、AI 声明 | 包装与运营编辑 |

### 微短剧

微短剧是竖屏短集连续剧：开场几秒内给出钩子，每 20 到 30 秒一个情绪节点，每集结尾卡在悬念上，付费卡点放在情绪最高点
（调研 §3.2）。团队沿用影视剧的分工：showrunner 持有剧集圣经，编剧在圣经内写作，选角与场记保证脸、服装和道具连贯，
对白剪辑与补录（ADR）、声音设计、配乐和终混。AI 生成的微短剧每集都要加 AI 提示标识（广电总局第 16 号令，2026-09-01 施行）。

| 阶段 | 环节 | 岗位 |
|---|---|---|
| 开发 | 一句话梗概、类型与调性、世界观、人物、分集计划（钩子、结尾悬念、付费卡点） | Showrunner、总编剧 |
| | 按广电规定和 2026 年专项治理审核题材 | 内容审核 |
| 写作 | 在圣经约束内写分集剧本 | 编剧 |
| 前期 | 分镜：镜头覆盖、对白构图、轴线 | 导演、摄影指导、场记 |
| | 选角、定妆、服装与连贯性 | 选角导演、服装设计、场记 |
| 拍摄 | 表演与对白 | 导演、演员 |
| 后期 | 对白剪辑与补录、音效与环境声、配乐、四轨混音 | 对白剪辑、声音设计、作曲、混音师 |
| | 剪辑、调色、双语字幕、AI 标识、逐集技术质检 | 剪辑师、调色师、字幕、质检 |

## 二、岗位与 Skill

25 个 Skill，一个岗位一个，分六类（每个 `SKILL.md` 的 `metadata.category` 字段）。“执行位置”一栏说明岗位在哪里工作：
加载该 Skill 的智能体所在的流水线阶段，或由引擎按 Skill 规则用代码执行的步骤（代码强制执行的规则在 Skill 中标为 *checked*）。

### 制片（production，7 个）

| Skill | 岗位 | 执行位置 |
|---|---|---|
| `cinefoundry-ad-film` | 广告制片人 | 外部智能体的入口：运行 `cinefoundry ad`，按交付记录汇报 |
| `cinefoundry-short-video` | 短视频制片人 | 入口：运行 `cinefoundry short` |
| `cinefoundry-micro-drama` | 剧集制片人 | 入口：运行 `cinefoundry drama` |
| `ad-brief-intake` | 客户策划 | 广告阶段 `brief` |
| `ad-compliance-review` | 广告法务 | 广告阶段 `compliance`，以及 `versions` 中剪辑版的文案 |
| `content-compliance` | 内容审核 | 短视频与微短剧阶段 `development`（题材）和 `compliance` |
| `spark-model-scheduler` | 技术统筹 | 引擎的阶段切换：语言模型休眠，同一时间只加载一类扩散模型 |

### 写作（writing，5 个）

| Skill | 岗位 | 执行位置 |
|---|---|---|
| `creative-direction` | 创意总监 | 广告阶段 `creative`：洞察、主张、概念、导演阐述、播音选角、配乐与环境声方向 |
| `ad-script-writing` | 文案 | 广告阶段 `script`，以及 `versions` 中剪辑版的文案 |
| `series-development` | Showrunner | 微短剧阶段 `development`：剧集圣经 |
| `short-video-scripting` | 创作者内容编剧 | 短视频阶段 `development`（选题）和 `screenplay` |
| `screenwriting` | 编剧 | 微短剧阶段 `screenplay` |

### 画面（picture，5 个）

| Skill | 岗位 | 执行位置 |
|---|---|---|
| `storyboard-design` | 导演、分镜师 | 广告阶段 `storyboard`；短视频与微短剧阶段 `shots` |
| `cinematography-and-art-direction` | 摄影指导、美术指导、产品造型 | 广告阶段 `storyboard`；短视频与微短剧阶段 `shots` |
| `character-and-continuity` | 选角导演、服装设计、场记 | 短视频与微短剧阶段 `shots` 和 `casting` |
| `spark-local-media-generation` | 摄制组 | 代码：产品定妆图、参考图锚定的首帧、原生 1080p 视频、RIFE 插帧 |
| `shot-quality-gate` | 现场监看、质检 | 广告阶段 `frames`（质检判定与提示词修复）；剧情类首帧由代码质检 |

### 声音（sound，2 个）

| Skill | 岗位 | 执行位置 |
|---|---|---|
| `dialogue-and-voice` | 配音选角、对白导演、ADR | 代码：从音色库选角、Whisper 逐句检查与重录、口型镜头规则 |
| `sound-design-and-music` | 声音设计、作曲 | 短视频与微短剧阶段 `sound` |

### 后期（post，5 个）

| Skill | 岗位 | 执行位置 |
|---|---|---|
| `editing-and-versioning` | 剪辑师、版本剪辑师 | 广告阶段 `versions`：15 秒和 6 秒剪辑版 |
| `final-cut-assembly` | 成片合成：调色、字幕包装、混音 | 代码：广告阶段 `cut`；`cinefoundry cut --project <id>` 重新合成 |
| `bilingual-subtitles` | 字幕 | 代码：每个成片的中上英下双语字幕 |
| `platform-packaging` | 包装与运营编辑 | 短视频阶段 `packaging` |
| `delivery-qc` | 质检与交付 | 广告阶段 `qc`；短视频与微短剧阶段 `cut` 结尾的质检 |

### 调研（research，1 个）

| Skill | 岗位 | 执行位置 |
|---|---|---|
| `ad-reference-breakdown` | 参考片研究 | 按需：`cinefoundry shots <video>` 把参考片切成镜头，`cinefoundry qa` 逐镜描述 |

## 三、流水线

一个引擎（`src/engine`）运行所有片型：启动前检查、一次只拍一部片的锁（`projects/.harness.lock`）、写入
`projects/<id>/state.json` 的阶段状态、运行记录 `reports/run.jsonl` 和模型调度。片型就是一组有序的阶段。加上 `--plan-only`
时，三种片型都在写作和分镜阶段之后停下，不占用 GPU。

### 广告片：`cinefoundry ad "<brief>"`

定义在 `src/pipelines/ad/index.ts`。30 秒主片由六个 5 秒镜头和 3 秒定版组成。

| 阶段 | 岗位与 Skill | 产出 | 质检门 |
|---|---|---|---|
| `brief`（需求） | 需求制片：`ad-brief-intake` | `brief.json` | `checkBrief`；客户原话中的画幅、时长、结尾口号和产品外观优先于智能体的选择；产品照由 Step3-VL 读取 |
| `creative`（创意） | 创意总监：`creative-direction` | `creative/treatment.json` | `checkTreatment`，4 次；播音必须是音色库中通过本机质检的英文播音 |
| `script`（脚本） | 文案：`ad-script-writing` | `script/script.draft.json` | `checkScript`，6 次；仍有硬性问题则终止 |
| `compliance`（合规） | 独立审稿：`ad-compliance-review` | `script/script.json`、`script/copy.txt`、`reports/compliance.json` | 广告法用语扫描，再由未参与写作的审稿人审核；出现 `block` 级问题即终止 |
| `storyboard`（分镜） | 分镜师与摄影指导：`storyboard-design`、`cinematography-and-art-direction` | `storyboard/storyboard.json` | `checkStoryboard`，6 次；仍有硬性问题则终止 |
| `frames`（生图） | 摄制组与现场监看：`shot-quality-gate` | `frames/` | 定妆图对照需求质检；每个首帧对照定妆图质检（见第四节） |
| `clips`（生视频） | 摄制组 | `clips/shot_001.mp4` … | 首帧驱动的视频，默认 LTX-2.5 Fast NVFP4；帧率高于 24 fps 时用 RIFE 插帧为高帧率母版 |
| `cut`（成片） | 成片合成：`final-cut-assembly`、`bilingual-subtitles`、`dialogue-and-voice` | `cut/final.mp4`、`cut/titles.ass`、`reports/delivery.md` | 播音逐句 Whisper 检查；标题字体逐字检查字形 |
| `versions`（版本） | 版本剪辑师：`editing-and-versioning`、`ad-script-writing` | `cut/final_15s.mp4`、`cut/final_06s.mp4`、`cut/version_<id>.json` | `checkVersion`，4 次；剪辑版文案走同样的合规审核；无法通过的版本不剪，记为待处理事项 |
| `qc`（技术质检） | 质检：`delivery-qc` | `reports/qc.json` | 每个交付文件逐项测量（第四节） |

### 创作者短视频：`cinefoundry short "<topic>"`

定义在 `src/pipelines/short/index.ts`，使用 `src/crafts/narrative/pipeline.ts` 中的剧情类阶段。一支视频，默认 60 秒
（12 个 5 秒镜头），最长 180 秒。

| 阶段 | 岗位与 Skill | 产出 | 质检门 |
|---|---|---|---|
| `development`（选题） | 创作者内容编剧：`short-video-scripting`、`content-compliance` | `story/bible.json` | `checkBible`，5 次；题材由独立审稿人审核，最多退回两次，仍不通过则终止 |
| `screenplay`（剧本） | 编剧：`short-video-scripting` | `story/` | `checkScreenplay`，6 次；每句台词放得进一个 5 秒镜头 |
| `compliance`（合规） | 独立审稿：`content-compliance` | `reports/compliance.ep<n>.json` | 字幕用语扫描，再由审稿人审核，每条意见必须引用原文；改写后仍不通过即终止 |
| `shots`（分镜） | 导演、摄影指导、场记：`storyboard-design`、`cinematography-and-art-direction`、`character-and-continuity` | `storyboard/ep01.shots.json` | `checkShots`，6 次；对白镜头单人拍摄 |
| `casting`（选角定妆） | 选角：`character-and-continuity` | `cast/<id>/character.json` | 每个角色每轮 4 名候选、最多 2 轮；参考视图逐张做身份质检；音色从音色库选，或为角色单独设计 |
| `frames`（生图质检） | 摄制组 | `frames/` | 每帧对照画面中角色的定妆主图质检 |
| `dialogue`（对白） | 代码，`dialogue-and-voice` | 配音素材 | 每句 Whisper 检查，听不准就重录 |
| `clips`（生视频） | 摄制组 | `clips/` | 对白镜头按已定稿的台词音频生成口型（LTX-2.5 音频驱动）；高于 24 fps 时 RIFE 插帧 |
| `sound`（声音） | 声音设计与作曲：`sound-design-and-music` | `audio/` | 每场一条环境声，最多一半镜头配同步音效（MOSS-SoundEffect v2），配乐（ACE-Step） |
| `cut`（成片） | 代码：成片合成、`bilingual-subtitles`、`delivery-qc` | `cut/ep01.mp4`、`cut/ep01.ass`、`reports/qc.json` | 硬切、四轨混音、按实际发音计时的字幕、AI 标识、−14 LUFS；技术质检 |
| `packaging`（平台包装） | 包装编辑：`platform-packaging` | `reports/packaging.json`、`cut/cover.jpg` | `checkPackaging`，4 次：三个标题，至少一个中文，不用标题党；简介中声明 AI 生成 |

### 微短剧：`cinefoundry drama "<story>"`

定义在 `src/pipelines/drama/index.ts`，使用同一组剧情类阶段。`--episodes` 规划集数（1 到 30 集），`--produce` 制作其中前
*n* 集；每集默认 120 秒（24 个镜头），最长 180 秒。`--cast <dir>` 复用已定妆的角色，后续集数或新一季出现的是同一批人。

| 阶段 | 与短视频的区别 |
|---|---|
| `development`（剧本开发） | Showrunner（`series-development`）写剧集圣经：一句话梗概、世界观、视觉风格、最多五个角色、每集的钩子与结尾悬念 |
| `screenplay`（剧本） | `screenwriting`：每集以钩子开场、以悬念收尾，并接上一集的结尾 |
| `compliance` … `cut` | 同短视频，逐集执行：`cut/ep01.mp4`、`cut/ep02.mp4` … |
| — | 没有包装阶段 |

## 四、质检门

每个阶段只交出通过质检的产出。在次数上限内无法通过时，要么终止运行（继续下去会让整部片出错），要么保留最好的一次，
记为待处理事项，写入运行日志和交付报告。

| 质检门 | 位置 | 上限 | 未通过时 |
|---|---|---|---|
| 确定性校验（`src/agent/checks.ts`、`src/crafts/narrative/checks.ts`） | 所有写作与分镜阶段 | 4 到 6 次，最后两次开启推理；每次退回都附具体原因 | 脚本、分镜、剧本开发、剧本、镜头：终止。导演阐述与包装：保留最好的一稿并记录未解决项。剪辑版：不剪，记为待处理 |
| 结构化文案判读（Jev，可选，云端，`TYPESAFE_API_KEY`） | 广告 `script` 与 `storyboard` | 概率 ≥ 0.7 退回改写；0.3 到 0.7 交审稿人裁决 | — |
| 广告合规 | 广告 `compliance` 与每个剪辑版 | 扫描、独立审稿；审稿人的改写须通过 `checkScript` 才采用 | 出现 `block` 级问题即终止 |
| 内容合规 | 短视频与微短剧 `development` 和 `compliance` | 题材最多退回两次；每集改写一次后复审 | 在生成任何画面之前终止 |
| 产品定妆图 | 广告 `frames` | 3 次，按质检意见修复提示词 | 终止：所有画面都以它为锚。提供产品照时以产品照为参考 |
| 首帧质检（Step3-VL） | 广告 `frames` | 2 个种子，再 2 次提示词修复 | 保留最好的一次，记为待处理 |
| 选角质检 | 短视频与微短剧 `casting` | 每轮 4 名候选、每个角色 2 轮；每个参考视图 3 次编辑 | 保留最好的候选并记为待处理；始终对不上的视图弃用，首帧改用主图 |
| 首帧身份质检 | 短视频与微短剧 `frames` | 3 次，最后一次带上质检意见 | 保留最好的一次，记为待处理 |
| 台词听写检查（Whisper large-v3-turbo） | 广告播音、剧情对白 | 错误率高于 8% 重录，最多 2 次 | 记为待处理：发布前人工试听 |
| 技术质检（`src/crafts/qc.ts`） | 广告 `qc`、剧情类 `cut` | 容器、编码、分辨率、帧率与帧数、时长、码率、色彩、faststart、黑帧、画面冻结、音频、响度与响度范围、真峰值、削波、静音、字幕、AI 标识、AIGC 元数据 | 每项不合格与警告都记为待处理；文件保留，由负责的阶段修复 |

## 五、交付规格

| | 广告片 | 创作者短视频 | 微短剧 |
|---|---|---|---|
| 时长 | 30 秒主片，15 秒和 6 秒剪辑版（`--duration` 5 到 30 秒，以 5 为步长） | 60 秒（`--seconds` 10 到 180） | 每集 2 分钟（`--seconds` 10 到 180），最多规划 30 集 |
| 画幅 | 16:9；`--ratio` 可选 9:16、1:1 | 9:16 | 9:16 |
| 分辨率 | 原生 1080p（1920×1080）；`2k`、`4k`、`6k` 档位在成片时放大，并在报告中注明 | 原生 1080p（1080×1920） | 原生 1080p（1080×1920） |
| 帧率 | 60 fps，由 RIFE 插帧 | 30 fps | 24 fps |
| 声音主体 | 音色库中选出的英文播音 | 出镜人或角色，英文口型同步 | 角色，英文口型同步 |
| 声音 | 播音压在自动避让的 ACE-Step 配乐之上 | 四轨：对白、音效、环境声、配乐 | 四轨：对白、音效、环境声、配乐 |
| 字幕 | 中上英下；16:9 每行最多 16 个汉字，9:16 最多 12 个 | 中上英下，位于竖屏安全区内 | 中上英下，位于竖屏安全区内 |
| 响度 | −16 LUFS ±1，真峰值 −1.5 dBTP | −14 LUFS ±1，真峰值 −1.0 dBTP | −14 LUFS ±1，真峰值 −1.0 dBTP |
| 剪辑 | 硬切，0.5 秒溶解进入 3 秒定版 | 每 5 秒硬切 | 每 5 秒硬切 |
| AI 标识 | 开头与定版显示“内容由 AI 生成”；隐式 AIGC 元数据（GB 45438-2025） | 同上，另在简介中声明 | 同上，每集都有 |
| 交付物 | `cut/final.mp4`、`cut/final_15s.mp4`、`cut/final_06s.mp4`、`reports/delivery.md`、`reports/qc.json` | `cut/ep01.mp4`、`cut/cover.jpg`、`reports/packaging.json`、`reports/qc.json` | 每个已制作的集一个 `cut/ep<nn>.mp4`，`reports/qc.json` |

## 六、AI 摄制组与实拍的不同之处

- **镜头固定 5 秒。** 视频模型生成 5 秒片段，所以剧情类每个镜头都是 5 秒，每句对白放得进一个镜头；广告剪辑版从镜头开头截取。
- **对白单人拍摄。** 两人同框说话并不可靠，所以每句台词都拍说话人单人镜头或越过听者肩膀的过肩镜头，这也是导演本来就会用的正反打。
- **连贯性只决定一次。** 场记的工作由参考图承担：每个产品一张通过质检的定妆图，每个角色一张锁定的主图和一组参考视图，每一帧都从它们生成。
- **画面里没有文字。** 标题、字幕、定版和 AI 标识都在成片时用逐字检查过字形的字体排版。
- **成片合成由代码完成。** 调色、字幕包装和混音在实拍中是三个岗位；这里是一次由代码执行的合成，参数来自导演阐述和产品品类，主片和每个剪辑版的处理完全一致。
