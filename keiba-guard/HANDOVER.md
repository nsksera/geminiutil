# 引継書 — 馬券配分プランナー (keiba-guard)

このファイルは**次のチャットセッションに引き継ぐため**の要点まとめ。前提知識なしで
この内容だけで続行できるように書かれている。

---

## 0. 作業環境と絶対ルール

- 作業ディレクトリ: `C:\Users\user\Documents\デフォルトプロジェクト`（**gitリポジトリではない**・全ファイル未コミット/Tetris用`tetris/`も残置）
- **ファイルの変更・GitHubへのコミット/プッシュ・外部サービス操作の前に必ずユーザー確認**。
  読み取り・スクリーンショット・DOM参照は自由に可。
- **追加インストール禁止**（dev server / npm / ライブラリ音声含む）。素のHTML/CSS/JSのみ。
- デザインは Apple HIG 方針（シンプルに）。
- ブラウザでの動作確認は OpenCode の browser tools を使う（9節参照: Tips 多め）。

## 1. アプリの現状

`keiba-guard/index.html`・`style.css`・`app.js` (+ `help.html`, `MANUAL.md`, `SPEC.md`, `HANDOVER.md`)。
- 目的: 複数の馬券保有者が「どの券種が単体/同時に的中しても総掛金以上の払戻」となる配分を支援。
- 理論・内部と既知事項・検証ログは **`SPEC.md`**（古い仕様と混同しないよう、それに基づくもの）
- 使い方（ユーザー向け）は **`MANUAL.md`**、初めての方向けは **`help.html`**（本体ヘッダからリンク）。

## 2. 成果物の要点（時系列）

1. **テトリス**（テスト巻）: `tetris/`。ユーザー満足済。参照不要。
2. **keiba-guard**:
   - 選択式入力 UI + 自動再計算 (120ms debounce)
   - オッズ電卓キー `789/456/123/0 .⌫ / クリア`
   - **まとめモード**: ボックス/ながし/フォーメーションを1行で入力、点数自動計算。
     実効オッズ `e = 最低オッズ ÷ 点数` で計算に統合し、`S = Σ 1/e ≤ 1` で保証判定。
   - **丸め**: 1点あたり100円単位（gran = 点数 × unit）。貪欲＋LCM移動修正＋
     **減額調整**（成立する総額に切り下げ; 例 S=1.000 境界で 10,000 から 7,200 に成立）
   - **攻撃配分**: 安全率 α スライダー ＋ 本命ドロップダウン（最高オッズ行 auto）。
     `保険 αB/集中 (1−α)B`、保険側の丸め余りは本命に合流。
   - **入力制限**: 単勝/複勝 = 最後の選択を置換。満席時の新番号は
     **拒否（.deny 揺れ + .deny-msg 説明 2.2秒）**。赤リングは廃止（枠キーとの区別改善）。
   - **レース情報**: 最上部カードで日付・競馬場（中央10場＋地方15場）・レース番号を登録。
     書き出しファイル名に反映（`buildFileName()` = `keiba-guard-YYYY-MM-DD-Venue-R.json`、
     英数字のみに正規化・未入力部分は省略）。保存対象、保存データがない日は日付に本日を既定入力。
   - **予想からの提案**: 着順ごと複数候補（重複可）→ 打ち方提案（3連単フォーメーション/
     3連単ながし/3連複box/馬単・馬連・ワイドながし/単勝）を点数つき表示。
     「追加」で馬券パターンカード化（memo に例）。yoso も保存/復元対象。
   - **UI 細部（2026-10-18）**: ✕削除ボタンはカード右上（絶対配置）。
     「＋ 直前を複製」（#dupLast、最下段カードを serialize で複製）。
     カード追加 = cardIn スライドイン演出 / 削除 = WAAPI 200ms（height縮小＋フェード、
     prefers-reduced-motion 時は即時）。総予算は `.budget-field`（¥プレフィックス付き
     インセットフィールド）。安全率スライダの thumb は track 中心に margin-top 補正。
   - **カードメモ**: 各行カード下端に1行メモ（`.memo-input`）。計算不変・保存対象。
   - **データ保存/読込**: 「データ」カード。自動保存（localStorage `keibaGuardState.v1`、
     scheduleCalc 併走の400msデバウンス）＋ 書き出し（JSON Blob ダウンロード）＋
     読み込み（FileReader→`applyData`、不正は警告バナーで入力無変更）。
     復元は既定2カードを全置換して `_applyState` で再構築。focus は `dataset.restore` 経由。
   - **help.html**: 初心者向けガイド（本体ヘッダにリンク、style.css 共有）。

## 3. 障害と解決の履歴（今後も同じパターンが出やすい）

- (済) オッズタブ移動でまとめデータが計算から外れた → `st.dataMode` 導入、
  `rowInfo(st, vm)`, `readRows` は常に vm 判定。
- (済) 空プールがあり ボックスが 0 点扱い → `poolCombos` で空プールを除外してから判定。
- (済) 予算変更後に結果が残留する旧バグ → 有効行ゼロで `#result` を hidden。
- (済) 馬連ボックスの最低オッズが1点あたり単位守れずに端数捨て → 本命集中へ合流に変更済み。

## 4. 未実装・拡張候補（ユーザー調整待ちなど）

- ケリー基準等 **自身の確率予想**を入力する本格 EV モードは未実装（single race での優先度 low）。
- まとめの最低オッズが役別点な点数ごとに変わる（現実）場合の按分 = 最低オッズ 1本入りの簡易仕様。
- 期待値は配分不変のため、追加提案はすべてリスク形状の選択に帰着する点を説明済み。

## 5. テスト手順（信頼性の確認に使った方法）

UI 自動操作は **JS dispatch によるネイティブクリック** 推奨。
`browser.click` の a11y-ref 方式は DOM 再描画で ref 失効 & 状態のずれを招くので避ける。

```
// 典型JS操作（tabID を受け取った直後に実行）
const c = document.querySelectorAll('.pattern-card')[0];
[...c.querySelectorAll('.chip')].find(ch => ch.textContent === '馬連').click();
[...c.querySelectorAll('.seg button')].find(b => b.textContent === 'まとめ').click();
const k = n => [...c.querySelectorAll('.key[data-n]')].find(b => b.dataset.n === String(n));
k(3).click();
[...c.querySelectorAll('.key')].find(b => b.textContent === '6').click();
// 結果はデバウンス 120ms + 背景タブの timer throttle を考慮して 1.3〜1.5 秒待つ
document.getElementById('result').textContent
```

## 6. ブラウザ自動化 Tips（実績のある定型）

1. `browser.preview` は**毎回新タブ**を作る → 最新 `tabs.focusedTabID` を必ず取り直して、
   その tabID を固定して使用する。
2. preview 直後はローディング中 → 700ms 待ってから操作。**「document changed」エラーは
   取り直しで回避**。
3. スナップショットは非同期で古くなることがある → **スクリーンショット**が実状態の下調で有効。
4. `setTimeout` は Code Mode では使えない → `browser.evaluate` 内
   `new Promise(r => setTimeout(r, N))` で待機をプロミス化する。
5. `.snapshot` の depth 上限は 20。a11y-ref は再描画（chips, seg, キー再構築）で失効。
6. スクリーンショットは `tabs.focus(tabID)` 後に撮る。
7. 予算/α/トグル/ドロップダウンは`dispatchEvent(new Event('input'/'change', {bubbles:true}))`。

## 7. 数式クイックリファレンス

```
e_i = odds_i / count_i      実効オッズ (まとめの最低オッズ÷点数)
S   = Σ 1/e_i               ≤1 で赤字回避可能
保険配分 x_i = B(1/e_i)/S    → 全行の最悪払戻 = B/S（均一）
gran_i = count_i × unit     1点あたり単位の実装刻み
攻撃配分: 保険 αB / 集中 (1−α)B を本命行 k へ
  本命中払戻 = 保険fp_k + e_k × y_k, y_k = floor(((1−α)B + 残)/gran_k) × gran_k
```

## 8. ユーザーの好み・対応方針

- 回答は**簡潔に**。計算ロジックの説明は要点箱文章＋実測値（例: ¥1,500 × 4点）で示すと好評。
- 数理の訂正は丁寧に（胴元控除・オッズ含意の話は納得度高め）。
- ファイル・ツール変更は事前提示 → 承認 → 実行のルールを**必ず守る**。
- GitHub 操作や外部サービスは最小限（過去実験は全rollback済み・現状クリーン）。
