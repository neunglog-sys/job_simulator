import {
  Buildings,
  ChatCircleDots,
  FileText,
  PlusCircle,
  SuitcaseSimple,
} from "@phosphor-icons/react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { NavigationMenuId } from "../../types/conversation";
import { NavigationMenuItem } from "./NavigationMenuItem";

const NAVIGATION_ITEMS = [
  { id: "conversation-list", label: "대화 목록", icon: ChatCircleDots, top: 0 },
  { id: "new-consultation", label: "새로운 상담하기", icon: PlusCircle, top: 72 },
  { id: "virtual-company", label: "가상 회사 입장하기", icon: Buildings, top: 152 },
  { id: "recommended-jobs", label: "추천 직무 확인하기", icon: SuitcaseSimple, top: 232 },
  { id: "final-report", label: "최종 리포트 보기", icon: FileText, top: 304 },
] as const;

type FixedNavigationMenuProps = {
  activeMenuId: NavigationMenuId;
  onSelect: (id: NavigationMenuId) => void;
};

export function FixedNavigationMenu({ activeMenuId, onSelect }: FixedNavigationMenuProps) {
  return (
    <nav className={styles.fixedNavigationMenu} aria-label="직무 상담 메뉴">
      {NAVIGATION_ITEMS.map((item) => (
        <NavigationMenuItem
          key={item.id}
          {...item}
          active={activeMenuId === item.id}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
