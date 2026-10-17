/** Deterministic wording screen for Chinese ad copy. Rule notes: .agents/skills/ad-compliance-review/references/rules.md */

export type Category = 'general' | 'food' | 'health_food' | 'cosmetics' | 'medical'
export const CATEGORIES: Category[] = ['general', 'food', 'health_food', 'cosmetics', 'medical']

export interface Finding {
  text: string
  rule: string
  severity: 'block' | 'review'
  reason: string
  line: number
  context: string
}

interface Rule {
  rule: string
  severity: 'block' | 'review'
  pattern: RegExp
  reason: string
  categories?: Category[]
}

const NON_MEDICAL: Category[] = ['general', 'food', 'health_food', 'cosmetics']

const RULES: Rule[] = [
  {
    rule: 'absolute_terms',
    severity: 'block',
    pattern: /国家级|世界级|最高级|最佳|最好|最优|最强|最大|最低价|最便宜|最先进|最受欢迎|第一品牌|全网第一|销量第一|排名第一|NO\.?\s*1|顶级|顶尖|极致|极品|首选|唯一|独一无二|史无前例|前所未有|绝无仅有|全网最低|行业领先|遥遥领先|王牌|巅峰/gi,
    reason: '《广告法》第九条第（三）项禁止使用“国家级”“最高级”“最佳”等绝对化用语。',
  },
  {
    rule: 'guarantee',
    severity: 'block',
    pattern: /100\s*[%％]|百分之百|永不|永久|永远不|零风险|无任何副作用|无副作用|保证有效|无效退款|立竿见影|一次见效|\d+\s*天见效|包治|药到病除/gi,
    reason: '无法证实的效果保证，构成引人误解的内容（《广告法》第四条、第二十八条）。',
  },
  {
    rule: 'medical_claim',
    severity: 'block',
    pattern: /治疗|治愈|根治|疗效|疗程|药用|处方|消炎|抗炎|杀菌|抑菌|抗病毒|抗癌|防癌|降血压|降血糖|降血脂|医学级|医疗级|药妆|医用级/gi,
    reason: '非医疗、药品、医疗器械广告不得涉及疾病治疗功能或使用医疗用语（《广告法》第十七条）。',
    categories: NON_MEDICAL,
  },
  {
    rule: 'health_food',
    severity: 'block',
    pattern: /预防疾病|安全无毒|绝对安全|替代药物|代替药物/gi,
    reason: '保健食品广告不得含功效、安全性的断言或保证，不得涉及疾病预防、治疗（《广告法》第十八条）。',
    categories: ['health_food', 'food'],
  },
  {
    // The nuts brief asked for 补脑、增强免疫力; the reviewer's rewrite was too short for the script checks, the line stood,
    // and nothing in this list caught it. A food or an everyday product may not claim a health effect at all.
    rule: 'health_effect',
    severity: 'block',
    pattern: /补脑|健脑|益智|增强免疫|提高免疫|提升免疫|增强抵抗力|抗疲劳|缓解疲劳|助眠|改善睡眠|安神|缓解焦虑|抗焦虑|减肥|瘦身|燃脂|刮油|排毒|养颜|抗衰老|延缓衰老|护肝|养胃|不长胖|喝不胖|吃不胖/gi,
    reason: '普通食品和一般商品不得宣称保健、医疗或减肥功效（《广告法》第十七条、第二十八条，《食品安全法》第七十三条）。',
    categories: ['general', 'food'],
  },
  {
    rule: 'cosmetics_efficacy',
    severity: 'review',
    pattern: /美白|祛斑|淡斑|防晒|防脱|生发|育发|祛痘|抗皱|去皱|除皱|修复屏障|换肤|再生/gi,
    reason: '功效宣称需与注册/备案的功效一致并有依据；不得明示或暗示医疗作用（《化妆品监督管理条例》第四十三条）。',
    categories: ['cosmetics'],
  },
  {
    rule: 'data_claim',
    severity: 'review',
    pattern: /\d+(\.\d+)?\s*[%％]|\d+\s*倍|[\d,，]+\s*[万亿]\s*(人|用户|家庭|次)|销量突破|好评率|回购率|临床(验证|测试|证明)|实验(证明|证实)/gi,
    reason: '引用数据、统计或实验结论必须真实准确并标明出处（《广告法》第十一条）。',
  },
  {
    rule: 'authority',
    severity: 'block',
    pattern: /国家领导人|国务院推荐|政府指定|国家机关推荐|特供|专供|国旗|国徽|国歌|军旗/gi,
    reason: '不得使用国家机关及其工作人员名义或形象、国旗国徽等（《广告法》第九条）。',
  },
  {
    rule: 'superstition',
    severity: 'block',
    pattern: /转运|招财|辟邪|开光|旺夫|改运|保佑/gi,
    reason: '广告不得含有迷信内容（《广告法》第九条第（八）项）。',
  },
]

export function scanCopy(copy: string, category: Category): Finding[] {
  const findings: Finding[] = []
  copy.split(/\r?\n/).forEach((line, index) => {
    const blocked: Array<[number, number]> = []
    for (const rule of RULES) {
      if (rule.categories && !rule.categories.includes(category)) continue
      for (const match of line.matchAll(rule.pattern)) {
        const start = match.index
        // "100%" is a guarantee, not also a data claim: keep the stricter finding only.
        if (rule.severity === 'review' && blocked.some(([from, to]) => start >= from && start < to)) continue
        if (rule.severity === 'block') blocked.push([start, start + match[0].length])
        findings.push({
          text: match[0],
          rule: rule.rule,
          severity: rule.severity,
          reason: rule.reason,
          line: index + 1,
          context: line.slice(Math.max(0, start - 12), start + match[0].length + 12).trim(),
        })
      }
    }
  })
  return findings
}
