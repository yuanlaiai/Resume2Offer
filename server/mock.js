/**
 * 演示模式（DEMO_MODE=1）：不调用大模型，用内置样例数据跑通完整流程。
 * 目的：让 clone 下来的人不用配 Key 就能看到产品长什么样。
 * 结构与真实 LLM 输出完全一致，前端无需区分。
 */

const PROFILE = {
  candidate: {
    name: '林一',
    title: '高级后端工程师',
    years: 5,
    education: '本科 · 某 211 · 计算机科学与技术',
    city: '杭州',
  },
  targetRole: {
    title: 'AI 应用开发工程师',
    level: '高级',
    fitScore: 74,
    reason: '后端功底扎实，有 8 个月大模型应用落地经验，但缺少 RAG 评估体系和算法侧深度。',
  },
  summary:
    '5 年 Java 后端经验，近 8 个月主导公司内部知识库问答系统，做过检索链路和成本优化。工程能力强、能扛线上问题，但 AI 部分偏"调通即上线"，缺少量化评估；汇报时习惯讲做了什么，讲不清为什么这么做。',
  skills: [
    { name: 'Java / Spring Boot', level: '熟练', evidence: '主导订单中心重构，QPS 从 800 提升到 3200' },
    { name: '大模型应用（RAG / Agent）', level: '掌握', evidence: '搭建内部知识库问答，日均 1.2 万次调用' },
    { name: 'MySQL / Redis', level: '熟练', evidence: '设计分库分表方案，缓存命中率 96%' },
    { name: 'Kubernetes', level: '掌握', evidence: '负责 3 个服务的容器化与灰度发布' },
    { name: 'Python', level: '了解', evidence: '编写检索评测脚本' },
    { name: 'Prompt 工程', level: '掌握', evidence: '沉淀 40+ 业务提示词模板' },
  ],
  experiences: [
    {
      company: '某电商科技公司',
      role: '高级后端工程师',
      period: '2023.04 - 至今',
      highlights: [
        '主导内部知识库问答系统，接入 6 个业务线，日均调用 1.2 万次，人工工单下降 35%',
        '重构检索链路，引入混合检索与重排，答案采纳率从 61% 提升到 79%',
        '通过缓存与模型分流把单次问答成本从 0.08 元降到 0.03 元，年省约 42 万',
      ],
      stack: ['Java', 'Spring Boot', 'Milvus', 'Redis', 'Kubernetes', 'LLM'],
    },
    {
      company: '某支付公司',
      role: '后端工程师',
      period: '2021.07 - 2023.03',
      highlights: [
        '负责订单中心重构，接口 P99 从 420ms 降到 120ms',
        '设计分库分表方案，支撑单表 4 亿行数据迁移，零故障切换',
      ],
      stack: ['Java', 'MySQL', 'RocketMQ', 'Redis'],
    },
  ],
  projects: [
    {
      name: '企业知识库智能问答',
      role: '技术负责人',
      desc: '面向客服与销售的内部问答系统，覆盖产品文档、工单、政策三类数据源。',
      stack: ['RAG', 'Milvus', 'BM25', 'Rerank', 'Java'],
      impact: '日均 1.2 万次调用，答案采纳率 79%，人工工单下降 35%',
    },
    {
      name: '订单中心重构',
      role: '核心开发',
      desc: '把单体订单服务拆分为读写分离 + 分库分表架构。',
      stack: ['ShardingSphere', 'MySQL', 'RocketMQ'],
      impact: 'P99 420ms → 120ms，支撑大促 6 倍峰值流量',
    },
  ],
  strengths: [
    '有真实的大模型应用落地数据（调用量、采纳率、成本），不是只做过 Demo',
    '工程底子硬，能同时讲清业务指标和技术方案',
    '成本意识强，降本 60% 这个点很能打',
  ],
  risks: [
    {
      point: 'AI 经历只有 8 个月，深度存疑',
      why: '面试官会怀疑你只是调 API，没做过检索质量和评估体系',
      probe: '你怎么证明采纳率从 61% 到 79% 是检索优化带来的，而不是换了模型？',
    },
    {
      point: '成果归因不清',
      why: '简历写的都是结果数字，没有对照组和拆解过程',
      probe: '这 35% 的工单下降，有多少是你这个系统带来的？',
    },
    {
      point: '缺少算法侧能力',
      why: '目标岗位 JD 里提到微调与评测，简历完全没有体现',
      probe: '如果让你做一次 SFT，你会怎么构造数据？',
    },
    {
      point: '职级与年限匹配度',
      why: '5 年仍是"高级工程师"，没体现技术影响力半径',
      probe: '你影响过团队之外的决策吗？',
    },
  ],
  missing: ['RAG 评估体系（召回率/忠实度）', '模型微调与数据构造', 'A/B 实验设计', '技术方案的对上沟通'],
};

const TOPICS = [
  {
    name: '大模型应用与 RAG',
    why: '简历里近 8 个月的核心工作，也是目标岗位的主战场，必须能讲透。',
    topics: [
      {
        id: 't1',
        title: 'RAG 检索质量：混合检索与重排为什么有效',
        level: '深度',
        priority: 5,
        gap: false,
        reason: '简历写"引入混合检索与重排，采纳率 61%→79%"，面试官一定会追问原理与对比。',
        interviewerFocus: '不是听你背 BM25 和向量检索的定义，而是看你知不知道它们各自在什么 query 上失效。',
        followups: ['为什么向量检索会漏掉型号类的精确匹配？', '重排模型为什么不能直接替代召回？', '你怎么证明提升来自检索而不是换了模型？'],
      },
      {
        id: 't2',
        title: 'RAG 评估体系：召回率、忠实度与幻觉率怎么量',
        level: '深度',
        priority: 5,
        gap: false,
        reason: '简历只有"采纳率"这一个指标，面试官会质疑你缺少体系化评估。',
        interviewerFocus: '看你是否有离线评测集思维，还是只看线上体感。',
        followups: ['你的评测集怎么来的？多少条？', '忠实度和召回率冲突时怎么取舍？'],
      },
      {
        id: 't3',
        title: 'Prompt 工程的版本管理与回归测试',
        level: '进阶',
        priority: 4,
        gap: false,
        reason: '简历写"沉淀 40+ 提示词模板"，会被问怎么保证改动不退化。',
        interviewerFocus: '考察工程化习惯，而不是会写多少花哨提示词。',
        followups: ['改一版 prompt 怎么验证没退化？', '模板多了怎么治理？'],
      },
      {
        id: 't4',
        title: '模型分流与成本优化：什么请求该走小模型',
        level: '深度',
        priority: 5,
        gap: false,
        reason: '简历写"成本从 0.08 降到 0.03 元"，这是差异化亮点，必须能拆解。',
        interviewerFocus: '看你是拍脑袋分流，还是有可量化的路由策略和兜底。',
        followups: ['分流错了怎么办？', '怎么衡量降本对体验的损伤？'],
      },
    ],
  },
  {
    name: '后端基本功',
    why: '5 年 Java 后端，这部分答不好会被判定"只会用框架"。',
    topics: [
      {
        id: 't5',
        title: '线程池核心参数与拒绝策略的真实取舍',
        level: '进阶',
        priority: 4,
        gap: false,
        reason: '订单中心重构涉及异步化，面试官会顺着问线程池配置。',
        interviewerFocus: '看你能不能说清队列长度和拒绝策略对业务的影响，而不是背七个参数。',
        followups: ['队列该不该有界？', '为什么不用 Executors 的默认工厂？'],
      },
      {
        id: 't6',
        title: 'MySQL 索引失效的 6 种场景与执行计划解读',
        level: '进阶',
        priority: 4,
        gap: false,
        reason: '简历写"单表 4 亿行迁移"，必然被问索引与慢查询治理。',
        interviewerFocus: '考察是否真排查过线上慢查询，能不能读懂 EXPLAIN 的 type 与 rows。',
        followups: ['为什么会回表？覆盖索引怎么设计？', '深分页怎么优化？'],
      },
      {
        id: 't7',
        title: '缓存与数据库一致性：延迟双删到底解决什么',
        level: '深度',
        priority: 4,
        gap: false,
        reason: '简历写"缓存命中率 96%"，会被追问一致性方案。',
        interviewerFocus: '看你知不知道各类方案的失效窗口，而不是背"先删缓存再更新库"。',
        followups: ['删除失败怎么办？', '为什么不用 binlog 订阅？'],
      },
    ],
  },
  {
    name: '简历深挖与岗位缺口',
    why: '你的经历里有三个高风险追问点，以及两个岗位需要但简历没写的能力。',
    topics: [
      {
        id: 't8',
        title: '项目深挖：79% 采纳率怎么归因到你的改动',
        level: '深度',
        priority: 5,
        gap: false,
        reason: '这是你简历里最强的数字，也是最容易被拆穿的数字。',
        interviewerFocus: '看你能不能讲出对照组、变量隔离和置信度，而不是讲故事。',
        followups: ['有没有做 A/B？', '样本量够吗？', '如果让你重做一次会怎么设计实验？'],
      },
      {
        id: 't9',
        title: '模型微调（SFT）的数据构造与适用边界',
        level: '基础',
        priority: 3,
        gap: true,
        reason: '目标岗位 JD 提到微调，简历完全没有体现，属于必修的岗位缺口。',
        interviewerFocus: '不要求你做过，但要能判断什么场景该微调、什么场景该做 RAG。',
        followups: ['什么情况下微调比 RAG 更合适？', '数据量不够怎么办？'],
      },
    ],
  },
];

const MATERIALS = {
  t1: {
    oneLine: '混合检索的本质是用稀疏与稠密两套召回互补覆盖不同 query 类型，重排再用更贵的模型做精排。',
    core: [
      'BM25 擅长精确词、型号、专有名词；向量检索擅长同义改写和语义泛化。两者失败场景几乎不重叠。',
      '混合检索的收益来自"召回并集"，代价是候选集变大、噪声变多，所以必须配重排。',
      '重排模型（cross-encoder）要同时看 query 和文档，精度高但无法预先建索引，只能对 Top-K 重排。',
      '重排的 K 不是越大越好：K 从 20 加到 100，延迟线性上升，精度通常在 30-50 就见顶。',
      '融合分数不能直接相加，RRF（倒数排名融合）比加权求和更稳，因为它不吃分数尺度。',
    ],
    principle:
      '检索的本质是「在候选空间里找相关文档」。BM25 把文档看成词袋，靠词频和逆文档频率打分，所以它对"iPhone 15 Pro 屏幕更换"这种**词面精确**的 query 极其可靠，但它对"手机屏碎了怎么修"这种换了说法的 query 几乎无能为力——因为字面不重合。\n\n向量检索把 query 和文档都映射到语义空间，用余弦相似度找近邻，解决了同义改写的问题。但它的短板同样明显：**对数字、型号、人名这类低频精确 token 不敏感**，embedding 会把"15 Pro"和"14 Pro"压得很近。\n\n所以工程上把两路召回的结果做并集，本质是**用两套互补的失败模式换更高的召回上限**。代价是候选集从 20 条变成 60 条，噪声变多，直接喂给大模型会导致"答非所问"和 token 浪费。\n\n重排就是为这个代价买单的环节：cross-encoder 把 query 和每篇文档拼在一起过一次模型，能捕捉细粒度交互，精度远高于双塔，但它**不能预计算**，只能对几十条候选做精排，这就是为什么它只能站在召回之后。',
    resumeHook:
      '简历里「引入混合检索与重排，答案采纳率从 61% 提升到 79%」这句话，面试官会立刻问："为什么加这两样就能提升 18 个点？"',
    answerFramework: [
      { step: '先给结论', say: '我们原来的纯向量检索在两个场景上稳定翻车：型号类精确查询和长尾专有名词，混合检索是为了补这两个洞。' },
      { step: '讲清为什么', say: 'BM25 管字面命中，向量管语义泛化，两路结果取并集，召回上限就上去了；但噪声也变多，所以加了 cross-encoder 做重排。' },
      { step: '给出关键参数', say: '召回各取 30 条，RRF 融合后取 40 条进重排，重排出 Top 8 给模型，延迟增加 180ms，在可接受范围。' },
      { step: '说清代价与取舍', say: '重排的 K 我们试过 60，延迟翻倍但准确率只涨 1.2 个点，最后定在 40。' },
    ],
    followups: [
      {
        q: '为什么向量检索会漏掉型号类的精确匹配？',
        a: '因为 embedding 是把整句压成一个稠密向量，数字和型号这种低频 token 的权重被平均掉了，"15 Pro"和"14 Pro"在语义空间里几乎重合，相似度差异很小，排序就乱了。',
        trap: '如果回答"因为向量维度不够"，说明没真正理解 embedding 的压缩特性。',
      },
      {
        q: '重排模型为什么不能直接替代召回？',
        a: 'cross-encoder 要对每个 query-文档对做一次前向，全库几百万文档根本算不过来；它只能在小候选集上做精排，所以必须依赖召回先筛一遍。',
        trap: '说"因为重排慢"不算答完，要讲清是 O(N) 次前向的复杂度问题。',
      },
      {
        q: '你怎么证明提升来自检索而不是换了模型？',
        a: '我们做了变量隔离：模型版本锁死，只切检索链路，用同一批 800 条评测集跑，采纳率从 61% 到 79%；中间单独上线重排只涨 6 个点，说明主要收益来自混合召回。',
        trap: '如果没做过对照，千万别硬编，改成"我们当时没有严格 A/B，这是这个项目最大的遗憾，重做会先固定评测集"。',
      },
    ],
    pitfalls: [
      '说"混合检索就是把 BM25 和向量的分数加起来"——分数尺度不同，直接相加会被某一路主导，正确做法是 RRF 或归一化后加权。',
      '把重排说成"再检索一次"——它是精排，不是召回。',
      '只讲技术不讲指标，面试官会认为你没参与决策。',
    ],
    bonus: [
      '主动提 RRF 的公式：score = Σ 1/(k + rank)，k 一般取 60，能体现你真的落过地。',
      '补充一个反例：在纯口语化提问上，混合检索只涨了 2 个点，说明收益是有场景边界的。',
    ],
    drill: {
      question: '如果线上发现"退款政策第 3 条"这类带编号的查询召回很差，你会先改哪一环？为什么？',
      hint: '想想编号在 BM25 分词后是否被保留，以及 embedding 对数字的处理。',
    },
    references: [{ title: '《Introduction to Information Retrieval》', note: '第 6 章 TF-IDF 与 BM25 打分' }],
  },
  t2: {
    oneLine: 'RAG 评估要拆成检索和生成两段：检索看召回率与 MRR，生成看忠实度与答案相关性。',
    core: [
      '检索侧必须有人工标注的 query-文档对，至少 200 条才能看出趋势。',
      '忠实度（faithfulness）衡量答案是否都能被召回文档支撑，是幻觉的代理指标。',
      '答案相关性看是否回答了问题，不等于忠实度：忠实但答非所问一样是 0 分。',
      '离线评估集要按 query 类型分层（精确查询/多跳/闲聊），否则平均值会掩盖短板。',
      '线上用采纳率、追问率、转人工率做代理指标，但要警惕幸存者偏差。',
    ],
    principle:
      'RAG 的错误可以发生在两个完全不同的位置：**没检索到** 和 **检索到了但没答对**。如果不拆开评估，你永远不知道该优化哪一段。\n\n检索侧的标准做法是构造 query-相关文档对，算 Recall@K 和 MRR。这里的关键是**评测集质量**：如果只挑容易的 query，Recall 会虚高到 95%，上线照样翻车。所以评测集必须从真实日志里采样，并覆盖精确查询、多跳推理、口语化提问三类。\n\n生成侧的核心指标是忠实度：把答案拆成若干断言，逐条检查是否能被上下文支持。这个指标能抓住"模型自己编"的问题。但忠实度高不代表好——如果模型把文档原封不动抄一遍，忠实度满分，用户依然不满意，所以还要看答案相关性。\n\n线上指标只能做代理：采纳率会被 UI 引导污染，追问率受用户耐心影响。**正确姿势是离线评测做主判断，线上指标做回归监控**。',
    resumeHook: '简历只写了「答案采纳率 79%」，没说评测集怎么来的、多少条、覆盖哪些类型，这是必被追问的缺口。',
    answerFramework: [
      { step: '先承认现状', say: '我们初期确实只看线上采纳率，这是不严谨的，后来补了离线评测集。' },
      { step: '讲清两段拆解', say: '检索看 Recall@10 和 MRR，生成看忠实度和答案相关性，两个都过线才算好。' },
      { step: '给出建设过程', say: '从三个月日志里分层抽样 600 条 query，人工标了相关文档，作为回归基线。' },
      { step: '讲监控机制', say: '每次改检索或 prompt 都跑一遍，掉 3 个点以上就回滚，线上采纳率只做辅助观察。' },
    ],
    followups: [
      { q: '你的评测集怎么来的？多少条？', a: '从真实日志分层抽样 600 条，精确查询、多跳、口语化各 200 条，人工标了相关文档和标准答案。', trap: '回答"让 GPT 生成的"会被质疑分布不真实。' },
      { q: '忠实度和召回率冲突怎么取舍？', a: '优先保召回上限，但用重排和阈值把噪声压住；宁可少答，不可乱答——答不出来用户会重问，答错了用户会信。', trap: '只说"都要"等于没回答。' },
    ],
    pitfalls: [
      '把采纳率当成准确率——用户点了"有用"可能只是答案看起来像。',
      '只做生成评估不做检索评估，导致优化方向全错。',
      '评测集只用 GPT 生成，分布和真实流量差很远。',
    ],
    bonus: [
      '提一句"我们给幻觉单独建了 badcase 库，每两周回归一次"，工程感立刻不一样。',
      '能说出 Recall@K 里 K 的选择依据（我们取 10，因为重排窗口是 40，召回 10 条覆盖 92% 的相关文档）。',
    ],
    drill: { question: '如果 Recall@10 是 95%，但用户仍说"答非所问"，问题可能出在哪三个地方？', hint: '分别想：重排、上下文拼装、生成指令。' },
    references: [{ title: 'RAGAS 论文与开源实现', note: 'faithfulness / answer relevancy 的定义与计算方式' }],
  },
  t3: {
    oneLine: 'Prompt 也是代码：要版本化、要回归测试、要有回滚，而不是在后台文本框里随手改。',
    core: [
      '每个 prompt 模板带版本号，和代码一起走 Git，不放在数据库里裸奔。',
      '改动必须跑固定评测集，指标包括格式合规率、答案忠实度、拒答正确率。',
      '结构化输出要用 schema 校验 + 修复重试，不要指望模型每次都给合法 JSON。',
      '模板数量超过 20 个就要做分层：通用系统提示 + 业务片段 + 输出约束。',
    ],
    principle:
      '把 prompt 当配置改，是团队里最常见的隐性债务。改一个词，可能让格式合规率从 99% 掉到 80%，而你没有任何手段发现。\n\n正确做法是把 prompt 当代码管：模板文件进仓库，带版本号和变更记录；每次改动触发固定评测集回归，指标不过线不允许合并。评测集不需要很大，200 条覆盖主要意图就够，关键是**稳定**。\n\n另一个工程细节是输出契约。所有需要结构化输出的场景，都要做 schema 校验，失败时先尝试自动修复（把错误信息回喂给模型），两次失败再降级到规则兜底。这套机制能把线上解析失败率压到千分之三以内。',
    resumeHook: '简历写「沉淀 40+ 提示词模板」，面试官会问：40 个模板怎么保证不互相污染、改动怎么验证。',
    answerFramework: [
      { step: '定位', say: '我们把 prompt 当代码管，模板进 Git，带版本号。' },
      { step: '机制', say: '改模板必须跑回归集，200 条固定 case，看格式合规率和忠实度，掉点就拦。' },
      { step: '兜底', say: '结构化输出做 schema 校验，失败回喂错误重试一次，再失败走规则兜底。' },
      { step: '效果', say: '上线后解析失败率从 4% 降到 0.3%，没人再敢在后台直接改 prompt。' },
    ],
    followups: [
      { q: '改一版 prompt 怎么验证没退化？', a: '跑固定 200 条回归集，比格式合规率、忠实度、拒答率三个指标，任何一项掉 2 个点就打回。', trap: '答"看几个 case 觉得还行"会被认为没有工程习惯。' },
      { q: '模板多了怎么治理？', a: '拆成通用系统提示 + 业务片段 + 输出约束三层，业务方只改中间那层，通用约束统一维护。', trap: '说"文档写清楚"不够，要讲结构。' },
    ],
    pitfalls: ['把 prompt 存在数据库里直接改，没有版本记录。', '只测正常 case，不测拒答和越权提问。'],
    bonus: ['补一句"我们给每次 prompt 变更记了 diff 和指标对比表"，可信度直接拉满。'],
    drill: { question: '业务方要求今晚就改一句 prompt 上线，你怎么在不阻塞的前提下控制风险？', hint: '想想灰度、监控、回滚三件事。' },
    references: [{ title: 'OpenAI Prompt Engineering Guide', note: '输出格式约束与 few-shot 部分' }],
  },
  t4: {
    oneLine: '成本优化的核心不是换便宜模型，而是按请求难度路由，并给路由错误准备兜底。',
    core: [
      '先做请求分层：简单问答、多跳推理、长文档总结，三类的 token 成本差 5-10 倍。',
      '路由信号用可解释特征：query 长度、是否含多实体、是否需要检索、历史轮次。',
      '小模型答不好要有兜底：置信度低或格式失败时升级到大模型，重试成本远低于答错成本。',
      '缓存要分层：精确缓存命中率低，语义缓存要设相似度阈值，否则会答错问题。',
      '降本必须同时看体验指标，否则省下的钱会从客诉里还回去。',
    ],
    principle:
      '很多团队的成本优化停留在"换个更便宜的模型"，这会直接把体验打穿。真正有效的做法是**让简单的请求走便宜路径，复杂的请求走贵路径**。\n\n路由的关键是找到可解释、可监控的信号。query 长度、实体数量、是否需要多跳、是否命中 FAQ，这些特征既便宜又稳定。用一个小分类器或规则树就能做到 80% 的准确率。\n\n但路由一定会错。所以必须有兜底：小模型输出格式不合规、或自评置信度低、或用户点了"没解决"，就自动升级到大模型重答。**重试的成本远低于答错的成本**。\n\n缓存是另一个大头，但要小心语义缓存的陷阱：相似度阈值设低了，会把"退款多久到账"和"退款怎么申请"判成同一个问题，直接答错。我们的做法是精确缓存 + 高阈值语义缓存（0.95 以上）双层。',
    resumeHook: '「单次问答成本从 0.08 降到 0.03 元，年省 42 万」这个数字很亮，面试官一定会让你拆开算。',
    answerFramework: [
      { step: '给结论', say: '降本 62%，主要来自三块：请求分层路由、缓存、上下文裁剪。' },
      { step: '拆占比', say: '路由贡献约 45%，缓存 30%，上下文裁剪 25%。' },
      { step: '讲机制', say: '用规则 + 小分类器判断难度，简单请求走小模型，格式失败或置信度低自动升级。' },
      { step: '讲风险控制', say: '我们盯了采纳率和转人工率，降本期间这两个指标没掉，才算成功。' },
    ],
    followups: [
      { q: '分流错了怎么办？', a: '两层兜底：格式校验失败直接升级；用户反馈"没解决"也升级。升级率 12%，这部分成本可控。', trap: '说"我们的分类器很准"会被追问准确率，答不上来就崩。' },
      { q: '怎么衡量降本对体验的损伤？', a: '看采纳率、追问率、转人工率三个指标，我们降本后采纳率掉了 1.8 个点，在阈值内。', trap: '只说成本不说体验，会被认为不懂业务。' },
    ],
    pitfalls: ['把所有请求都切到小模型，短期省钱了，三个月后客诉爆炸。', '语义缓存阈值拍脑袋定 0.8，导致串答案。'],
    bonus: ['主动说"我们把路由决策打了日志，每周抽样 100 条人工看误判"，体现闭环。'],
    drill: { question: '如果老板要求再降 30% 成本但体验不能掉，你的下一步在哪？', hint: '想想上下文长度、重复检索、模型输出长度。' },
    references: [{ title: '《Designing Machine Learning Systems》', note: '第 8 章 推理成本与延迟优化' }],
  },
  t5: {
    oneLine: '线程池的参数不是调出来的，是被业务的有界性和失败策略推出来的。',
    core: [
      '核心线程数按 CPU 密集 N+1、IO 密集 2N 起步，但真正定值要看下游超时和 QPS。',
      '队列必须有界。无界队列会把压力变成内存溢出，比拒绝更危险。',
      '拒绝策略要按业务选：核心链路用 CallerRuns 做反压，非核心用丢弃 + 埋点。',
      '线程池隔离：不同下游用不同池，避免一个慢接口拖垮全局。',
      '监控必须有：活跃线程数、队列长度、拒绝次数，缺一不可。',
    ],
    principle:
      '线程池的七个参数里，真正决定行为的是三个：核心线程数、队列容量、拒绝策略。它们共同定义了系统在过载时的**退化方式**。\n\n先看队列。很多人用 `new LinkedBlockingQueue<>()` 不传容量，默认是 Integer.MAX_VALUE，等于把所有排队请求塞进内存。表面上看"没有拒绝"，实际上是**把拒绝推迟成了 OOM**，而且延迟会无限增长，用户等到超时也没结果。\n\n有界队列 + 合理的拒绝策略才是可控的。核心交易链路适合 CallerRunsPolicy，让提交任务的线程自己执行，天然形成反压，上游会被拖慢从而降低提交速率。非核心链路（日志、埋点）适合 DiscardPolicy + 计数埋点，丢了要知道丢了多少。\n\n最后是隔离。一个线程池服务多个下游，只要有一个下游变慢，队列就会被它的任务占满，其他下游全部饿死。所以按下游拆池，是微服务里最基本的容错手段。',
    resumeHook: '订单中心重构里做过异步化，面试官会问：异步用的哪个池、队列多长、打满了怎么办。',
    answerFramework: [
      { step: '先说结论', say: '我们用有界队列 + CallerRuns，核心思想是让过载变成可控的慢，而不是不可控的挂。' },
      { step: '给参数', say: '核心 32、最大 64、队列 2000，按下游 P99 300ms 和峰值 QPS 反推的。' },
      { step: '讲失败策略', say: '打满后 CallerRuns 反压到 Tomcat 线程，上游超时快速失败，不会堆积。' },
      { step: '讲隔离', say: '订单写入和通知拆了两个池，通知变慢不影响下单。' },
    ],
    followups: [
      { q: '队列该不该有界？', a: '必须有界。无界队列会把过载转成 OOM 和无限延迟，有界队列才能让系统在压力下优雅退化。', trap: '答"看情况"而不给判断标准，会被认为没想清楚。' },
      { q: '为什么不用 Executors 的默认工厂？', a: '它的队列是无界的，且最大线程数无效，等于隐藏了过载风险；阿里规约也明确禁止。', trap: '只知道"规约禁止"但说不出原因，深度不够。' },
    ],
    pitfalls: ['最大线程数设了但队列无界，导致最大线程数永远不生效。', '拒绝策略用 AbortPolicy 却没捕获异常，任务静默丢失。'],
    bonus: ['补充"我们给拒绝次数配了告警，超过阈值自动扩容"，体现运维闭环。'],
    drill: { question: '下游 P99 从 300ms 恶化到 3s，你的线程池会发生什么？怎么提前发现？', hint: '算一下队列积压速度和活跃线程数变化。' },
    references: [{ title: '《Java 并发编程实战》', note: '第 8 章 线程池的使用与饱和策略' }],
  },
  t6: {
    oneLine: '索引失效不是背六条规则，而是判断优化器为什么算出来全表扫更便宜。',
    core: [
      '最左前缀：联合索引 (a,b,c) 能用于 a、a+b、a+b+c，跳不过 a 直接用 b。',
      '对索引列做函数/运算/隐式转换会让索引不可用，例如 where date(created_at)=... 。',
      '范围查询之后的列无法再用于过滤，只能回表过滤。',
      'EXPLAIN 重点看 type（ref/range/index/ALL）、rows、filtered、Extra 里的 Using filesort。',
      '深分页用延迟关联或游标，limit 100000,20 会扫 100020 行。',
    ],
    principle:
      'InnoDB 的索引是 B+ 树，叶子节点存主键（二级索引）或整行（聚簇索引）。优化器决定走不走索引，本质是在比较**走索引回表的随机 IO 成本**和**全表扫描的顺序 IO 成本**。\n\n所以"索引失效"更准确的说法是"优化器认为不划算"。当过滤条件区分度很低（比如性别），走索引要回表几百万次，还不如全表扫，这时候优化器主动放弃索引，你加 force index 反而更慢。\n\n最左前缀的根因是联合索引按 (a,b,c) 排序，只有当 a 确定时 b 才有序，a 不定 b 就是乱序，无法二分。范围查询之后同理：`a>1 and b=2`，a 是范围，b 在范围内无序，只能回表逐行过滤。\n\nEXPLAIN 里最有信息量的是 rows × filtered，它告诉你优化器估算要扫多少行、过滤后剩多少。type=ALL 且 rows 很大时就该警惕；Using filesort 说明排序没走索引，数据量大时会用磁盘临时文件。',
    resumeHook: '简历「单表 4 亿行数据迁移，零故障切换」——4 亿行表的索引设计和慢查询治理是必然追问。',
    answerFramework: [
      { step: '先给判断', say: '我会先看 EXPLAIN 的 type 和 rows，判断是没走索引，还是走了但回表太多。' },
      { step: '分类归因', say: '常见三类：违反最左前缀、索引列上做运算、区分度太低优化器主动放弃。' },
      { step: '给方案', say: '前两类改 SQL 或补索引；第三类要么做覆盖索引避免回表，要么接受全表扫但控制频率。' },
      { step: '讲验证', say: '改完对比 rows 和实际执行时间，线上再观察慢查询日志的 p99。' },
    ],
    followups: [
      { q: '为什么会回表？覆盖索引怎么设计？', a: '二级索引叶子只存主键，要拿其他列就得按主键再查一次聚簇索引，这就是回表。把查询需要的列都放进索引，就能 Using index 直接返回。', trap: '把覆盖索引说成"加索引"，没讲清列的顺序和数量限制。' },
      { q: '深分页怎么优化？', a: '延迟关联：先用覆盖索引查出主键再 join 回表；或者用游标 where id > last_id 代替 offset。', trap: '只说"加 limit"没有意义。' },
    ],
    pitfalls: ['说"加了索引就一定走索引"。', '忽略隐式转换：字符串列传数字，索引直接失效。'],
    bonus: ['提"我们用 pt-query-digest 每周出慢查询 Top 20，按扫描行数排序"，比说"看慢日志"具体得多。'],
    drill: { question: 'where a=1 and b>2 and c=3，联合索引 (a,b,c) 能用到几列？为什么？', hint: '想想范围列之后的列在索引里是否还有序。' },
    references: [{ title: 'MySQL 官方文档 · Optimization / EXPLAIN Output Format', note: 'type 与 Extra 字段含义' }],
  },
  t7: {
    oneLine: '缓存一致性没有完美解，只有"能接受多长不一致窗口"的工程取舍。',
    core: [
      '先更新库再删缓存（Cache Aside）是主流，删除失败要有重试或 binlog 补偿。',
      '延迟双删解决的是"并发读写导致旧值回填"，不是所有不一致。',
      '不一致窗口 ≈ 主从延迟 + 缓存重建时间，能接受就别上复杂方案。',
      '强一致场景不要用缓存，或者用读写都加锁的短 TTL 方案。',
      '缓存击穿用互斥重建，穿透用空值缓存 + 布隆过滤器，雪崩用随机 TTL。',
    ],
    principle:
      '缓存和数据库是两个系统，没有分布式事务就不可能有强一致。所有方案本质都在**缩短不一致窗口**。\n\nCache Aside 的顺序很关键：为什么是删缓存而不是更新缓存？因为更新缓存在并发下会产生旧值覆盖新值——A 更新库为 2，B 更新库为 3，B 先更新缓存为 3，A 后更新缓存为 2，缓存就脏了。删除则不会，删是幂等的。\n\n但删除也会失败。删缓存失败后，旧值会一直留在缓存里直到过期。所以工程上要么加重试（MQ 补偿），要么订阅 binlog 异步删，后者最可靠。\n\n延迟双删针对的是另一个场景：读请求在"库已更新、缓存已删"的窗口里读到了旧值，然后又把这个旧值写回缓存。做法是更新后延迟几百毫秒再删一次，把回填的脏值清掉。延迟时间要大于一次读请求的耗时。\n\n如果业务能接受秒级不一致，其实什么都不用做，设个短 TTL 就够了。**过度设计是这里最常见的错误。**',
    resumeHook: '「缓存命中率 96%」这个数字背后，面试官想知道你怎么处理更新和失效。',
    answerFramework: [
      { step: '先定标准', say: '先问业务能接受多长的不一致窗口，这决定了方案复杂度。' },
      { step: '给主方案', say: 'Cache Aside，先更库再删缓存，删失败进 MQ 重试，保证最终删掉。' },
      { step: '讲并发兜底', say: '极端并发下加延迟双删，延迟 500ms，覆盖一次读请求的回填窗口。' },
      { step: '讲边界', say: '强一致的场景我们直接不走缓存，避免用复杂度换幻觉。' },
    ],
    followups: [
      { q: '删除失败怎么办？', a: '进 MQ 重试，三次失败告警人工介入；更彻底的是订阅 binlog 异步删，业务代码不用管。', trap: '答"重试三次"就完了，没考虑重试也失败的情况。' },
      { q: '为什么不用 binlog 订阅？', a: 'binlog 方案最可靠但引入 Canal 等组件，运维成本高；数据量大、并发高的核心表值得上，小表用重试就够。', trap: '一味说 binlog 最好，不评估成本。' },
    ],
    pitfalls: ['先删缓存再更新库，并发下必然脏。', '把延迟双删当成万能药，延迟时间拍脑袋写 100ms。'],
    bonus: ['主动说"我们统计过不一致的持续时间，p99 是 480ms"，数据感很强。'],
    drill: { question: '秒杀场景下，缓存和库存怎么配合才不会超卖？', hint: '想想扣减应该发生在哪一层。' },
    references: [{ title: 'Redis 官方文档 · Client-side caching', note: '了解失效通知机制' }],
  },
  t8: {
    oneLine: '把结果数字拆成「变量—对照—样本」三层，才叫归因；讲不出对照，就承认是估算。',
    core: [
      '先说清楚改动前后的对照条件：模型版本、流量、用户群是否一致。',
      '采纳率提升 18 个点，要能拆到每个改动的贡献（混合召回、重排、prompt）。',
      '样本量：日活 1.2 万次调用，两周样本足够看趋势，但要注意 query 分布漂移。',
      '没做严格 A/B 就诚实说，并给出如果重做会怎么设计。',
      '归因的边界要主动划：哪些提升来自产品引导，哪些来自检索。',
    ],
    principle:
      '面试官问归因，不是要抓你造假，而是看你有没有**实验思维**。大部分业务改动都没法做完美 A/B，能讲清"我知道哪里有偏差、我怎么缩小它"就已经赢了一半。\n\n归因的三层：变量层（改了哪几个东西）、对照层（和什么比）、样本层（样本量够不够、分布有没有变）。三层讲全，数字才站得住。\n\n如果确实没做对照，正确的答法是先承认，再补一个"事后近似"：比如按时间切分看趋势拐点、按业务线拆分看是否同步提升、看没接入的对照组业务线。这些方法不完美，但体现你认真想过。\n\n最忌讳的是把功劳全揽在自己身上。面试官听到"这 35% 都是我带来的"，第一反应是这人不懂业务复杂度。',
    resumeHook: '「答案采纳率 61%→79%」「工单下降 35%」两个数字都是高风险高回报，讲好了是加分项，讲崩了直接出局。',
    answerFramework: [
      { step: '先划边界', say: '这两个数字我只对采纳率负责，工单下降是多个团队一起的结果。' },
      { step: '给对照', say: '模型版本锁死，只切检索链路，同一批 800 条评测集，这是最干净的一次对照。' },
      { step: '拆贡献', say: '混合召回 +12 个点，重排 +4，prompt 调整 +2，加起来 18。' },
      { step: '主动认缺陷', say: '没做线上 A/B，样本也有分布漂移，重做会按业务线分流做同期对照。' },
    ],
    followups: [
      { q: '有没有做 A/B？', a: '线上没做严格 A/B，因为当时全量灰度；我们用的是离线评测集 + 业务线拆分做近似对照。', trap: '硬说做了 A/B，追问分流比例和显著性就露馅。' },
      { q: '样本量够吗？', a: '800 条评测集，日调用 1.2 万，两周累计 16 万次，看 5 个点以上的差异是够的，2 个点以内不敢下结论。', trap: '对显著性毫无概念，说明没做过数据判断。' },
    ],
    pitfalls: ['把团队成果说成个人成果。', '只有结果数字，没有任何过程指标。'],
    bonus: ['补一句"我们还看了没接入的业务线，工单没降，交叉验证了一下"，说服力翻倍。'],
    drill: { question: '如果老板说"这个提升我不信"，你会拿哪三份材料说服他？', hint: '评测集报告、分流日志、业务线对比。' },
    references: [{ title: '《Trustworthy Online Controlled Experiments》', note: '第 2-3 章 指标与对照设计' }],
  },
  t9: {
    oneLine: 'RAG 解决"知识在外面"，微调解决"行为要固定"；能用 RAG 解决的就别微调。',
    core: [
      '知识频繁更新 → RAG；输出风格/格式/领域语气要求高 → 微调。',
      'SFT 数据量不是越多越好，500-2000 条高质量样本通常就能见效。',
      '数据构造要有难度分层：简单、边界、拒答三类都要有。',
      '微调不擅长注入新知识，硬灌事实容易导致幻觉加重。',
      '评估必须和微调前同口径，否则无法判断是真提升还是过拟合。',
    ],
    principle:
      '这是目标岗位的缺口题，面试官不指望你训过大模型，但要看你能不能做技术选型判断。\n\n核心区分：**参数里装的是能力和风格，上下文里装的是事实**。知识库天天变，塞进参数里既贵又过期，所以用 RAG；而"用我们公司的语气回答""必须输出固定 JSON 结构""遇到越权问题一律拒答"这类行为要求，靠 prompt 约束不稳定，微调更合适。\n\nSFT 的数据构造比数量重要。500 条覆盖真实意图分布的高质量样本，效果往往好过 5 万条自动生成的垃圾。样本要分层：70% 常规、20% 边界情况、10% 应该拒答的。缺了拒答样本，模型会变得什么都不敢答或者什么都敢答。\n\n最后是评估。微调最容易骗自己的地方是：训练集和评测集同分布，指标很好看，上线一片骂声。所以评测集必须独立、且和 RAG 版本用同一套口径。',
    resumeHook: '目标 JD 提到"参与模型微调与评测"，你简历完全没有，必须主动准备一套判断逻辑。',
    answerFramework: [
      { step: '给判断框架', say: '看要解决的是知识问题还是行为问题：知识用 RAG，行为用微调。' },
      { step: '举例', say: '我们知识库天天更新，只能 RAG；但客服话术的一致性一直不稳，这个适合 SFT。' },
      { step: '讲数据', say: '我会先抽 500 条真实对话，按 7:2:1 分层，边界和拒答样本必须有。' },
      { step: '讲评估', say: '用同一套离线评测集对比微调前后，重点看忠实度和拒答正确率有没有掉。' },
    ],
    followups: [
      { q: '什么情况下微调比 RAG 更合适？', a: '固定输出格式、领域语气、需要稳定拒答边界的时候；知识型问题微调性价比很低。', trap: '说"微调效果更好"，说明没理解两者定位。' },
      { q: '数据量不够怎么办？', a: '先用 prompt + few-shot 顶住，同时积累真实 badcase；500 条高质量样本就能起步，不要用合成数据硬凑。', trap: '说"用 GPT 生成十万条"，会被追问数据质量。' },
    ],
    pitfalls: ['把微调当知识注入手段。', '只谈训练不谈评估。'],
    bonus: ['提一句"我们会留 10% 拒答样本，防止模型在越权问题上乱答"，安全意识到位。'],
    drill: { question: '如果业务要求"回答必须带上公司政策条款编号"，你会选 RAG、微调还是 prompt？为什么？', hint: '这是格式约束 + 事实引用的混合需求。' },
    references: [{ title: 'Hugging Face PEFT 文档', note: 'LoRA 原理与参数配置' }],
  },
};

const MATERIAL_TEMPLATE = (title) => ({
  oneLine: `先把「${title}」讲成一条因果链，再准备三个能被追问的细节。`,
  core: ['先给结论，再给原因，最后给边界条件。', '准备一个真实项目里的数字。', '准备一个你踩过的坑。'],
  principle: `关于「${title}」，面试官真正想确认的是你有没有在一线做过判断。回答时先讲你遇到的场景，再讲方案取舍，最后给结果。`,
  resumeHook: `简历中与「${title}」相关的表述会引出这个问题。`,
  answerFramework: [
    { step: '给结论', say: '先用一句话回答核心判断。' },
    { step: '讲原因', say: '说明为什么这样选，另外的方案差在哪。' },
    { step: '给证据', say: '用项目里的数字或现象支撑。' },
  ],
  followups: [{ q: '如果条件反过来，你会怎么改？', a: '说明边界变化后方案如何调整。', trap: '只背结论、不讲条件。' }],
  pitfalls: ['只讲概念不讲取舍。'],
  bonus: ['带上真实数据。'],
  drill: { question: `用一个你自己的项目例子说明「${title}」。`, hint: '场景 → 取舍 → 结果。' },
  references: [],
});

const QUIZ = {
  title: 'AI 应用开发 · 第一轮能力测验',
  questions: [
    {
      id: 'q1',
      topicId: 't1',
      topicTitle: 'RAG 检索质量：混合检索与重排为什么有效',
      type: 'choice',
      difficulty: '进阶',
      question: '下列哪种 query 最能体现纯向量检索的短板？',
      options: [
        '手机屏幕碎了怎么修',
        'iPhone 15 Pro 的电池更换价格',
        '我想退货需要什么流程',
        '你们的售后电话是多少',
      ],
      answerIndex: 1,
      reference: '型号类精确 token 在 embedding 中被平均，向量检索难以区分 15 Pro 与 14 Pro，需 BM25 补足字面匹配。',
      rubric: ['指出型号/数字属于低频精确 token', '说明 embedding 压缩导致区分度低'],
      points: 10,
    },
    {
      id: 'q2',
      topicId: 't4',
      topicTitle: '模型分流与成本优化：什么请求该走小模型',
      type: 'choice',
      difficulty: '进阶',
      question: '关于模型分流的兜底设计，哪种做法最合理？',
      options: [
        '小模型输出格式不合规时，直接把错误返回给用户',
        '小模型输出格式不合规或置信度低时，自动升级到大模型重答',
        '所有请求都先走小模型，靠人工抽查发现问题',
        '按用户等级分流，VIP 走大模型',
      ],
      answerIndex: 1,
      reference: '路由必然有误判，重试成本远低于答错成本，格式失败与低置信度是最可靠的两个升级信号。',
      rubric: ['识别路由会误判', '给出自动升级机制'],
      points: 10,
    },
    {
      id: 'q3',
      topicId: 't6',
      topicTitle: 'MySQL 索引失效的 6 种场景与执行计划解读',
      type: 'choice',
      difficulty: '进阶',
      question: '联合索引 (a, b, c)，执行 where a = 1 and b > 2 and c = 3，索引最多能用到几列做过滤？',
      options: ['三列都用于索引过滤', '只有 a 和 b，c 需回表过滤', '只有 a', '优化器一定会全表扫描'],
      answerIndex: 1,
      reference: 'a 等值可用，b 范围可用，但范围之后 b 在索引内不再有序，c 无法继续二分，只能回表过滤。',
      rubric: ['说明范围列之后失去有序性'],
      points: 10,
    },
    {
      id: 'q4',
      topicId: 't5',
      topicTitle: '线程池核心参数与拒绝策略的真实取舍',
      type: 'choice',
      difficulty: '基础',
      question: '线程池使用无界队列（LinkedBlockingQueue 不传容量）会导致什么后果？',
      options: [
        'maximumPoolSize 永远不生效，过载转为内存堆积和无限延迟',
        '线程频繁创建销毁，性能下降',
        '任务会被立即拒绝，保护系统',
        '没有影响，JVM 会自动扩容',
      ],
      answerIndex: 0,
      reference: '无界队列导致队列永不满，maximumPoolSize 无法触发，压力转为内存占用与延迟增长，最终 OOM。',
      rubric: ['指出最大线程数失效', '指出 OOM/延迟风险'],
      points: 10,
    },
    {
      id: 'q5',
      topicId: 't2',
      topicTitle: 'RAG 评估体系：召回率、忠实度与幻觉率怎么量',
      type: 'short',
      difficulty: '深度',
      question: '请说明 RAG 的评估为什么要拆成检索侧和生成侧，各自的核心指标是什么，只看线上采纳率有什么问题。',
      options: [],
      answerIndex: -1,
      reference: '检索侧看 Recall@K / MRR，需要有标注的 query-文档对；生成侧看忠实度与答案相关性。只看采纳率会被 UI 引导污染、无法定位错误发生在召回还是生成，也无法做回归。',
      rubric: [
        '指出错误可能发生在检索或生成两处',
        '说出 Recall@K / MRR 等检索指标',
        '说出忠实度 / 答案相关性等生成指标',
        '指出采纳率是代理指标、存在偏差',
        '提到评测集与回归机制',
      ],
      points: 20,
    },
    {
      id: 'q6',
      topicId: 't1',
      topicTitle: 'RAG 检索质量：混合检索与重排为什么有效',
      type: 'short',
      difficulty: '深度',
      question: '重排模型精度更高，为什么不能直接替代召回？请从复杂度角度解释。',
      options: [],
      answerIndex: -1,
      reference: 'cross-encoder 需要对每个 query-文档对做一次前向，复杂度 O(N)，全库百万级文档无法承受；它不能预计算文档表示，因此只能在小候选集上精排，必须依赖召回先缩小范围。',
      rubric: ['指出 cross-encoder 需逐对计算', '指出复杂度与延迟不可接受', '指出可预计算性差异（双塔可离线）'],
      points: 20,
    },
    {
      id: 'q7',
      topicId: 't3',
      topicTitle: 'Prompt 工程的版本管理与回归测试',
      type: 'short',
      difficulty: '进阶',
      question: '团队有 40 多个 prompt 模板，业务方经常直接改。你会怎么治理，保证改动不引入退化？',
      options: [],
      answerIndex: -1,
      reference: '模板进 Git 带版本；改动跑固定回归集（200 条），指标包括格式合规率、忠实度、拒答正确率；分层管理通用约束与业务片段；结构化输出做 schema 校验与重试。',
      rubric: ['版本化管理', '固定回归集与指标', '分层/结构治理', '输出契约与兜底'],
      points: 20,
    },
    {
      id: 'q8',
      topicId: 't8',
      topicTitle: '项目深挖：79% 采纳率怎么归因到你的改动',
      type: 'design',
      difficulty: '深度',
      question: '假设面试官质疑："采纳率从 61% 到 79%，怎么可能是一个检索改动带来的？"请写出你的完整回应思路（含对照设计与可能的偏差）。',
      options: [],
      answerIndex: -1,
      reference: '先划清个人贡献与团队成果；说明变量隔离方式（锁模型版本、只切检索、固定评测集）；拆解各改动贡献；主动承认缺少线上 A/B、存在 query 分布漂移；给出重做时的实验设计（分流、样本量、显著性）。',
      rubric: ['划清贡献边界', '说明对照与变量隔离', '拆解贡献占比', '主动指出偏差', '给出更严谨的实验设计'],
      points: 20,
    },
  ],
};

/* ---------------- 内部工具 ---------------- */

function pickUser(messages) {
  return messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
}

/** 从 marker 之后抠出第一个完整的 JSON 数组/对象（按括号配对） */
function parseJSONAfter(text, marker) {
  const idx = marker ? text.indexOf(marker) : 0;
  const slice = text.slice(idx >= 0 ? idx : 0);
  const startObj = slice.indexOf('{');
  const startArr = slice.indexOf('[');
  const candidates = [startObj, startArr].filter((i) => i >= 0);
  if (!candidates.length) return null;
  const start = Math.min(...candidates);
  const open = slice[start];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inStr = false;
  let escaped = false;

  for (let i = start; i < slice.length; i += 1) {
    const ch = slice[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(slice.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function gradeMock(payload) {
  const items = [];
  for (const q of payload) {
    const raw = String(q.userAnswer ?? '');
    let score = 0;
    let verdict = '';
    const missed = [];

    if (q.type === 'choice') {
      const correct = Number(raw) === q.answerIndex;
      score = correct ? q.points : 0;
      verdict = correct ? '选对了，概念清晰。' : '选错了，说明这个点还停留在印象层面。';
      if (!correct) missed.push(q.rubric?.[0] || '正确选项对应的判断依据');
    } else {
      const len = raw.trim().length;
      if (!len) {
        score = 0;
        verdict = '没有作答。这题是必考方向，空白等于放弃。';
        missed.push(...(q.rubric || []).slice(0, 3));
      } else if (len < 25) {
        score = Math.round(q.points * 0.25);
        verdict = '只给了方向，没有展开因果，面试官会继续追问。';
        missed.push(...(q.rubric || []).slice(1, 3));
      } else if (len < 80) {
        score = Math.round(q.points * 0.55);
        verdict = '要点覆盖了一部分，但缺少边界条件和具体证据。';
        missed.push(...(q.rubric || []).slice(2, 4));
      } else {
        score = Math.round(q.points * 0.82);
        verdict = '结构完整，能看出有实操经验；再补一个量化结果会更稳。';
        missed.push((q.rubric || [])[q.rubric.length - 1] || '可以再补一个反例');
      }
    }

    items.push({
      id: q.id,
      score,
      max: q.points,
      verdict,
      missed: missed.filter(Boolean).slice(0, 3),
      better: q.reference,
      knowledgeGap: score / q.points < 0.5 ? `「${q.topicTitle}」还没形成可复述的结构` : '',
    });
  }

  const sum = items.reduce((s, i) => s + i.score, 0);
  const max = items.reduce((s, i) => s + i.max, 0) || 1;
  const total = Math.round((sum / max) * 100);
  const byTopic = new Map();
  for (const it of items) {
    const q = payload.find((p) => p.id === it.id);
    const key = q?.topicId || '';
    const cur = byTopic.get(key) || { title: q?.topicTitle || '', got: 0, max: 0 };
    cur.got += it.score;
    cur.max += it.max;
    byTopic.set(key, cur);
  }
  const weakTopics = [...byTopic.entries()]
    .filter(([, v]) => v.max && v.got / v.max < 0.65)
    .map(([topicId, v]) => ({
      topicId,
      topicTitle: v.title,
      reason: `本题组得分 ${v.got}/${v.max}，属于明显短板`,
      severity: v.got / v.max < 0.4 ? 5 : 4,
    }));

  const scoreOf = (k) => Math.max(0, Math.min(100, total + k));
  return {
    total,
    level: total >= 90 ? '优秀' : total >= 78 ? '良好' : total >= 60 ? '基本合格' : total >= 40 ? '待加强' : '不及格',
    dimensions: {
      concept: { score: scoreOf(4), comment: '概念层面基本能对上，个别点混淆了因果。' },
      depth: { score: scoreOf(-9), comment: '一追问复杂度和边界就明显变薄，缺少量化。' },
      expression: { score: scoreOf(1), comment: '有结构，但习惯先讲过程再给结论。' },
    },
    items,
    summary:
      total >= 70
        ? '整体达到了能进面试的水平，项目经历讲得比原理好。最大问题是深度题：能说出方案，说不清为什么不是另一种方案。建议把 RAG 评估与重排这两块补成可以脱稿讲 3 分钟的程度。'
        : '基础概念有印象，但还没形成可复述的结构。当前最该做的不是刷更多题，而是把 3 个核心知识点讲到能给别人讲明白。',
    weakTopics: weakTopics.length ? weakTopics : [{ topicId: 't2', topicTitle: 'RAG 评估体系', reason: '演示数据默认短板', severity: 4 }],
    nextActions: [
      '把 RAG 评估的五个指标写成一张卡片，明天脱稿讲一遍并录音',
      '用一个自己项目的数字，重写「采纳率提升」的归因话术',
      '找一道系统设计题，限时 15 分钟写完再对照标准答案',
    ],
  };
}

/* ---------------- 对外入口 ---------------- */

export function mockChat(messages) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const user = pickUser(messages);

  const reply = (obj) => JSON.stringify(obj);

  if (system.includes('读懂一份简历')) return reply(PROFILE);

  if (system.includes('必须复习的知识点')) {
    return reply({ groups: TOPICS });
  }

  if (system.includes('一份可以直接拿去面试的复习资料')) {
    const title = (user.match(/【要写的知识点】(.+)/) || [])[1]?.trim() || '这个知识点';
    const hit = Object.entries(MATERIALS).find(([, m]) => m.oneLine && TOPICS.flatMap((g) => g.topics).some((t) => t.title === title));
    if (hit) return reply(MATERIALS[hit[0]]);
    return reply(MATERIAL_TEMPLATE(title));
  }

  if (system.includes('出一套测验题')) return reply(QUIZ);

  if (system.includes('批改候选人')) {
    const payload = parseJSONAfter(user, '【测验与作答】') || [];
    return reply(gradeMock(Array.isArray(payload) ? payload : []));
  }

  if (system.includes('知识点拓展')) {
    const parentTitle = (user.match(/【要拓展的知识点】(.+?)（/) || [])[1]?.trim() || '该知识点';
    return reply({
      topics: [
        {
          title: `${parentTitle}的 4 个常见错误认知与纠正`,
          level: '进阶',
          priority: 4,
          gap: false,
          reason: `聊到「${parentTitle}」时，面试官常用"你是不是以为…"式的反例来探深度，这类纠错题几乎是标配。`,
          interviewerFocus: '看你是背了结论，还是知道结论的适用边界在哪里。',
          followups: ['这几种错误认知你在项目里踩过哪个？', '怎么跟团队讲清这个误区？'],
          relation: '同族变体',
        },
        {
          title: `用「${parentTitle}」拆一道系统设计题`,
          level: '深度',
          priority: 5,
          gap: false,
          reason: `一轮面试的固定套路：把「${parentTitle}」放进一个开放场景让你从头设计，考的是综合运用。`,
          interviewerFocus: '不看名词堆砌，看你会不会先问约束条件再动手。',
          followups: ['你会先问哪三个问题？', '并发涨 10 倍哪里先崩？'],
          relation: '组合考察',
        },
        {
          title: `「${parentTitle}」在生产事故里的定位与止损`,
          level: '深度',
          priority: 4,
          gap: false,
          reason: `高级岗位几乎必问：当「${parentTitle}」相关的系统出问题时，你怎么排障、怎么止损、怎么复盘。`,
          interviewerFocus: '有没有真的处理过线上问题，以及处理时是否有章法。',
          followups: ['你的排查路径是什么？', '止损和根因分析怎么排序？'],
          relation: '组合考察',
        },
        {
          title: `「${parentTitle}」的上下游：它建立在什么之上，又支撑着什么`,
          level: '进阶',
          priority: 3,
          gap: false,
          reason: `把「${parentTitle}」放进技术栈全景里讲，才能体现理解深度，也最容易和下一层追问衔接。`,
          interviewerFocus: '能否画出它所处的分层位置，并说清每层的取舍。',
          followups: ['如果去掉它所在层，系统会怎样？', '有什么替代方案？'],
          relation: '上下游',
        },
      ],
    });
  }

  if (system.includes('面试冲刺计划')) {
    const grade = parseJSONAfter(user, '【测验复盘】') || {};
    const weak = (grade.weakTopics || []).slice(0, 3);
    const fallbackFocus = [
      { topicId: 't2', topicTitle: 'RAG 评估体系', reason: '面试出现概率最高，且你的指标解释不清' },
      { topicId: 't1', topicTitle: 'RAG 检索质量', reason: '原理能说，一追复杂度和边界就变薄' },
      { topicId: 't9', topicTitle: '模型微调与适用边界', reason: '岗位 JD 明确要求，简历里是空白' },
    ];
    const focus = (weak.length ? weak : fallbackFocus).map((w) => ({
      topicId: w.topicId || 't1',
      topicTitle: w.topicTitle || 'RAG 检索质量',
      why: w.reason || '面试出现概率最高，且当前说不透',
      how: ['先用自己的项目讲一遍，录音回听', '写出三个可能的追问并准备好答案'],
    }));
    return reply({
      headline: '方案能讲清，一追边界和数字就露怯——问题不在知识量，在表达结构。',
      focus,
      days: [
        { day: 'D1', goal: '把最弱的那个知识点补成能讲 3 分钟', tasks: [
          { time: '45min', task: '重读该知识点资料，用白纸默写答题框架', type: '复习' },
          { time: '20min', task: '录音口述一遍，回听并删掉所有废话', type: '口述' },
        ] },
        { day: 'D2', goal: '补齐量化证据', tasks: [
          { time: '40min', task: '翻出项目数据，把三个关键数字写进话术', type: '复盘' },
          { time: '30min', task: '针对「成果归因」做一次自问自答', type: '口述' },
        ] },
        { day: 'D3', goal: '复习第二、第三短板', tasks: [
          { time: '50min', task: '两个知识点各写 5 条核心结论', type: '复习' },
          { time: '30min', task: '做一轮 8 题测验，目标 75 分以上', type: '刷题' },
        ] },
        { day: 'D4', goal: '系统设计热身', tasks: [
          { time: '45min', task: '限时设计一个高并发问答服务，画架构图', type: '刷题' },
          { time: '20min', task: '对照资料补漏，标注没想到的点', type: '复盘' },
        ] },
        { day: 'D5', goal: '模拟面试', tasks: [
          { time: '60min', task: '找人做一次完整模拟，全程录音', type: '口述' },
          { time: '30min', task: '整理被问住的 5 个问题', type: '复盘' },
        ] },
        { day: 'D6', goal: '补齐岗位缺口', tasks: [
          { time: '45min', task: '学习 SFT 数据构造与适用边界，写成 5 条判断', type: '复习' },
        ] },
        { day: 'D7', goal: '二轮测验验收', tasks: [
          { time: '40min', task: '用新一套题再测一次，目标 85 分', type: '刷题' },
          { time: '20min', task: '把仍出错的知识点标记为重点复习', type: '复盘' },
        ] },
      ],
      resources: [
        { type: '练习', title: '把自己的项目讲给不懂技术的人听', note: '能讲明白说明真懂了' },
        { type: '文档', title: 'MySQL 官方 EXPLAIN 文档', note: '重点看 type 与 Extra' },
      ],
      nextRound: '再做一轮混合难度测验，总分 85 以上且深度题单项不低于 70%，才算过线。',
    });
  }

  return reply({ note: 'demo' });
}
