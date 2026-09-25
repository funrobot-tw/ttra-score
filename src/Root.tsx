import { useEffect, useState } from "react";
import App from "./App";
import AcademicApp from "./AcademicApp";
import { backendConfigured, isDemoMode } from "./supabase";
export default function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const academic = hash.startsWith("#/exam");
  useEffect(() => {
    document.title = academic
      ? "2026 TTRA｜檢定成績"
      : "2026 TTRA｜主題挑戰賽即時成績";
  }, [academic]);
  if (!backendConfigured && !isDemoMode)
    return (
      <div className={academic ? "academic-theme academic-shell" : ""}>
        <main className="page">
          <section className="panel auth-panel" role="status">
            <h1>系統尚未開放</h1>
            <p>正式賽事連線尚未設定完成，暫不開放查詢與工作人員操作。</p>
            <p className="muted">請等待主辦人公告，稍後再試。</p>
          </section>
        </main>
      </div>
    );
  return academic ? (
    <AcademicApp staffView={hash.endsWith("/staff")} />
  ) : (
    <App />
  );
}
