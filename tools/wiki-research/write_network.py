import json,re
g=json.load(open('data/graph.json'))
L0=[('level-0-1','步行即可穿過，但在廣大的 Level 0 裡極難碰到'),('level-0-2','嗡嗡聲變安靜、地毯變乾、房間看起來像在施工時，可能找到一扇門'),('level-1','閃爍的牆（主要出口）'),('level-44','打開一扇金屬門'),('level-46','砂岩做的門'),('level-58','多彩的溜滑梯（傳聞，未證實）'),('level-72','從坑洞掉下去，墜落非常、非常久'),('level-82','市場攤位或牆上的門'),('level-232','一扇有半透明窗戶的舊木門'),('level-263','零星出現的入口'),('level-287','打破牆壁，或穿過任何深色的牆'),('level-311','約 30% 的牆「稍微更黃一點」，碰到就會被帶走；Level 0 主要死因之一'),('level-313','偶爾出現的玻璃門框'),('level-421','散落各處的球池'),('level-609','打破燈')]
L1=[('level-2','一直往某個方向走，出現管線和儀表就漸漸進入（最常見）'),('level-22','玻璃門'),('level-154','日光燈走廊盡頭、有特殊符號的門'),('level-159','覆冰的金屬門'),('level-218','碉堡門'),('level-389','出現在不合理位置的木門'),('level-998','像電梯的金屬雙開門，後面是樓梯'),('level-998-2','純白木門'),('level-19','爬進天花板的洞'),('level-38','越走越「故障」的走廊'),('level-128','牆上露出戶外的破口，或穿牆'),('level-24','月亮的畫（B.N.T.G. 保密中，傳聞）'),('level-201','把標著「Mach+」的錄影帶放進電視'),('level-305','穿進一棵枯樹')]
def d(k):
    m=re.search(r'(?:SURVIVAL (?:DIFFICULTY|CLASS)(?: CLASS)?:?)\s*([^\s]+)',g[k]['difficulty'],re.I); return m.group(1) if m else '?'
o=['# Backrooms Wiki 層級網路（第一輪整理）','','資料來源：backrooms-wiki.wikidot.com 層級總表（Normal Levels I，602 個條目，含子層級），2026-11-08 抓取。各頁皆為 CC BY-SA 3.0。','','> 出入口由程式從各頁的 Entrances/Exits 段落自動擷取，Level 0、Level 1 兩部分已人工核對。生存難度標「?」或格式特殊的頁面仍需人工確認。','','## 從 Level 0 出去','','| 目的地 | 生存難度 | 方式 | 作者 |','|---|---|---|---|']
for k,w in L0: o.append(f"| {g[k]['name']} {g[k]['title']} | {d(k)} | {w} | {g[k]['authors']} |")
o+=['','## 從 Level 1 出去（Level 1 頁面自己列的出口）','','| 目的地 | 生存難度 | 方式 | 作者 |','|---|---|---|---|']
for k,w in L1: o.append(f"| {g[k]['name']} {g[k]['title']} | {d(k)} | {w} | {g[k]['authors']} |")
o+=['','Level 1 頁面另列「通風管 → Level 800」，但該頁面已不存在，排除。另有約 15 個層級在自己的入口段落寫了可以從 Level 1 進入（例如 1.1、1.3、3.5、9.2、46、55、307、314、386、726、817、902），待逐一核對。','','## Level 0～11 與子層級','','IN = 該頁入口段落提到的來源；OUT = 該頁出口段落提到的目的地；只列 0～11 範圍內的連接。「全部」= 出入口段落提到的層級總數。','','| 層級 | 名稱 | 生存難度 | IN | OUT | 全部 | 作者 |','|---|---|---|---|---|---|---|']
core=[k for k in g if re.fullmatch(r'level-(\d|1[01])(-\d+)?',k)]
core.sort(key=lambda k:[int(x) for x in k[6:].split('-')]); S=set(core)
f=lambda L:', '.join(x[6:].replace('-','.') for x in L if x in S) or '—'
for k in core:
    p=g[k]; o.append(f"| {p['name']} | {p['title']} | {d(k)} | {f(p['entrances_refs'])} | {f(p['exits_refs'])} | {len(set(p['entrances_refs'])|set(p['exits_refs']))} | {p['authors']} |")
open('../../docs/level-network.md','w',encoding='utf-8').write('\n'.join(o)+'\n')
print(len(o),'lines')
