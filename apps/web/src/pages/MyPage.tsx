import {
  ArrowLeft,
  Briefcase,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  DownloadSimple,
  FilePdf,
  Files,
  FileText,
  GameController,
  House,
  IdentificationCard,
  Key,
  LockKey,
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
  fetchProfileDocuments,
  fetchReportPdfBlob,
  fetchReports,
  fetchSimulationSummaries,
  updateProfileAccount,
  uploadProfileDocument,
  type ConsultationSummary,
  type Report,
  type SimulationSummary,
  type UserDocument,
  type UserDocumentKind,
} from "../lib/api";
import { logout, refreshAuth, useAuth } from "../lib/auth";
import styles from "../styles/myPage.module.css";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MY_PAGE_DESIGN_WIDTH = 1920;
const MY_PAGE_DESIGN_HEIGHT = 900;

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

  const [profileName, setProfileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [simulations, setSimulations] = useState<SimulationSummary[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const me = auth.status === "authed" ? auth.me : null;

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
            <button type="button" onClick={() => window.history.back()} aria-label="이전 화면으로 이동">
              <ArrowLeft weight="bold" />
            </button>
            <a href={FRONTEND_ENDPOINTS.home} aria-label="JOBIVERSE 홈으로 이동">
              <span className={styles.brandMark} aria-hidden="true"><span /></span>
              <strong>JOBIVERSE</strong>
            </a>
          </div>
          <nav className={styles.topBarActions} aria-label="마이페이지 메뉴">
            <a href={FRONTEND_ENDPOINTS.home}>
              <House weight="duotone" />
              홈
            </a>
            <button type="button" onClick={() => setIsLogoutConfirmOpen(true)}>
              <SignOut weight="duotone" />
              로그아웃
            </button>
          </nav>
        </header>

        <div className={styles.layout}>
        <aside className={styles.profileRail}>
          <section className={styles.profileCard}>
            <div className={styles.profileMain}>
              <span className={styles.avatar} aria-hidden="true">{initial}</span>
              <div className={styles.identity}>
                <span>내 커리어 보관함</span>
                <h1>{me?.name ?? "내 프로필"}</h1>
                <p>{me?.email ?? "로그인 계정"}</p>
              </div>
            </div>
            <div className={styles.profileStats} aria-label="보관 문서 현황">
              <div><span>보관 문서</span><strong>{documents.length}</strong></div>
              <div><span>이력서</span><strong>{resumeCount}</strong></div>
            </div>
            <div className={styles.orbitDecoration} aria-hidden="true">
              <span />
              <span />
              <span />
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

          <section className={styles.privacyNote}>
            <span aria-hidden="true"><LockKey weight="duotone" /></span>
            <div>
              <h2>내 자료는 나만 볼 수 있어요</h2>
              <p>로그인한 계정에서만 열고 내려받을 수 있습니다.</p>
            </div>
          </section>
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
                      <ShieldCheck weight="duotone" />
                      <div><strong>비밀번호 입력이 필요하지 않아요</strong><p>Google·Kakao·Naver 계정의 보안 설정은 해당 서비스에서 변경해주세요.</p></div>
                    </div>
                  )}
                </div>
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
