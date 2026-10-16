import { useEffect, useState } from "react";

const PHONE = "(max-width: 700px)";

/** True while the viewport is phone-sized — panels become bottom sheets. */
export function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
