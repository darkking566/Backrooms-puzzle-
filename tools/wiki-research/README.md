# Wiki 層級網路研究工具

用來重新產生 [`docs/level-network.md`](../../docs/level-network.md)。

| 檔案 | 用途 |
|---|---|
| `fetch.sh` | 依 `data/index.json` 下載各層級頁面到 `data/`（每頁間隔 0.4 秒，已下載的會跳過） |
| `parse_levels.py` | 解析下載的頁面，輸出 `data/graph.json`：名稱、作者、生存難度、出入口段落與提到的層級 |
| `write_network.py` | 從 `graph.json` 產生 `docs/level-network.md` |
| `data/index.json` | Normal Levels I 總表的 602 個層級條目（含子層級） |
| `data/graph.json` | 解析結果（2026-11-08 抓取） |

用法（在本資料夾內執行）：

```sh
./fetch.sh                       # 下載原始頁面（不納入版本控制）
python3 parse_levels.py data     # 產生 data/graph.json
python3 write_network.py         # 產生 docs/level-network.md
```

`write_network.py` 裡 Level 0 和 Level 1 的出口清單是人工核對後寫入的，重新抓取後需要再核對一次。

`data/graph.json` 含有從 Backrooms Wiki 擷取的文字片段，依 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 授權，各頁作者記錄在檔案中。
