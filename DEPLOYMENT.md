# 上線與賽前演練

完成以下設定與演練後，才可用於正式比賽。

## Supabase

1. 建立專用專案，勿將 migration 套至其他正在使用的資料庫。
2. 新專案依序在 SQL Editor 執行 supabase/migrations/001_competition.sql、002_heats_and_privacy.sql、003_academic.sql、004_participant_numbering.sql、005_heat_numbering.sql、006_rank_by_heat.sql，各一次；不要重跑已套用的 migration。002 會移除既有學校欄及稽核中的學校資料，並將既有參賽者暫設第 1 梯；004 建立舊編號限制，005 將舊編號依既有組別與梯次轉為幼A001／動A001／程A001／機A001格式，再要求編號中的組別與梯次必須符合資料欄位；006 改為各梯次單獨計算名次。新匯入的 CSV 只填參賽編號與姓名。
3. API Exposed schemas 保持 public，不要暴露 private。
4. Auth 設定關閉公開註冊與匿名登入。不能只隱藏前端註冊按鈕；後端也必須禁止註冊。
5. Auth / Users 由專案擁有者手動新增固定技術身份 `staff@ttra-score.invalid`，設為已確認，並先設定符合 Supabase 規則的初始密碼。這不是個人信箱，不寄邀請信，也不需要裁判填 Email；此登入流程不使用 SMTP。管理員第一次以初始密碼進入挑戰賽工作台後，使用「變更 PIN」設定兩端共用的 4 位數 PIN。資料庫管理密碼和工作人員 PIN 必須不同，且 PIN 只適合防止家長誤入。
6. 前端只收共用密碼，Supabase Auth 驗證固定技術身份。身份名稱是公開識別字，不是秘密；密碼、資料庫密碼、service-role key 都不可放入 GitHub、前端環境變數或對話。
7. 由 SQL Editor 為已建立的 Auth user 加入角色，替換 UUID：

       insert into private.staff_roles(user_id,role,category_ids)
       values ('AUTH-USER-UUID','admin','{}');

   本次所有工作人員共用管理權限，可報到、匯入、登分、公布學科與查看稽核。角色由專案擁有者管理，前端不能自行升權。共用身份無法辨識個別裁判；若未來需要分工或責任追蹤，再改個別身份。

8. 確認 event_state 已加入 supabase_realtime publication；migration 會自動加入。只推播版本變更，家長端再讀安全快照。內部表格不公開。
9. 取得 Project URL 與 publishable key，不將機密放入前端。

登入狀態僅在頁面記憶體保留，不寫入 localStorage；重新整理或關閉頁面需再輸入密碼。密碼只交付工作人員，定期更換；若洩漏，先移除該身份的資料庫角色阻止操作，再更換密碼並處理既有工作階段。不能假設改密碼會立即使所有已簽發 JWT 失效。

參考：[密碼登入](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## GitHub Pages

### 裁判／選手雙方確認（015）

先發布支援兩個確認按鈕的前端，再在既有 Supabase 執行 `015_dual_score_confirmation.sql` 一次。後端拒絕缺少任一確認的新送分與修正，但保留已成功請求的安全重試行為。確認資訊只寫入私有稽核紀錄與原有請求紀錄，不新增公開選手資料；既有分數、報到、飲料與獎項均不更動。各裁判裝置需重新整理，新版的第二方確認後自動送出；不得只隱藏舊「送出」按鈕而省略後端更新。

### 挑戰規則與比例佳作（013、014）

於既有專案依序執行 `013_program_time_and_failure_reasons.sql`、`014_percentage_merit_awards.sql`，各一次，再發布對應前端。程式組完成時限與合格門檻均為 25 秒；動力組仍為 30 秒、拉推皆有有效成績且任一回合至少 7 瓶。動力與程式新增「飲料罐掉落」原因，未完成秒數仍可留空或不受競賽上限限制。原成績紀錄保留，程式組既有超過 25 秒者不計有效成績。

獎項改為每梯前三名，佳作為 `max(0, ceil(本梯全部名單人數 / 2) - 3)`；舊固定名額設定停止使用，旧版寫入會提示重新整理。已公布獎項仍保留原快照，不自動重新公告。各梯／全賽事公布均儲存當下計算後的名額；名單或成績變更使舊預覽失效，同分跨界仍須主辦單位裁定。此更新不更動名單、報到、飲料、學科資料或歷史獎狀快照。

### 檢定家長端隱私更新（012）

先發布支援合格結果的前端，再於既有專案執行 `supabase/migrations/012_academic_public_privacy.sql`。此更新不變動名單、分數及公布狀態；公開 RPC 僅回傳第二字為 `o` 的姓名與 `passed`（已公布分數 ≥ 80），並撤銷家長直接讀取原始成績表的權限。裁判仍透過授權工作台取得完整姓名與數字分數。已開啟的舊頁面請重新整理。

長期使用的 repository 為 `funrobot-tw/ttra-score`。2026/09/21 從個人帳號轉移至公司 Organization，使用公司 GitHub Pages 網址，不部署示範版。

Supabase 原專案 `ydwspournjyxsupuaqbs` 已轉入公司 `funrobot-tw` Organization（`bongyuyqyubrlhkigdew`），沒有重建資料庫或重跑 migration；原專案 URL、公開連線設定、Auth、角色、成績與歷史紀錄沿用。GitHub Pages 舊網址不會自動轉址，Linkt 與已分享連結需改用以下公司網址。兩邊維持 Free 方案，目前仍由原管理員登入帳號管理公司 Organization。

1. 本資料夾內容放在 repository 根目錄，預設 branch 為 main；不提交 `.env.local`、真實參賽名單、私密金鑰或 `node_modules`。
2. Settings / Pages：Source 選 GitHub Actions。
3. Settings / Secrets and variables / Actions / Variables：
   - 新增 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`，只能填公開連線資訊。
   - 工作流程固定使用 production，不再讀取 repository 的 `DEPLOYMENT_MODE`；可刪除舊的 demo 變數。
4. Push main 或手動啟動工作流程，先測試與型別檢查再部署。缺少連線設定或使用非 production 建置會拒絕部署。更改 Variables 後需重新執行工作流程才會生效。自動測試使用隔離的虛構資料，不連線正式資料庫。
5. 使用帳號根站台或自訂網域時，將 workflow 的 VITE_SITE_URL 改為正確網址。

Linkt 放入兩個家長端連結：

- 挑戰賽：https://funrobot-tw.github.io/ttra-score/#/challenge
- 檢定：https://funrobot-tw.github.io/ttra-score/#/exam

工作人員分別使用 /#/challenge/staff 與 /#/exam/staff。舊 /#/、/#/staff 保留相容。

## 賽前必要驗收

- 家長頁沒有工作人員入口；直接開工作台網址仍須輸入密碼。錯誤密碼、沒有角色或匿名 API 請求都不能操作工作台或取得私有草稿。
- 在兩個工作台驗證 PIN 登入、登出、重新整理後重新登入；登出後不可顯示原工作台內容。不要將共用 PIN 分享至家長群組。
- 一支裁判手機與一支家長手機，使用 4G／5G。
- 名單匯入、報到、四組各送分，確認家長端同步。
- 確認兩端都依梯次分段；各梯次單獨計算排名，家長端依編號排列且不顯示名次，工作人員端保留本梯名次，頂端人數僅屬於目前項目。
- 學科匯入、登錄 0 分與其他分數；未公布前，以匿名及未授權帳號確認 API 取不到草稿。
- 手動公布前核對已登分與未登分人數；公布後所有已登分者同時可見，未登分不顯示為 0。
- 公布後修正一人成績，家長仍看到舊版；再次手動公布後才更新。10/04 10:00 不會自動公布。
- 超限值、未報到、權限不足、重複編號及錯誤組別前綴必須拒絕。
- 修正成績、確認新排名與原始版本紀錄。
- 兩支裁判手機編輯同回合，後送者應提示版本衝突。
- 切飛航模式後禁止送出，恢復後重試不重複入帳。
- 重整、關閉再開、另一裝置均可讀到正式資料。
- 使用 120 位參賽者及至少 100 個並行讀取用戶做正式環境負載演練，監看 Supabase 配額與延遲。本地測試不等同公網容量保證。
- 賽前備份資料庫並保留紙本備援，競賽期間凍結程式與規則變更。

## 限制

無離線記分，完全斷網時須採現場備援。挑戰賽每 10 秒檢查版本，有變動才取完整快照；學科每 10 秒補抓，並以 Realtime 加速公布通知。正式容量仍須演練確認。
挑戰賽公開遮罩姓名／參賽編號／組別／梯次／報到／成績；學科只公開已公布的遮罩姓名／參賽編號／合格或不合格及公布時間，不提供數字分數。不記錄學校，勿上傳電話、家長聯絡方式等額外個資；匯入前須確認可公開的資料範圍。示範與範本姓名皆為虛構，正式匯入前請替換。
已有成績的參賽者不能直接撤銷報到，需由管理員先處理成績。
取消資格、重賽等非常態事件由主辦人裁決，本版不自動處理。
PGlite 測試不取代正式 Supabase 密碼登入、JWT、Realtime、公網延遲驗證。
