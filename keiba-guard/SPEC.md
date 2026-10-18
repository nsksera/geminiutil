# 馬券配分プランナー 技術仕様書 (SPEC)

`keiba-guard/` — 素の HTML/CSS/JS によるオフライン・シングルページアプリ。
バージョン: 2026-10-17 時点の実装。

---

## 1. 目的と理論

### 1.1 保証条件（赤字回避）

馬券の的中シナリオ i（単体・同時を問わない）について,
```
払戻(シナリオ i) ≥ 総掛金 T
```
がすべて成立する配分は,
```
S = Σ_i 1/e_i ≤ 1 のときに存在する
```
ここで `e_i = オッズ_i ÷ 点数_i`（**実効オッズ**: まとめ券種の最悪組合せを基準にした値）。
最悪シナリオの払戻は `e_i × x_i`（x_i は行 i への総掛金）。したがって
```
x_i = B × (1/e_i) / S
```
と置くと全行の払戻が一律 `B/S`（≥ B）になり、同時的中は加算されるだけで常に成立する
（排他/非排他の区別が不要。組合せ列挙も不要）。

### 1.2 期待値の性質

オッズの含意確率 `p_i = (1/オッズ)/S` の下では期待払戻は配分に関係なく `B/S` で一定。
配分で選ぶのは**リスクの形状**（最小払戻と最大払戻のバランス）のみ。

### 1.3 攻撃配分（安全率 α）

```
保険部分  G = B × α/100          … 1.1 の保証配分を予算 G で実行
集中部分  C = B − G（＋保険側の丸め余り）を本命行 k に投入
本命中の払戻 = 保険部分の払戻(随時 e_k x_k^G) + e_k × y_k
最悪払戻    = min_i (e_i x_i)｜(i ≠ k の行は保険分のみ)
```
- `y_k = floor(C' / gran_k) × gran_k`（丸め単位を維持）
- α=100% で通常の renderPlan、α=0% で全額集中
- S > 1 の場合は攻撃配分は表示せず既存の不成立パネルを出す

---

## 2. ファイル構成

```
keiba-guard/
├─ index.html   … 6カード(レース情報/予想からの提案/馬券パターン/予算/配分スタイル/データ)
│                 ＋ 計算ボタン + #result + 免責
├─ help.html    … 初めての方向けガイド（本体ヘッダからリンク、style.css 共有）
├─ style.css    … HIG風。:root変数、prefers-color-schemeでライト/ダーク自動切替
└─ app.js       … IIFE 1本。ロジック・UI生成・計算エンジン・保存/読込・予想提案
```

DOM 主要ID:
`#raceDate` `#raceVenue` `#raceNo` `#fileNameNote`（レース情報カード）
`#yosoTabs` `#yosoKeypad` `#yosoClear` `#yosoList`（予想からの提案カード）
`#patternList`（行カード群） `#addPattern` `#dupLast` `#budget` `#roundToggle`
`#alpha` `#alphaVal` `#focusRow` `#calcBtn` `#result`
`#autoSave` `#exportBtn` `#importBtn` `#importFile`（データカード）

---

## 3. データモデル

- **券種テーブル `BET`**
  ```
  tan/fuku      : count 1, 単票のみ
  wakuren/wakutan : count 2, field 'w' (枠番1..8)
  umaren/wide/umatan : count 2, field 'h' (馬番1..18)
  sanrenpuku/sanrentan : count 3, field 'h'
  ordered: wakutan/umatan/sanrentan のみ true（タップ順 = 着順）
  ```
- **行カードの状態 `card._st = st`**
  ```
  {
    type: BET の key | null,
    mode: 'num' | 'multi' | 'odds',   // 現在表示中のタブ
    dataMode: 'num' | 'multi',        // ★最後に使った入力モード（odds タブ中のデータ参照用）
    sel: [],          // 番号モードの選択（ordered はこの並びが着順）
    pools: [[],[]],   // まとめモードの組ごとの候補（長さ = BET.count）
    focus: 0,         // まとめモードでフォーカス中の組
    odds: '',         // 文字列（電卓キーが積む。'.' は1個まで）
    memo: ''          // カードメモ（計算に影響しない・保存対象）
  }
  ```
  重要: 計算・表示は `vm = (mode === 'odds') ? dataMode : mode` で分岐する。
  （odds タブ中でも直前の入力データを計算対象にするため dataMode を分離。）

---

## 4. 入力バリデーション（2026-10-17 追加）

| 条件 | 挙動 |
|---|---|
| 番号モードで選択が満席（sel.length === count）かつ新しい番号 | **拒否**: キーに `.deny`（揺れアニメ + 赤文字）＋ `.deny-msg` メッセージ 2.2秒表示。「{券種}は選択 {count} までです。⌫や再タップで外してから選び直してください。」 |
| 単勝/複勝（count === 1）の新番号 | `sel[0] = n` で**置換**（ラジオ挙動） |
| 選択済み番号の再タップ | 選択解除（満席中も可） |
| まとめモード | プールへの追加は自由（ボックス/ながしは本来複数候補）。重複馬は生成時に除外 |

### 4.1 まとめの組合せ生成 `poolCombos(st)`

```
active = pools.filter(空でない) 各重複除去
- 無順序 & active.length === 1 → ボックス: C(n, count) の組合せ
- それ以外: active.length === count のときのみ直積。
  同一馬重複は除外、無順序はソート署名で重複統合
- 上記以外は 0点（未完成扱い）
```
行名は `「馬連ボックス 3-5-7」` / `「3連単まとめ 3,5 / 2,8 / 1」` 形式。

### 4.2 行の完成条件（読み取り `readRows()`）

`info = rowInfo(st, vm)` が非null かつ `odds > 1 && odds < 999999` の行のみ計算対象。
- 番号モード: `sel.length === count`
- まとめモード: `poolCombos(st).count >= 1`
- **odds タブ中でも vm === dataMode で判定する**（バグ修正の要点）

---

## 4.5 予想からの提案（2026-10-18 追加）

`yState = { pools: [1着, 2着, 3着], tab }`。キーパッドで馬番を追加/解除（着間の重複可）。

提案生成 `ySuggestions()` のルール（優先順）:

1. **3連単 フォーメーション**: 1〜3着すべてに候補があるとき。点数 = 着順直積の
   同馬重複除外数（`yOrdCombos`）。pools は `[P1,P2,P3]` をそのまま `sanrentan` の pools に。
2. **3連単 ながし**: 1着候補が1頭 h のとき。`[[h],[oth],[oth]]`、点数 = |oth|×(|oth|−1)。
3. **3連複 ボックス**: 候補全体 U（|U|≥3）から3頭。`[U,[],[]]`、点数 = C(|U|,3)。
4. **馬単/馬連/ワイド ながし**: 1着候補が1頭のとき。点数 = |oth|。
5. **単勝**: 1着候補それぞれ（最大4行）。

「追加」ボタン → `addPatternRow()` + `_applyState(row)`（memo に組み合わせ例、
markEntering で追加演出、scrollIntoView）。serialize には
`yoso: { p: pools, t: tab }`（候補があるときのみ）として保存し、`applyData` で復元。

---

## 5. 計算エンジン（app.js）

構成: `runCalc()` → S 判定 → `renderPlan` / `renderAttack` / `renderInfeasible`
配分の本体は `allocate(rows, budget, S)`（貪欲法＋移動修正＋減額調整）を共通利用。

### 5.1 行パラメータ

```
e    = odds / count      （実効オッズ）
gran = count × unit      （丸め刻み。unit = roundToggle ? 100 : 1 円）
```
まとめ券種は「1点あたり100円」を守るため gran を点数倍する。

### 5.1b オッズ下落率（2026-10-18 追加）

- 入力: `#dropRate`（0〜80% step5、既定30%）+ `#dropVal` 表示。配分スタイルカード。
- 数理: 補正係数 `kDrop = 1 − d/100`（全券種一律 → 各 e も一律に kDrop 倍）。
  `Sdrop = S / kDrop`、下落時の任意の払戻は元の払戻 × kDrop。
  よって **配分（stake）は d に依存しない**（比率不変）→ 同じ買い目で
  「下落なし／下落あり」両方の表示が成り立つ:
  - 現在成立ならば下落成立条件は `S ≤ 1 − d/100`（例: 30% なら S ≤ 0.700）。
- 表示（bannerState 拡張）: badge `下落d%後 = Sdrop`（dropRate>0 のときのみ追加。1以下なら緑）。
  - バナー状態: `okExact && Sdrop ≤ 1` → ok（緑）、`okExact && Sdrop > 1` → warn（黄、
    「成立 — ただし下落すると保証外」+ 下落時払戻/利益）。S>1 は renderInfeasible（既存）。
  - renderPlan/renderAttack とも各「的中時(最悪)」と最低払戻行に下落想定値を併記
    （`minPd = minP × kDrop`。「利益」は負値も表示、yen() は負数対応）。
  - renderInfeasible は desc に `Sdrop` の一言を追加（バッジも同時）。
- 保存: serialize `drop`、applyData で 0〜80 にクランプ復元。

### 5.2 `allocate(rows, budget, S)` の3段構成

1. **貪欲配分**: gran0 = min(gran)。gran0 === 1（丸めなし且つ全行 count=1）のときのみ
   理論比 `budget × (1/e)/S`。それ以外は以下を繰り返す:
   各行について「gran を1つ足した場合の不足 T' − e_i s_i'」が最小になる行を選択し
   加算。予算超過候補は除外。反復上限 200000。
2. **移動修正（repair）**: 最大赤字行 t を選び、`lcm(gran_j, gran_t)` の額を
   出金側 j から移動（t 行は gran_t の倍数を維持したまま増やせる）。
   donor 不在なら打ち切り。上限 3000 反復。
3. **減額調整（trim）**: それでも minP ≥ T が成立しない場合、各行の gran を1つ引いて
   （最低1点は維持）成立する刻みを探す。各ステップで「成立候補を最優先・なければ
   最も成立に近い候補」を採用し、最大 300 ステップ。端数は未使用（spare）に。

戻り値は `stake` 配列（行ごとの総掛金）。

### 5.3 表示

- `renderPlan`: banner(ok/warn) + 各行 (`¥p × 点数`, 的中時(最悪)) + 総掛金(端数注記)
  + 最低払戻/利益 + すべて外れ/同時的中。
- `renderAttack`: 
  ```
  k = pickFocus()   // #focusRow の値。行名一致 or 'auto' → オッズ最大の行
  G = floor(B × α/100)
  stake = allocate(rows, G, S)
  y = floor((C + (G − Σstake)) / gran_k) × gran_k   // 保険側の未使用額も集中に合流
  stake[k] += y
  ```
  banner は常に `warn`（攻撃）。本命行に行名へ `★本命` を前置し sub に `集中 ¥y`。
  下段カードに「本命行が外れた場合= 最悪 minP」「同時的中= 本命中が最大」。
- `renderInfeasible`: 削除候補（実効オッズ最小の行から最大3案、Sは残行で計算）
  ＋均衡配分（損失 B − B/S、各行 per-combo 表示）。

### 5.4 自動再計算

- `scheduleCalc()` = 120ms デバウンス → `runCalc()`。
  トリガ: 全キー / タブ / チップ / 予算 input / roundToggle change / α input&change /
  focusRow change。`#calcBtn` クリックは即時 `runCalc()`。
- 有効行ゼロで `#result` を hidden。旧バグ（予算変更後の結果残留）はこの構造で解消済み。

---

## 6. UI 要件（決定済みの設計原則）

- 選択式＋電卓型テンキー。文字入力なし（予算はテキスト入力のみ）。
- 「＋ 馬券を追加」はパターンカード群の最下部。
- キー配列: 番号 = 1..18 (6列) / 枠 = 1..8 (4列) / オッズ = `789/456/123/0 .⌫/クリア`
  （下段に ⌫ と クリア(span3)）。
- まとめ: 組タブ（1着/2着/3着 または 組1/組2/組3）＋フォーカスされる組に番号追加。
- 拒否フィードバック: 赤リングは不使用（枠キーの選択リングと紛れるため）。
  揺れ `.key.deny` ＋ `.deny-msg` テキスト。
- CSS の `.slider` は iOSスイッチ用。range は `.alpha-range`（同名衝突を回避）。
- 予算入力は `.budget-field`（chip 背景・¥ プレフィックス付・22px、枠なしテキスト）。
  生のテキストボックスは UI 上現れない（2026-10-18 確認済み）。
- 安全率スライダ（`.alpha-range`）の thumb は `margin-top: calc((4px - 26px) / 2)`
  で track を中心に揃える（WebKit の標準的ずれ防止）。Firefox 用の
  `-moz-range-thumb/track` も併記済み。
- ✕削除ボタンは `.pattern-card` 右上の絶対配置（top/right 9px）。フッターは combo＋oddsDisp のみ。
- 追加行: `#addPattern` の隣に `#dupLast`（直前カードの複製）。複製は最下段カードの
  `_st` を serialize 形式で `_applyState` に渡す（券種・mode/dataMode・sel・pools・odds・memo 含む）。
  カード0枚のときは no-op。追加後は新カードへ scrollIntoView。
- カード追加/削除演出: 追加は `.pattern-card.entering`（cardIn キーフレーム .22s、
  付与は markEntering、animate 終了で class 削除）。削除は WAAPI `card.animate`
  （opacity/height/transform, 200ms）で要素を縮めつつフェード→ onfinish で remove。
  `REDUCED_MOTION`（prefers-reduced-motion: reduce）のときは両方即時・アニメなし。

---

## 7. 既知の仕様・癖

1. **オッズ入力は券種変更でも保持される**（選び直しに便利）。クリアキーで消す。
2. `e_i < 1`（最低オッズ < 点数）のまとめ行は配分上不利（1/e_i が巨大）→ S で自然に不成立側になる。
3. 丸めなし(unit=1)時も、まとめを含む構成では理論比ではなく
   `gran = count × 1` 円の刻みで整数円配分になる（design: 1点あたり単位の実装一貫性）。
4. `focusRow` のオプションは行名で再構築するため、行の内容が変わっても選択状態は
   行名が一致する限り維持される。
5. データ保存: 「データ」カードの自動保存（localStorage キー `keibaGuardState.v1`）。
   `scheduleCalc` 内で `scheduleSave`（400ms デバウンス）が併走し、`serialize()` が
   `{v:1, race:{date,venue,no}|null, yoso:{p,t}|null, budget, round, alpha, focus,
   rows:[{type,mode,dataMode,sel,pools,odds,memo}]}` を書く。
   `race.date` は `YYYY-MM-DD`、`race.venue` は英字（Sapporo〜Kokura の中央10場、
   Obihiro〜Saga の地方15場、optgroup で中央/地方を分離）、`race.no` は 1〜12 の文字列。
   起動時に復元（rows がある場合のみ・2枚の既定カードを置換して再構築）。
   `yoso.p` は `[[],[],[]]` 形式で `applyData` が各値を 1〜18 にフィルタし、
   `refreshYKeys()/renderYosoList()` で提案を再生成する。
   保存データがない日は `raceDate` に本日を既定入力（restore 時は上書きしない）。
   `focusRow` の選択状態は `dataset.restore` 経由で `syncFocusSelect` に引き渡して復元。
   書き出しのファイル名は `buildFileName()` = `keiba-guard-YYYY-MM-DD-競馬場英字-レース番号.json`
   （ `keiba-guard-2026-10-18-Ohi-6.json` 形式。英数字とハイフンのみに正規化、
   未入力部分は省略。カード下 `#fileNameNote` に常時表示）。
   読み込みは File→FileReader→`applyData()`（不正 JSON は警告バナーを表示して入力を変更しない）。
   race の各値は `applyData` 側で正規表現で検証して正規化（例: venue は `^[A-Za-z]{0,12}$`）。
6. 免責（理論値参考表示・オッズ変動・全損リスク）を UI に常時表示。

---

## 8. 検証ログ（完了済み）

| ケース条件 | 期待 | 結果 |
|---|---|---|
| 単勝 1→2→3 | sel=[3], 表示「単勝 3」（置換） | OK |
| 馬連 [3,5] + 7タップ | 拒否（.deny + メッセージ）, sel 変化なし | OK |
| 3連単 [1,2,3] + 4タップ | 同上 | OK |
| 枠連 [1,2] + 3タップ | メッセージ「枠連は選択 2 まで…」表示・2.2秒で消える | OK |
| 馬連ボックス 3,5,7 | 「3点・最低オッズ ≥ 3倍」表示 | OK |
| 3連複ボックス 3,5,7,9 @6 | 4点、まとめ統合計算 | OK |
| 3連単まとめ 4点 @4000 | 成立バナー（S=0.001）・自動再計算 | OK |
| まとめ+単勝の2行, 予算10,000 | ¥1500×4 + ¥4000, 最低払戻=総掛金=10,000 | OK |
| S=1.000 境界（box2行）| 貪欲失敗 → 減額調整で総掛金7,200 に成立 | OK |
| S>1（まとめ含む）| 不成立 + 削除候補 + 均衡配分 | OK |
| 予算/トグル/α/focus 入力毎に自動再計算 | 即時反映（残留なし）| OK |
| α=70, auto 本命 | 保険5400 + 集中4500 → min 5,400 / 本命中 18,900 | OK |
| α=70 手動本命 / α=0 全額集中 | 集中先が行に正しく切替 | OK |
| メモ入力（2カード） | 計算不変・serialize の rows[i].memo に入る | OK (2026-10-17) |
| 自動保存→リロード | 券種/まとめ/オッズ/メモ/予算/α 全復元、自動再計算で本命再選択 | OK (2026-10-17) |
| 不正 JSON を読込 | 警告バナー「読み込めませんでした」が残り、入力無変更 | OK (2026-10-17) |
| レース情報入力（日付/競馬場/R） | ファイル名 `keiba-guard-2026-10-18-Ohi-6.json` に即時反映・serialize に race | OK (2026-10-18) |
| レース情報を含む保存→リロード | date/venue/no 復元・ファイル名表示も復元 | OK (2026-10-18) |
| 保存データなし起動 | raceDate=本日、競馬場/R 空欄、`keiba-guard-YYYY-MM-DD.json` | OK (2026-10-18) |
| 競馬場プルダウン | 中央10場＋地方15場（optgroup 区分）が全選択肢に存在 | OK (2026-10-18) |
| ✕ボタンをカード右上へ移動 | カード右/上それぞれ 9px の絶対配置、フッターからは独立、チップ行は padding-right 30px で干渉なし | OK (2026-10-18) |
| help.html 遷移（本体⇆ガイド） | file:// 相対リンクで双方向 OK、ダーク反映 | OK (2026-10-17) |
| 直前を複製 | 単勝6@2.5+メモのカードが同内容で第2カード化（match=true）、削除で戻せる | OK (2026-10-18) |
| 安全率スライダのツマミ位置 | track 中心に一致（margin-top 補正後） | OK (2026-10-18) |
| カード追加演出 | .entering が付与（animationend で自動剥離/400ms 内に解消） | OK (2026-10-18) |
| カード削除演出 | 即時削除でなく 200ms アニメ → remove、残りカードの詰めは滑らか | OK (2026-10-18) |
| 予想例 1-[2,3]-[3,4] | フォーメーション3点・ながし6点・3連複box4点・馬単/馬連/ワイド各3点・単勝1点 | OK (2026-10-18) |
| 提案「追加」 | sanrentan multi pools=[[1],[2,3],[3,4]] のカード追加＋メモ | OK (2026-10-18) |
| 予想の保存→リロード | yoso{p,t} 復元・キー点灯・提案再生成 | OK (2026-10-18) |
| 下落30%（S=0.733=S'1.048） | バナーバッジ2個・warn 黄「成立—ただし下落すると保証外」/ 最低払戻行に 下落想定 ¥8,400・利益 ¥−3,600 | OK (2026-10-18) |
| 下落30%（S=0.583=S'0.833） | 緑 ok「成立 — 下落しても保証内」 | OK (2026-10-18) |
| 下落0% | 下落バッジ非表示（Sのみ） | OK (2026-10-18) |
| drop 保存→リロード | drop=30 復元・再計算 | OK (2026-10-18) |
| 全クリア | pools全消去・提案リスト空（ヒント表示）・yoso=null で保存 | OK (2026-10-18) |
