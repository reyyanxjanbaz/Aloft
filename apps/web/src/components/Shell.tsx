import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useApp, type Tab } from "../state/app";
import "../styles/shell.css";

/**
 * Bezel keys, as on a multi-function display: four bracketed abbreviations
 * along the bottom edge, the active one inverted to solid phosphor.
 *
 * `key` is what the bezel shows; `label` is what a screen reader announces,
 * because "HGR" is jargon that should never reach assistive tech.
 */
const TABS: Array<{ id: Tab; key: string; label: string }> = [
  { id: "radar", key: "SCOPE", label: "Scope" },
  { id: "hangar", key: "HGR", label: "Hangar" },
  { id: "social", key: "SPTR", label: "Spotters" },
  { id: "system", key: "SYS", label: "System" },
];

/** The instrument bezel. No status strip — link state lives on the scope now. */
export function Shell({ tab, children }: { tab: Tab; children: ReactNode }) {
  const go = useApp((s) => s.go);

  return (
    <div className="shell">
      <main className="shell__body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="shell__view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="nav" aria-label="Primary">
        {TABS.map(({ id, key, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              className={active ? "lsk-nav lsk-nav--on" : "lsk-nav"}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              onClick={() => go({ name: id })}
            >
              <span aria-hidden="true">
                <i className="lsk-nav__br">&rsaquo;</i>
                {key}
                <i className="lsk-nav__br">&lsaquo;</i>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
