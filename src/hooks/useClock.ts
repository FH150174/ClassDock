import { useEffect, useState } from "react";
import { DateTime } from "luxon";

export function useClock() {
  const [now, setNow] = useState(() => DateTime.local());
  useEffect(() => {
    const update = () => setNow(DateTime.local());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  return now;
}
