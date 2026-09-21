# 2026 TTRA 檢定與挑戰賽成績系統

提供「檢定專區」與「挑戰賽專區」，由主辦人的 Linkt 分別連入，不另做總首頁。React + TypeScript + Vite 靜態前端部署於 GitHub Pages；Supabase 負責登入、PostgreSQL、權限、即時同步。

本賽事為單人賽。挑戰賽先在工作台選擇比賽項目，CSV 只需「參賽編號、姓名」；系統從編號自動帶入組別與梯次。編號採「組別中文字＋梯次英文字母＋三位流水號」，例如幼A001、動B001、程C001、機A001。學科名單使用「參賽編號、姓名」。不顯示或記錄學校，匯入時拒絕額外欄位。正式資料庫初始名單由主辦人匯入；範本統一使用王小明作為虛構姓名。

## 本機操作

需要 Node.js 22.13 以上：

    npm ci
    npm run dev

系統只提供正式連線模式。沒有 Supabase 設定時顯示「系統尚未開放」，不提供模擬成績、免登入工作台或記憶體計分。建置缺少連線設定時會失敗。

複製 .env.example 為 .env.local，填入專案 URL 與 publishable key 即使用正式後端。不得放入 secret、service-role 或資料庫密碼。

## 入口與功能

- /#/challenge：挑戰賽家長端，無需登入。
- /#/challenge/staff：挑戰賽工作台。舊 /#/、/#/staff 仍可使用。
- /#/exam：檢定學科成績公告，無需登入。
- /#/exam/staff：學科登分與公布。
- 家長頁面不顯示工作人員入口；工作台連結由主辦人另外提供。知道網址仍須通過後端驗證，隱藏入口不是權限保護本身。
- 兩個工作台只要求共用 4 位數 PIN 碼，不要求裁判填寫帳號或 Email。網站會將 PIN 轉為符合 Supabase 規則的技術密碼，再由 Supabase 驗證固定技術身份；PIN 本身不放在前端或 GitHub。管理員可在挑戰賽工作台直接變更兩端共用 PIN。這項設計用於避免家長誤入，不應視為抵擋惡意攻擊的高強度登入。
- 登入狀態僅保留於目前頁面記憶體，重新整理、關閉再開需重新輸入密碼；正式資料仍保存在資料庫。
- 幼兒、動力、科創各 2 梯，程式 3 梯；兩端依梯次分段，也可篩選。各梯次單獨計算排名；家長端依編號排列且不顯示名次，工作人員端保留本梯名次供內部核對。
- 頂端人數統計只計目前組別的全部梯次，不因搜尋或梯次篩選改變。
- 四組固定計分、回合明細、排名、合格與未完成狀態。
- 報到、未報到、缺席、取消參賽；未報到不得送分。
- Realtime 加 10 秒補抓，離線禁止送分。
- 分組 CSV 匯入預覽、自動帶入組別、編號前綴與重複檢查、整批交易、不覆蓋原名單。
- 分組成績 CSV 匯出，防試算表公式注入。
- 本次使用共用工作人員管理權限，可處理挑戰賽與學科；資料庫保留分組裁判與報到角色的支援。
- 原值、新值、原因與時間的修改紀錄。共用密碼的操作者皆為同一技術身份，不能辨認個別裁判。
- 唯一請求 ID 防重送、預期版本防止並行覆寫。

## 學科成績公布

- 僅記錄 0–100 分（最多一位小數），不包含術科、線上考試、排名或合格判定。
- 管理員匯入獨立學科名單；管理員及獲授學科權限的裁判可以登分與公布。
- 預計 2026/10/04（日）10:00 公布僅為提示，不會到點自動公開。
- 按「公布全部學科成績」後先確認已登分／未登分人數，再一次公開全部已登分資料。
- 未登分不是 0 分；未登分者不列入公告。草稿存放於私有資料表，家長 API 無法取得。
- 公布後的修正仍先存草稿，須再次按公布才更新家長端，保留操作與修改紀錄。
- 挑戰賽維持送分即公開，不受學科公布按鈕影響。

## 上線與測試

長期 repository：[funrobot-tw/ttra-score](https://github.com/funrobot-tw/ttra-score)。2026/09/21 將原 repository 轉移至公司 Organization，保留原有提交紀錄；正式網站使用公司 GitHub Pages 網址，不提供示範部署。

家長入口（也可放入 Linkt）：

- [挑戰賽](https://funrobot-tw.github.io/ttra-score/#/challenge)
- [檢定學科](https://funrobot-tw.github.io/ttra-score/#/exam)

參閱 [DEPLOYMENT.md](DEPLOYMENT.md) 與 [RULES.md](RULES.md)。

    npm test
    npm run build

測試使用 PGlite 執行真正 PostgreSQL / PLpgSQL、RLS 與權限情境，不需要 Docker。正式 Supabase 密碼驗證、JWT、Realtime 與兩支手機賽前演練仍必須另外完成。

資料庫 public.results 是正式排名來源，前端 domain.ts 為測試與比對實作。公開資料不含裁判身份、內部備註或聯絡資料。

內部沿用 Team／teams／team_id 等初版識別名稱以維持介面相容，每筆實際代表個人，沒有團體或隊員資料。同名參賽者以不同參賽編號區分。含學校或缺少梯次的 CSV 不再接受，請下載目前範本後填寫。

## 檔案

- src/App.tsx：家長與工作人員介面。
- src/Root.tsx：兩個專區的 hash 路由。
- src/AcademicApp.tsx、src/academic.ts：學科工作台、公告及測試資料。
- src/ScoreForm.tsx：裁判表單、確認與修正。
- src/domain.ts：計分與驗證對照。
- src/data.ts：Supabase RPC 與訂閱。
- supabase/migrations/001_competition.sql：資料、權限、稽核與排名。
- supabase/migrations/002_heats_and_privacy.sql：梯次、移除學校、科創 40 秒。
- supabase/migrations/003_academic.sql：私有學科草稿與原子公布快照。
- supabase/migrations/004_participant_numbering.sql：A／B／C／D 組別編號格式與後端限制。
- supabase/migrations/005_heat_numbering.sql：以幼／動／程／機及 A／B／C 編入組別與梯次。
- supabase/migrations/006_rank_by_heat.sql：各梯次單獨計算名次。
- tests/：計分、CSV 與資料庫測試。
- .github/workflows/pages.yml：測試及部署。

本版不含公式自訂、多賽事模板、電子證書、獎品核銷、賽程自動安排與網頁碼表。

分享封面以內建影像生成工具製作，檔案為 public/og.png。提示詞：深森林綠、米白與萊姆色，極簡機器人競賽分享卡，文字為「2026 TTRA」「主題挑戰賽」「即時成績」。設定 VITE_SITE_URL 後才輸出絕對分享圖片網址。
