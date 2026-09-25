export const EVENT_HOME = "https://ttra-2026-rules-m913aib.gamma.site";

export function EventNavigation({
  section,
  staffView,
}: {
  section: "challenge" | "exam";
  staffView: boolean;
}) {
  return (
    <nav className="event-navigation" aria-label="賽事導覽">
      <a
        className="event-nav-button"
        href={section === "exam" ? "#/challenge" : "#/exam"}
      >
        {section === "exam" ? "挑戰賽專區" : "檢定專區"}
      </a>
      {staffView && (
        <a className="event-nav-button" href={`#/${section}`}>
          家長看成績
        </a>
      )}
      <a className="event-nav-button event-home-button" href={EVENT_HOME}>
        賽事資料首頁
      </a>
    </nav>
  );
}
