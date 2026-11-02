import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 콘솔이 화면 네 귀퉁이를 모두 쓰므로 개발 표시기를 끕니다.
  // 기본 위치(왼쪽 아래)가 트랜스포트의 재생 버튼을 가립니다.
  // 컴파일·런타임 오류는 이 설정과 무관하게 그대로 표시됩니다.
  devIndicators: false,
};

export default nextConfig;
