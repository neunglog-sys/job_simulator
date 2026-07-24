import {
  ArrowLeft,
  Briefcase,
  Camera,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  Compass,
  DownloadSimple,
  FilePdf,
  Files,
  FileText,
  GameController,
  House,
  IdentificationCard,
  Key,
  LockKey,
  List,
  MapPin,
  ShieldCheck,
  SignOut,
  SpinnerGap,
  Trash,
  UploadSimple,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";
import { FRONTEND_ENDPOINTS } from "../config/endpoints";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
import {
  changeProfilePassword,
  deleteProfileDocument,
  downloadProfileDocument,
  fetchConsultations,
  fetchPolicyProfile,
  fetchProfileAvatar,
  fetchProfileDocuments,
  fetchReportPdfBlob,
  fetchReports,
  fetchSimulationSummaries,
  updateProfileAccount,
  updatePolicyProfile,
  uploadProfileAvatar,
  uploadProfileDocument,
  type ConsultationSummary,
  type PolicyProfile,
  type PolicyProfileGender,
  type PolicyProfileUpdate,
  type Report,
  type SimulationSummary,
  type UserDocument,
  type UserDocumentKind,
} from "../lib/api";
import { logout, refreshAuth, useAuth } from "../lib/auth";
import styles from "../styles/myPage.module.css";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const MY_PAGE_DESIGN_WIDTH = 1920;
const MY_PAGE_DESIGN_HEIGHT = 900;
const POLICY_BIRTH_YEAR_MIN = 1900;
const POLICY_BIRTH_YEAR_MAX = 2026;
const POLICY_REGION_CTPV = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

type MyPageStageStyle = CSSProperties & {
  "--my-page-scale": number;
};

const DOCUMENT_META: Record<
  UserDocumentKind,
  { label: string; description: string; icon: typeof FilePdf }
> = {
  resume: {
    label: "이력서",
    description: "지원과 상담에 활용할 최신 이력서",
    icon: FilePdf,
  },
  portfolio: {
    label: "포트폴리오",
    description: "프로젝트와 작업 결과를 담은 문서",
    icon: Briefcase,
  },
  other: {
    label: "기타 서류",
    description: "자격증, 수료증 등 참고 문서",
    icon: Files,
  },
};

type MyPageSection = "documents" | "account" | "activity";
type ScenarioNavigationState = "idle" | "loading" | "missing" | "error";
type PolicyDisabilitySelection = "" | "yes" | "no";

type PolicyProfileForm = {
  birthYear: string;
  gender: "" | PolicyProfileGender;
  regionCtpv: string;
  regionSgg: string;
  hasDisability: PolicyDisabilitySelection;
  sensitiveAgreed: boolean;
};

const EMPTY_POLICY_PROFILE_FORM: PolicyProfileForm = {
  birthYear: "",
  gender: "",
  regionCtpv: "",
  regionSgg: "",
  hasDisability: "",
  sensitiveAgreed: false,
};

function policyProfileToForm(profile: PolicyProfile): PolicyProfileForm {
  return {
    birthYear: profile.birth_year?.toString() ?? "",
    gender: profile.gender ?? "",
    regionCtpv: profile.region_ctpv ?? "",
    regionSgg: profile.region_sgg ?? "",
    hasDisability:
      profile.has_disability === null ? "" : profile.has_disability ? "yes" : "no",
    sensitiveAgreed: Boolean(
      profile.has_disability !== null && profile.sensitive_agreed_at,
    ),
  };
}

type ActivityItem = {
  id: string;
  kind: "consultation" | "simulation" | "report";
  title: string;
  description: string;
  createdAt: string;
  status: string;
  consultation?: ConsultationSummary;
  simulation?: SimulationSummary;
  report?: Report;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";
}

type UploadZoneProps = {
  kind: UserDocumentKind;
  busy: boolean;
  prominent?: boolean;
  onSelect: (kind: UserDocumentKind, file: File) => void;
};

function UploadZone({ kind, busy, prominent = false, onSelect }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const meta = DOCUMENT_META[kind];
  const Icon = meta.icon;

  const acceptDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file) onSelect(kind, file);
  };

  return (
    <div
      className={`${styles.uploadZone} ${prominent ? styles.uploadZoneProminent : ""} ${
        dragging ? styles.uploadZoneDragging : ""
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={acceptDrop}
    >
      {prominent && (
        <>
          <div className={styles.uploadPlanet} aria-hidden="true">
            <span className={styles.planetAura} />
            <span className={styles.planetOuterOrbit}>
              <i />
              <i />
              <i />
            </span>
            <span className={`${styles.planetStar} ${styles.planetStarLarge}`} />
            <span className={`${styles.planetStar} ${styles.planetStarSmall}`} />
            <span className={`${styles.planetDot} ${styles.planetDotTop}`} />
            <span className={`${styles.planetDot} ${styles.planetDotBottom}`} />
            <span className={`${styles.planetTiltRing} ${styles.planetTiltRingBack}`} />
            <span className={styles.planetBody}>
              <span className={styles.planetBands} />
              <span className={styles.planetLight} />
            </span>
            <span className={`${styles.planetTiltRing} ${styles.planetTiltRingFront}`} />
          </div>
          <div className={styles.uploadDocumentOrbit} aria-hidden="true">
            <span className={styles.orbitDocumentIcon}>
              <FileText weight="duotone" />
            </span>
            <span className={styles.orbitRingPrimary} />
            <span className={styles.orbitRingSecondary} />
            <span className={styles.orbitTrail} />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      )}
      <span className={styles.uploadIcon} aria-hidden="true">
        <Icon weight="duotone" />
      </span>
      <div className={styles.uploadCopy}>
        <span className={styles.uploadEyebrow}>{prominent ? "이력서" : "추가 문서"}</span>
        <h2 id={prominent ? "upload-title" : undefined}>{prominent ? "이력서 PDF 업로드" : meta.label}</h2>
        <p>{meta.description}</p>
      </div>
      <small>PDF 파일, 최대 8MB</small>
      <button
        className={styles.uploadButton}
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <SpinnerGap className={styles.spinner} aria-hidden="true" /> : <UploadSimple aria-hidden="true" />}
        {busy ? "업로드 중" : "PDF 선택"}
      </button>
      <input
        ref={inputRef}
        className={styles.fileInput}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0);
          if (file) onSelect(kind, file);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

export function MyPage() {
  const auth = useAuth();
  const [stageScale, setStageScale] = useState(() => {
    if (typeof window === "undefined") return 1;
    return Math.min(
      1,
      window.innerWidth / MY_PAGE_DESIGN_WIDTH,
      window.innerHeight / MY_PAGE_DESIGN_HEIGHT,
    );
  });
  const [activeSection, setActiveSection] = useState<MyPageSection>("documents");
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingKind, setUploadingKind] = useState<UserDocumentKind | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [scenarioNavigationState, setScenarioNavigationState] =
    useState<ScenarioNavigationState>("idle");
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const recentScenarioRedirectRef = useRef<number | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);

  const [profileName, setProfileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [policyProfile, setPolicyProfile] = useState<PolicyProfile | null>(null);
  const [policyProfileForm, setPolicyProfileForm] = useState<PolicyProfileForm>(
    EMPTY_POLICY_PROFILE_FORM,
  );
  const [policyProfileLoading, setPolicyProfileLoading] = useState(false);
  const [savingPolicyProfile, setSavingPolicyProfile] = useState(false);
  const [policyProfileNotice, setPolicyProfileNotice] = useState<string | null>(null);
  const [policyProfileError, setPolicyProfileError] = useState<string | null>(null);

  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [simulations, setSimulations] = useState<SimulationSummary[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const me = auth.status === "authed" ? auth.me : null;
  const userId = me?.id ?? null;

  const applyPolicyProfile = useCallback((profile: PolicyProfile) => {
    setPolicyProfile(profile);
    setPolicyProfileForm(policyProfileToForm(profile));
  }, []);

  const policyProfileChanges = useMemo<PolicyProfileUpdate>(() => {
    if (!policyProfile) return {};

    const changes: PolicyProfileUpdate = {};
    const birthYear = policyProfileForm.birthYear.trim()
      ? Number(policyProfileForm.birthYear)
      : null;
    const gender = policyProfileForm.gender || null;
    const regionCtpv = policyProfileForm.regionCtpv.trim() || null;
    const regionSgg = policyProfileForm.regionSgg.trim() || null;
    const hasDisability =
      policyProfileForm.hasDisability === ""
        ? null
        : policyProfileForm.hasDisability === "yes";

    if (birthYear !== policyProfile.birth_year) changes.birth_year = birthYear;
    if (gender !== policyProfile.gender) changes.gender = gender;
    if (regionCtpv !== policyProfile.region_ctpv) changes.region_ctpv = regionCtpv;
    if (regionSgg !== policyProfile.region_sgg) changes.region_sgg = regionSgg;
    if (hasDisability !== policyProfile.has_disability) {
      changes.has_disability = hasDisability;
      if (hasDisability !== null) {
        changes.sensitive_agreed = policyProfileForm.sensitiveAgreed;
      }
    }

    return changes;
  }, [policyProfile, policyProfileForm]);

  const hasPolicyProfileChanges = Object.keys(policyProfileChanges).length > 0;
  const hasStoredSensitiveConsent = Boolean(
    policyProfile?.has_disability !== null && policyProfile?.sensitive_agreed_at,
  );

  const showAvatar = useCallback((blob: Blob) => {
    if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
    const nextUrl = URL.createObjectURL(blob);
    avatarObjectUrlRef.current = nextUrl;
    setAvatarUrl(nextUrl);
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocuments(await fetchProfileDocuments());
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const [consultationRows, simulationRows, reportRows] = await Promise.all([
        fetchConsultations(),
        fetchSimulationSummaries(),
        fetchReports(),
      ]);
      setConsultations(consultationRows);
      setSimulations(simulationRows);
      setReports(reportRows);
      setActivityLoaded(true);
    } catch (loadError) {
      setActivityError(errorMessage(loadError));
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    const updateScale = () => {
      setStageScale(
        Math.min(
          1,
          window.innerWidth / MY_PAGE_DESIGN_WIDTH,
          window.innerHeight / MY_PAGE_DESIGN_HEIGHT,
        ),
      );
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    if (me) setProfileName(me.name);
  }, [me]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setPolicyProfileLoading(true);
    setPolicyProfileError(null);

    void fetchPolicyProfile()
      .then((profile) => {
        if (active) applyPolicyProfile(profile);
      })
      .catch((loadError) => {
        if (active) setPolicyProfileError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setPolicyProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applyPolicyProfile, userId]);

  useEffect(() => {
    if (!me) return;
    let active = true;
    void fetchProfileAvatar()
      .then((blob) => {
        if (active && blob) showAvatar(blob);
      })
      .catch(() => {
        if (active) setAvatarMessage("프로필 이미지를 불러오지 못했어요.");
      });
    return () => {
      active = false;
    };
  }, [me, showAvatar]);

  useEffect(() => () => {
    if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!isHeaderMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!headerMenuRef.current?.contains(event.target as Node)) setIsHeaderMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsHeaderMenuOpen(false);
      headerMenuButtonRef.current?.focus();
    };
    window.document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isHeaderMenuOpen]);

  useEffect(() => {
    if (isHeaderMenuOpen) return;
    if (recentScenarioRedirectRef.current !== null) {
      window.clearTimeout(recentScenarioRedirectRef.current);
      recentScenarioRedirectRef.current = null;
    }
    setScenarioNavigationState("idle");
  }, [isHeaderMenuOpen]);

  useEffect(() => () => {
    if (recentScenarioRedirectRef.current !== null) {
      window.clearTimeout(recentScenarioRedirectRef.current);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "activity" && !activityLoaded && !activityLoading) {
      void loadActivity();
    }
  }, [activeSection, activityLoaded, activityLoading, loadActivity]);

  const handleUpload = async (kind: UserDocumentKind, file: File) => {
    setNotice(null);
    setError(null);
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("PDF 파일만 업로드할 수 있어요.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("PDF는 최대 8MB까지 업로드할 수 있어요.");
      return;
    }

    setUploadingKind(kind);
    try {
      const uploaded = await uploadProfileDocument(kind, file);
      setDocuments((current) => [uploaded, ...current]);
      setNotice(`${DOCUMENT_META[kind].label}가 안전하게 저장됐어요.`);
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setUploadingKind(null);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setAvatarMessage(null);
    if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
      setAvatarMessage("JPG, PNG, WEBP 이미지만 등록할 수 있어요.");
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarMessage("프로필 이미지는 최대 5MB까지 등록할 수 있어요.");
      return;
    }

    setAvatarBusy(true);
    try {
      await uploadProfileAvatar(file);
      showAvatar(file);
      setAvatarMessage("프로필 이미지가 저장됐어요.");
    } catch (uploadError) {
      setAvatarMessage(errorMessage(uploadError));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleDownload = async (document: UserDocument) => {
    setError(null);
    try {
      const blob = await downloadProfileDocument(document.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.original_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    }
  };

  const handleDownloadReport = async (report: Report) => {
    setError(null);
    try {
      const blob = await fetchReportPdfBlob(report.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `진로리포트_${report.id}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    }
  };

  const handleDelete = async (documentId: number) => {
    setDeletingId(documentId);
    setError(null);
    try {
      await deleteProfileDocument(documentId);
      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setConfirmDeleteId(null);
      setNotice("문서를 삭제했어요.");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const handleProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = profileName.trim();
    setAccountNotice(null);
    setAccountError(null);
    if (!nextName) {
      setAccountError("이름을 입력해주세요.");
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfileAccount(nextName);
      await refreshAuth();
      setAccountNotice("회원 정보가 저장됐어요.");
    } catch (saveError) {
      setAccountError(errorMessage(saveError));
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePolicyProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPolicyProfileNotice(null);
    setPolicyProfileError(null);

    if (!policyProfile) {
      setPolicyProfileError("맞춤 제도 정보를 불러온 뒤 다시 시도해주세요.");
      return;
    }

    const birthYearText = policyProfileForm.birthYear.trim();
    if (birthYearText) {
      const birthYear = Number(birthYearText);
      if (
        !Number.isInteger(birthYear) ||
        birthYear < POLICY_BIRTH_YEAR_MIN ||
        birthYear > POLICY_BIRTH_YEAR_MAX
      ) {
        setPolicyProfileError(
          `출생 연도는 ${POLICY_BIRTH_YEAR_MIN}-${POLICY_BIRTH_YEAR_MAX} 사이로 입력해주세요.`,
        );
        return;
      }
    }

    if (policyProfileForm.regionSgg.trim() && !policyProfileForm.regionCtpv) {
      setPolicyProfileError("시군구를 입력하려면 시도를 먼저 선택해주세요.");
      return;
    }

    const disabilityChanged = Object.prototype.hasOwnProperty.call(
      policyProfileChanges,
      "has_disability",
    );
    if (
      disabilityChanged &&
      policyProfileChanges.has_disability !== null &&
      !policyProfileForm.sensitiveAgreed
    ) {
      setPolicyProfileError("장애 여부를 저장하려면 민감정보 저장에 동의해주세요.");
      return;
    }

    if (!hasPolicyProfileChanges) {
      setPolicyProfileNotice("변경된 맞춤 제도 정보가 없어요.");
      return;
    }

    setSavingPolicyProfile(true);
    try {
      const saved = await updatePolicyProfile(policyProfileChanges);
      applyPolicyProfile(saved);
      setPolicyProfileNotice("맞춤 제도 정보가 저장됐어요.");
    } catch (saveError) {
      setPolicyProfileError(errorMessage(saveError));
    } finally {
      setSavingPolicyProfile(false);
    }
  };

  const handlePasswordSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountNotice(null);
    setAccountError(null);
    if (newPassword.length < 8) {
      setAccountError("새 비밀번호는 8자 이상 입력해주세요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setAccountError("새 비밀번호가 서로 일치하지 않아요.");
      return;
    }

    setSavingPassword(true);
    try {
      await changeProfilePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setAccountNotice("비밀번호가 안전하게 변경됐어요.");
    } catch (saveError) {
      setAccountError(errorMessage(saveError));
    } finally {
      setSavingPassword(false);
    }
  };

  const activityItems = useMemo<ActivityItem[]>(() => {
    const consultationItems: ActivityItem[] = consultations.map((consultation) => ({
      id: `consultation-${consultation.id}`,
      kind: "consultation",
      title: consultation.title || "새로운 상담",
      description: consultation.preview || "아직 나눈 대화가 없어요.",
      createdAt: consultation.updated_at || consultation.created_at,
      status: consultation.status === "completed" ? "상담 완료" : "상담 중",
      consultation,
    }));
    const simulationItems: ActivityItem[] = simulations.map((simulation) => ({
      id: `simulation-${simulation.id}`,
      kind: "simulation",
      title: simulation.scenario_title,
      description: simulation.module || "가상 회사 직무 체험",
      createdAt: simulation.created_at,
      status:
        simulation.status === "completed"
          ? "체험 완료"
          : simulation.status === "active"
            ? "진행 중"
            : "종료됨",
      simulation,
    }));
    const reportItems: ActivityItem[] = reports.map((report) => ({
      id: `report-${report.id}`,
      kind: "report",
      title: report.kind_label,
      description:
        report.status === "done"
          ? "탭하면 PDF로 다운로드해요."
          : report.status === "failed"
            ? "리포트 생성에 실패했어요."
            : "리포트를 생성하고 있어요.",
      createdAt: report.created_at,
      status: report.status === "done" ? "완료" : report.status === "failed" ? "실패" : "생성 중",
      report,
    }));

    return [...consultationItems, ...simulationItems, ...reportItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12);
  }, [consultations, simulations, reports]);

  const openActivity = (item: ActivityItem) => {
    if (item.kind === "simulation" && item.simulation) {
      if (item.simulation.status === "active") {
        window.sessionStorage.setItem(
          `sim:${item.simulation.scenario_slug}`,
          String(item.simulation.id),
        );
      }
      window.location.assign(
        `${FRONTEND_ENDPOINTS.scenario}?slug=${encodeURIComponent(item.simulation.scenario_slug)}`,
      );
      return;
    }
    if (item.kind === "report" && item.report) {
      if (item.report.status !== "done") {
        setNotice(
          item.report.status === "failed"
            ? "리포트 생성에 실패했어요."
            : "리포트를 생성하고 있어요. 잠시 후 다시 시도해주세요.",
        );
        return;
      }
      void handleDownloadReport(item.report);
      return;
    }
    window.location.assign(FRONTEND_ENDPOINTS.conversation);
  };

  const handleRecentScenarioOpen = async () => {
    if (scenarioNavigationState === "loading") return;

    if (recentScenarioRedirectRef.current !== null) {
      window.clearTimeout(recentScenarioRedirectRef.current);
      recentScenarioRedirectRef.current = null;
    }
    setScenarioNavigationState("loading");
    try {
      const recentSimulations = await fetchSimulationSummaries();
      setSimulations(recentSimulations);
      const latestSimulation = recentSimulations[0];

      if (!latestSimulation) {
        setScenarioNavigationState("missing");
        recentScenarioRedirectRef.current = window.setTimeout(() => {
          recentScenarioRedirectRef.current = null;
          window.location.assign(FRONTEND_ENDPOINTS.conversation);
        }, 1400);
        return;
      }

      if (latestSimulation.status === "active") {
        window.sessionStorage.setItem(
          `sim:${latestSimulation.scenario_slug}`,
          String(latestSimulation.id),
        );
      }

      window.location.assign(
        `${FRONTEND_ENDPOINTS.scenario}?slug=${encodeURIComponent(
          latestSimulation.scenario_slug,
        )}`,
      );
    } catch {
      setScenarioNavigationState("error");
    }
  };

  const initial = me?.name.trim().charAt(0) || "나";
  const resumeCount = documents.filter((document) => document.kind === "resume").length;
  const activityCount = consultations.length + simulations.length + reports.length;

  return (
    <main className={styles.page}>
      <div className={styles.background} aria-hidden="true" />
      <div
        className={styles.stage}
        style={{ "--my-page-scale": stageScale } as MyPageStageStyle}
      >
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button className={styles.headerIconButton} type="button" onClick={() => window.history.back()} aria-label="이전 화면으로 이동" data-tooltip="뒤로가기">
              <ArrowLeft weight="bold" />
            </button>
            <a className={styles.headerIconButton} href={FRONTEND_ENDPOINTS.home} aria-label="홈으로 이동" data-tooltip="홈">
              <House weight="regular" />
            </a>
            <a href={FRONTEND_ENDPOINTS.home} aria-label="JOBIVERSE 홈으로 이동">
              <span className={styles.brandMark} aria-hidden="true"><span /></span>
              <strong>JOBIVERSE</strong>
            </a>
          </div>
          <div className={styles.headerPrivacy}>
            <LockKey weight="duotone" aria-hidden="true" />
            <div>
              <strong>내 자료는 나만 볼 수 있어요</strong>
              <span>로그인한 계정에서만 열고 내려받을 수 있습니다.</span>
            </div>
          </div>
          <nav className={styles.topBarActions} aria-label="마이페이지 메뉴">
            <button className={styles.headerIconButton} type="button" onClick={() => setIsLogoutConfirmOpen(true)} aria-label="로그아웃" data-tooltip="로그아웃">
              <SignOut weight="regular" />
            </button>
            <div className={styles.headerMenu} ref={headerMenuRef}>
              <button
                ref={headerMenuButtonRef}
                className={`${styles.headerIconButton} ${
                  isHeaderMenuOpen ? styles.headerIconButtonActive : ""
                }`}
                type="button"
                aria-label={isHeaderMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
                aria-expanded={isHeaderMenuOpen}
                data-tooltip="메뉴"
                onClick={() => {
                  setScenarioNavigationState("idle");
                  setIsHeaderMenuOpen((open) => !open);
                }}
              >
                <List weight="bold" />
              </button>
              {isHeaderMenuOpen && (
                <div className={styles.headerMenuPopover} role="menu">
                  <div className={styles.headerMenuHeading}>
                    <span><Compass weight="duotone" /> JOBIVERSE MENU</span>
                    <strong>빠른 이동</strong>
                  </div>

                  <span className={styles.headerMenuGroupLabel}>마이페이지</span>
                  <button
                    className={`${styles.headerMenuItem} ${
                      activeSection === "documents" ? styles.headerMenuItemActive : ""
                    }`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveSection("documents");
                      setIsHeaderMenuOpen(false);
                    }}
                  >
                    <span className={styles.headerMenuItemIcon}><Files weight="duotone" /></span>
                    <span>
                      <strong>문서 보관함</strong>
                      <small>이력서와 증빙 서류를 관리해요</small>
                    </span>
                  </button>
                  <button
                    className={`${styles.headerMenuItem} ${
                      activeSection === "account" ? styles.headerMenuItemActive : ""
                    }`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveSection("account");
                      setIsHeaderMenuOpen(false);
                    }}
                  >
                    <span className={styles.headerMenuItemIcon}>
                      <IdentificationCard weight="duotone" />
                    </span>
                    <span>
                      <strong>회원 정보</strong>
                      <small>기본 정보와 맞춤 조건을 관리해요</small>
                    </span>
                  </button>
                  <button
                    className={`${styles.headerMenuItem} ${
                      activeSection === "activity" ? styles.headerMenuItemActive : ""
                    }`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveSection("activity");
                      setIsHeaderMenuOpen(false);
                    }}
                  >
                    <span className={styles.headerMenuItemIcon}>
                      <GameController weight="duotone" />
                    </span>
                    <span>
                      <strong>활동 기록</strong>
                      <small>상담·체험·리포트를 모아봐요</small>
                    </span>
                  </button>

                  <div className={styles.headerMenuDivider} />
                  <span className={styles.headerMenuGroupLabel}>서비스</span>
                  <button
                    className={styles.headerMenuItem}
                    type="button"
                    role="menuitem"
                    onClick={() => window.location.assign(FRONTEND_ENDPOINTS.home)}
                  >
                    <span className={styles.headerMenuItemIcon}><House weight="duotone" /></span>
                    <span>
                      <strong>홈</strong>
                      <small>JOBIVERSE 시작 화면으로 이동해요</small>
                    </span>
                  </button>
                  <button
                    className={styles.headerMenuItem}
                    type="button"
                    role="menuitem"
                    onClick={() => window.location.assign(FRONTEND_ENDPOINTS.conversation)}
                  >
                    <span className={styles.headerMenuItemIcon}>
                      <ChatCircleDots weight="duotone" />
                    </span>
                    <span>
                      <strong>1:1 화면</strong>
                      <small>AI 커리어 코치와 상담을 이어가요</small>
                    </span>
                  </button>
                  <button
                    className={styles.headerMenuItem}
                    type="button"
                    role="menuitem"
                    disabled={scenarioNavigationState === "loading"}
                    onClick={() => void handleRecentScenarioOpen()}
                  >
                    <span className={styles.headerMenuItemIcon}>
                      {scenarioNavigationState === "loading" ? (
                        <SpinnerGap className={styles.spinner} />
                      ) : (
                        <GameController weight="duotone" />
                      )}
                    </span>
                    <span>
                      <strong>
                        {scenarioNavigationState === "loading"
                          ? "최근 체험 확인 중"
                          : "시나리오 화면"}
                      </strong>
                      <small>가장 최근 직무체험을 이어서 열어요</small>
                    </span>
                  </button>

                  {scenarioNavigationState === "missing" && (
                    <p className={styles.headerMenuNotice} role="status">
                      아직 추천 직무를 받지 못했어요. 1:1 화면으로 이동할게요.
                    </p>
                  )}
                  {scenarioNavigationState === "error" && (
                    <p className={`${styles.headerMenuNotice} ${styles.headerMenuNoticeError}`} role="alert">
                      최근 체험을 확인하지 못했어요. 잠시 후 다시 시도해주세요.
                    </p>
                  )}
                </div>
              )}
            </div>
          </nav>
        </header>

        <div className={styles.layout}>
        <aside className={styles.profileRail}>
          <section className={styles.profileCard}>
            <div className={styles.profileMain}>
              <div className={styles.avatarOrbit}>
                <div className={styles.orbitDecoration} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <button
                  className={styles.avatarButton}
                  type="button"
                  aria-label="프로필 이미지 등록"
                  data-tooltip="프로필 이미지 변경"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarBusy}
                >
                  <span className={styles.avatar} aria-hidden="true">
                    {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
                  </span>
                  <span className={styles.avatarEditBadge} aria-hidden="true">
                    {avatarBusy ? <SpinnerGap className={styles.spinner} /> : <Camera weight="fill" />}
                  </span>
                </button>
                <input
                  ref={avatarInputRef}
                  className={styles.fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.item(0);
                    if (file) void handleAvatarUpload(file);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              <div className={styles.identity}>
                <span>내 커리어 보관함</span>
                <h1>{me?.name ?? "내 프로필"}</h1>
                <p>{me?.email ?? "로그인 계정"}</p>
                {avatarMessage && <small className={styles.avatarMessage} aria-live="polite">{avatarMessage}</small>}
              </div>
            </div>
            <div className={styles.profileStats} aria-label="보관 문서 현황">
              <div><span>보관 문서</span><strong>{documents.length}</strong></div>
              <div><span>이력서</span><strong>{resumeCount}</strong></div>
            </div>
          </section>

          <nav className={styles.profileNav} aria-label="내 정보 메뉴">
            <button
              className={activeSection === "documents" ? styles.profileNavButtonActive : undefined}
              type="button"
              onClick={() => setActiveSection("documents")}
            >
              <span className={styles.profileNavIcon}><Files weight="duotone" /></span>
              <span><strong>문서 보관함</strong><small>이력서와 증빙 서류 관리</small></span>
              <em>{documents.length}</em>
            </button>
            <button
              className={activeSection === "account" ? styles.profileNavButtonActive : undefined}
              type="button"
              onClick={() => setActiveSection("account")}
            >
              <span className={styles.profileNavIcon}><IdentificationCard weight="duotone" /></span>
              <span><strong>회원 정보</strong><small>이름과 로그인 보안 설정</small></span>
              <CaretRight weight="bold" />
            </button>
            <button
              className={activeSection === "activity" ? styles.profileNavButtonActive : undefined}
              type="button"
              onClick={() => setActiveSection("activity")}
            >
              <span className={styles.profileNavIcon}><GameController weight="duotone" /></span>
              <span><strong>활동 기록</strong><small>상담·체험·리포트 모아보기</small></span>
              {activityLoaded ? <em>{activityCount}</em> : <CaretRight weight="bold" />}
            </button>
          </nav>

        </aside>

        <section className={`${styles.workspace} ${activeSection !== "documents" ? styles.workspaceSingle : ""}`}>
          {activeSection === "documents" && (
            <>
              <section className={styles.uploadSection} aria-labelledby="upload-title">
                <div className={styles.uploadGrid}>
                  <UploadZone
                    kind="resume"
                    prominent
                    busy={uploadingKind === "resume"}
                    onSelect={handleUpload}
                  />
                  <div className={styles.supportingUploads}>
                    <UploadZone
                      kind="portfolio"
                      busy={uploadingKind === "portfolio"}
                      onSelect={handleUpload}
                    />
                    <UploadZone
                      kind="other"
                      busy={uploadingKind === "other"}
                      onSelect={handleUpload}
                    />
                  </div>
                </div>
              </section>

              <div className={styles.feedback} aria-live="polite">
                {error && <p className={styles.error}><WarningCircle weight="fill" />{error}</p>}
                {notice && !error && <p className={styles.success}><CheckCircle weight="fill" />{notice}</p>}
              </div>

              <section className={styles.documentsSection} aria-labelledby="documents-title">
                <div className={styles.documentHeading}>
                  <h2 id="documents-title">내 문서</h2>
                  <span>업로드 최신순</span>
                </div>

                {loading ? (
                  <div className={styles.loadingState}>
                    <SpinnerGap className={styles.spinner} aria-hidden="true" />
                    문서를 불러오고 있어요
                  </div>
                ) : documents.length === 0 ? (
                  <div className={styles.emptyState}>
                    <span><Files weight="duotone" /></span>
                    <h3>아직 보관한 문서가 없어요</h3>
                    <p>이력서를 올리면 이곳에서 바로 관리할 수 있어요.</p>
                  </div>
                ) : (
                  <div className={styles.documentTable}>
                    <div className={styles.documentTableHead} aria-hidden="true">
                      <span>파일 이름</span>
                      <span>유형</span>
                      <span>크기</span>
                      <span>업로드 날짜</span>
                      <span>관리</span>
                    </div>
                    <ul className={styles.documentList}>
                      {documents.map((document) => {
                        const meta = DOCUMENT_META[document.kind];
                        const Icon = meta.icon;
                        const confirming = confirmDeleteId === document.id;
                        return (
                          <li className={styles.documentRow} key={document.id}>
                            <div className={styles.documentName}>
                              <span className={styles.documentIcon}><Icon weight="duotone" /></span>
                              <strong title={document.original_name}>{document.original_name}</strong>
                            </div>
                            <span className={styles.documentKind}>{meta.label}</span>
                            <span className={styles.documentSize}>{formatFileSize(document.size_bytes)}</span>
                            <time dateTime={document.created_at}>{formatDate(document.created_at)}</time>
                            {confirming ? (
                              <div className={styles.deleteConfirm}>
                                <span>삭제할까요?</span>
                                <button type="button" onClick={() => setConfirmDeleteId(null)}>취소</button>
                                <button
                                  className={styles.deleteConfirmAction}
                                  type="button"
                                  onClick={() => void handleDelete(document.id)}
                                  disabled={deletingId === document.id}
                                >
                                  {deletingId === document.id ? "삭제 중" : "삭제"}
                                </button>
                              </div>
                            ) : (
                              <div className={styles.documentActions}>
                                <button type="button" onClick={() => void handleDownload(document)} aria-label={`${document.original_name} 다운로드`}>
                                  <DownloadSimple weight="bold" />
                                </button>
                                <button className={styles.deleteButton} type="button" onClick={() => setConfirmDeleteId(document.id)} aria-label={`${document.original_name} 삭제`}>
                                  <Trash weight="bold" />
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            </>
          )}

          {activeSection === "account" && (
            <section className={`${styles.detailSection} ${styles.accountSection}`}>
              <div className={styles.detailHeading}>
                <span><UserCircle weight="duotone" /></span>
                <div>
                  <h2>회원 정보</h2>
                  <p>JOBIVERSE에서 사용할 기본 정보와 로그인 보안을 관리해요.</p>
                </div>
              </div>

              <div className={styles.accountFeedback} aria-live="polite">
                {accountError && <p className={styles.error}><WarningCircle weight="fill" />{accountError}</p>}
                {accountNotice && !accountError && <p className={styles.success}><CheckCircle weight="fill" />{accountNotice}</p>}
              </div>

              <div className={styles.settingsGrid}>
                <form className={styles.settingsCard} onSubmit={(event) => void handleProfileSave(event)}>
                  <div className={styles.settingsCardHeading}>
                    <span><IdentificationCard weight="duotone" /></span>
                    <div><h3>기본 정보</h3><p>서비스에 표시되는 이름을 수정할 수 있어요.</p></div>
                  </div>
                  <label className={styles.formField}>
                    <span>이름</span>
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      maxLength={100}
                      autoComplete="name"
                    />
                  </label>
                  <label className={styles.formField}>
                    <span>이메일</span>
                    <input value={me?.email ?? ""} readOnly aria-readonly="true" />
                    <small>로그인 계정을 식별하는 이메일이라 이 화면에서는 변경할 수 없어요.</small>
                  </label>
                  <button
                    className={styles.primaryAction}
                    type="submit"
                    disabled={savingProfile || !profileName.trim() || profileName.trim() === me?.name}
                  >
                    {savingProfile ? <SpinnerGap className={styles.spinner} /> : <CheckCircle weight="bold" />}
                    {savingProfile ? "저장 중" : "변경사항 저장"}
                  </button>
                </form>

                <div className={styles.settingsCard}>
                  <div className={styles.settingsCardHeading}>
                    <span><ShieldCheck weight="duotone" /></span>
                    <div><h3>로그인 보안</h3><p>현재 계정 유형에 맞는 보안 설정을 제공해요.</p></div>
                  </div>
                  <div className={styles.accountType}>
                    <span><LockKey weight="duotone" /></span>
                    <div>
                      <strong>{me?.has_password ? "이메일·비밀번호 계정" : "소셜 로그인 계정"}</strong>
                      <p>{me?.has_password ? "비밀번호를 정기적으로 안전하게 관리해주세요." : "연결한 소셜 서비스에서 비밀번호를 관리합니다."}</p>
                    </div>
                  </div>

                  {me?.has_password ? (
                    <form className={styles.passwordForm} onSubmit={(event) => void handlePasswordSave(event)}>
                      <label className={styles.formField}>
                        <span>현재 비밀번호</span>
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={(event) => setCurrentPassword(event.target.value)}
                          autoComplete="current-password"
                        />
                      </label>
                      <div className={styles.passwordColumns}>
                        <label className={styles.formField}>
                          <span>새 비밀번호</span>
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            minLength={8}
                            maxLength={72}
                            autoComplete="new-password"
                            placeholder="8자 이상"
                          />
                        </label>
                        <label className={styles.formField}>
                          <span>새 비밀번호 확인</span>
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            minLength={8}
                            maxLength={72}
                            autoComplete="new-password"
                          />
                        </label>
                      </div>
                      <button
                        className={styles.secondaryAction}
                        type="submit"
                        disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                      >
                        {savingPassword ? <SpinnerGap className={styles.spinner} /> : <Key weight="bold" />}
                        {savingPassword ? "변경 중" : "비밀번호 변경"}
                      </button>
                    </form>
                  ) : (
                    <div className={styles.socialAccountNote}>
                      <span className={styles.socialAccountIcon}><ShieldCheck weight="duotone" /></span>
                      <div><strong>비밀번호 입력이 필요하지 않아요</strong><p>Google·Kakao·Naver 계정의 보안 설정은 해당 서비스에서 변경해주세요.</p></div>
                    </div>
                  )}
                </div>

                <form
                  className={`${styles.settingsCard} ${styles.policyProfileCard}`}
                  onSubmit={(event) => void handlePolicyProfileSave(event)}
                  aria-busy={policyProfileLoading || savingPolicyProfile}
                >
                  <div className={styles.settingsCardHeading}>
                    <span><MapPin weight="duotone" /></span>
                    <div>
                      <h3>맞춤 제도 프로필</h3>
                      <p>입력한 조건을 바탕으로 나에게 맞는 취업 지원제도를 찾아요.</p>
                    </div>
                  </div>

                  <div className={styles.policyProfileFeedback} aria-live="polite">
                    {policyProfileError ? (
                      <p className={styles.error}>
                        <WarningCircle weight="fill" />
                        {policyProfileError}
                      </p>
                    ) : policyProfileNotice ? (
                      <p className={styles.success}>
                        <CheckCircle weight="fill" />
                        {policyProfileNotice}
                      </p>
                    ) : null}
                  </div>

                  {policyProfileLoading && !policyProfile ? (
                    <div className={styles.policyProfileLoading}>
                      <SpinnerGap className={styles.spinner} aria-hidden="true" />
                      맞춤 제도 정보를 불러오고 있어요
                    </div>
                  ) : (
                    <>
                      <div className={styles.policyProfileFields}>
                        <label className={styles.formField}>
                          <span>출생 연도</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={POLICY_BIRTH_YEAR_MIN}
                            max={POLICY_BIRTH_YEAR_MAX}
                            value={policyProfileForm.birthYear}
                            onChange={(event) =>
                              setPolicyProfileForm((current) => ({
                                ...current,
                                birthYear: event.target.value,
                              }))
                            }
                            placeholder="예: 1993"
                            disabled={!policyProfile || savingPolicyProfile}
                          />
                        </label>

                        <label className={styles.formField}>
                          <span>성별</span>
                          <select
                            value={policyProfileForm.gender}
                            onChange={(event) =>
                              setPolicyProfileForm((current) => ({
                                ...current,
                                gender: event.target.value as PolicyProfileForm["gender"],
                              }))
                            }
                            disabled={!policyProfile || savingPolicyProfile}
                          >
                            <option value="">응답하지 않음</option>
                            <option value="male">남성</option>
                            <option value="female">여성</option>
                          </select>
                        </label>

                        <label className={styles.formField}>
                          <span>시도</span>
                          <select
                            value={policyProfileForm.regionCtpv}
                            onChange={(event) => {
                              const regionCtpv = event.target.value;
                              setPolicyProfileForm((current) => ({
                                ...current,
                                regionCtpv,
                                regionSgg: regionCtpv ? current.regionSgg : "",
                              }));
                            }}
                            disabled={!policyProfile || savingPolicyProfile}
                          >
                            <option value="">응답하지 않음</option>
                            {POLICY_REGION_CTPV.map((region) => (
                              <option key={region} value={region}>{region}</option>
                            ))}
                          </select>
                        </label>

                        <label className={styles.formField}>
                          <span>시군구</span>
                          <input
                            value={policyProfileForm.regionSgg}
                            onChange={(event) =>
                              setPolicyProfileForm((current) => ({
                                ...current,
                                regionSgg: event.target.value,
                              }))
                            }
                            maxLength={30}
                            placeholder={policyProfileForm.regionCtpv ? "예: 양주시" : "시도를 먼저 선택"}
                            disabled={
                              !policyProfile ||
                              !policyProfileForm.regionCtpv ||
                              savingPolicyProfile
                            }
                          />
                        </label>
                      </div>

                      <div className={styles.policySensitivePanel}>
                        <label className={styles.formField}>
                          <span>장애 여부</span>
                          <select
                            value={policyProfileForm.hasDisability}
                            onChange={(event) => {
                              const hasDisability =
                                event.target.value as PolicyDisabilitySelection;
                              setPolicyProfileForm((current) => ({
                                ...current,
                                hasDisability,
                                sensitiveAgreed: hasDisability
                                  ? current.sensitiveAgreed
                                  : false,
                              }));
                            }}
                            aria-describedby="policy-disability-help"
                            disabled={!policyProfile || savingPolicyProfile}
                          >
                            <option value="">응답하지 않음</option>
                            <option value="no">해당 없음</option>
                            <option value="yes">해당</option>
                          </select>
                        </label>

                        <label
                          className={`${styles.policyConsent} ${
                            policyProfileForm.hasDisability === ""
                              ? styles.policyConsentDisabled
                              : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={policyProfileForm.sensitiveAgreed}
                            onChange={(event) =>
                              setPolicyProfileForm((current) => ({
                                ...current,
                                sensitiveAgreed: event.target.checked,
                              }))
                            }
                            disabled={
                              !policyProfile ||
                              policyProfileForm.hasDisability === "" ||
                              (hasStoredSensitiveConsent &&
                                policyProfileForm.sensitiveAgreed) ||
                              savingPolicyProfile
                            }
                          />
                          <span>
                            <strong>장애 여부 저장에 동의합니다</strong>
                            <small id="policy-disability-help">
                              장애 여부는 민감정보로 분류되며 맞춤 제도 조회에만 사용해요.
                              저장된 답변을 철회하려면 장애 여부에서 응답하지 않음을 선택해주세요.
                            </small>
                          </span>
                        </label>
                      </div>

                      <div className={styles.policyProfileActions}>
                        <small>입력하지 않은 조건은 맞춤 제도 검색에서 제외돼요.</small>
                        <button
                          className={styles.primaryAction}
                          type="submit"
                          disabled={
                            !policyProfile ||
                            policyProfileLoading ||
                            savingPolicyProfile ||
                            !hasPolicyProfileChanges
                          }
                        >
                          {savingPolicyProfile ? (
                            <SpinnerGap className={styles.spinner} aria-hidden="true" />
                          ) : (
                            <CheckCircle weight="bold" aria-hidden="true" />
                          )}
                          {savingPolicyProfile ? "저장 중" : "맞춤 정보 저장"}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              </div>
            </section>
          )}

          {activeSection === "activity" && (
            <section className={`${styles.detailSection} ${styles.activitySection}`}>
              <div className={styles.detailHeading}>
                <span><GameController weight="duotone" /></span>
                <div>
                  <h2>활동 기록</h2>
                  <p>상담부터 직무 체험, 최종 리포트까지 커리어 여정을 한곳에서 확인해요.</p>
                </div>
              </div>

              <div className={styles.activitySummary}>
                <article><span><ChatCircleDots weight="duotone" /></span><div><small>상담</small><strong>{consultations.length}</strong></div></article>
                <article><span><GameController weight="duotone" /></span><div><small>직무 체험</small><strong>{simulations.length}</strong></div></article>
                <article><span><FileText weight="duotone" /></span><div><small>리포트</small><strong>{reports.length}</strong></div></article>
              </div>

              <div className={styles.activityArchive}>
                <div className={styles.activityArchiveHeading}>
                  <div><h3>최근 커리어 활동</h3><p>가장 최근 기록부터 보여드려요.</p></div>
                  <button type="button" onClick={() => void loadActivity()} disabled={activityLoading}>
                    {activityLoading ? <SpinnerGap className={styles.spinner} /> : "새로고침"}
                  </button>
                </div>

                {activityLoading && !activityLoaded ? (
                  <div className={styles.activityState}><SpinnerGap className={styles.spinner} />활동 기록을 불러오고 있어요</div>
                ) : activityError ? (
                  <div className={styles.activityState}><WarningCircle weight="duotone" />{activityError}</div>
                ) : activityItems.length === 0 ? (
                  <div className={styles.activityState}><GameController weight="duotone" /><strong>아직 저장된 활동이 없어요</strong><span>상담이나 직무 체험을 시작하면 여기에 차곡차곡 모여요.</span></div>
                ) : (
                  <ul className={styles.activityList}>
                    {activityItems.map((item) => {
                      const Icon = item.kind === "consultation" ? ChatCircleDots : item.kind === "simulation" ? GameController : FileText;
                      return (
                        <li key={item.id}>
                          <span className={styles.activityIcon}><Icon weight="duotone" /></span>
                          <div className={styles.activityCopy}>
                            <div><strong>{item.title}</strong><em data-status={item.status}>{item.status}</em></div>
                            <p>{item.description}</p>
                          </div>
                          <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                          <button type="button" onClick={() => openActivity(item)}>
                            {item.kind === "simulation" && item.simulation?.status === "active" ? "이어서 하기" : "확인하기"}
                            <CaretRight weight="bold" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}
        </section>
        </div>
      </div>
      <LogoutConfirmDialog
        open={isLogoutConfirmOpen}
        onCancel={() => setIsLogoutConfirmOpen(false)}
        onConfirm={() => {
          logout();
          window.location.assign(FRONTEND_ENDPOINTS.home);
        }}
      />
    </main>
  );
}
