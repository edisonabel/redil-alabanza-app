import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export default function MotionNavIcon({ icon = '', active = false }) {
  const prefersReducedMotion = useReducedMotion();

  const springTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { type: 'spring', stiffness: 440, damping: 30, mass: 0.42 };

  return (
    <motion.div
      data-nav-icon
      className="w-6 h-6 mb-1 origin-center will-change-transform"
      initial={false}
      animate={
        prefersReducedMotion
          ? { scale: active ? 1.08 : 1, y: 0 }
          : { scale: active ? 1.13 : 1, y: active ? -1 : 0 }
      }
      whileTap={prefersReducedMotion ? undefined : { scale: 0.8, y: 1 }}
      transition={springTransition}
      dangerouslySetInnerHTML={{ __html: icon }}
    />
  );
}
