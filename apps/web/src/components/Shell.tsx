import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { IconHangar, IconScope, IconSpotters, IconSystem } from "../ui/icons";
import { useApp, type Tab } from "../state/app";
import { usePlanes } from "../state/planes";
import "../styles/shell.css";

const TABS: Array<{ id: Tab; label: string; Icon: typeof IconScope }> = [
  { id: "radar", label: "Scope", Icon: IconScope },
  { id: "hangar", label: "Hangar", Icon: IconHangar },
  { id: "social", label: "Spotters", Icon: IconSpotters },
  { id: "system", label: "System", Icon: IconSystem },
];

const LINK_COPY = {
  live: "Live",
  connecting: "Syncing",
  offline: "Link lost",
} as const;

/** The instrument bezel: status strip above, destination row below. */
export function Shell({ tab, children }: { tab: Tab; children: ReactNode }) {
  const go = useApp((s) => s.go);
  const link = usePlanes((s) => s.link);
  const contacts = usePlanes((s) => s.planes.size);

  return (
    <div className="shell">
      <header className="strip">
        <span className="strip__mark">
          <span className={`strip__led strip__led--${link}`} aria-hidden="true" />
          Aloft
        </span>
        <span className="strip__status">
          <span className={`strip__link strip__link--${link}`}>{LINK_COPY[link]}</span>
          {link === "live" && (
            <>
              <span className="strip__sep" aria-hidden="true" />
              <span className="strip__count">
                {contacts} <span className="unit">contacts</span>
              </span>
            </>
          )}
        </span>
      </header>

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
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              className={active ? "nav__item nav__item--on" : "nav__item"}
              aria-current={active ? "page" : undefined}
              onClick={() => go({ name: id })}
            >
              <Icon size={22} weight={active ? "fill" : "regular"} />
              <span className="nav__label">{label}</span>
              {active && (
                <motion.span
                  className="nav__marker"
                  layoutId="nav-marker"
                  transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
