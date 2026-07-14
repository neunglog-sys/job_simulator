import type { CSSProperties } from "react";
import styles from "../../styles/scenarioGame.module.css";

type GameMapLayerProps = {
  imageUrl?: string;
};

type MapLayerStyle = CSSProperties & {
  "--scenario-map-image"?: string;
};

export function GameMapLayer({ imageUrl }: GameMapLayerProps) {
  const layerStyle: MapLayerStyle = imageUrl
    ? { "--scenario-map-image": `url("${imageUrl}")` }
    : {};

  return (
    <div className={styles.mapLayer} style={layerStyle} aria-hidden="true">
      <div className={styles.mapDepth} />
    </div>
  );
}
