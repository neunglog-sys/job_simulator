import styles from "../../styles/oneToOneConversation.module.css";

type BrandLogoProps = {
  onClick: () => void;
};

export function BrandLogo({ onClick }: BrandLogoProps) {
  return (
    <button className={styles.brand} type="button" onClick={onClick} aria-label="JOBIVERSE 홈">
      <span className={styles.brandMark} aria-hidden="true">
        <span />
      </span>
      <span className={styles.brandWordmark}>JOBIVERSE</span>
    </button>
  );
}
