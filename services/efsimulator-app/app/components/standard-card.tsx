"use client";

import { useState } from "react";

/** Anonymous result artwork; it deliberately does not accept a Player entity. */
export function StandardCard() {
  const [failed, setFailed] = useState(false);
  return <div className="standard-card" role="img" aria-label="얼굴 사진·이름·오버롤이 없는 일반 선수 공통 카드">
    {failed ? <span className="standard-card-fallback">STANDARD</span> : <img
      src="/images/simulator/standard-card-170588-cdf8117dae82.png"
      alt="" aria-hidden="true" width="240" height="340" loading="lazy" decoding="async"
      onError={() => setFailed(true)}
    />}
  </div>;
}
