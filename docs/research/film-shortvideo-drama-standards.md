# 影视长片、创作者短视频与微短剧的制作标准，及 Cinefoundry 扩展方案（2026-10-17）

调研目的：Cinefoundry 目前只做 TVC 广告（30 秒主片 + 15 秒 + 6 秒剪辑版）。本文调研三类新输出的行业标准：好莱坞 / 国内一线剧集与电影、抖音 / B 站 / YouTube 创作者短视频、微短剧（国内与出海）。最后给出统一 Harness 需要的岗位与 Skill 对照、本地开源模型现在能做到什么、做不到什么，以及每类输出的规格表。

可信度说明：带 URL 的数字都有出处。标"二手"的来自媒体转述或厂商博客，没有拿到原文；标"未核实"的是业内常用值，本次没找到官方原文。凡是会写进代码的数字（响度、字幕字数、标识尺寸），上线前都要再对一遍原文。

---

## 一、好莱坞长片 / 剧集制作

### 1.1 五个阶段

| 阶段 | 主要产出 | 关键决策人 |
|---|---|---|
| 开发（Development） | 一句话梗概（logline）→ 故事大纲（treatment）→ 节拍表（beat sheet）→ 剧本各稿；剧集还要写剧集圣经（series bible）和试播集 | 制片人、编剧；剧集由 showrunner 主导编剧室 |
| 前期（Pre-production） | 拍摄剧本锁定、分场表 / 拍摄日程（stripboard）、镜头表与分镜、视觉手册（lookbook）、选角、勘景、美术 / 服装设计、预算 | 导演、第一副导演（1st AD）、制片主任（UPM）、摄影指导、美术指导 |
| 拍摄（Production） | 每日素材（dailies）、场记单、摄影报告、录音报告 | 导演、1st AD 管现场进度、场记管连贯性 |
| 后期（Post） | 剪辑（offline）→ 锁定剪辑版（picture lock）→ 视效 → 调色 → 声音后期 → 配乐 → 混音 → 字幕 | 剪辑师、视效总监、调色师、声音总监 / 混录师、作曲 |
| 交付（Delivery） | IMF 母版包、各声道混音与分轨（stems）、M&E 国际声轨、时码字幕、元数据、法务文件（版权、肖像授权） | 后期主管、交付 QC |

### 1.2 岗位要点（对 AI 流水线有直接参考价值的部分）

- **Showrunner + 编剧室（writers' room）**：剧集的总负责人兼主笔。编剧室先把整季拆成每集的故事线（A/B/C 线），再分给各编剧写分集大纲和剧本，最后由 showrunner 统稿，保证人物语气和设定前后一致。对应 AI：一个"总编剧"Agent 持有剧集圣经，分集编剧 Agent 只能在圣经约束内写。
- **导演**：决定表演、镜头和节奏。剧集里导演按集轮换，视觉风格靠 showrunner 和"样板集导演"定的规矩维持。
- **第一副导演（1st AD）**：把剧本拆成拍摄日程（按场景 / 演员 / 地点合并），管现场时间。对应 AI：按角色 / 场景合并生成任务，减少模型和参考图切换。
- **场记 / 剧本监督（script supervisor）**：记录每条镜头的服装、道具、手的位置、视线方向、台词改动、180 度轴线，保证剪在一起不穿帮。**这是 AI 视频最缺的岗位**：跨镜头的人脸、服装、道具、发型一致性。
- **摄影指导（DP）**：镜头语言、布光、镜头焦段、画幅。**美术指导**：场景、色板、陈设。**服装设计**：每个角色每场戏的服装表（costume continuity）。**选角**：长相、声音、气质与角色匹配。
- **剪辑师**：先按剧本出粗剪（assembly），再导演版（director's cut），再制片版，最后锁定。**调色师**：统一镜头之间的颜色，建立整部片的质感（look）。**视效总监**：从前期起就参与，决定哪些镜头实拍、哪些合成。
- **声音后期**：
  - 对白剪辑师：清理同期声、拼接不同条次的最佳台词、标出需要补录的句子；
  - ADR（后期补录对白）：演员在录音棚对着画面重录，修技术问题或改表演；
  - 拟音（Foley）：脚步、衣服摩擦、道具声，现场实时录制；
  - 音效 / 声音设计：环境声、特殊音效；
  - 混录师（re-recording mixer）：把对白、音效、音乐做平衡，输出主混音和分轨。好莱坞通常两到三人混录：主混音师管对白和 ADR，另一人管音效和拟音。M&E 声轨（只有音乐和音效、没有对白）用于外语配音。来源：[Krotos 音频后期](https://krotos.studio/blog/what-is-audio-post-production)、[ScreenSkills 混音岗位说明](https://www.screenskills.com/media/to0jlymy/screenskills-sound-mixing-word-format.docx)、[FilmSound 音频后期 FAQ](https://www.filmsound.org/AudiopostFAQ/audiopostfaq.htm)
- **作曲 / 音乐总监（music supervisor）**：作曲写原创配乐；音乐总监负责选用已有歌曲和清版权。

### 1.3 关键文档

| 文档 | 标准写法 | Cinefoundry 是否已有对应 |
|---|---|---|
| Logline | 1–2 句：主角 + 目标 + 阻碍 + 赌注 | 部分（广告 brief 的单一主张） |
| Treatment | 2–10 页散文体故事大纲 | 有（`creative-direction` 的创意阐述） |
| Beat sheet | 按节拍列故事转折；常用 Save the Cat 15 拍 | 无 |
| 剧本格式 | Courier 12 pt，左 1.5 英寸、其余 1 英寸边距，约 55 行 / 页，**1 页 ≈ 1 分钟**；场景标题大写 `INT./EXT. 地点 - 时间`；长片 90–120 页。来源：[Wikipedia: Screenplay](https://en.wikipedia.org/wiki/Screenplay)、[Wikibooks 剧本格式](https://en.wikibooks.org/wiki/Movie_Making_Manual/Writing/Screenplay_Format) | 无（广告脚本是表格体） |
| 剧集圣经 | 世界观、人物小传与关系、语气、每季弧线、分集梗概 | 无 |
| 人物 / 连贯性圣经 | 每个角色的定妆照（正 / 侧 / 背）、服装表、道具表、声音设定 | 无（广告只有产品参考图） |
| Shot list / 分镜 | 每镜景别、机位、运动、焦段、时长 | 有（`storyboard-design`） |
| Lookbook | 参考画面、色板、光比、质感 | 有（`cinematography-and-art-direction`） |
| EDL / AAF / XML | 剪辑决策表，供调色、混音回套 | 无（直接 ffmpeg 合成） |

### 1.4 Netflix 交付标准（行业最常被引用的标杆）

**画面**
- 新拍原创内容 **90% 以上时长须用 Netflix 认证摄影机**拍摄，传感器至少 3840 个横向感光点（UHD）；非虚构类可放宽。来源：[Netflix: Cameras and Image Capture](https://backlothelp.netflix.com/hc/en-us/articles/360000579527-Cameras-and-Image-Capture)、[NewsShooter](https://www.newsshooter.com/2019/10/14/netflix-updates-its-cameras-and-image-capture-list/)
- 母版用 IMF（SMPTE ST 2067-21 Application #2E）；SDR 中间片 10/16-bit DPX，HDR 用 16-bit TIFF，分辨率 UHD 3840×2160 或 HD 1920×1080。帧率按原生帧率交付（23.976、24、25、29.97、30 等）。来源：[Netflix 交付规格 v5.1](https://backlothelp.netflix.com/hc/en-us/articles/7262346654995)、[Netflix Pre-Release Servicing](https://backlothelp.netflix.com/hc/en-us/articles/360000385467-Content-Hub-Preparing-Pre-Release-Servicing-Turnovers)
- HDR 原创必须用 Dolby Vision 调色并交付 Dolby Vision IMF，HDR10 和 SDR 由 Netflix 派生。来源：[Netflix Dolby Vision HDR Mastering Guidelines](https://backlothelp.netflix.com/hc/en-us/articles/360000599948-Dolby-Vision-HDR-Mastering-Guidelines)

**声音**
- 平均响度 **-27 LKFS ±2 LU，按对白门限测量**（ITU BS.1770 dialog gating，只测对白部分）；真峰值 -2 dBTP（建议限到 -2.3 dBTP 以下）。全景声混音必须同时交付 5.1，2.0 可选，两者都要符合响度。来源：[Netflix Sound Mix Specifications v1.5](https://backlothelp.netflix.com/hc/en-us/articles/360001794307-Netflix-Sound-Mix-Specifications-Best-Practices-v1-5)、[Production Expert](https://www.production-expert.com/production-expert-1/how-to-optimise-an-audio-mix-for-delivery-to-netflix)
- 对比：中国电视广播一般按 GY/T 282-2014《数字电视节目平均响度和真峰值音频电平技术要求》，业内通常引用 -24 LKFS（未核实原文，标准编号见 [GY/T 379-2023 引用](https://www.gov.cn/zhengce/zhengceku/202308/P020230826481669284756.pdf)）；美国 CALM Act -24 LKFS。

**字幕（Timed Text Style Guide）**

| 项目 | 英文 | 简体中文 |
|---|---|---|
| 每行字数上限 | 42 字符 | 16 字（SDH 可到 18） |
| 阅读速度 | 成人 ≤20 字符 / 秒，儿童 ≤17 | 成人 ≤9 字 / 秒，儿童 ≤7 |
| 行数 | 最多 2 行，不超过一行长度就只用 1 行 | 最多 2 行 |
| 单条时长 | 最短 5/6 秒（24fps 下 20 帧），最长 7 秒 | 同左 |
| 字体 | Arial 类无衬线，白色 | 黑体类，白色 |
| 标点 | 两行时上短下长（金字塔）；不在冠词 / 名字中间断行；省略号用 U+2026 | **不用逗号句号，用空格代替**；问号保留；引号用全角 “ ” |
| 对话 | 每位说话人一行，行首加连字符 | 同左 |
| 位置 | 居中，画面底部或顶部，避开画面内文字 | 避开口、脸和下三分之一的重要动作；连续字幕位置不跳 |

来源：[Netflix 英文字幕规范](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977)、[Netflix 简体中文字幕规范](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide)、[Netflix 字幕通用要求](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617)

注意：Netflix 没有"双语同屏字幕"规范。Cinefoundry 的"中文大字在上、英文小字在下"是国内字幕组和 B 站常见做法，字数和阅读速度可以分别套用上表两列。

**生成式 AI 使用规定（2025 年 8 月）**：Netflix 给制作方的 GenAI 指南要求——不得复制无授权的受版权内容；工具不得存储或用制作素材训练；生成内容默认是临时素材，不进入最终成片；**凡涉及最终交付物、演员肖像、个人数据或第三方 IP，都要书面审批**；未经同意不得用 AI 替代或生成演员表演。来源：[TheWrap](https://www.thewrap.com/netflix-generative-ai-use-content-production-guidelines/)、[Kidscreen](https://kidscreen.com/2025/08/28/netflix-releases-guidelines-for-using-generative-ai-in-content-production)、[CineD](https://www.cined.com/netflix-publishes-generative-ai-guidelines-for-content-production/)（二手，未取得原文）。对 Cinefoundry 的含义：全 AI 生成的成片目前不可能按 Netflix 原创标准交付，"好莱坞级"应理解为**画面、声音和叙事质量对标**，交付规格则对标平台。

---

## 二、国内一线影视公司与头部创作者

### 2.1 剧集 / 电影公司

- **正午阳光**：制片人中心制。侯鸿亮选项目，孔笙等导演负责拍摄并带新人；控制演员片酬，**制作费与片酬约 7:3**，钱集中花在制作上。2014 年以来出品剧集 85.7% 豆瓣 7 分以上；服化道、灯光、场景"基本挑不出毛病"是它的品质标签。来源：[第一财经](https://www.yicai.com/news/100148560.html)、[界面新闻](https://www.jiemian.com/article/7064410.html)（二手）
- **华策影视**：2026 年 6 月在桐庐 AIGC 影视创制中心发布 AI 精品项目，其中《西游记》系列首部《消失的 500 年》定位为 **"AIGC 精品中剧"，6 集 × 每集 15 分钟**；《资治通鉴》微短剧分季制作，全程请历史专家把关。来源：[同花顺/证券时报](https://stock.10jqka.com.cn/20260618/c677557766.shtml)。说明头部公司做 AI 内容时选择的是"少集数、长单集、精品化"，而不是 80 集流水线。
- **柠萌影视**（任务里写的"柠檬影业"未找到，推测指柠萌）：2026 年上半年短剧板块营收约 5800 万元，同比 +10%；华策、博纳、横店等老牌公司的短剧收入占比仍低。来源：[北京商报](https://www.bbtnews.com.cn/2026/0907/604975.shtml)

### 2.2 头部创作者 / MCN

- **影视飓风（Tim）**：团队约百人，业务是测评、商业短片、电商三块。管理原则是**"分段专业化"、一人只负责一件事**（调色、剪辑、摄影互不兼任），**管流程而不是管人**，目标是把产出流程标准化以减少收音、录像等基础失误。来源：[汽车之家创作者大会报道 2025-11](https://www.autohome.com.cn/news/202511/1310715.html)
- **papi 酱 / Papitube**：走红后很快转为团队制并孵化 MCN；行业评论认为短视频需要"工业化生产和传播体系"。**无忧传媒**：定位"互联网型经纪公司"，签约达人 10 万以上，业务覆盖短视频广告、直播电商、短剧等。来源：[人人都是产品经理](https://www.woshipm.com/it/916499.html)、[投资界](https://news.pedaily.cn/202005/455292.shtml)
- 何同学：本次没找到其生产流程的可靠公开资料，不作结论。

共同点：头部创作者的质量门槛不是某个参数，而是**流程拆分到岗位 + 每个岗位有固定检查项**。这与 Cinefoundry"每个岗位一个 Skill + 质检门"的结构一致。

---

## 三、微短剧（2025–2026）

### 3.1 市场规模

- 国内：2025 年规模口径差异大——艾媒 677.9 亿元，DataEye 称微短剧 + 漫剧产值达千亿；同年全国电影票房 518.32 亿元，微短剧已超过电影票房。用户 6.96 亿（2025 年 6 月）。红果短剧月活 2.45 亿（QuestMobile），**全剧免费、靠广告变现**，对创作者"保底 + 分账"；免费短剧约占市场 55%。来源：[界面新闻](https://www.jiemian.com/article/13912771.html)、[36氪](https://www.36kr.com/p/3648568571359750)、[CBNData](https://www.cbndata.com/information/294920)
- 出海：2025 年 Q1 短剧 App 全球内购收入约 7 亿美元，同比约 4 倍，美国占 49%；ReelShort 1.3 亿、DramaBox 1.2 亿美元。2025 全年内购约 29.8 亿美元（+115%）。2026 年 Q1 美国占全球内购 37%，DramaBox、ReelShort 各约 1.4 亿美元。2026 年全球预计超 60 亿美元。来源：[Sensor Tower](https://sensortower.com/blog/state-of-short-drama-apps-2025)、[Filmustage](https://filmustage.com/blog/short-drama-apps-compared-reelshort-vs-dramabox-in-2026/)、[财新 Global 2026-08](https://www.caixinglobal.com/2026-08-07/analysis-ai-fuels-chinese-micro-drama-boom-in-us-as-regulators-circle-102472290.html)

### 3.2 格式与结构

| 维度 | 国内主流 | 出海（ReelShort / DramaBox 类） |
|---|---|---|
| 画幅 | 竖屏 9:16，1080×1920 | 同左 |
| 单集时长 | 1–3 分钟；法规定义上限为 20 分钟 / 集 | 60–90 秒 / 集 |
| 集数 | 付费剧常见 60–100 集；精品 / 免费剧趋向更少集数 | 约 60–90 集，一部总长相当于一部电影 |
| 付费 | 付费剧前若干集免费后按集解锁；免费平台靠广告 | 前 5–10 集免费，之后金币解锁（约 0.3 美元 / 集）或周订阅；用户投诉集中在周订阅自动续费 |
| 开场 | "黄金 3 秒"：直接冲突、强悬念或极致反差（高光跌谷底）三类钩子 | 同左，首集 10 秒内交代身份落差 |
| 节奏 | 每 20–30 秒一个情绪节点；前半分钟给出第一次释放 / 反转；"期待—压抑—爆发"循环 | 同左 |
| 集尾 | 每集结尾卡在悬念最高点；**付费卡点必须放在情绪最高潮，而非故事自然段落**，结构从卡点倒推 | 同左 |
| 题材 | 逆袭、甜宠、重生复仇、战神 / 赘婿、悬疑、萌宝、年代 | 狼人 / 吸血鬼奇幻、亿万富翁言情、重生复仇；早期主攻 35 岁以上女性，正在年轻化 |

来源：[网易 · 短剧节奏方法](https://c.m.163.com/news/a/L30RCS1005340TH8.html)、[人人都是产品经理](https://www.woshipm.com/copy/4255408.html)、[Spyrosoft 微短剧变现](https://spyro-soft.com/blog/media-and-entertainment/microdrama-monetisation-models-why-the-real-innovation-isnt-the-content-its-the-payment-stack)、[Genra 变现指南](https://genra.ai/blog/ai-short-drama-monetization-guide)、[Vodlix](https://vodlix.com/blog/top-short-drama-platforms-and-how-they-monetize)、[财新 Global](https://www.caixinglobal.com/2026-08-07/analysis-ai-fuels-chinese-micro-drama-boom-in-us-as-regulators-circle-102472290.html)（集数、价格多为二手单一来源）

### 3.3 实拍制作规范

- 国内：剧组规模从 2023 年十余人扩大到 2025 年 **40–60 人**，分工接近传统影视；有公司 3–4 天拍完 30 集，女频情感戏更慢。西安日均 60 多个剧组开机，横店 2025 年前 7 个月接待竖屏剧组已超过 2024 全年。来源：[人民网《中国城市报》](https://paper.people.com.cn/zgcsb/pc/attachement/202512/22/ab4fe3f7-9f01-4fc5-9ea7-c3d2e707e59d.pdf)、[36氪/中新经纬](https://www.36kr.com/p/3119081864531976)、[新华网 2026-07](https://www.news.cn/money/20260723/807bd52c041a46ea964f3452f8c79c8b/c.html)
- 美国（ReelShort 在洛杉矶）：单部预算 **13–30 万美元**，拍摄 8–10 天，每天 12 小时、**平均 10 页 / 天**（纪录 29 页），每个镜头只给 3–5 条；演员日薪 200–800 美元。母公司 Crazy Maple 从 2023 年每月 4 部增到 30 部以上。来源：[No Film School](https://nofilmschool.com/what-are-verticals)、[LA Film School](https://www.lafilm.edu/?p=31325)、[Backstage](https://www.backstage.com/magazine/article/now-casting-vertical-drama-78969/)

结论：实拍微短剧的质量门槛本身不高（条次少、布光平），观众买的是**剧情钩子和情绪**。AI 版能否成立，取决于剧本结构和人物一致性，而非画面极致。

### 3.4 AI 短剧现状（2025–2026）

**规模与效果**
- 2026 年 Q1 全行业上线约 12.8 万部微短剧，**95% 以上为 AI 生成**（单一来源，口径可能含漫剧）。红果热播榜前十中 7 部是 AI 漫剧；大盘播放 86.7 亿次中 AI 漫剧占 29.4%，其中八成是"AI 仿真人"风格。来源：[36氪](https://www.36kr.com/p/3895496974026632)、[澎湃](https://www.thepaper.cn/newsDetail_forward_32818640)、[Vitrina](https://vitrina.ai/blog/ai-generated-short-drama-production-companies)
- 出海：中国公司每月至少为海外市场生产 1000 部 AI 短剧；ReelShort 背后的中文在线（COL）每月用字节 Seedance 2.0 生产 100 部以上；蚂蚁系 CreativeFitting 称 80% 以上剧目由 AI Agent 完成编剧到分发。AI 真人短剧在 2026 年 Q1 出海投放榜前 20 中占 7 席，观众"能看出是 AI，但不太影响观看"。来源：[财新 Global](https://www.caixinglobal.com/2026-08-07/analysis-ai-fuels-chinese-micro-drama-boom-in-us-as-regulators-circle-102472290.html)、[SocialPeta](https://socialpeta.com/en/blog/when-ai-starts-acting-can-the-surge-of-ai-live-action-short-dramas-cross-cultures-and-trigger-empathy)
- 成本：AI 短剧单集成本可控制在约 1 万元；所谓"3000 元成本"爆款只算了算力，实际团队近 20 人。来源：[每日经济新闻](https://www.nbd.com.cn/articles/2026-07-26/4512224.html)、[人人都是产品经理](https://www.woshipm.com/ai/6429518.html)

**问题**
- 爆款率极低：2025 年约 6 万部漫剧，破亿播放仅 96 部（0.16%），2026 年 2 月降至 0.117%；纯付费漫剧 ROI 降到 1.1。红果 2026 年 4 月专项治理低质漫剧，一周下架 3522 部，月底累计处置超 1 万部；Q2 新增 AI 短剧约 0.6 万部，大幅收缩。来源：[人人都是产品经理](https://www.woshipm.com/ai/6429518.html)、[36氪](https://www.36kr.com/p/3895496974026632)
- 观众吐槽排名：**"动作诡异"、"表情僵硬"、"剧情套路"**；特写里眼神空洞、表情与台词不搭、情绪"公式化"；抠图生硬、光影脱节的"塑料感"（《这一秒过火》AI 片头被吐槽后改回真人重拍）。来源：[每日经济新闻](https://www.nbd.com.cn/articles/2026-07-26/4512224.html)、[界面新闻](https://www.jiemian.com/article/14861797.html)、[新浪娱乐](https://ent.sina.cn/2026-07-27/detail-inikfnpm0766338.d.html)
- 侵权：大量团队未经授权使用真人肖像（[Vitrina](https://vitrina.ai/blog/ai-generated-short-drama-production-companies)）。美国参议院司法委员会 2026 年 6 月一致通过 NO FAKES Act，要求用 AI 复制他人声音或肖像前取得同意（[财新 Global](https://www.caixinglobal.com/2026-08-07/analysis-ai-fuels-chinese-micro-drama-boom-in-us-as-regulators-circle-102472290.html)）。
- 英语观众：没找到针对 AI 短剧的系统性受众调研。非短剧领域，Aronofsky 的 AI 剧集遭到批评者和观众的强烈负面反馈（[Digital Trends](https://www.digitaltrends.com/movies/darren-aronofskys-ai-generated-series-faces-harsh-backlash-online/)）。有观点认为风格化角色比"差一点像真人"的角色更容易被接受。

对 Cinefoundry 的含义：市场已经被低价 AI 漫剧淹没，**平台在清理低质 AI 内容**；单靠"能生成"没有竞争力，差异点只能是"看不出 AI 的表演和镜头 + 扎实的剧本结构 + 合规"。

### 3.5 监管（截至 2026-10）

**《微短剧发展管理办法》（广电总局第 16 号令，2026-07-27 通过，2026-09-01 施行）**——首部微短剧部门规章：
- 定义：单集时长少于 20 分钟、主线明确、情节连续、人物突出的剧集。
- 按投资额度和题材分为一、二、三类，实行备案公示和发行许可：一类（投资较大，或涉及政治、军事、外交、国家安全、民族、宗教、司法、公安等特殊题材）由省级及以上广电颁发《微短剧发行许可证》；二类由省级广电出具批准文件；三类由符合条件的播出平台自行播前审核并标注节目编号。具体金额门槛另行制定。
- **使用 AI 生成、制作的微短剧，制作机构和播出单位须在每集明显位置添加提示标识**。
- 列明 11 类禁载内容（危害国家安全、歪曲历史、诋毁传统文化、侵害未成年人权益等）；禁用诱导沉迷的算法。
- 来源：[新华网 2026-07-31 全文](https://www.news.cn/legal/20260731/4b8eea40226644d0a347c72ea1b21b75/c.html)、[IT之家](https://www.ithome.com/0/984/306.htm)、[光明网](https://m.gmw.cn/2026-08/02/content_1304541635.htm)、[澎湃](https://m.thepaper.cn/newsDetail_forward_33691660)

**《AI 微短剧分类分层标准》（2026-06-25 发布，2026-07-01 施行）**：投资 **80 万元及以上**，或主要剧情涉及政治、军事、外交、国家安全等特殊题材的 AI 微短剧，按"重点微短剧"管理。来源：[同花顺](https://news.10jqka.com.cn/20260625/c677723241.shtml)

**专项治理（2026-06-01 起）**：集中整治八类问题——涉儿童有害、软色情擦边、拜金炫富、畸形婚恋观、封建糟粕、暴力复仇、低俗片名、侵权盗版。来源：[腾讯新闻/读特](https://news.qq.com/rain/a/20260604A06CUD00)、[新京报](https://m.bjnews.com.cn/detail/1782405519189409.html)

**更早的管理提示**：2024 年 11 月"霸总"题材提示——压缩数量，不得用"霸总"等字眼做片名引流，严控拜金、炫富、一夜暴富等价值观；企业家题材须坚持现实主义。来源：[澎湃](https://m.thepaper.cn/newsDetail_forward_29470924)、[第一财经](https://www.yicai.com/news/102374883.html)。注意 Cinefoundry 想做的"逆袭 / 复仇"题材，正好落在"暴力复仇""拜金炫富"的治理区。

**《人工智能生成合成内容标识办法》（网信办等四部门，2025-09-01 施行）+ 强制性国标 GB 45438-2025**：
- 显式标识（用户能直接感知的文字、声音、图形）：视频在**起始画面**加显著提示，播放过程中可在画面周边、中间或结尾补充；音频在开头、中间或结尾加语音提示或节奏提示。二手解读称视频文字标识**字高不低于画面最短边的 5%、正常播放下持续不少于 2 秒**（未取得国标原文，需核实）。来源：[网信办原文](https://www.cac.gov.cn/2025-03/14/c_1743654685899683.htm)、[少数派合规解读](https://sspai.com/post/97539)、[AIbase](https://www.aibase.com/zh/news/20918)
- 隐式标识（写进文件元数据）：包含生成合成属性、服务提供者名称或编码、内容编号。TC260 视频元数据实践指南覆盖 MP4/MOV/MKV/WebM 等，必填字段 `Label`、`ContentProducer`、`ProduceID`、`ContentPropagator`、`PropagateID`。来源：[Digital Policy Alert / TC260](https://digitalpolicyalert.org/event/33150-tc260-adopted-guidelines-on-identification-methods-for-ai-generated-synthetic-video-content)、[PwC 解读](https://www.pwccn.com/zh/tmt/method-identifying-synthetic-content-generated-ai-sep2025.pdf)
- 平台义务：读取元数据 → 有隐式标识就在内容旁显著提示；无元数据但用户声明 → 提示"可能为 AI 生成"；都没有但检测到痕迹 → 标"疑似 AI 生成"。**任何人不得恶意删除、篡改、伪造、隐匿标识**。

---

## 四、创作者短视频（抖音 / B 站 / YouTube / Shorts）

### 4.1 主流形态

| 形态 | 典型时长 | 结构要点 | AI 可行性 |
|---|---|---|---|
| 口播（talking head） | 抖音 30–90 秒；B 站 / YouTube 5–15 分钟 | 第一句即结论或冲突；每 5–10 秒切景别（推近 / 拉远 / B-roll）；全程大字幕 | 中：单人正面、口型对齐是 LTX 类模型最擅长的场景；长时间同一张脸的微表情是难点 |
| 测评 / 开箱 | 3–15 分钟 | 结论前置 → 外观 → 细节特写 → 实测 → 对比 → 结论 | 中低：产品特写是现有广告能力；"真人上手操作"涉及手部 |
| 知识科普 | B 站 5–20 分钟 | 问题钩子 → 反常识 → 图解 / 动画 → 总结 | 高：信息图、示意动画和旁白最不依赖真人 |
| Vlog | 3–15 分钟 | 生活流、环境声、真实感 | 低：观众买的就是"真实"，AI 与形态本身冲突 |
| 剧情短片（skit） | 1–5 分钟 | 冲突开场，30–60 秒一个反转 | 中：同微短剧单集 |
| 带货 / 产品展示 | 15–60 秒 | 痛点 → 产品 → 效果 → 价格 / 行动号召 | 高：现有广告管线直接复用 |

### 4.2 留存结构

- **开头**：抖音业内普遍把"5 秒完播率"当作能否进入下一级流量池的信号；常被引用的门槛是 5 秒完播 >40%、整体完播 >30%（培训机构说法，无官方出处）。抖音 2025 年初公开推荐逻辑后，业内共识是完播率只是"入场券"，还要看互动等多维数据。来源：[B 站专栏](https://www.bilibili.com/read/cv45263020)、[人人都是产品经理](https://www.woshipm.com/operate/6200947.html)
- **YouTube 长视频**：MrBeast 内部制作文档要求**把最好的内容压缩在前 60 秒预告**，之后大约每 3 分钟一次"再吸引"（新规则、加码）；第一句台词与标题一致、第一个镜头与封面一致；大部分流失发生在第一分钟。来源：[OMR 泄露文档报道](https://omr.com/de/daily/mrbeast-doc-pdf-leak)、[Substack 引 Guardian 2025-06](https://casarthakahuja.substack.com/p/the-mozart-of-the-attention-economy)
- **节奏手法**：短视频每 2–4 秒一次视觉变化（切镜、推拉、字幕弹出、音效点），长视频约 30 秒一次"模式打断"（换场景、插图、音效）。来源：[Autonolab](https://blog.autonolab.com/blog/2025-10-01-pattern-interrupts-resetting-attention-every-30-seconds/)（经验值）
- **字幕**：国内口播类全程大字幕，关键词变色 / 放大；位置在画面中部偏下、避开底部 UI 区。
- **封面与标题**：YouTube 2025 年 12 月起所有开通高级功能的创作者可**同时测试最多 3 组标题 / 封面**（长视频，不含 Shorts），两周内出结果，**以单次曝光带来的观看时长**而非点击率判定胜者。来源：[YouTube 帮助：A/B 测试](https://support.google.com/youtube/answer/16391400)、[Search Engine Journal](https://www.searchenginejournal.com/youtube-title-a-b-testing-rolls-out-globally-to-creators)。对 Cinefoundry：包装环节应一次产出 3 组标题 + 封面供测试。
- **Shorts 计数**：2025-03-31 起 Shorts 只要开始播放或重播即计 1 次观看；原口径改名"互动观看次数（Engaged views）"，变现仍以它为准。来源：[PPC Land](https://ppc.land/youtube-changes-how-shorts-views-are-counted-from-march-31/)

### 4.3 平台技术规格

| 项目 | YouTube（官方） | 抖音 | B 站 |
|---|---|---|---|
| 容器 / 编码 | MP4，H.264 High Profile，2 个连续 B 帧，CABAC，VBR；音频 AAC-LC 或 Opus，立体声 48 kHz | 官方页面未取得；常见做法 H.264 / HEVC MP4 | 官方页面未取得 |
| 参考码率（SDR） | 1080p：8 Mbps（标准帧率）/ 12 Mbps（高帧率）；4K：35–45 / 53–68 Mbps；官方说明"不设码率上限" | 1080p 常见 5–10 Mbps（二手，非官方） | 4K 实测平均约 20 Mbps、峰值 60 Mbps，最高 120fps（UP 主 2024 年实测，非官方） |
| 帧率 | 按拍摄帧率上传 | 30 / 60 | 最高 120 |
| 竖屏 | Shorts 9:16 1080×1920，**最长 3 分钟**（2024-10 起） | 9:16 1080×1920 为全屏 | 支持竖屏，主场景仍是横屏 |
| 响度 | 播放时归一化，业内普遍测得约 **-14 LUFS**，只压低超标内容、不提升过小内容（非官方）；建议真峰值 ≤ -1 dBTP | 无公开标准 | 无公开标准 |

来源：[YouTube 推荐上传编码设置](https://support.google.com/youtube/answer/1722171?hl=en-GB)、[Compresto · Shorts 规格](https://compresto.app/blog/youtube-shorts-size)、[B 站码率实测](https://www.bilibili.com/opus/891367754490183699)、[Shotcut 论坛](https://forum.shotcut.org/t/highest-possible-audio-quality-for-youtube/31825/12)、[Youlean](https://youlean.co/?p=30813)、[B 站专栏（抖音码率）](https://www.bilibili.com/opus/447634956319510993)

**9:16 安全区**（官方未公布自然流量的精确像素，各家测量不一）：
- YouTube Shorts：顶部 120–380 px、底部 300–380 px、右侧 96–200 px（操作按钮列）、左侧约 60 px 被遮挡；保守安全区约 **900×1160**（居中）。来源：[AdKit](https://adkit.so/tools/safe-zones/youtube)、[Postplanify](https://postplanify.com/tools/youtube-shorts-safe-zone-checker)、[AI Carousels](https://www.aicarousels.com/free-tools/youtube-safe-zone-checker)
- 抖音 / TikTok：有效安全区约 840×1280 或 900×1492；底部 25–35% 留给标题、文案、用户名。来源：[Reap](https://reap.video/blog/short-form-video-safe-zones)、[Visu](https://visu.network/tools/safe-zone-checker/)
- 统一取交集作为工程规则：**1080×1920 画布内，关键信息（脸、字幕、产品）放在 x∈[60, 900]、y∈[380, 1440] 的区域**；字幕基线放在 y≈1300–1400，即底部 UI 之上。

### 4.4 AI 内容标注规则

- **YouTube**：凡是**观众可能误以为真实的、用 AI 生成或改动的写实内容**必须在上传时勾选"经过修改或合成的内容"；脚本辅助、缩略图、普通 TTS 等不触发。普通视频标签显示在简介区，新闻、健康、金融、选举等敏感话题会显示在播放器上；未申报时 YouTube 可自行加标签，屡次不申报可能下架或暂停合作伙伴计划。2026 年 5 月改名为"AI content labeling"并提高标签可见度（时间点与欧盟 AI 法案 2026-08-02 合规期限相关）。来源：[AIR Media-Tech](https://air.io/en/youtube-hacks/youtube-ai-disclosure-in-2026-label-it-yourself-or-youtube-will)、[PPC Land](https://ppc.land/youtube-shifts-generative-ai-labels-to-spots-viewers-will-actually-see/)、[Minimatters 2026-05](https://minimatters.com/youtube-ai-content-labeling-update-in-may-2026/)（二手）。**Cinefoundry 的写实真人画面属于必须申报的类别**。
- **抖音**：发布时通过"创作声明"主动标注 AI 生成；平台也会自动识别。早在 2023 年即规定未标注可处罚至封号；违规 AI 虚拟人可被下架、取消营利权限、清粉、封号。来源：[界面新闻](https://www.jiemian.com/article/13310461.html)、[财联社](https://www.cls.cn/detail/1630930)、[China Law Translate](https://www.chinalawtranslate.com/抖音关于人工智能生成内容标识的水印与元数据规/)
- **B 站、快手、腾讯等**：均已针对国家标识办法出台细则，B 站具体操作页面本次未取得。来源：[澎湃](https://m.thepaper.cn/newsDetail_forward_31523045)

---

## 五、对 Cinefoundry 的综合建议

### 5.1 三类输出的本质差异

| | 广告（现有） | 创作者短视频 | 微短剧 |
|---|---|---|---|
| 主角 | 产品 | 一个固定"出镜人"或无人出镜 | 3–8 个固定角色 |
| 核心难点 | 产品一致性、质感 | 留存曲线、口播表演、包装 | **剧本结构 + 多角色跨集一致性 + 对白表演** |
| 单件长度 | 6–30 秒 | 30 秒–15 分钟 | 每集 1–3 分钟 × 10–80 集 |
| 声音主体 | 旁白 + 音乐 | 口播（人物说话） | 多人对白 + 音效 + 配乐 |
| 合规 | 广告法 | 平台规则 + AI 标识 | 广电备案 / 分类 + 禁载内容 + 每集 AI 标识 |

### 5.2 岗位 → Skill 对照

**可以直接或稍改后复用的现有 Skill**

| 现有 Skill | 新用途 | 需要的改动 |
|---|---|---|
| `ad-brief-intake` | 三类项目统一入口 | 增加 `format` 字段（ad / short / drama）、平台、集数、语言；按格式分支追问 |
| `creative-direction` | 短视频选题与概念；微短剧的 logline + treatment | 加入剧情类模板 |
| `cinematography-and-art-direction` | 全格式通用 | 增加竖屏构图规则（人物放在安全区内、头顶留白小于横屏）、剧情布光（动机光源、夜景） |
| `storyboard-design` | 全格式通用 | 支持"场次 → 镜头"两级结构；加入对白镜头的正反打、轴线、视线匹配 |
| `shot-quality-gate` | 全格式通用 | 从"产品身份"扩展为"角色身份"：比对角色定妆照的脸、发型、服装、道具 |
| `spark-local-media-generation` / `spark-model-scheduler` | 通用 | 按角色 / 场景合并任务（1st AD 思路），减少模型与参考切换 |
| `ad-compliance-review` | 拆成通用合规框架 | 广告法规则保留为一个规则集，新增"广电微短剧禁载 + 专项治理八类 + 平台社区规范"规则集 |
| `final-cut-assembly` | 通用后期 | 拆出剪辑、字幕、混音、交付四段（见下） |
| `ad-reference-breakdown` | 拉片 | 增加爆款短视频 / 短剧的节奏拉片（每段时长、钩子位置、卡点位置） |

**需要新增的 Skill**（按优先级）

| 新 Skill | 对应岗位 | 职责与合格标准 |
|---|---|---|
| `series-development` | Showrunner / 编剧室 | 产出 logline、剧集圣经、分集大纲。每集必须写明：开场 3 秒钩子、情绪节点（每 20–30 秒）、结尾卡点；整季标出付费卡点位置；题材自检（避开"暴力复仇、拜金炫富、霸总片名"等治理项） |
| `screenplay-writing` | 编剧 | 标准剧本格式（场景标题、动作、角色、对白），英文对白 + 中文译文并行；按"1 页 ≈ 1 分钟"控制时长；单句对白 ≤ 一个镜头时长（便于口型生成，见 5.3） |
| `character-continuity-bible` | 选角 + 服装 + 场记 | 为每个角色生成并锁定定妆照（正 / 侧 / 3/4 / 全身）、服装表（按场次）、道具表、**声音档案**（TTS 音色、语速、口音）；所有镜头生成都必须引用它 |
| `continuity-check` | 场记 | 剪辑前跨镜头检查：脸、服装、道具、左右轴线、视线、光线方向、时间（日 / 夜）是否连贯；与 `shot-quality-gate`（单镜头）互补 |
| `dialogue-performance` | 配音导演 + ADR | 按角色档案生成英文对白音频（Qwen3-TTS），控制情绪与语速；与画面口型对齐（LTX 音频驱动），不合格的句子单独重生成（相当于 ADR） |
| `sound-design-foley` | 拟音 + 音效 | 用 MOSS-SoundEffect 生成脚步、衣物、道具、环境声，按镜头对点 |
| `music-score` | 作曲 / 音乐总监 | ACE-Step 生成主题曲与情绪配乐，按场景情绪和卡点设计音乐起落；保证全剧主题动机一致 |
| `retention-editing` | 剪辑师（短视频方向） | 按平台留存规则剪：前 3 秒钩子、每 2–4 秒视觉变化、结尾卡点；输出预估留存风险点 |
| `bilingual-subtitles` | 字幕 | 中文上（大）、英文下（小）；中文 ≤16 字 / 行、≤9 字 / 秒、不用逗号句号；英文 ≤42 字符 / 行、≤20 字符 / 秒；单条 0.83–7 秒；自动校验后烧录，同时导出 SRT / TTML |
| `platform-packaging` | 运营 / 包装 | 每个平台的标题（3 组）、封面（3 张，首镜与封面一致）、简介、话题标签、AI 申报选项；竖屏安全区检查 |
| `delivery-qc` | 交付 QC | 规格（分辨率、帧率、码率）、响度测量、黑帧 / 爆音、**显式 AI 标识是否在每集起始画面、隐式元数据是否写入**；输出交付报告 |

现有 `cinefoundry-ad-film` 入口改为通用的制片人 Skill，按 `format` 选择流程：广告走现有流程；短视频在脚本后插入 `retention-editing` 和 `platform-packaging`；微短剧在最前插入 `series-development → screenplay-writing → character-continuity-bible`，在剪辑前插入 `continuity-check`，在声音阶段走 `dialogue-performance → sound-design-foley → music-score`。

### 5.3 本地开源模型现在能做到什么（坦率评估）

参考 LTX-2 公开资料：19B 参数，音画一次生成，单段最长约 20 秒；**多人同框时偶尔把台词分给错误的角色**；超过 20 秒出现时序漂移、同步变差；精细手势需要反复调参；非对白音频质量偏低。来源：[Wikipedia: LTX-2](https://en.wikipedia.org/wiki/LTX-2)、[Introl](https://introl.com/blog/ltx-2-audiovisual-diffusion-synchronized-video-audio-2026)、[AI Indigo 评测](https://aiindigo.com/blog/ltx-2-review-bringing-static-images-to-life-in-2026)。LTX-2.5 的具体改进本次未查证，以下按 LTX-2 能力保守估计，需在 Spark 上实测确认。

| 能力 | 现状 | 做法 |
|---|---|---|
| 单人中近景说英文、口型同步 | **可用**，是最稳定的场景 | 一个镜头只让一个人说话，单句 ≤5–8 秒；正面或 3/4 侧脸 |
| 对话戏 | 双人同框说话**不可靠** | 用正反打（shot / reverse shot）拆成单人镜头 + 听者反应镜头；双人镜头只放无对白的动作 |
| 单集内角色一致 | 可用，靠定妆照 + Qwen-Image-Edit 锚定首帧 | 每镜首帧由角色圣经生成，过 `shot-quality-gate` |
| 跨 60 集角色一致 | **困难**：脸会慢慢漂移，服装、发型细节最先出错 | 先做 10–20 集短季；考虑每个主角训练 LoRA；每集开头重新锚定 |
| 情绪微表情 | 弱，正是观众吐槽的"表情僵硬、眼神空洞" | 少用长时间大特写；用剪辑（反应镜头、音乐、声音）补情绪；表演靠对白音频驱动比靠文本提示更自然 |
| 手部、肢体接触 | 弱：拥抱、打斗、握手、递物、吃东西易出错 | 剧本阶段就规避或改为画外 / 剪辑暗示；`shot-quality-gate` 重点查手 |
| 人群 | 弱：背景人脸崩坏 | 浅景深虚化背景，或用空镜 / 少人场景 |
| 画面内文字 | 弱：招牌、手机屏幕、文件上的字会乱 | 后期叠加，生成时避免 |
| 长镜头 | >20 秒漂移 | 镜头控制在 3–8 秒，符合短剧本来的剪辑节奏 |
| 吞吐 | 一部 60 集 × 90 秒的剧约 90 分钟成片，约 1000 个镜头加重试，单台 Spark 需要数周 | 首个剧集产品定为 10–20 集 × 1–2 分钟的"精品短季"（与华策 6 集 × 15 分钟的"精品中剧"同一思路） |

**最不容易看出 AI 的方向**：知识科普 / 解说、带货与产品展示、单人口播、风格化（非照片级）剧情。**最容易露馅**：照片级多人情感戏、动作戏、Vlog。

### 5.4 推荐规格表

说明：Cinefoundry 当前标准是 16:9 / 1080p / 60fps。剧情类建议改用 **24fps**——60fps 会产生"电视剧 / 肥皂剧感"，与"电影感、少 AI 味"的目标相反（行业惯例，非平台要求）；RIFE 插帧只用于广告和展示类。

| 输出类型 | 画幅 / 分辨率 | 帧率 | 时长 | 响度（积分 / 真峰值） | 字幕 |
|---|---|---|---|---|---|
| TVC 广告主片 + 剪辑版（现有） | 16:9，1920×1080（可加 9:16 版） | 60（产品展示）或 25（国内电视） | 30 / 15 / 6 秒 | 网络投放 -14 LUFS / -1 dBTP；电视 -24 LKFS / -2 dBTP（GY/T 282，未核实） | 双语，中上英下 |
| 抖音 / 视频号竖屏短视频 | 9:16，1080×1920 | 30（口播、剧情）/ 60（产品、运动） | 15–90 秒（带货 15–30 秒） | -14 LUFS / -1 dBTP | 中文 ≤12 字 / 行大字（竖屏行宽窄）、英文 ≤32 字符 / 行；基线 y≈1300–1400 |
| B 站横屏 | 16:9，1920×1080 或 3840×2160 | 24（剧情）/ 30 / 60（测评、游戏） | 3–15 分钟 | -14 LUFS / -1 dBTP | 中 ≤16 字、英 ≤42 字符，单行优先 |
| YouTube 长视频 | 16:9，3840×2160（4K 码率档更高）或 1920×1080 | 24 / 30 / 60 | 8–20 分钟；前 60 秒压缩看点 | -14 LUFS / -1 dBTP | 同上；另上传 SRT 供自动翻译 |
| YouTube Shorts | 9:16，1080×1920 | 30 / 60 | ≤3 分钟（建议 20–60 秒） | -14 LUFS / -1 dBTP | 同抖音 |
| 国内微短剧 | 9:16，1080×1920 | 24 | 每集 1–3 分钟（法规上限 <20 分钟）；10–20 集精品季起步 | -14 LUFS / -1 dBTP，以对白为基准 | 中上英下；中 ≤12 字 / 行、≤9 字 / 秒；英 ≤32 字符 / 行、≤20 字符 / 秒；**每集起始画面加 AI 标识（字高 ≥ 短边 5%，≥2 秒，待核实）+ 隐式元数据** |
| 出海英文微短剧 | 9:16，1080×1920 | 24 | 每集 60–90 秒；前 5–10 集免费，卡点放在第 8–12 集情绪最高点 | -14 LUFS / -1 dBTP | 英文为主（可单语）；YouTube 渠道勾选 AI 申报 |
| 精品中剧 / 好莱坞对标 | 16:9 或 2.39:1 遮幅，3840×2160 | 23.976 / 24 | 每集 10–15 分钟 | 对标 Netflix：-27 LKFS ±2（对白门限）/ -2 dBTP；另出 -14 LUFS 网络版 | Netflix 规范：中 16 字 / 行 9 字 / 秒，英 42 字符 / 行 20 字符 / 秒，最多 2 行 |

双语字幕通用样式：中文字号约为画面高度的 4.5–5%（竖屏按宽度算，约 1080 宽下 56–64 px），英文约为中文的 60%，白字加半透明黑描边或投影，中英两行行距 0.3 倍字高；同一说话人字幕位置不跳动；避开人物嘴部。

### 5.5 落地顺序建议

1. **先做低风险格式**：竖屏带货 / 产品短视频和科普解说——复用 80% 的广告管线，只需新增 `platform-packaging`、`bilingual-subtitles`、`delivery-qc`（含 AI 标识）。
2. **再做单人口播与剧情短片**（1–3 分钟）：新增 `character-continuity-bible`、`dialogue-performance`、`retention-editing`，验证单人英文对白口型和一个角色跨十几个镜头的一致性。
3. **最后做微短剧精品短季**（10–20 集）：新增 `series-development`、`screenplay-writing`、`continuity-check`、`sound-design-foley`、`music-score`。上线前确认广电分类（AI 短剧 80 万元以下、一般题材通常落在平台自审类）和每集 AI 标识。
4. 所有格式统一在交付阶段写入显式 + 隐式 AI 标识，不提供去除标识的选项（法规明确禁止删除或隐匿标识）。
