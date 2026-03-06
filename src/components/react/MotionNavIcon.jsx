import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export default function MotionNavIcon({ icon = '', active = false }) {
  const prefersReducedMotion = useReducedMotion();

  const springTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 520, damping: 30, mass: 0.34 };

  return (
    <motion.div
      data-nav-icon
      className={`w-6 h-6 mb-1 transition-transform duration-300 ${active ? 'scale-110' : 'scale-100'}`}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.85 }}
      transition={springTransition}
      dangerouslySetInnerHTML={{ __html: icon }}
    />
  );
}
