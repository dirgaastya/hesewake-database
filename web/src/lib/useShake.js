import { useAnimate, useReducedMotion } from 'motion/react';

// Geleng kiri-kanan seperti layar login macOS saat master password salah (design system, Motion).
export function useShake() {
  const [scope, animate] = useAnimate();
  const reduce = useReducedMotion();
  const shake = () => {
    if (reduce || !scope.current) return;
    animate(scope.current, { x: [0, -8, 8, -6, 6, -3, 0] }, { duration: 0.36, ease: [0.22, 1, 0.36, 1] });
  };
  return [scope, shake];
}
