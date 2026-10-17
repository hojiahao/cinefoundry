# 顶级广告片的制作流程、岗位与 Spotfoundry 的 Skill 对照（2026-10-17）

Spotfoundry 的每个 Skill 对应真实广告制作中的一个岗位：Skill 写清楚这个岗位做什么、不许做什么、怎样算合格。本文先列出国际与国内一线广告的标准流程和岗位，再对照现有 10 个 Skill，给出增减方案。

## 一、顶级广告片的标准流程

一线广告公司（4A 与本土头部代理商）加制作公司（Production House）加后期公司（Post House）的分工，三个阶段、约二十个关键环节：

**前期（Pre-production）**
1. 客户简报（Client Brief）→ 策划解读：目标、受众、单一主张、投放渠道、规格与预算
2. 策略洞察（Insight）→ 创意概念（Big Idea / Concept）
3. 文案（Script）与创意提案
4. 法务预审（Legal / Clearance）：广告法用语、功效与数据声称、肖像与音乐版权
5. 导演阐述（Treatment）：视觉概念、调性参考、光线与色彩方案、节奏
6. 分镜与镜头表（Storyboard / Shot List）
7. 选角（Casting）、美术与置景（Production Design）、产品造型（Product / Food Styling）、服化道
8. 制作会（PPM, Pre-Production Meeting）：所有决定由客户确认后才开拍

**拍摄（Production）**
9. 导演执导；摄影指导（DP）掌镜与布光；灯光师（Gaffer）执行；美术与造型师在现场保证产品与画面
10. 现场监看与素材质检（Video Assist / DIT）：焦点、曝光、产品是否走样、是否穿帮

**后期（Post-production）**
11. 粗剪 / 精剪（Offline Edit）：节奏、叙事、时长
12. 特效与修饰（VFX / Clean-up）：擦除瑕疵、产品与包装修正
13. 调色（Color Grading）：统一镜头、建立质感
14. 字幕与包装设计（Titles / Motion Graphics）：标题、字幕、定版
15. 配音（Voice Over）：选声线、配音导演指导语气与节奏
16. 声音设计（Sound Design）：环境声、动作音效、转场声
17. 音乐（Music）：原创配乐或曲库选曲、按画面剪辑
18. 混音（Mix）：配音、音效、音乐平衡，按电视 / 网络响度标准
19. 版本与剪辑版（Versioning）：30 秒主片、15 秒、6 秒；横竖屏；多语种
20. 技术质检与交付（QC / Delivery）：规格、响度、码率、黑帧与爆音检查、标识、交付包

## 二、岗位与现有 Skill 对照

| 岗位 | 环节 | 现有 Skill | 覆盖情况 |
|---|---|---|---|
| 制片人 / 监制（Producer） | 全程统筹 | `spotfoundry-ad-film`（入口）+ Harness | 覆盖 |
| 客户经理 / 策划（Account / Planner） | 1 | `ad-brief-intake` | 覆盖 |
| 策略与创意总监（Strategist / CD） | 2、5 | 无，零散写在脚本和分镜里 | **缺失**：没有独立的洞察、创意概念和导演阐述环节，脚本和画面可能不是同一个想法 |
| 文案（Copywriter） | 3 | `ad-script-writing` | 覆盖 |
| 法务合规（Legal） | 4 | `ad-compliance-review` | 覆盖 |
| 导演 + 分镜师（Director / Storyboard Artist） | 6 | `storyboard-design` | 覆盖，但一个 Skill 同时承担了导演、摄影、美术、造型、选角 |
| 摄影指导 + 灯光（DP / Gaffer） | 9 | 写在 `storyboard-design` 和代码的品类布光基调里 | **不独立**：布光、镜头语言、质感没有专人负责 |
| 美术 + 产品造型（Production Designer / Stylist） | 7 | 同上 | **不独立** |
| 选角与表演（Casting / Talent Direction） | 7 | 分镜里只有"最多一个人"的避坑规则 | **缺失** |
| 拍摄执行（Shoot Crew） | 9 | `spark-local-media-generation` | 覆盖 |
| 现场监看与素材质检（Video Assist / DIT） | 10 | `shot-quality-gate` | 覆盖 |
| 技术统筹（Technical Producer） | 全程 | `spark-model-scheduler` | 覆盖（AI 制作特有：算力与内存调度） |
| 参考片研究（Researcher） | 5 | `ad-reference-breakdown` | 覆盖（可选） |
| 剪辑（Editor） | 11 | 写在 `final-cut-assembly` 里 | **不独立** |
| 版本剪辑（Versioning Editor） | 19 | 无 | **缺失**：30 秒主片 + 15 秒 + 6 秒剪辑版没有人做 |
| 调色（Colorist） | 13 | 写在 `final-cut-assembly` 里 | 合并在后期合成中，可接受 |
| 字幕与包装设计（Title / Motion Designer） | 14 | 写在 `final-cut-assembly` 里 | 合并在后期合成中，可接受 |
| 配音导演 + 配音员（VO Director / Talent） | 15 | 无，只有一个固定音色 | **缺失** |
| 声音设计（Sound Designer） | 16 | 无 | **缺失**：没有音效 |
| 音乐（Composer / Music Supervisor） | 17 | 无，配乐用简报调性自动生成 | **缺失** |
| 混音（Mixer） | 18 | 写在 `final-cut-assembly` 里 | 合并在后期合成中，可接受 |
| 技术质检与交付（QC / Delivery） | 20 | 无 | **缺失**：成片没有自动技术质检 |

**结论**：现有 10 个 Skill 覆盖了文字和画面的主干，但缺 6 个岗位：创意总监、摄影美术、选角、版本剪辑、配音导演、声音与音乐、技术质检；另有一个 Skill（分镜）承担了太多岗位。顶级制作和"能出片"之间的差距，主要就在这些缺口上。

## 三、调整后的 Skill 体系（10 → 16）

原则：一个 Skill 对应一个真实岗位；每个 Skill 都有对应的执行环节（智能体或代码），不写没人执行的 Skill；能用代码检查的规则写进校验器。

| # | Skill | 岗位 | 阶段 | 执行方式 | 变化 |
|---|---|---|---|---|---|
| 1 | `spotfoundry-ad-film` | 制片人 / 监制 | 入口 | 外部 Agent 调用 Harness | 保留 |
| 2 | `ad-brief-intake` | 客户经理 / 策划 | 需求 | 需求智能体 | 保留 |
| 3 | **`creative-direction`** | 策略与创意总监 | 创意 | 新增**创意智能体**：洞察、单一主张、创意概念、导演阐述（视觉概念、光线逻辑、色彩、节奏、声音方向）。文案、分镜、声音都从它出发 | **新增** |
| 4 | `ad-script-writing` | 文案 | 脚本 | 文案智能体 | 保留 |
| 5 | `ad-compliance-review` | 法务合规 | 合规 | 扫描 + 独立审稿 | 保留 |
| 6 | `storyboard-design` | 导演 + 分镜师 | 分镜 | 分镜智能体 | 保留，精简为镜头设计本身 |
| 7 | **`cinematography-and-art-direction`** | 摄影指导、灯光、美术、产品造型、选角与表演 | 分镜 | 分镜智能体同时加载：布光方案、镜头语言、置景与道具、产品造型、人物外形与表演 | **新增**（从分镜拆出并扩充） |
| 8 | `spark-local-media-generation` | 拍摄执行 | 生图、生视频 | 代码 | 保留 |
| 9 | `shot-quality-gate` | 现场监看与素材质检 | 质检 | 视觉模型 | 保留 |
| 10 | **`editing-and-versioning`** | 剪辑、版本剪辑 | 剪辑 | 新增**剪辑智能体**：从 30 秒主片选镜头、写 15 秒和 6 秒版文案（再过合规），代码出片 | **新增** |
| 11 | `final-cut-assembly` | 后期合成（调色、字幕包装、混音） | 成片 | 代码 | 保留，专注合成、调色、字幕 |
| 12 | **`voice-casting-and-direction`** | 配音导演 + 配音员 | 配音 | 按品类和人群选声线，播音风格与停顿要求；声线库由设计音色组成 | **新增** |
| 13 | **`sound-design-and-music`** | 声音设计、音乐 | 声音 | 新增**声音智能体**：每个镜头的音效与环境声提示、配乐方向；MOSS-SoundEffect 与 ACE-Step 生成 | **新增** |
| 14 | **`delivery-qc`** | 技术质检与交付 | 交付 | 代码自动检查成片：时长、帧率、分辨率、响度与真峰值、黑帧与静音、字幕越界、AI 标识；生成交付包 | **新增** |
| 15 | `spark-model-scheduler` | 技术统筹 | 全程 | 代码 | 保留 |
| 16 | `ad-reference-breakdown` | 参考片研究 | 可选 | 视觉模型 | 保留 |

调色、字幕包装、混音在真实行业是三个岗位，这里仍合并在 `final-cut-assembly` 中：三者都由代码执行，参数由品类和导演阐述决定，单独拆成 Skill 不会多一个决策者，反而增加维护成本。

## 四、调整后的流程

```
需求 → 创意（洞察 / 概念 / 导演阐述）→ 脚本 → 合规 → 分镜（导演 + 摄影美术）
     → 生图 → 质检 → 生视频 → 插帧
     → 声音（配音选角 / 音效 / 配乐）→ 成片（剪辑 / 调色 / 字幕 / 混音）
     → 版本剪辑（15 秒 / 6 秒，文案再过合规）→ 技术质检 → 交付包
```

默认交付：30 秒主片 + 15 秒剪辑版 + 6 秒短版，16:9、原生 1080p、60 fps，带显式和隐式 AI 标识。
