/**
 * tw-concepts.ts
 * 台股概念股對照表（股票代號 → 所屬概念清單）
 * 一支股票可同時屬於多個概念；不在對照表內的歸為「其他」。
 */

export const CONCEPTS = [
  'AI', '伺服器', '雲端運算', '先進封裝', '散熱群組', '機體群組',
  '機器人', '無人機', '車用電子', '電動車', '低軌衛星', '玻璃基板',
  '充電能源', '軍工', '太陽能', '智慧電網',
] as const

export type Concept = typeof CONCEPTS[number] | '其他'

// ─── 概念 → 股票代號清單 ──────────────────────────────────────
const RAW: Record<string, string[]> = {
  'AI': [
    '2330.TW',  // 台積電
    '2454.TW',  // 聯發科
    '2382.TW',  // 廣達
    '6669.TWO', // 緯穎
    '2356.TW',  // 英業達
    '3231.TW',  // 緯創
    '2357.TW',  // 華碩
    '2376.TW',  // 技嘉
    '2377.TW',  // 微星
    '2395.TW',  // 研華
    '2379.TW',  // 瑞昱
    '3034.TW',  // 聯詠
    '6415.TWO', // 矽力-KY
    '2308.TW',  // 台達電
    '2345.TW',  // 智邦
    '3711.TW',  // 日月光投控
    '2303.TW',  // 聯電
    '2324.TW',  // 仁寶
    '6770.TW',  // 力積電
    '3105.TWO', // 穩懋
    '2337.TW',  // 旺宏
  ],
  '伺服器': [
    '2382.TW',  // 廣達
    '2356.TW',  // 英業達
    '6669.TWO', // 緯穎
    '3231.TW',  // 緯創
    '2324.TW',  // 仁寶
    '6230.TWO', // 超眾
    '2059.TW',  // 川湖
    '8210.TWO', // 勤誠
    '2421.TW',  // 建準
    '2376.TW',  // 技嘉
    '2377.TW',  // 微星
    '3338.TWO', // 泰碩
    '2408.TW',  // 南亞科
    '2330.TW',  // 台積電
  ],
  '雲端運算': [
    '2330.TW',  // 台積電
    '2382.TW',  // 廣達
    '6669.TWO', // 緯穎
    '2356.TW',  // 英業達
    '2345.TW',  // 智邦
    '5388.TWO', // 中磊
    '6285.TW',  // 啟碁
    '3045.TW',  // 台灣大哥大
    '2412.TW',  // 中華電
    '3231.TW',  // 緯創
  ],
  '先進封裝': [
    '2330.TW',  // 台積電（CoWoS）
    '3711.TW',  // 日月光投控
    '2325.TW',  // 矽品
    '6239.TW',  // 力成
    '8150.TWO', // 南茂
    '6147.TWO', // 頎邦
    '3374.TW',  // 精材
    '3264.TWO', // 欣銓
    '2369.TW',  // 菱生
    '2303.TW',  // 聯電
    '3037.TW',  // 欣興
  ],
  '散熱群組': [
    '6230.TWO', // 超眾
    '3324.TWO', // 雙鴻
    '3017.TW',  // 奇鋐
    '2421.TW',  // 建準
    '3653.TWO', // 健策
    '3338.TWO', // 泰碩
    '8210.TWO', // 勤誠
    '3375.TWO', // 力致
    '2059.TW',  // 川湖
  ],
  '機體群組': [
    '2354.TW',  // 鴻準
    '2474.TW',  // 可成
    '3376.TW',  // 新日興
    '4938.TW',  // 和碩
    '2392.TW',  // 正崴
    '8210.TWO', // 勤誠
    '2317.TW',  // 鴻海
    '2357.TW',  // 華碩
  ],
  '機器人': [
    '2049.TW',  // 上銀
    '2308.TW',  // 台達電
    '1504.TW',  // 東元
    '6188.TW',  // 廣明
    '1590.TW',  // 亞崴
    '2395.TW',  // 研華
    '2317.TW',  // 鴻海
    '1513.TW',  // 中興電
    '1515.TW',  // 力山工業
  ],
  '無人機': [
    '8033.TWO', // 雷虎
    '2634.TW',  // 漢翔
    '3558.TW',  // 神準
    '2314.TW',  // 台揚
    '2474.TW',  // 可成
  ],
  '車用電子': [
    '6271.TWO', // 同欣電
    '2458.TW',  // 義隆電
    '2308.TW',  // 台達電
    '3034.TW',  // 聯詠
    '6257.TWO', // 矽格
    '2436.TW',  // 偉詮電
    '3014.TW',  // 聯陽
    '6231.TWO', // 系微
    '3035.TW',  // 智原
    '2454.TW',  // 聯發科
    '6770.TW',  // 力積電
    '3545.TWO', // 旭曜
  ],
  '電動車': [
    '1536.TW',  // 和大
    '3665.TWO', // 貿聯-KY
    '2308.TW',  // 台達電
    '1504.TW',  // 東元
    '1549.TW',  // 富田電機
    '2317.TW',  // 鴻海（MIH）
    '4938.TW',  // 和碩
    '6282.TW',  // 康舒
    '3023.TW',  // 信邦
    '2360.TW',  // 致茂
  ],
  '低軌衛星': [
    '2314.TW',  // 台揚
    '6485.TWO', // 昇達科
    '5388.TWO', // 中磊
    '6285.TW',  // 啟碁
    '4906.TWO', // 正文
    '3558.TW',  // 神準
    '3596.TWO', // 智易
    '3044.TW',  // 健鼎
    '3138.TWO', // 耀登
    '2345.TW',  // 智邦
    '3008.TWO', // 台林
  ],
  '玻璃基板': [
    '3037.TW',  // 欣興
    '8046.TW',  // 南電
    '3189.TW',  // 景碩
    '8213.TWO', // 志超
    '1802.TW',  // 台玻
  ],
  '充電能源': [
    '2308.TW',  // 台達電
    '2457.TW',  // 飛宏
    '6202.TWO', // 盛群
    '6121.TW',  // 新普
    '6523.TWO', // 順達
    '4175.TWO', // 有量
    '3323.TWO', // 能元科技
    '6282.TW',  // 康舒
    '9958.TWO', // 仕欽
  ],
  '軍工': [
    '2634.TW',  // 漢翔
    '2612.TW',  // 中航
    '2208.TW',  // 台船
    '5009.TW',  // 榮剛
    '2002.TW',  // 中鋼
    '8033.TWO', // 雷虎
  ],
  '太陽能': [
    '3576.TW',  // 聯合再生能源
    '6443.TW',  // 元晶
    '6244.TW',  // 茂迪
    '5483.TW',  // 中美矽晶
    '6477.TWO', // 安集
  ],
  '智慧電網': [
    '2371.TW',  // 大同
    '1513.TW',  // 中興電
    '1503.TW',  // 士林電機
    '2308.TW',  // 台達電
    '1504.TW',  // 東元
    '1514.TW',  // 亞力
    '6146.TWO', // 耕興
    '1512.TW',  // 瑞利
  ],
}

// ─── 反向索引：symbol → concepts（模組載入時建立一次）──────────
const SYMBOL_TO_CONCEPTS: Record<string, string[]> = {}
for (const [concept, symbols] of Object.entries(RAW)) {
  for (const sym of symbols) {
    if (!SYMBOL_TO_CONCEPTS[sym]) SYMBOL_TO_CONCEPTS[sym] = []
    if (!SYMBOL_TO_CONCEPTS[sym].includes(concept)) {
      SYMBOL_TO_CONCEPTS[sym].push(concept)
    }
  }
}

/** 取得股票所屬概念清單，不在對照表內回傳空陣列（顯示為「其他」） */
export function getConceptsForSymbol(symbol: string): string[] {
  return SYMBOL_TO_CONCEPTS[symbol] ?? []
}

// ─── 每個概念的 Badge 樣式 ────────────────────────────────────
export const CONCEPT_BADGE: Record<string, string> = {
  'AI':       'bg-violet-900/60 text-violet-300',
  '伺服器':   'bg-blue-900/60 text-blue-300',
  '雲端運算': 'bg-sky-900/60 text-sky-300',
  '先進封裝': 'bg-teal-900/60 text-teal-300',
  '散熱群組': 'bg-orange-900/60 text-orange-300',
  '機體群組': 'bg-slate-700/60 text-slate-300',
  '機器人':   'bg-green-900/60 text-green-300',
  '無人機':   'bg-yellow-900/60 text-yellow-300',
  '車用電子': 'bg-amber-900/60 text-amber-300',
  '電動車':   'bg-lime-900/60 text-lime-300',
  '低軌衛星': 'bg-indigo-900/60 text-indigo-300',
  '玻璃基板': 'bg-cyan-900/60 text-cyan-300',
  '充電能源': 'bg-yellow-800/60 text-yellow-200',
  '軍工':     'bg-red-900/60 text-red-300',
  '太陽能':   'bg-orange-800/60 text-orange-200',
  '智慧電網': 'bg-emerald-900/60 text-emerald-300',
  '其他':     'bg-[#30363d] text-[#8b949e]',
}

// 篩選按鈕選中時的樣式
export const CONCEPT_ACTIVE: Record<string, string> = {
  'AI':       'bg-violet-600 text-white',
  '伺服器':   'bg-blue-600 text-white',
  '雲端運算': 'bg-sky-600 text-white',
  '先進封裝': 'bg-teal-600 text-white',
  '散熱群組': 'bg-orange-600 text-white',
  '機體群組': 'bg-slate-600 text-white',
  '機器人':   'bg-green-700 text-white',
  '無人機':   'bg-yellow-600 text-white',
  '車用電子': 'bg-amber-600 text-white',
  '電動車':   'bg-lime-700 text-white',
  '低軌衛星': 'bg-indigo-600 text-white',
  '玻璃基板': 'bg-cyan-700 text-white',
  '充電能源': 'bg-yellow-700 text-white',
  '軍工':     'bg-red-700 text-white',
  '太陽能':   'bg-orange-700 text-white',
  '智慧電網': 'bg-emerald-700 text-white',
  '其他':     'bg-[#444c56] text-white',
}
