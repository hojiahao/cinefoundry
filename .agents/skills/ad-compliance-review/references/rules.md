# Rule notes

Summaries for triage. Confirm against the current official text before publication.

## absolute_terms
《广告法》第九条第（三）项：广告不得使用“国家级”“最高级”“最佳”等用语。
Practice extends this to equivalent superlatives (第一、顶级、极致、首选、全网最低 …).
Rewrite toward a specific, provable attribute: “销量第一” → “2025 年 X 平台同品类销量领先（数据来源：…）”
is still risky without the source on screen; prefer describing the feature itself.
The rule follows the claim, not the language: an English voiceover heard in China is advertising content too, so
"the best", "number one", "the only", "ultimate", "world's first" are restricted exactly like 最佳、第一、唯一、顶级、首创.
The code rejects the common forms in `vo` (`EN_ABSOLUTES` in `src/agent/checks.ts`); the reviewer judges the rest
("finest", "unmatched", "like no other").

## guarantee
《广告法》第四条、第二十八条：不得含有虚假或者引人误解的内容。
“100% 有效”“永不”“零风险”“无效退款” promise outcomes that cannot be substantiated.

## medical_claim
《广告法》第十七条：除医疗、药品、医疗器械广告外，禁止其他任何广告涉及疾病治疗功能，
并不得使用医疗用语或者易使推销的商品与药品、医疗器械相混淆的用语。
Applies to `general`, `food`, `health_food`, `cosmetics`.

## health_food
《广告法》第十八条：保健食品广告不得含有表示功效、安全性的断言或者保证；不得涉及疾病预防、治疗功能；
并应当显著标明“本品不能代替药物”。

## cosmetics_efficacy
《化妆品监督管理条例》第四十三条：化妆品广告不得明示或者暗示产品具有医疗作用。
Efficacy claims (美白、祛斑、防晒、防脱发 等) belong to special cosmetics and need registration;
flag them for proof instead of blocking.

## data_claim
《广告法》第十一条：广告使用数据、统计资料、调查结果、文摘、引用语等引证内容的，应当真实、准确，并表明出处。

## superstition / national symbols
《广告法》第九条第（一）（二）（八）项：不得使用国旗、国歌、国徽、军旗等；不得使用国家机关及其工作人员名义或形象；
不得含有迷信内容。
