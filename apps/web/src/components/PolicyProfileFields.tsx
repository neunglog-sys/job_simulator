import type { PolicyProfileGender } from "../lib/api";
import {
  POLICY_REGION_CTPV,
  type PolicyProfileForm,
} from "../lib/policyProfile";

type Props = {
  value: PolicyProfileForm;
  onChange: (next: PolicyProfileForm) => void;
  socialSignupNotice?: boolean;
};

export function PolicyProfileFields({
  value,
  onChange,
  socialSignupNotice = false,
}: Props) {
  const update = (patch: Partial<PolicyProfileForm>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <fieldset className="auth-policy-profile">
      <legend>
        <span>맞춤 제도 프로필</span>
        <small>선택 입력</small>
      </legend>
      <p className="auth-policy-description">
        혜택과 지원 제도를 더 정확히 추천해드려요. 지금 건너뛰고 마이페이지에서 입력해도
        괜찮아요.
      </p>
      {socialSignupNotice && (
        <p className="auth-policy-social-notice">
          소셜 가입은 개인정보 보호를 위해 로그인 완료 후 이 정보를 입력해요.
        </p>
      )}

      <div className="auth-policy-grid">
        <label className="auth-field">
          <span>출생 연도</span>
          <input
            type="text"
            inputMode="numeric"
            value={value.birthYear}
            onChange={(event) =>
              update({ birthYear: event.target.value.replace(/\D/g, "").slice(0, 4) })
            }
            placeholder="예: 1993"
            autoComplete="bday-year"
            maxLength={4}
          />
        </label>

        <label className="auth-field">
          <span>성별</span>
          <select
            value={value.gender}
            onChange={(event) =>
              update({ gender: event.target.value as "" | PolicyProfileGender })
            }
          >
            <option value="">선택 안 함</option>
            <option value="female">여성</option>
            <option value="male">남성</option>
          </select>
        </label>

        <label className="auth-field">
          <span>시도</span>
          <select
            value={value.regionCtpv}
            onChange={(event) =>
              update({
                regionCtpv: event.target.value,
                regionSgg: event.target.value ? value.regionSgg : "",
              })
            }
          >
            <option value="">선택 안 함</option>
            {POLICY_REGION_CTPV.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>

        <label className="auth-field">
          <span>시군구</span>
          <input
            type="text"
            value={value.regionSgg}
            onChange={(event) => update({ regionSgg: event.target.value })}
            placeholder="예: 수원시"
            disabled={!value.regionCtpv}
            maxLength={30}
          />
        </label>
      </div>

      <div className="auth-policy-sensitive">
        <label className="auth-field">
          <span>장애 여부</span>
          <select
            value={value.disability}
            onChange={(event) => {
              const disability = event.target.value as "" | "yes" | "no";
              update({
                disability,
                sensitiveAgreed: disability ? value.sensitiveAgreed : false,
              });
            }}
          >
            <option value="">선택 안 함</option>
            <option value="no">해당 없음</option>
            <option value="yes">해당함</option>
          </select>
        </label>

        <label className="auth-sensitive-consent" data-disabled={!value.disability}>
          <input
            type="checkbox"
            checked={value.sensitiveAgreed}
            onChange={(event) => update({ sensitiveAgreed: event.target.checked })}
            disabled={!value.disability}
          />
          <span>
            <strong>장애 여부 수집·이용에 동의합니다</strong>
            <small>맞춤 제도 조회에만 사용하며 응답하지 않음으로 언제든 철회할 수 있어요.</small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
