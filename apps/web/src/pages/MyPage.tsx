import {
  ArrowLeft,
  Briefcase,
  CheckCircle,
  DownloadSimple,
  FilePdf,
  Files,
  House,
  LockKey,
  SignOut,
  SpinnerGap,
  Trash,
  UploadSimple,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { FRONTEND_ENDPOINTS } from "../config/endpoints";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
import {
  deleteProfileDocument,
  downloadProfileDocument,
  fetchProfileDocuments,
  uploadProfileDocument,
  type UserDocument,
  type UserDocumentKind,
} from "../lib/api";
import { logout, useAuth } from "../lib/auth";
import styles from "../styles/myPage.module.css";

const MAX_FILE_SIZE = 8 * 1024 * 1024;

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
      <span className={styles.uploadIcon} aria-hidden="true">
        <Icon weight="duotone" />
      </span>
      <div className={styles.uploadCopy}>
        <span className={styles.uploadEyebrow}>{prominent ? "PRIMARY DOCUMENT" : "SUPPORTING FILE"}</span>
        <h2>{meta.label}</h2>
        <p>{meta.description}</p>
      </div>
      <button
        className={styles.uploadButton}
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <SpinnerGap className={styles.spinner} aria-hidden="true" /> : <UploadSimple aria-hidden="true" />}
        {busy ? "업로드 중" : "PDF 선택"}
      </button>
      <small>PDF · 최대 8MB</small>
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
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingKind, setUploadingKind] = useState<UserDocumentKind | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

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

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

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

  const me = auth.status === "authed" ? auth.me : null;
  const initial = me?.name.trim().charAt(0) || "나";
  const resumeCount = documents.filter((document) => document.kind === "resume").length;

  return (
    <main className={styles.page}>
      <div className={styles.background} aria-hidden="true" />
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
          <button
            type="button"
            onClick={() => setIsLogoutConfirmOpen(true)}
          >
            <SignOut weight="duotone" />
            로그아웃
          </button>
        </nav>
      </header>

      <div className={styles.layout}>
        <aside className={styles.profileRail}>
          <section className={styles.profileCard}>
            <p className={styles.eyebrow}>CAREER PROFILE</p>
            <span className={styles.avatar} aria-hidden="true">{initial}</span>
            <div className={styles.identity}>
              <h1>{me?.name ?? "내 프로필"}</h1>
              <p>{me?.email ?? "로그인 계정"}</p>
            </div>
            <div className={styles.profileStats}>
              <div><strong>{documents.length}</strong><span>보관 문서</span></div>
              <div><strong>{resumeCount}</strong><span>이력서</span></div>
            </div>
          </section>

          <section className={styles.privacyNote}>
            <span><LockKey weight="duotone" /></span>
            <div>
              <h2>내 문서는 나만 볼 수 있어요</h2>
              <p>업로드한 PDF는 로그인한 계정에서만 열고 내려받을 수 있습니다.</p>
            </div>
          </section>
        </aside>

        <section className={styles.workspace}>
          <div className={styles.workspaceIntro}>
            <div>
              <p className={styles.eyebrow}>MY CAREER ARCHIVE</p>
              <h1>내 정보</h1>
              <p>지원에 필요한 서류를 한곳에 모아두고 필요할 때 바로 꺼내 쓰세요.</p>
            </div>
            <span className={styles.workspaceBadge}><UserCircle weight="duotone" /> 개인 문서함</span>
          </div>

          <section className={styles.uploadSection} aria-labelledby="upload-title">
            <div className={styles.sectionHeading}>
              <div>
                <span>01</span>
                <h2 id="upload-title">문서 추가</h2>
              </div>
              <p>파일을 끌어놓거나 PDF 선택 버튼을 눌러주세요.</p>
            </div>
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
            <div className={styles.sectionHeading}>
              <div>
                <span>02</span>
                <h2 id="documents-title">내 문서</h2>
                <em>{documents.length}</em>
              </div>
              <p>최신 문서부터 표시됩니다.</p>
            </div>

            {loading ? (
              <div className={styles.loadingState}>
                <SpinnerGap className={styles.spinner} aria-hidden="true" />
                문서를 불러오고 있어요.
              </div>
            ) : documents.length === 0 ? (
              <div className={styles.emptyState}>
                <span><Files weight="duotone" /></span>
                <h3>아직 보관한 문서가 없어요</h3>
                <p>첫 이력서를 올리면 이곳에서 바로 관리할 수 있어요.</p>
              </div>
            ) : (
              <ul className={styles.documentList}>
                {documents.map((document) => {
                  const meta = DOCUMENT_META[document.kind];
                  const Icon = meta.icon;
                  const confirming = confirmDeleteId === document.id;
                  return (
                    <li className={styles.documentRow} key={document.id}>
                      <span className={styles.documentIcon}><Icon weight="duotone" /></span>
                      <div className={styles.documentInfo}>
                        <strong title={document.original_name}>{document.original_name}</strong>
                        <span>{meta.label} · {formatFileSize(document.size_bytes)} · {formatDate(document.created_at)}</span>
                      </div>
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
            )}
          </section>
        </section>
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
