import { useEffect, useState } from "react";
import { listAttributions, type ModelEntry } from "../features/reveal/modelRegistry";

/**
 * Attribution screen — a licensing requirement for CC-BY model and data
 * sources, not a nicety. Data credits are always shown; model credits appear
 * as the GLB library grows.
 */
export function Credits({ onClose }: { onClose: () => void }) {
  const [models, setModels] = useState<Array<ModelEntry & { key: string }>>([]);

  useEffect(() => {
    void listAttributions().then(setModels);
  }, []);

  return (
    <div className="credits" onClick={onClose}>
      <div className="credits__panel" onClick={(e) => e.stopPropagation()}>
        <button className="plane-card__close" onClick={onClose}>✕</button>
        <h2>Credits</h2>

        <h3>Flight data</h3>
        <p>
          Live aircraft positions from <strong>adsb.lol</strong> and <strong>airplanes.live</strong>, community ADS-B
          networks (non-commercial use). Aircraft and route details from <strong>adsbdb.com</strong>. Map tiles ©
          OpenStreetMap contributors, style by CARTO.
        </p>

        <h3>3D models</h3>
        {models.length === 0 ? (
          <p>
            Aircraft are currently rendered as original stylized models generated in-app. Licensed models added to the
            library will be credited here.
          </p>
        ) : (
          <ul className="credits__list">
            {models.map((m) => (
              <li key={m.key}>
                <strong>{m.key}</strong> — {m.author ?? "Unknown"}
                {m.license ? ` (${m.license})` : ""}
                {m.sourceUrl && (
                  <>
                    {" "}
                    <a href={m.sourceUrl} target="_blank" rel="noreferrer">source</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="credits__foot">Aloft is a fan project for aviation enthusiasts. Not for navigation.</p>
      </div>
    </div>
  );
}
